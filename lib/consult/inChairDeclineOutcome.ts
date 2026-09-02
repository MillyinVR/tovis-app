// lib/consult/inChairDeclineOutcome.ts
//
// Book the Look, slice B6 — WHAT HAPPENS TO THE DEPOSIT WHEN SHE SAYS NO.
//
// Tori, 2026-08-31: "decline-in-the-chair — the PRO decides each time. When the
// client declines the finalized number, the pro gets an explicit keep-deposit /
// refund-deposit choice in the moment, recorded on the outcome (who chose,
// which way)."
//
// Three things make this honest rather than a button that hopes:
//
// 1. IT IS ASKED ONLY WHEN THERE IS MONEY TO DECIDE ABOUT. A booking with no
//    captured deposit has nothing to keep or refund, and offering a pro a
//    choice with no consequence is how a surface teaches her to ignore it.
//
// 2. IT IS ANSWERED ONCE. `BookingCloseoutAuditLog`'s own
//    `@@unique([bookingId, action, idempotencyKey])` is the lock, with a
//    booking-scoped key — so a double tap, a retry or a second pro on the same
//    account records one answer, not two, and the second attempt cannot issue a
//    second refund.
//
// 3. THE REFUND IS THE REFUND MACHINERY. `refundDiscoveryDeposit` is the same
//    function a cancellation refund goes through: it claims the deposit row
//    PAID → REFUNDED under the per-booking refund lock BEFORE calling Stripe,
//    refuses a disputed charge, and carries a deterministic Stripe idempotency
//    key. Nothing is forked here. Stripe stays ON HOLD — no key, price or
//    webhook is touched.
//
// 🔴 A KEEP moves no money, and it is recorded anyway. That is the whole point
// of "recorded on the outcome": the absence of a refund must be a decision
// somebody made and signed, not a silence.

import 'server-only'

import {
  BookingCloseoutAuditAction,
  BookingDepositStatus,
  BookingRefundTrigger,
  ConsultationApprovalStatus,
  Prisma,
  Role,
} from '@prisma/client'

import { createBookingCloseoutAuditLog } from '@/lib/booking/closeoutAudit'
import type {
  ConsultDeclineDepositChoice,
  ConsultDeclineDepositSettlement,
} from '@/lib/consult/declineDepositSettlement'
import { refundDiscoveryDeposit } from '@/lib/booking/refunds'
import { prisma } from '@/lib/prisma'
import { safeError } from '@/lib/security/logging'

const ROUTE = 'lib/consult/inChairDeclineOutcome.ts'

/**
 * One answer per booking. The audit table's unique index is on
 * `(bookingId, action, idempotencyKey)`, so a constant key here is what turns
 * "she may answer once" into a database fact rather than a race.
 */
const DECISION_IDEMPOTENCY_KEY = 'consult-decline-deposit'

export type {
  ConsultDeclineDepositChoice,
  ConsultDeclineDepositSettlement,
} from '@/lib/consult/declineDepositSettlement'

export type ConsultDeclineDepositState = {
  /** Cents the client paid up front: the deposit portion plus her platform fee. */
  depositChargeCents: number
  /** The answer already on record, or null while it is still open. */
  decidedChoice: ConsultDeclineDepositChoice | null
  decidedAt: string | null
  /**
   * Cents of that charge ACTUALLY back with the client, read off the booking —
   * `depositRefundedCents`, the counter Stripe's own refund webhook maintains.
   *
   * 🔴 Read from the money, never from the recorded choice. The decision row is
   * written BEFORE the Stripe call and is never revised, so a REFUND whose
   * refund then failed leaves a decision saying "refund" next to a deposit that
   * never moved. Deriving the sentence from this counter is what stops the page
   * repeating a refund that did not happen every time it reloads.
   */
  refundedCents: number
}

export type ConsultDeclineDepositResult =
  | {
      ok: true
      choice: ConsultDeclineDepositChoice
      settlement: ConsultDeclineDepositSettlement
      refundedCents: number
    }
  | { ok: false; code: 'NOT_FOUND' | 'NOT_APPLICABLE' | 'ALREADY_DECIDED' }
  | { ok: false; code: 'REFUND_FAILED'; message: string }

const DECLINE_BOOKING_SELECT = {
  id: true,
  professionalId: true,
  depositStatus: true,
  depositAmount: true,
  discoveryFeeAmount: true,
  depositRefundedCents: true,
  depositStripePaymentIntentId: true,
  consultBookingProposal: { select: { id: true } },
  consultationApproval: { select: { status: true } },
} satisfies Prisma.BookingSelect

type DeclineBookingRow = Prisma.BookingGetPayload<{
  select: typeof DECLINE_BOOKING_SELECT
}>

/**
 * Could this booking EVER have carried the question? Look-anchored, and its
 * client declined.
 *
 * Separate from `isChoicePending` because it is also what gates the audit-table
 * read: a pro's session page loads on every step of every appointment, and a
 * second query per load to discover that a question was never asked is a cost
 * with no reader.
 */
function isDeclineDepositQuestion(booking: DeclineBookingRow): boolean {
  return (
    booking.consultBookingProposal !== null &&
    booking.consultationApproval?.status === ConsultationApprovalStatus.REJECTED
  )
}

function isChoicePending(booking: DeclineBookingRow): boolean {
  // Only a declined look-anchored booking with a deposit still captured.
  // `REFUNDED` is excluded because the money has already gone back — by this
  // route or any other — and there is nothing left to choose.
  return (
    isDeclineDepositQuestion(booking) &&
    booking.depositStatus === BookingDepositStatus.PAID &&
    Boolean(booking.depositStripePaymentIntentId)
  )
}

/**
 * The client's whole up-front charge in cents: the deposit portion plus the
 * one-time client convenience fee that rode the same PaymentIntent. Both are
 * hers, so both are what a REFUND returns — the same total
 * `resolveDepositRefundPlan` hands back on a pro-side cancellation.
 */
function depositChargeCents(booking: DeclineBookingRow): number {
  const deposit = booking.depositAmount
    ? Math.round(Number(booking.depositAmount) * 100)
    : 0
  return deposit + (booking.discoveryFeeAmount ?? 0)
}

function parseChoice(value: unknown): ConsultDeclineDepositChoice | null {
  return value === 'KEEP' || value === 'REFUND' ? value : null
}

function readRecordedChoice(metadata: Prisma.JsonValue | null): {
  choice: ConsultDeclineDepositChoice | null
} {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return { choice: null }
  }
  return { choice: parseChoice((metadata as Prisma.JsonObject).choice) }
}

/**
 * Is this pro being asked the question, and has she already answered it?
 *
 * Returns null when the question does not apply at all, so a surface renders
 * nothing rather than an empty prompt.
 */
export async function loadConsultDeclineDepositState(args: {
  bookingId: string
  professionalId: string
}): Promise<ConsultDeclineDepositState | null> {
  const booking = await prisma.booking.findFirst({
    where: { id: args.bookingId, professionalId: args.professionalId },
    select: DECLINE_BOOKING_SELECT,
  })

  if (!booking) return null

  // Nothing to ask and nothing to read back: return before touching the audit
  // table at all.
  if (!isDeclineDepositQuestion(booking)) return null

  const decision = await prisma.bookingCloseoutAuditLog.findFirst({
    where: {
      bookingId: booking.id,
      action: BookingCloseoutAuditAction.CONSULTATION_DECLINE_DEPOSIT_DECIDED,
    },
    select: { createdAt: true, metadata: true },
    orderBy: { createdAt: 'desc' },
  })

  // An answered question stays on screen — as the ANSWER. A pro who chose
  // "keep" and then wonders what she did must be able to read it back; that is
  // most of what "recorded on the outcome" is for.
  if (decision) {
    return {
      depositChargeCents: depositChargeCents(booking),
      decidedChoice: readRecordedChoice(decision.metadata).choice,
      decidedAt: decision.createdAt.toISOString(),
      refundedCents: booking.depositRefundedCents,
    }
  }

  if (!isChoicePending(booking)) return null

  return {
    depositChargeCents: depositChargeCents(booking),
    decidedChoice: null,
    decidedAt: null,
    refundedCents: booking.depositRefundedCents,
  }
}

/**
 * Record the pro's choice, and move the money when the choice is REFUND.
 *
 * ORDER MATTERS, and it is: claim the decision, then refund. The audit row is
 * written first inside its own transaction, so the unique index refuses a
 * second answer BEFORE a second Stripe call can be made. A refund that then
 * fails leaves a recorded REFUND decision with no money moved — which is the
 * honest state, visible in the audit trail, and recoverable by the ordinary
 * refund tooling. The reverse order would risk refunding twice, which is not
 * recoverable.
 */
export async function recordConsultDeclineDepositChoice(args: {
  bookingId: string
  professionalId: string
  actorUserId: string
  choice: ConsultDeclineDepositChoice
}): Promise<ConsultDeclineDepositResult> {
  const booking = await prisma.booking.findFirst({
    where: { id: args.bookingId, professionalId: args.professionalId },
    select: DECLINE_BOOKING_SELECT,
  })

  if (!booking) return { ok: false, code: 'NOT_FOUND' }
  if (!isChoicePending(booking)) return { ok: false, code: 'NOT_APPLICABLE' }

  const chargeCents = depositChargeCents(booking)

  try {
    await prisma.$transaction(async (tx) => {
      await createBookingCloseoutAuditLog({
        tx,
        bookingId: booking.id,
        professionalId: booking.professionalId,
        actorUserId: args.actorUserId,
        action:
          BookingCloseoutAuditAction.CONSULTATION_DECLINE_DEPOSIT_DECIDED,
        route: ROUTE,
        idempotencyKey: DECISION_IDEMPOTENCY_KEY,
        oldValue: { depositChoice: null },
        newValue: { depositChoice: args.choice },
        metadata: {
          choice: args.choice,
          depositChargeCents: chargeCents,
          chosenByUserId: args.actorUserId,
        },
      })
    })
  } catch (error: unknown) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      return { ok: false, code: 'ALREADY_DECIDED' }
    }
    throw error
  }

  if (args.choice === 'KEEP') {
    // No money moves — and that is the decision, now signed and dated.
    return { ok: true, choice: 'KEEP', settlement: 'KEPT', refundedCents: 0 }
  }

  const paymentIntentId = booking.depositStripePaymentIntentId
  if (!paymentIntentId) {
    // `isChoicePending` already required one; belt and braces so the refund
    // call site never takes a null id.
    return { ok: false, code: 'NOT_APPLICABLE' }
  }

  const remaining = chargeCents - booking.depositRefundedCents

  const refund = await refundDiscoveryDeposit({
    bookingId: booking.id,
    paymentIntentId,
    refundAmountCents: remaining,
    // Her fee goes back with her deposit: the appointment is not happening and
    // the pro chose to make her whole. Same ledger as a pro-side cancellation
    // (lib/booking/discoveryDepositPlan.ts).
    refundFee: true,
    // A human made a discretionary call. AUTO_CANCELLATION would put this row
    // in front of the retry sweep, which is for refunds nobody is watching.
    trigger: BookingRefundTrigger.DISCRETIONARY,
    actor: { userId: args.actorUserId, role: Role.PRO },
    reason: 'Pro refunded the deposit after the client declined in the chair.',
  }).catch((error: unknown) => {
    console.error(`${ROUTE} deposit refund threw`, safeError(error))
    return { outcome: 'FAILED' as const, message: 'Refund failed.' }
  })

  if (refund.outcome === 'REFUNDED') {
    return {
      ok: true,
      choice: 'REFUND',
      settlement: 'REFUNDED',
      refundedCents: refund.refundAmountCents,
    }
  }

  if (refund.outcome === 'FAILED') {
    return { ok: false, code: 'REFUND_FAILED', message: refund.message }
  }

  // NOT_ATTEMPTED — the deposit was already returned, or the charge is under
  // dispute and the refund is frozen (refundDiscoveryDeposit logs which). The
  // decision stands, and it is reported as what it is: a refund that moved no
  // money. This is a SUCCESSFUL request — there is nothing for the pro to retry,
  // because either the client already has her money or Stripe is taking it back
  // — but it is NOT a refund, and the surface must not call it one.
  console.warn(
    JSON.stringify({
      level: 'warn',
      app: 'tovis',
      namespace: 'payments',
      event: 'consult_decline_deposit_refund_not_moved',
      bookingId: booking.id,
      reason: refund.reason,
      requestedCents: remaining,
    }),
  )

  return { ok: true, choice: 'REFUND', settlement: 'NOT_MOVED', refundedCents: 0 }
}

export { parseChoice as parseConsultDeclineDepositChoice }
