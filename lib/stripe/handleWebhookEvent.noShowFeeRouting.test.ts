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
  applyStripeDisputeInTransaction: vi.fn(),
  applyStripeDepositDisputeInTransaction: vi.fn(),
  applyStripeNoShowFeeDisputeInTransaction: vi.fn(),
  reconcileDepositChargeRefundInTransaction: vi.fn(),
  reconcileNoShowFeeChargeRefundInTransaction: vi.fn(),
  reconcileChargeRefundInTransaction: vi.fn(),
  captureStripeDisputeAlert: vi.fn(),
}))

vi.mock('@/lib/booking/writeBoundary', () => ({
  applyStripeCheckoutSessionStatusInTransaction: vi.fn(),
  applyStripeDepositDisputeInTransaction:
    mocks.applyStripeDepositDisputeInTransaction,
  applyStripeDepositSucceededInTransaction: vi.fn(),
  applyStripeDisputeInTransaction: mocks.applyStripeDisputeInTransaction,
  applyStripeNoShowFeeDisputeInTransaction:
    mocks.applyStripeNoShowFeeDisputeInTransaction,
  applyStripePaymentFailedInTransaction:
    mocks.applyStripePaymentFailedInTransaction,
  applyStripePaymentSucceededInTransaction:
    mocks.applyStripePaymentSucceededInTransaction,
  reconcileDepositChargeRefundInTransaction:
    mocks.reconcileDepositChargeRefundInTransaction,
  reconcileNoShowFeeChargeRefundInTransaction:
    mocks.reconcileNoShowFeeChargeRefundInTransaction,
  DISCOVERY_DEPOSIT_CHECKOUT_KIND: 'DISCOVERY_DEPOSIT',
  NO_SHOW_FEE_CHARGE_KIND: 'NO_SHOW_FEE',
}))

vi.mock('@/lib/booking/refunds', () => ({
  reconcileChargeRefundInTransaction: mocks.reconcileChargeRefundInTransaction,
  mapStripeRefundToReconcileInput: vi.fn((r: unknown) => r),
}))

vi.mock('@/lib/membership/syncSubscription', () => ({
  applyStripeSubscriptionInTransaction: vi.fn(),
}))

vi.mock('@/lib/observability/bookingEvents', () => ({
  captureStripeDisputeAlert: mocks.captureStripeDisputeAlert,
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

function chargeRefundedEvent(paymentIntentId: string): Stripe.Event {
  return asTestStripeEvent({
    id: 'evt_refund_1',
    type: 'charge.refunded',
    data: {
      object: {
        id: 'ch_1',
        object: 'charge',
        payment_intent: paymentIntentId,
        amount: 2500,
        amount_refunded: 2500,
        refunds: { data: [] },
      },
    },
  })
}

function disputeEvent(paymentIntentId: string): Stripe.Event {
  return asTestStripeEvent({
    id: 'evt_dispute_1',
    type: 'charge.dispute.created',
    data: {
      object: {
        id: 'dp_1',
        object: 'dispute',
        payment_intent: paymentIntentId,
        status: 'warning_needs_response',
      },
    },
  })
}

beforeEach(() => {
  Object.values(mocks).forEach((m) => m.mockReset())
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
  // Default: no PI matches anything — each test opts a branch in.
  mocks.reconcileDepositChargeRefundInTransaction.mockResolvedValue({
    handled: false,
  })
  mocks.reconcileNoShowFeeChargeRefundInTransaction.mockResolvedValue({
    handled: false,
  })
  mocks.reconcileChargeRefundInTransaction.mockResolvedValue({ handled: false })
  mocks.applyStripeDisputeInTransaction.mockResolvedValue(null)
  mocks.applyStripeDepositDisputeInTransaction.mockResolvedValue(null)
  mocks.applyStripeNoShowFeeDisputeInTransaction.mockResolvedValue(null)
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

// M15 GAP B — a Stripe-side refund / dispute of the fee's OWN PaymentIntent must
// reconcile the fee row, and must NOT fall through to the final-bill reconcile.
describe('handleStripeEvent — fee-PI refund / dispute reconciles the fee, not the final bill', () => {
  it('charge.refunded on the fee PI reconciles the fee and skips the final-bill reconcile', async () => {
    mocks.reconcileNoShowFeeChargeRefundInTransaction.mockResolvedValue({
      handled: true,
    })

    const result = await handleStripeEvent(tx, chargeRefundedEvent('pi_fee_1'))

    expect(result.handled).toBe(true)
    expect(result.message).toContain('no-show fee')
    expect(
      mocks.reconcileNoShowFeeChargeRefundInTransaction,
    ).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        paymentIntentId: 'pi_fee_1',
        amountRefundedCents: 2500,
        chargeAmountCents: 2500,
      }),
    )
    // The final-bill reconcile must NOT run once the fee branch handled it.
    expect(mocks.reconcileChargeRefundInTransaction).not.toHaveBeenCalled()
  })

  it('ALLOW: charge.refunded on a NON-fee PI still reaches the final-bill reconcile', async () => {
    mocks.reconcileChargeRefundInTransaction.mockResolvedValue({
      handled: true,
    })

    const result = await handleStripeEvent(tx, chargeRefundedEvent('pi_service_1'))

    expect(result.handled).toBe(true)
    expect(result.message).toContain('reconciled')
    expect(mocks.reconcileNoShowFeeChargeRefundInTransaction).toHaveBeenCalled()
    // Fee reconcile returned handled:false (default), so the service reconcile ran.
    expect(mocks.reconcileChargeRefundInTransaction).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ paymentIntentId: 'pi_service_1' }),
    )
  })

  it('charge.dispute on the fee PI freezes the fee and alerts with the NO_SHOW_FEE flavor', async () => {
    mocks.applyStripeNoShowFeeDisputeInTransaction.mockResolvedValue({
      bookingId: 'booking_1',
    })

    const result = await handleStripeEvent(tx, disputeEvent('pi_fee_1'))

    expect(result.handled).toBe(true)
    expect(result.message).toContain('no-show fee')
    expect(mocks.applyStripeNoShowFeeDisputeInTransaction).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ feePaymentIntentId: 'pi_fee_1', outcome: 'OPEN' }),
    )
    expect(mocks.captureStripeDisputeAlert).toHaveBeenCalledWith(
      expect.objectContaining({ flavor: 'NO_SHOW_FEE', bookingId: 'booking_1' }),
    )
  })

  it('ALLOW: a dispute matching the SERVICE PI never reaches the fee dispute path', async () => {
    mocks.applyStripeDisputeInTransaction.mockResolvedValue({
      bookingId: 'booking_1',
    })

    const result = await handleStripeEvent(tx, disputeEvent('pi_service_1'))

    expect(result.handled).toBe(true)
    // The service branch handled it first — the fee dispute path must not run.
    expect(
      mocks.applyStripeNoShowFeeDisputeInTransaction,
    ).not.toHaveBeenCalled()
    expect(mocks.captureStripeDisputeAlert).toHaveBeenCalledWith(
      expect.objectContaining({ flavor: 'SERVICE' }),
    )
  })
})
