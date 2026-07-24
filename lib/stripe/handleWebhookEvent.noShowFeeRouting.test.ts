// lib/stripe/handleWebhookEvent.noShowFeeRouting.test.ts
//
// M12 — a no-show / late-cancel fee PaymentIntent's webhook must NOT be routed
// into the final-bill applier. The fee PI (lib/noShowProtection/charge.ts)
// carries this booking's `metadata.bookingId`, and findBookingForStripeWebhook
// resolves that hint FIRST — so without the kind guard a $25 fee's
// `payment_intent.succeeded` would record as the booking's payment (marking a
// no-show booking PAID/COMPLETED) and its `.payment_failed` would mark the
// booking's final bill FAILED. The fee outcome is recorded synchronously by the
// charge path; these events are deliberate no-ops.
//
// Mirrors the M2 checkout-session-routing test's shape. Two ALLOW controls prove
// the guard is kind-specific, not a blanket skip: a real final-bill PI (no kind)
// still reaches the final-bill applier for BOTH success and failure.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type Stripe from 'stripe'
import type { Prisma } from '@prisma/client'

import { asTestStripeEvent } from '@/lib/typed/stripeTestEvent'
import { asTestTransactionClient } from '@/lib/typed/prismaTestClient'

const mocks = vi.hoisted(() => ({
  applyStripePaymentSucceededInTransaction: vi.fn(),
  applyStripePaymentFailedInTransaction: vi.fn(),
}))

vi.mock('@/lib/booking/writeBoundary', () => ({
  applyStripeCheckoutSessionStatusInTransaction: vi.fn(),
  applyStripeDepositDisputeInTransaction: vi.fn(),
  applyStripeDepositSucceededInTransaction: vi.fn(),
  applyStripeDisputeInTransaction: vi.fn(),
  applyStripePaymentFailedInTransaction:
    mocks.applyStripePaymentFailedInTransaction,
  applyStripePaymentSucceededInTransaction:
    mocks.applyStripePaymentSucceededInTransaction,
  reconcileDepositChargeRefundInTransaction: vi.fn(),
  DISCOVERY_DEPOSIT_CHECKOUT_KIND: 'DISCOVERY_DEPOSIT',
  NO_SHOW_FEE_CHARGE_KIND: 'NO_SHOW_FEE',
}))

vi.mock('@/lib/booking/refunds', () => ({
  reconcileChargeRefundInTransaction: vi.fn(),
  mapStripeRefundToReconcileInput: vi.fn(),
}))

vi.mock('@/lib/membership/syncSubscription', () => ({
  applyStripeSubscriptionInTransaction: vi.fn(),
}))

vi.mock('@/lib/observability/bookingEvents', () => ({
  captureStripeDisputeAlert: vi.fn(),
}))

import { handleStripeEvent } from './handleWebhookEvent'

const tx: Prisma.TransactionClient = asTestTransactionClient({})

function paymentIntentEvent(args: {
  type: 'payment_intent.succeeded' | 'payment_intent.payment_failed'
  kind?: 'NO_SHOW_FEE'
}): Stripe.Event {
  return asTestStripeEvent({
    id: 'evt_1',
    type: args.type,
    data: {
      object: {
        id: 'pi_fee_1',
        object: 'payment_intent',
        amount: 2500,
        amount_received: 2500,
        currency: 'usd',
        metadata: {
          bookingId: 'booking_1',
          ...(args.kind ? { kind: args.kind } : {}),
        },
      },
    },
  })
}

beforeEach(() => {
  mocks.applyStripePaymentSucceededInTransaction.mockReset()
  mocks.applyStripePaymentFailedInTransaction.mockReset()
  mocks.applyStripePaymentSucceededInTransaction.mockResolvedValue({
    bookingId: 'booking_1',
    bookingCompleted: false,
    meta: { mutated: true },
  })
  mocks.applyStripePaymentFailedInTransaction.mockResolvedValue({
    bookingId: 'booking_1',
    bookingCompleted: false,
    meta: { mutated: true },
  })
})

describe('handleStripeEvent — no-show fee PI never reaches the final-bill applier', () => {
  it('fee PI × succeeded is a deliberate no-op — the final-bill applier never runs', async () => {
    const result = await handleStripeEvent(
      tx,
      paymentIntentEvent({ type: 'payment_intent.succeeded', kind: 'NO_SHOW_FEE' }),
    )

    expect(result.handled).toBe(true)
    expect(result.message).toContain('no-show fee')
    expect(
      mocks.applyStripePaymentSucceededInTransaction,
    ).not.toHaveBeenCalled()
  })

  it('fee PI × failed is a deliberate no-op — the booking payment stays untouched', async () => {
    const result = await handleStripeEvent(
      tx,
      paymentIntentEvent({
        type: 'payment_intent.payment_failed',
        kind: 'NO_SHOW_FEE',
      }),
    )

    expect(result.handled).toBe(true)
    expect(result.message).toContain('no-show fee')
    expect(mocks.applyStripePaymentFailedInTransaction).not.toHaveBeenCalled()
  })

  it('ALLOW: a real final-bill PI (no kind) × succeeded still reaches the applier', async () => {
    const result = await handleStripeEvent(
      tx,
      paymentIntentEvent({ type: 'payment_intent.succeeded' }),
    )

    expect(result.handled).toBe(true)
    expect(mocks.applyStripePaymentSucceededInTransaction).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        bookingIdHint: 'booking_1',
        stripePaymentIntentId: 'pi_fee_1',
      }),
    )
  })

  it('ALLOW: a real final-bill PI (no kind) × failed still reaches the applier', async () => {
    const result = await handleStripeEvent(
      tx,
      paymentIntentEvent({ type: 'payment_intent.payment_failed' }),
    )

    expect(result.handled).toBe(true)
    expect(mocks.applyStripePaymentFailedInTransaction).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        bookingIdHint: 'booking_1',
        stripePaymentIntentId: 'pi_fee_1',
      }),
    )
  })
})
