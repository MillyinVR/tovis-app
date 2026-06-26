// lib/notifications/paymentNotifications.ts
//
// Emission of payment-lifecycle notifications (receipts + action-required).
// These are the single emit points for PAYMENT_COLLECTED, PAYMENT_ACTION_REQUIRED
// and PAYMENT_REFUNDED; callers (the writeBoundary payment transition detector,
// the Stripe payment-failed apply path, and the refund reconcile paths) invoke
// them inside their own transaction.
//
// Idempotency: every emit passes a stable dedupeKey derived from the booking id
// plus the relevant Stripe identifier (payment_intent / refund). The notification
// helpers treat (recipient, dedupeKey) as an idempotent inbox upsert and do NOT
// re-enqueue delivery for an already-seen row, so a replayed Stripe webhook never
// double-notifies. Notification creation is delegated to the shared helpers — we
// never hand-roll inbox rows or dispatch here.

import { NotificationEventKey, Prisma } from '@prisma/client'

import { formatCents, formatMoneyFromUnknown } from '@/lib/money'

import { upsertClientNotification } from './clientNotifications'
import { createProNotification } from './proNotifications'

const paymentBookingContextSelect = {
  clientId: true,
  professionalId: true,
  totalAmount: true,
  stripePaymentIntentId: true,
  service: {
    select: { name: true },
  },
} satisfies Prisma.BookingSelect

type PaymentBookingContext = {
  clientId: string
  professionalId: string
  paymentIntentId: string | null
  serviceName: string
  totalAmountDisplay: string | null
}

async function loadPaymentBookingContext(
  tx: Prisma.TransactionClient,
  bookingId: string,
): Promise<PaymentBookingContext | null> {
  const booking = await tx.booking.findUnique({
    where: { id: bookingId },
    select: paymentBookingContextSelect,
  })

  if (!booking) return null

  return {
    clientId: booking.clientId,
    professionalId: booking.professionalId,
    paymentIntentId: booking.stripePaymentIntentId,
    serviceName: booking.service?.name?.trim() || 'your appointment',
    totalAmountDisplay: formatMoneyFromUnknown(booking.totalAmount),
  }
}

function centsToDisplay(amountCents: number): string | null {
  if (!Number.isFinite(amountCents) || amountCents <= 0) return null
  return formatCents(amountCents)
}

/**
 * PAYMENT_COLLECTED receipt — emitted when a booking transitions to collected.
 * Tier B (in-app + email for both client and pro; no SMS).
 */
export async function emitPaymentCollectedNotifications(args: {
  tx: Prisma.TransactionClient
  bookingId: string
}): Promise<void> {
  const ctx = await loadPaymentBookingContext(args.tx, args.bookingId)
  if (!ctx) return

  const dedupeKey = `PAYMENT_COLLECTED:${args.bookingId}:${ctx.paymentIntentId ?? 'none'}`
  const amountClause = ctx.totalAmountDisplay
    ? `Your payment of ${ctx.totalAmountDisplay} for ${ctx.serviceName} was received.`
    : `Your payment for ${ctx.serviceName} was received.`
  const proAmountClause = ctx.totalAmountDisplay
    ? `${ctx.totalAmountDisplay} was collected for ${ctx.serviceName}.`
    : `Payment was collected for ${ctx.serviceName}.`

  await upsertClientNotification({
    tx: args.tx,
    clientId: ctx.clientId,
    bookingId: args.bookingId,
    eventKey: NotificationEventKey.PAYMENT_COLLECTED,
    title: 'Payment received',
    body: amountClause,
    href: `/client/bookings/${args.bookingId}`,
    dedupeKey,
    data: {
      bookingId: args.bookingId,
      notificationReason: 'PAYMENT_COLLECTED',
    },
  })

  await createProNotification({
    tx: args.tx,
    professionalId: ctx.professionalId,
    eventKey: NotificationEventKey.PAYMENT_COLLECTED,
    title: 'Payment collected',
    body: proAmountClause,
    href: `/pro/bookings/${args.bookingId}`,
    bookingId: args.bookingId,
    dedupeKey,
    data: {
      bookingId: args.bookingId,
      notificationReason: 'PAYMENT_COLLECTED',
    },
  })
}

/**
 * PAYMENT_ACTION_REQUIRED — emitted when a charge needs client action (a failed
 * payment / SCA the client must resolve). Tier A urgent: client gets
 * in-app + email + SMS; pro gets in-app + email.
 *
 * The dedupeKey is keyed on the booking + payment_intent (NOT the Stripe event),
 * so repeated failures of the same payment intent collapse into one outstanding
 * actionable notice rather than stacking.
 */
export async function emitPaymentActionRequiredNotifications(args: {
  tx: Prisma.TransactionClient
  bookingId: string
  stripePaymentIntentId: string
}): Promise<void> {
  const ctx = await loadPaymentBookingContext(args.tx, args.bookingId)
  if (!ctx) return

  const dedupeKey = `PAYMENT_ACTION_REQUIRED:${args.bookingId}:${args.stripePaymentIntentId}`

  await upsertClientNotification({
    tx: args.tx,
    clientId: ctx.clientId,
    bookingId: args.bookingId,
    eventKey: NotificationEventKey.PAYMENT_ACTION_REQUIRED,
    title: 'Action needed on your payment',
    body: `We couldn’t process your payment for ${ctx.serviceName}. Please update your payment details to keep your appointment.`,
    href: `/client/bookings/${args.bookingId}`,
    dedupeKey,
    data: {
      bookingId: args.bookingId,
      notificationReason: 'PAYMENT_ACTION_REQUIRED',
    },
  })

  await createProNotification({
    tx: args.tx,
    professionalId: ctx.professionalId,
    eventKey: NotificationEventKey.PAYMENT_ACTION_REQUIRED,
    title: 'A payment needs attention',
    body: `A client’s payment for ${ctx.serviceName} couldn’t be processed.`,
    href: `/pro/bookings/${args.bookingId}`,
    bookingId: args.bookingId,
    dedupeKey,
    data: {
      bookingId: args.bookingId,
      notificationReason: 'PAYMENT_ACTION_REQUIRED',
    },
  })
}

/**
 * PAYMENT_REFUNDED receipt — emitted from the refund reconcile paths. Tier B
 * (in-app + email for both client and pro; no SMS).
 *
 * `refundDiscriminator` is the Stripe refund id for final-bill refunds, or a
 * payment-intent-derived key for the (single, full) deposit refund — either way
 * it makes the dedupeKey stable so cumulative `charge.refunded` replays never
 * double-notify.
 */
export async function emitPaymentRefundedNotifications(args: {
  tx: Prisma.TransactionClient
  bookingId: string
  refundDiscriminator: string
  amountRefundedCents: number
}): Promise<void> {
  const ctx = await loadPaymentBookingContext(args.tx, args.bookingId)
  if (!ctx) return

  const dedupeKey = `PAYMENT_REFUNDED:${args.bookingId}:${args.refundDiscriminator}`
  const amountDisplay = centsToDisplay(args.amountRefundedCents)
  const clientBody = amountDisplay
    ? `A refund of ${amountDisplay} for ${ctx.serviceName} is on its way.`
    : `A refund for ${ctx.serviceName} is on its way.`
  const proBody = amountDisplay
    ? `A refund of ${amountDisplay} was issued for ${ctx.serviceName}.`
    : `A refund was issued for ${ctx.serviceName}.`

  await upsertClientNotification({
    tx: args.tx,
    clientId: ctx.clientId,
    bookingId: args.bookingId,
    eventKey: NotificationEventKey.PAYMENT_REFUNDED,
    title: 'Refund issued',
    body: clientBody,
    href: `/client/bookings/${args.bookingId}`,
    dedupeKey,
    data: {
      bookingId: args.bookingId,
      notificationReason: 'PAYMENT_REFUNDED',
    },
  })

  await createProNotification({
    tx: args.tx,
    professionalId: ctx.professionalId,
    eventKey: NotificationEventKey.PAYMENT_REFUNDED,
    title: 'Refund processed',
    body: proBody,
    href: `/pro/bookings/${args.bookingId}`,
    bookingId: args.bookingId,
    dedupeKey,
    data: {
      bookingId: args.bookingId,
      notificationReason: 'PAYMENT_REFUNDED',
    },
  })
}
