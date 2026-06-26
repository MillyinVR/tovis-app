// N4 — payment-succeeded idempotency is keyed on the booking's terminal STATE,
// not on which event id last touched it.
//
// payment_intent.succeeded for a booking's single PI is one logical fact however
// it arrives: a live webhook redelivery, the requeue cron, or the orphan-recovery
// sweep (which applies under its own synthetic id). The old `stripeLastEventId ===
// args.stripeEventId` guard let a second path with a different id RE-apply
// (redundant closeout + duplicate audit log + a misleading mutated=true). These
// tests pin: once SUCCEEDED + PAID + collected, ANY later arrival no-ops.
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  BookingCheckoutStatus,
  BookingStatus,
  PaymentProvider,
  Prisma,
  StripePaymentStatus,
} from '@prisma/client'

vi.mock('@/lib/prisma', () => ({ prisma: {} }))

vi.mock('@/lib/notifications/paymentNotifications', () => ({
  emitPaymentCollectedNotifications: vi.fn(),
  emitPaymentActionRequiredNotifications: vi.fn(),
  emitPaymentRefundedNotifications: vi.fn(),
}))

import { applyStripePaymentSucceededInTransaction } from './writeBoundary'

const APPLIED_BOOKING_DEFAULTS = {
  id: 'booking_1',
  clientId: 'client_1',
  professionalId: 'pro_1',
  status: BookingStatus.COMPLETED,
  finishedAt: null,
  sessionStep: null,
  subtotalSnapshot: 0,
  serviceSubtotalSnapshot: 0,
  productSubtotalSnapshot: 0,
  tipAmount: 0,
  taxAmount: 0,
  discountAmount: 0,
  totalAmount: 10000,
  checkoutStatus: BookingCheckoutStatus.PAID,
  selectedPaymentMethod: null,
  paymentProvider: PaymentProvider.STRIPE,
  paymentAuthorizedAt: new Date('2026-06-01T00:00:00Z'),
  paymentCollectedAt: new Date('2026-06-01T00:00:00Z'),
  stripeCheckoutSessionId: null,
  stripePaymentIntentId: 'pi_1',
  stripeConnectedAccountId: null,
  stripeCheckoutSessionStatus: null,
  stripePaymentStatus: StripePaymentStatus.SUCCEEDED,
  stripeAmountSubtotal: 0,
  stripeAmountTotal: 10000,
  stripeCurrency: 'usd',
  stripePaidAt: new Date('2026-06-01T00:00:00Z'),
  stripeLastEventId: 'evt_first_apply',
  aftercareSummary: null,
}

function makeTx(bookingOverrides: Record<string, unknown> = {}) {
  const update = vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
    id: 'booking_1',
    ...data,
  }))

  const tx = {
    $executeRaw: vi.fn().mockResolvedValue(1),
    booking: {
      // findBookingForStripeWebhook (by PI) resolves the id + professionalId.
      findFirst: vi.fn(async () => ({ id: 'booking_1', professionalId: 'pro_1' })),
      // performLockedApplyStripePaymentSucceeded reads the full select.
      findUnique: vi.fn(async () => ({
        ...APPLIED_BOOKING_DEFAULTS,
        ...bookingOverrides,
      })),
      update,
    },
  }

  return { tx: tx as unknown as Prisma.TransactionClient, update }
}

afterEach(() => vi.restoreAllMocks())

describe('applyStripePaymentSucceededInTransaction — state-based idempotency (N4)', () => {
  it('no-ops on an already-applied booking even when the event id DIFFERS', async () => {
    const { tx, update } = makeTx()

    const result = await applyStripePaymentSucceededInTransaction(tx, {
      bookingIdHint: null,
      stripePaymentIntentId: 'pi_1',
      // A different id than the booking's stripeLastEventId — e.g. the live
      // webhook arriving after orphan-recovery already applied.
      stripeEventId: 'stripe:pi_succeeded:pi_1',
      amountReceivedCents: 10000,
      currency: 'usd',
    })

    expect(update).not.toHaveBeenCalled()
    expect(result?.meta.mutated).toBe(false)
    expect(result?.bookingId).toBe('booking_1')
  })

  it('still no-ops when the SAME event id redelivers', async () => {
    const { tx, update } = makeTx()

    const result = await applyStripePaymentSucceededInTransaction(tx, {
      bookingIdHint: null,
      stripePaymentIntentId: 'pi_1',
      stripeEventId: 'evt_first_apply',
      amountReceivedCents: 10000,
      currency: 'usd',
    })

    expect(update).not.toHaveBeenCalled()
    expect(result?.meta.mutated).toBe(false)
  })

  // The apply branch itself (a not-yet-collected booking recording the success)
  // is unchanged by this fix and is exercised end-to-end by the webhook route +
  // stripe-webhook-storm chaos suites; this file pins only the dedup condition.
})
