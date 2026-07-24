// lib/booking/depositReleaseSweep.ts
//
// Auto-release sweep for abandoned new-client discovery deposits (M5).
//
// A discovery-deposit booking is created occupying the pro's calendar BEFORE the
// client pays the deposit (PENDING when the pro doesn't auto-accept, ACCEPTED
// when they do — both occupy the slot). If the client never completes the
// deposit checkout, nothing frees that slot: no cron touches depositStatus, the
// Stripe checkout.session.expired handler is a deliberate no-op (M2), and the
// deposit was meant to secure the slot in the first place. This sweep is the
// backstop: once an unpaid deposit is older than the deadline, it releases the
// hold (cancels the booking) so the time is bookable again, and notifies the
// client with a rebook invitation.
//
// It keys on the BOOKING'S AGE (createdAt), not on a Stripe event, because the
// deposit checkout session is created on demand (only when the client taps "Pay
// deposit") — a client who books and never starts checkout fires no
// checkout.session.expired at all, so an event-driven release would miss the
// majority of abandonment. Age covers both populations.
//
// Safety:
//   - Only depositStatus=PENDING (unambiguously "deposit required, never paid"),
//     status ∈ {PENDING, ACCEPTED}, appointment still in the future.
//   - Each release re-checks depositStatus=PENDING under a FOR UPDATE row lock
//     (releaseUnpaidDepositBookingBySystem) so a payment landing mid-sweep is
//     never wrongly cancelled — see that function.
//   - Kill switch DEPOSIT_AUTO_RELEASE_ENABLED (default on). When off, the sweep
//     only observes: it logs the candidate count and releases nothing.
//   - Per-run cap MAX_RELEASES_PER_RUN, truncation logged.
//   - Never throws; per-booking failures are tallied and the rest of the run
//     proceeds.

import { BookingDepositStatus, BookingStatus, type Prisma } from '@prisma/client'

import {
  depositAutoReleaseEnabled,
  depositUnpaidDeadlineHours,
} from '@/lib/booking/depositDeadline'
import { releaseUnpaidDepositBookingBySystem } from '@/lib/booking/writeBoundary'
import { captureBookingException } from '@/lib/observability/bookingEvents'
import { prisma } from '@/lib/prisma'
import { logSweepObservation } from '@/lib/observability/sweepObservation'

export const MAX_RELEASES_PER_RUN = 100

const ROUTE = 'GET /api/internal/jobs/deposit-release'

export type DepositReleaseOutcome =
  | 'released'
  | 'deposit_not_pending'
  | 'status_not_releasable'
  | 'not_found'
  | 'release_error'

export type DepositReleaseResult = {
  bookingId: string
  outcome: DepositReleaseOutcome
}

export type DepositReleaseRunResult = {
  enabled: boolean
  deadlineHours: number
  candidatesScanned: number
  capped: boolean
  releasedCount: number
  tally: Record<DepositReleaseOutcome, number>
  results: DepositReleaseResult[]
}

const EMPTY_TALLY: Record<DepositReleaseOutcome, number> = {
  released: 0,
  deposit_not_pending: 0,
  status_not_releasable: 0,
  not_found: 0,
  release_error: 0,
}

const CANDIDATE_SELECT = {
  id: true,
  professionalId: true,
  clientId: true,
  createdAt: true,
  scheduledFor: true,
  status: true,
} satisfies Prisma.BookingSelect

/**
 * Release abandoned unpaid-deposit holds older than the deadline. Never throws.
 */
export async function releaseAbandonedDepositBookings(opts?: {
  now?: Date
}): Promise<DepositReleaseRunResult> {
  const now = opts?.now ?? new Date()
  const deadlineHours = depositUnpaidDeadlineHours()
  const enabled = depositAutoReleaseEnabled()
  const cutoff = new Date(now.getTime() - deadlineHours * 60 * 60 * 1000)

  // Only future-occupying holds: an appointment already in the past no longer
  // blocks availability (which is forward-looking), and a past unpaid booking is
  // stale-sessions' concern, not a slot to free.
  const candidates = await prisma.booking.findMany({
    where: {
      depositStatus: BookingDepositStatus.PENDING,
      status: { in: [BookingStatus.PENDING, BookingStatus.ACCEPTED] },
      createdAt: { lte: cutoff },
      scheduledFor: { gt: now },
    },
    select: CANDIDATE_SELECT,
    orderBy: { createdAt: 'asc' },
    take: MAX_RELEASES_PER_RUN + 1,
  })

  const capped = candidates.length > MAX_RELEASES_PER_RUN
  const batch = capped ? candidates.slice(0, MAX_RELEASES_PER_RUN) : candidates

  const tally: Record<DepositReleaseOutcome, number> = { ...EMPTY_TALLY }
  const results: DepositReleaseResult[] = []

  if (!enabled) {
    // Kill switch off — observe only. Surfaces how many holds WOULD be released
    // so the release can be enabled with confidence (matches stale-sessions'
    // observe-before-act rollout).
    logSweepObservation('deposit_unpaid_release', {
      mode: 'observe_only',
      deadlineHours,
      candidatesScanned: batch.length,
      capped,
      scannedAt: now.toISOString(),
    })
    return {
      enabled: false,
      deadlineHours,
      candidatesScanned: batch.length,
      capped,
      releasedCount: 0,
      tally,
      results,
    }
  }

  for (const booking of batch) {
    try {
      const outcome = await releaseUnpaidDepositBookingBySystem({
        bookingId: booking.id,
      })
      if (outcome.released) {
        tally.released += 1
        results.push({ bookingId: booking.id, outcome: 'released' })
        logSweepObservation('deposit_unpaid_release', {
          mode: 'released',
          bookingId: booking.id,
          professionalId: booking.professionalId,
          clientId: booking.clientId,
          previousStatus: outcome.previousStatus,
          createdAt: booking.createdAt.toISOString(),
          scheduledFor: booking.scheduledFor.toISOString(),
          ageHours: Number(
            ((now.getTime() - booking.createdAt.getTime()) / 3_600_000).toFixed(2),
          ),
          deadlineHours,
        })
      } else {
        const key: DepositReleaseOutcome =
          outcome.reason === 'DEPOSIT_NOT_PENDING'
            ? 'deposit_not_pending'
            : outcome.reason === 'STATUS_NOT_RELEASABLE'
              ? 'status_not_releasable'
              : 'not_found'
        tally[key] += 1
        results.push({ bookingId: booking.id, outcome: key })
      }
    } catch (error: unknown) {
      tally.release_error += 1
      results.push({ bookingId: booking.id, outcome: 'release_error' })
      captureBookingException({
        error,
        route: ROUTE,
        event: 'DEPOSIT_RELEASE_ERROR',
        bookingId: booking.id,
      })
    }
  }

  if (capped) {
    logSweepObservation('deposit_unpaid_release', {
      mode: 'capped',
      cap: MAX_RELEASES_PER_RUN,
      candidatesScanned: candidates.length,
      scannedAt: now.toISOString(),
    })
  }

  return {
    enabled: true,
    deadlineHours,
    candidatesScanned: batch.length,
    capped,
    releasedCount: tally.released,
    tally,
    results,
  }
}
