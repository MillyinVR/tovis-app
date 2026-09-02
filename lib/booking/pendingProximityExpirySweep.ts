// lib/booking/pendingProximityExpirySweep.ts
//
// Release a PENDING request the professional never answered, before its
// appointment arrives. Shipped for Book the Look (B4) and widened to every
// pro's pending requests on 2026-08-31 — see SCOPE below.
//
// WHY THIS IS THE PRICE OF REQUEST-MODE IMPULSE. Decision 4 routes a
// book-the-look commitment through the pro's existing `autoAcceptBookings`
// toggle. With it OFF the client still commits — deposit taken, slot reserved,
// "held for you; the pro confirms in the morning" — because PENDING already
// occupies the slot (`BOOKING_BLOCKING_STATUSES`, EXCLUDE-backed). That is a
// good trade only if a pro who never answers cannot leave the client holding a
// paid, unconfirmed appointment she then turns up for. Nothing in the repo did
// that: `stale-sessions` observes 48h-old PENDING rows and mutates nothing.
//
// SCOPE — WIDENED (Tori, 2026-08-31). This sweep began scoped to bookings
// carrying a B4 booking PROPOSAL, because auto-cancelling every pro's pending
// requests was a product change nobody had made. Tori has now made it: the
// expiry applies to EVERY pending request, on the same rules and the same two
// windows. The reasoning that justified it for book-the-look was never actually
// specific to book-the-look — a client who paid to hold a slot and turns up to
// an appointment the pro never confirmed is in the same position however she
// booked, and today those requests expire never.
//
// 🔴 THIS IS NOT FOUNDER-GATED and it touches every professional's pending
// bookings. `PENDING_PROXIMITY_EXPIRY_ENABLED` (default on) is the kill switch
// if the blast radius surprises anyone; turning it off returns the sweep to
// observing and releasing nothing.
//
// Safety:
//   - Only status=PENDING and an appointment still in the future.
//   - TWO thresholds: the appointment is within the proximity window AND the
//     request has had its minimum answer window. The second is what keeps a
//     3 AM booking for a 1 PM slot from being cancelled at 3:01
//     (lib/booking/pendingProximityDeadline.ts).
//   - Each expiry re-checks status under a FOR UPDATE row lock
//     (expirePendingBookingBySystem), so a pro accepting mid-sweep is never
//     told "expired" about an appointment that is going ahead.
//   - The deposit refund runs AFTER the cancel transaction commits, because
//     Stripe I/O cannot live inside it — the same two-phase shape every other
//     cancel path uses. `applyDiscoveryDepositCancelRefund` is best-effort and
//     never throws, and the refund-retry sweep picks up a failure — which is
//     true because the cancel stamps `cancelledBySystem`. Before that stamp
//     existed the sweep read this cancel's null role as unknown provenance and
//     refused it, so this comment described a retry that could never happen.
//   - Kill switch PENDING_PROXIMITY_EXPIRY_ENABLED (default on). When off, the
//     sweep only observes: it logs the candidate count and releases nothing.
//   - Per-run cap MAX_EXPIRIES_PER_RUN, truncation logged.
//   - Never throws; per-booking failures are tallied and the run proceeds.

import { BookingStatus, type Prisma } from '@prisma/client'

import { applyDiscoveryDepositCancelRefund } from '@/lib/booking/cancelRefund'
import {
  pendingProximityExpiryEnabled,
  pendingProximityExpiryHours,
  pendingProximityMinAnswerHours,
} from '@/lib/booking/pendingProximityDeadline'
import {
  expirePendingBookingBySystem,
  PENDING_PROXIMITY_EXPIRY_REASON,
} from '@/lib/booking/writeBoundary'
import { captureBookingException } from '@/lib/observability/bookingEvents'
import { prisma } from '@/lib/prisma'
import { logSweepObservation } from '@/lib/observability/sweepObservation'

export const MAX_EXPIRIES_PER_RUN = 100

const ROUTE = 'GET /api/internal/jobs/pending-proximity-expiry'

export type PendingProximityExpiryOutcome =
  | 'expired'
  | 'status_not_pending'
  | 'already_started'
  | 'not_found'
  | 'expire_error'

export type PendingProximityExpiryResult = {
  bookingId: string
  outcome: PendingProximityExpiryOutcome
}

export type PendingProximityExpiryRunResult = {
  enabled: boolean
  proximityHours: number
  minAnswerHours: number
  candidatesScanned: number
  capped: boolean
  expiredCount: number
  refundedCount: number
  tally: Record<PendingProximityExpiryOutcome, number>
  results: PendingProximityExpiryResult[]
}

const EMPTY_TALLY: Record<PendingProximityExpiryOutcome, number> = {
  expired: 0,
  status_not_pending: 0,
  already_started: 0,
  not_found: 0,
  expire_error: 0,
}

const CANDIDATE_SELECT = {
  id: true,
  professionalId: true,
  clientId: true,
  createdAt: true,
  scheduledFor: true,
} satisfies Prisma.BookingSelect

/**
 * Release any unanswered PENDING request whose appointment is close.
 * Never throws.
 */
export async function expireProximatePendingBookings(opts?: {
  now?: Date
}): Promise<PendingProximityExpiryRunResult> {
  const now = opts?.now ?? new Date()
  const proximityHours = pendingProximityExpiryHours()
  const minAnswerHours = pendingProximityMinAnswerHours()
  const enabled = pendingProximityExpiryEnabled()

  const proximityCutoff = new Date(
    now.getTime() + proximityHours * 60 * 60 * 1000,
  )
  const minAnswerCutoff = new Date(
    now.getTime() - minAnswerHours * 60 * 60 * 1000,
  )

  const candidates = await prisma.booking.findMany({
    where: {
      status: BookingStatus.PENDING,
      // Only future appointments: an appointment already in the past no longer
      // blocks availability (which is forward-looking), and cancelling it would
      // tell the client about a slot that has already gone by.
      scheduledFor: { gt: now, lte: proximityCutoff },
      // The minimum answer window. Without this the impulse case cancels itself
      // — and it is doing MORE work now than it did when this sweep only saw
      // book-the-look requests: an ordinary pro-side request created minutes
      // before a same-day appointment is exactly the shape this protects.
      createdAt: { lte: minAnswerCutoff },
    },
    select: CANDIDATE_SELECT,
    orderBy: { scheduledFor: 'asc' },
    take: MAX_EXPIRIES_PER_RUN + 1,
  })

  const capped = candidates.length > MAX_EXPIRIES_PER_RUN
  const batch = capped ? candidates.slice(0, MAX_EXPIRIES_PER_RUN) : candidates

  const tally: Record<PendingProximityExpiryOutcome, number> = { ...EMPTY_TALLY }
  const results: PendingProximityExpiryResult[] = []
  let refundedCount = 0

  if (!enabled) {
    // Kill switch off — observe only. Surfaces how many requests WOULD be
    // released, matching the deposit-release sweep's observe-before-act shape.
    logSweepObservation('pending_proximity_expiry', {
      mode: 'observe_only',
      proximityHours,
      minAnswerHours,
      candidatesScanned: batch.length,
      capped,
      scannedAt: now.toISOString(),
    })
    return {
      enabled: false,
      proximityHours,
      minAnswerHours,
      candidatesScanned: batch.length,
      capped,
      expiredCount: 0,
      refundedCount: 0,
      tally,
      results,
    }
  }

  for (const booking of batch) {
    try {
      const outcome = await expirePendingBookingBySystem({
        bookingId: booking.id,
      })

      if (!outcome.expired) {
        const key: PendingProximityExpiryOutcome =
          outcome.reason === 'STATUS_NOT_PENDING'
            ? 'status_not_pending'
            : outcome.reason === 'ALREADY_STARTED'
              ? 'already_started'
              : 'not_found'
        tally[key] += 1
        results.push({ bookingId: booking.id, outcome: key })
        continue
      }

      tally.expired += 1
      results.push({ bookingId: booking.id, outcome: 'expired' })

      // Post-commit, because Stripe I/O cannot live in the cancel transaction.
      // `actorKind: 'system'` refunds the deposit AND the one-time platform fee
      // in full: the client did everything asked of her and did not get an
      // appointment, so she keeps nothing of the cost. Best-effort by
      // construction — this helper never throws, and a FAILED refund is picked
      // up by the refund-retry sweep (the cancel above stamps
      // `cancelledBySystem`, which is what makes that pickup possible).
      const refund = await applyDiscoveryDepositCancelRefund({
        bookingId: booking.id,
        actorKind: 'system',
        actorUserId: null,
        cancelMutated: true,
        now,
        reason: PENDING_PROXIMITY_EXPIRY_REASON,
      })
      if (refund.outcome === 'REFUNDED') refundedCount += 1

      logSweepObservation('pending_proximity_expiry', {
        mode: 'expired',
        bookingId: booking.id,
        professionalId: booking.professionalId,
        clientId: booking.clientId,
        createdAt: booking.createdAt.toISOString(),
        scheduledFor: booking.scheduledFor.toISOString(),
        hoursUntilAppointment: Number(
          ((booking.scheduledFor.getTime() - now.getTime()) / 3_600_000).toFixed(2),
        ),
        ageHours: Number(
          ((now.getTime() - booking.createdAt.getTime()) / 3_600_000).toFixed(2),
        ),
        proximityHours,
        minAnswerHours,
        refundOutcome: refund.outcome,
      })
    } catch (error: unknown) {
      tally.expire_error += 1
      results.push({ bookingId: booking.id, outcome: 'expire_error' })
      captureBookingException({
        error,
        route: ROUTE,
        event: 'PENDING_PROXIMITY_EXPIRY_ERROR',
        bookingId: booking.id,
      })
    }
  }

  if (capped) {
    logSweepObservation('pending_proximity_expiry', {
      mode: 'capped',
      cap: MAX_EXPIRIES_PER_RUN,
      candidatesScanned: candidates.length,
      scannedAt: now.toISOString(),
    })
  }

  return {
    enabled: true,
    proximityHours,
    minAnswerHours,
    candidatesScanned: batch.length,
    capped,
    expiredCount: tally.expired,
    refundedCount,
    tally,
    results,
  }
}
