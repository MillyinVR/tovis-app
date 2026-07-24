// lib/observability/bookingEvents.ts
//
// Structured Sentry capture for booking route errors.
// Mirrors captureAuthException in authEvents.ts but tags by booking context.
//
import * as Sentry from '@sentry/nextjs'
import {
  registerLifecycleDriftSink,
  type LifecycleDriftEvent,
} from '@/lib/booking/lifecycleContract'

type CaptureBookingExceptionInput = {
  error: unknown
  route: string
  bookingId?: string | null
  professionalId?: string | null
  clientId?: string | null
  holdId?: string | null
  event?: string | null
}

/**
 * Captures a booking-domain exception in Sentry with structured context tags.
 *
 * Usage:
 *   captureBookingException(error, {
 *     bookingId: args.bookingId,
 *     professionalId: args.professionalId,
 *     clientId: args.clientId,
 *     route: 'POST /api/v1/bookings/finalize',
 *   })
 */
export function captureBookingException(
  input: CaptureBookingExceptionInput,
): void {
  const err =
    input.error instanceof Error
      ? input.error
      : new Error(String(input.error))

  Sentry.withScope((scope) => {
    scope.setTag('area', 'booking')
    scope.setTag('booking.route', input.route)

    if (input.event) scope.setTag('booking.event', input.event)
    if (input.bookingId) scope.setTag('booking.id', input.bookingId)
    if (input.professionalId) scope.setTag('booking.professionalId', input.professionalId)
    if (input.clientId) scope.setTag('booking.clientId', input.clientId)
    if (input.holdId) scope.setTag('booking.holdId', input.holdId)

    scope.setContext('booking', {
      route: input.route,
      event: input.event ?? null,
      bookingId: input.bookingId ?? null,
      professionalId: input.professionalId ?? null,
      clientId: input.clientId ?? null,
      holdId: input.holdId ?? null,
    })

    Sentry.captureException(err)
  })
}

/**
 * Captures a lifecycle contract drift event in Sentry as a structured warning.
 *
 * "Drift" means a SessionStep or BookingStatus transition was performed that
 * the lifecycle contract does not permit. Strict mode now throws upstream by
 * default, but this sink is still called before the throw for visibility.
 */
export function captureLifecycleDrift(event: LifecycleDriftEvent): void {
  Sentry.withScope((scope) => {
    scope.setLevel('warning')
    scope.setTag('area', 'booking')
    scope.setTag('booking.event', 'lifecycle_drift')
    scope.setTag('booking.lifecycle.kind', event.kind)
    scope.setTag('booking.lifecycle.actor', event.actor)
    scope.setTag('booking.lifecycle.from', String(event.from))
    scope.setTag('booking.lifecycle.to', String(event.to))
    scope.setTag('booking.route', event.route)

    if (event.bookingId) scope.setTag('booking.id', event.bookingId)
    if (event.professionalId)
      scope.setTag('booking.professionalId', event.professionalId)

    scope.setContext('lifecycle_drift', {
      kind: event.kind,
      from: event.from,
      to: event.to,
      actor: event.actor,
      route: event.route,
      reason: event.reason,
      bookingId: event.bookingId ?? null,
      professionalId: event.professionalId ?? null,
    })

    Sentry.captureMessage(
      `Lifecycle drift: ${event.kind} ${event.from} → ${event.to} by ${event.actor} (${event.route})`,
      'warning',
    )
  })

  // Structured log line so it shows up in Vercel logs even without Sentry.
  console.warn(
    JSON.stringify({
      level: 'warn',
      app: 'tovis',
      namespace: 'booking',
      event: 'lifecycle_drift',
      kind: event.kind,
      from: event.from,
      to: event.to,
      actor: event.actor,
      route: event.route,
      bookingId: event.bookingId ?? null,
      professionalId: event.professionalId ?? null,
      reason: event.reason,
    }),
  )
}

/**
 * The durable `Booking` overlap EXCLUDE constraint refused a write that the
 * app-level gate had already allowed.
 *
 * Every booking write is serialised per professional by the advisory schedule
 * lock and pre-checked by `enforceBookingOverlapPolicy`, so this should be
 * effectively unreachable. It fires only when the gate stopped finding conflicts
 * or a write reached the table without the lock.
 *
 * **Error level, not warning**, even though no bad data was written — Postgres
 * refused, so the appointment is safe. The severity is about detectability: both
 * layers refuse with the same `TIME_BOOKED`, so a gate that has silently stopped
 * working is invisible from every client-facing surface. Bookings keep getting
 * refused (by the database), the `booking_conflict` audit trail goes quiet
 * rather than wrong, and the only symptom is pro double-books — which are
 * *supposed* to succeed — starting to fail. Nothing else will page anyone.
 *
 * A nonzero rate is a bug, not background noise.
 *
 * The structured log line is emitted by `logBookingConflict` at the call site
 * (`note: 'db_overlap_backstop_fired'`, `meta.layer: 'db_backstop'`); this adds
 * the alert on top rather than duplicating it.
 */
export function captureOverlapBackstopFired(input: {
  action: string
  professionalId: string
  bookingId?: string | null
  holdId?: string | null
  requestedStart: Date
  requestedEnd: Date
  constraint: string
}): void {
  Sentry.withScope((scope) => {
    scope.setLevel('error')
    scope.setTag('area', 'booking')
    scope.setTag('booking.event', 'overlap_backstop_fired')
    scope.setTag('booking.action', input.action)
    scope.setTag('booking.professionalId', input.professionalId)

    if (input.bookingId) scope.setTag('booking.id', input.bookingId)
    if (input.holdId) scope.setTag('booking.holdId', input.holdId)

    scope.setContext('overlap_backstop', {
      action: input.action,
      professionalId: input.professionalId,
      bookingId: input.bookingId ?? null,
      holdId: input.holdId ?? null,
      requestedStart: input.requestedStart.toISOString(),
      requestedEnd: input.requestedEnd.toISOString(),
      constraint: input.constraint,
    })

    Sentry.captureMessage(
      `Booking overlap backstop fired (${input.action}) for professional ${input.professionalId} — the app-level overlap gate allowed a write the database refused`,
      'error',
    )
  })
}

/**
 * Surfaces a Stripe payment dispute on a booking as a high-severity operational
 * alert (Sentry + a structured log line). Disputes are rare and money-critical —
 * a destination-charge dispute reverses the transfer off the pro and debits the
 * platform — so a human must see every one. Fired on dispute OPEN and LOST; a
 * won dispute (which restores the payment) does not alert.
 *
 * `flavor` distinguishes the charges a booking can carry: the final-bill PI
 * (`SERVICE`, default), the up-front discovery deposit's OWN PI (`DEPOSIT`), and
 * the no-show / late-cancel fee's OWN PI (`NO_SHOW_FEE`). Each is a distinct
 * money-path with its own freeze, so each carries a distinct log identity
 * (`stripe_deposit_dispute` / `stripe_no_show_fee_dispute`) while the SERVICE
 * identity (`stripe_dispute`) stays unchanged for existing alerting.
 */
export function captureStripeDisputeAlert(input: {
  bookingId: string
  paymentIntentId: string
  disputeId: string
  disputeStatus: string
  outcome: 'OPEN' | 'WON' | 'LOST'
  eventType: string
  flavor: 'SERVICE' | 'DEPOSIT' | 'NO_SHOW_FEE'
}): void {
  const logEvent =
    input.flavor === 'DEPOSIT'
      ? 'stripe_deposit_dispute'
      : input.flavor === 'NO_SHOW_FEE'
        ? 'stripe_no_show_fee_dispute'
        : 'stripe_dispute'
  const label =
    input.flavor === 'DEPOSIT'
      ? 'Stripe deposit dispute'
      : input.flavor === 'NO_SHOW_FEE'
        ? 'Stripe no-show fee dispute'
        : 'Stripe dispute'

  Sentry.withScope((scope) => {
    scope.setLevel('error')
    scope.setTag('area', 'payments')
    scope.setTag('payments.event', logEvent)
    scope.setTag('payments.dispute.outcome', input.outcome)
    scope.setTag('payments.dispute.flavor', input.flavor)
    scope.setTag('booking.id', input.bookingId)

    scope.setContext('stripe_dispute', {
      bookingId: input.bookingId,
      paymentIntentId: input.paymentIntentId,
      disputeId: input.disputeId,
      disputeStatus: input.disputeStatus,
      outcome: input.outcome,
      eventType: input.eventType,
      flavor: input.flavor,
    })

    Sentry.captureMessage(
      `${label} (${input.outcome}) on booking ${input.bookingId} [${input.eventType}]`,
      'error',
    )
  })

  console.error(
    JSON.stringify({
      level: 'error',
      app: 'tovis',
      namespace: 'payments',
      event: logEvent,
      flavor: input.flavor,
      outcome: input.outcome,
      eventType: input.eventType,
      bookingId: input.bookingId,
      paymentIntentId: input.paymentIntentId,
      disputeId: input.disputeId,
      disputeStatus: input.disputeStatus,
    }),
  )
}

/**
 * Flags a captured Stripe payment whose `amount_received` does not match the
 * booking's expected total. The webhook records the captured amount as the
 * source of truth (it IS the money that moved), but a mismatch means a short-pay,
 * over-pay, or wrong-currency capture that needs human reconciliation — so it
 * must not pass silently. Sentry (error) + a structured log line.
 */
export function captureStripeAmountMismatch(input: {
  bookingId: string
  expectedCents: number
  receivedCents: number
  currency: string | null
}): void {
  Sentry.withScope((scope) => {
    scope.setLevel('error')
    scope.setTag('area', 'payments')
    scope.setTag('payments.event', 'amount_mismatch')
    scope.setTag('booking.id', input.bookingId)

    scope.setContext('stripe_amount_mismatch', {
      bookingId: input.bookingId,
      expectedCents: input.expectedCents,
      receivedCents: input.receivedCents,
      deltaCents: input.receivedCents - input.expectedCents,
      currency: input.currency,
    })

    Sentry.captureMessage(
      `Stripe capture amount mismatch on booking ${input.bookingId}: expected ${input.expectedCents}, received ${input.receivedCents}`,
      'error',
    )
  })

  console.error(
    JSON.stringify({
      level: 'error',
      app: 'tovis',
      namespace: 'payments',
      event: 'amount_mismatch',
      bookingId: input.bookingId,
      expectedCents: input.expectedCents,
      receivedCents: input.receivedCents,
      deltaCents: input.receivedCents - input.expectedCents,
      currency: input.currency,
    }),
  )
}

/**
 * A Stripe payment landed on a booking that was already CANCELLED, and the
 * automatic late-capture refund could not settle it: either the cancel predates
 * the provenance columns (who/when unknown — policy cannot be derived) or the
 * refund attempt itself failed. Money is sitting on a cancelled booking with no
 * automated owner — a human must resolve it, so this must page, not just log.
 */
export function captureLateCaptureOnCancelledBooking(input: {
  bookingId: string
  flavor: 'DEPOSIT' | 'SERVICE'
  reason: 'UNKNOWN_CANCEL_PROVENANCE' | 'REFUND_FAILED'
  detail: string | null
}): void {
  Sentry.withScope((scope) => {
    scope.setLevel('error')
    scope.setTag('area', 'payments')
    scope.setTag('payments.event', 'late_capture_on_cancelled_booking')
    scope.setTag('payments.late_capture.flavor', input.flavor)
    scope.setTag('payments.late_capture.reason', input.reason)
    scope.setTag('booking.id', input.bookingId)

    scope.setContext('late_capture_on_cancelled_booking', {
      bookingId: input.bookingId,
      flavor: input.flavor,
      reason: input.reason,
      detail: input.detail,
    })

    Sentry.captureMessage(
      `Stripe ${input.flavor} payment captured on cancelled booking ${input.bookingId} needs manual resolution (${input.reason})`,
      'error',
    )
  })

  console.error(
    JSON.stringify({
      level: 'error',
      app: 'tovis',
      namespace: 'payments',
      event: 'late_capture_on_cancelled_booking',
      bookingId: input.bookingId,
      flavor: input.flavor,
      reason: input.reason,
      detail: input.detail,
    }),
  )
}

/**
 * M9 — a Stripe card charge for the final bill landed AFTER the pro had already
 * closed the booking out by hand (mark-paid cash / waive). The client was
 * double-collected (cash + card) or charged despite a waive. The card money is
 * already captured at Stripe and cannot be un-charged from the webhook
 * transaction, so this pages a human to refund the card via the existing
 * pro/admin refund endpoint. Alert-only by design (Tori, 2026-07-23): the
 * platform does not auto-refund here. Fires post-commit on the arrival path that
 * first records the over-collection (live webhook, requeue, or orphan-recovery).
 */
export function captureManualCloseoutStripeOverCollection(input: {
  bookingId: string
  flavor: 'SERVICE'
  source: 'WEBHOOK' | 'REQUEUE' | 'ORPHAN_RECOVERY'
}): void {
  Sentry.withScope((scope) => {
    scope.setLevel('error')
    scope.setTag('area', 'payments')
    scope.setTag('payments.event', 'manual_closeout_stripe_over_collection')
    scope.setTag('payments.over_collection.flavor', input.flavor)
    scope.setTag('payments.over_collection.source', input.source)
    scope.setTag('booking.id', input.bookingId)

    scope.setContext('manual_closeout_stripe_over_collection', {
      bookingId: input.bookingId,
      flavor: input.flavor,
      source: input.source,
    })

    Sentry.captureMessage(
      `Stripe card charge landed on manually closed-out booking ${input.bookingId} — client over-collected, refund the card (${input.source})`,
      'error',
    )
  })

  console.error(
    JSON.stringify({
      level: 'error',
      app: 'tovis',
      namespace: 'payments',
      event: 'manual_closeout_stripe_over_collection',
      bookingId: input.bookingId,
      flavor: input.flavor,
      source: input.source,
    }),
  )
}

/**
 * The hourly refund-retry sweep has used up its attempt budget for a FAILED
 * auto-cancel refund (M3). The client is owed money the platform can no longer
 * return automatically — a human must settle it (discretionary refund endpoint
 * for the service payment, Stripe Dashboard for the deposit PI), so this must
 * page, not just log. Fires once, at the attempt that exhausts the budget.
 */
export function captureAutoCancelRefundRetriesExhausted(input: {
  bookingId: string
  paymentIntentId: string
  flavor: 'DEPOSIT' | 'SERVICE'
  attempts: number
  detail: string | null
}): void {
  Sentry.withScope((scope) => {
    scope.setLevel('error')
    scope.setTag('area', 'payments')
    scope.setTag('payments.event', 'auto_cancel_refund_retries_exhausted')
    scope.setTag('payments.refund_retry.flavor', input.flavor)
    scope.setTag('booking.id', input.bookingId)

    scope.setContext('auto_cancel_refund_retries_exhausted', {
      bookingId: input.bookingId,
      paymentIntentId: input.paymentIntentId,
      flavor: input.flavor,
      attempts: input.attempts,
      detail: input.detail,
    })

    Sentry.captureMessage(
      `Auto-cancel ${input.flavor} refund on booking ${input.bookingId} still failing after ${input.attempts} attempts — manual refund required`,
      'error',
    )
  })

  console.error(
    JSON.stringify({
      level: 'error',
      app: 'tovis',
      namespace: 'payments',
      event: 'auto_cancel_refund_retries_exhausted',
      bookingId: input.bookingId,
      paymentIntentId: input.paymentIntentId,
      flavor: input.flavor,
      attempts: input.attempts,
      detail: input.detail,
    }),
  )
}

/**
 * M14 — the deposit-success recovery sweep found a discovery deposit that Stripe
 * confirms captured, but which we still hold `depositStatus=PENDING` past
 * DEPOSIT_RECOVERY_STALE_HOURS (default 72h — beyond Stripe's ~3-day native
 * retry window). The client paid; the live webhook AND Stripe's retries both
 * failed to record it for that long, so the automatic healing pipeline
 * demonstrably broke down — page even though the sweep auto-records it this run.
 * `recovered` distinguishes the sweep healing it (still worth a heads-up: the
 * pipeline had a sustained gap) from a candidate the sweep could NOT record
 * (persistent apply failure — money captured, no local acknowledgement).
 */
export function captureLostDepositSuccessStale(input: {
  bookingId: string
  paymentIntentId: string
  ageHours: number
  recovered: boolean
}): void {
  Sentry.withScope((scope) => {
    scope.setLevel('error')
    scope.setTag('area', 'payments')
    scope.setTag('payments.event', 'lost_deposit_success_stale')
    scope.setTag('payments.deposit_recovery.recovered', String(input.recovered))
    scope.setTag('booking.id', input.bookingId)

    scope.setContext('lost_deposit_success_stale', {
      bookingId: input.bookingId,
      paymentIntentId: input.paymentIntentId,
      ageHours: input.ageHours,
      recovered: input.recovered,
    })

    Sentry.captureMessage(
      `Discovery deposit on booking ${input.bookingId} was captured at Stripe but stayed PENDING for ${input.ageHours}h (past native retries) — ${
        input.recovered ? 'recovered late by sweep' : 'could NOT be recorded'
      }`,
      'error',
    )
  })

  console.error(
    JSON.stringify({
      level: 'error',
      app: 'tovis',
      namespace: 'payments',
      event: 'lost_deposit_success_stale',
      bookingId: input.bookingId,
      paymentIntentId: input.paymentIntentId,
      ageHours: input.ageHours,
      recovered: input.recovered,
    }),
  )
}

// Register the Sentry sink once at module load. The lifecycleContract module
// keeps a registry of sinks and emits to all of them on drift.
let driftSinkRegistered = false
if (!driftSinkRegistered) {
  registerLifecycleDriftSink(captureLifecycleDrift)
  driftSinkRegistered = true
}
