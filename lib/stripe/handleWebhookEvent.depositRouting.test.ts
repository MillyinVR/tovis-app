// lib/stripe/handleWebhookEvent.depositRouting.test.ts
//
// M16 (payment-booking-integrity-audit-plan.md §21.4 R1) — a discovery-deposit
// PaymentIntent's `payment_intent.payment_failed` must NOT be routed into the
// final-bill applier. The deposit PI carries `metadata.bookingId` (+ kind
// DISCOVERY_DEPOSIT), and findBookingForStripeWebhook resolves that hint FIRST —
// so without the kind guard a routine declined deposit card stamped the
// booking's FINAL-BILL fields (`stripePaymentIntentId=<deposit PI>`,
// `stripePaymentStatus=FAILED`, provider/method STRIPE) and emitted a spurious
// final-bill action-required notification. Worse (the cascade): after the
// Checkout retry succeeds on the SAME PI, the poisoned `stripePaymentIntentId`
// routes a later deposit dispute into the SERVICE dispute applier — bypassing
// M4's `depositDisputedAt` refund freeze.
//
// The succeeded sibling already had this gate (it routes deposit successes to
// handleDepositPaid); this suite pins BOTH directions plus the ALLOW controls
// ([[redundant-layers-mask-the-test]] — the guard must be kind-specific, not a
// blanket skip). Mirrors handleWebhookEvent.noShowFeeRouting.test.ts.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type Stripe from 'stripe'
import type { Prisma } from '@prisma/client'

import { asTestStripeEvent } from '@/lib/typed/stripeTestEvent'
import { asTestTransactionClient } from '@/lib/typed/prismaTestClient'

const mocks = vi.hoisted(() => ({
  applyStripePaymentSucceededInTransaction: vi.fn(),
  applyStripePaymentFailedInTransaction: vi.fn(),
  applyStripeDepositSucceededInTransaction: vi.fn(),
}))

vi.mock('@/lib/booking/writeBoundary', () => ({
  applyStripeCheckoutSessionStatusInTransaction: vi.fn(),
  applyStripeDepositDisputeInTransaction: vi.fn(),
  applyStripeDepositSucceededInTransaction:
    mocks.applyStripeDepositSucceededInTransaction,
  applyStripeDisputeInTransaction: vi.fn(),
  applyStripeNoShowFeeDisputeInTransaction: vi.fn(),
  applyStripePaymentFailedInTransaction:
    mocks.applyStripePaymentFailedInTransaction,
  applyStripePaymentSucceededInTransaction:
    mocks.applyStripePaymentSucceededInTransaction,
  reconcileDepositChargeRefundInTransaction: vi.fn(),
  reconcileNoShowFeeChargeRefundInTransaction: vi.fn(),
  DISCOVERY_DEPOSIT_CHECKOUT_KIND: 'DISCOVERY_DEPOSIT',
  NO_SHOW_FEE_CHARGE_KIND: 'NO_SHOW_FEE',
}))

vi.mock('@/lib/booking/refunds', () => ({
  reconcileChargeRefundInTransaction: vi.fn(),
  mapStripeRefundToReconcileInput: vi.fn((r: unknown) => r),
}))

vi.mock('@/lib/membership/syncSubscription', () => ({
  applyStripeSubscriptionInTransaction: vi.fn(),
}))

vi.mock('@/lib/observability/bookingEvents', () => ({
  captureStripeDisputeAlert: vi.fn(),
}))

import { handleStripeEvent } from './handleWebhookEvent'

const tx: Prisma.TransactionClient = asTestTransactionClient({})

function depositPaymentIntentEvent(args: {
  type: 'payment_intent.succeeded' | 'payment_intent.payment_failed'
  kind?: 'DISCOVERY_DEPOSIT'
}): Stripe.Event {
  return asTestStripeEvent({
    id: 'evt_dep_1',
    type: args.type,
    data: {
      object: {
        id: 'pi_deposit_1',
        object: 'payment_intent',
        amount: 2500,
        amount_received: args.type === 'payment_intent.succeeded' ? 2500 : 0,
        currency: 'usd',
        latest_charge: 'ch_deposit_1',
        // The exact metadata the deposit stripe-session route stamps on
        // payment_intent_data (bookingId hint + kind).
        metadata: {
          bookingId: 'booking_1',
          clientId: 'client_1',
          professionalId: 'pro_1',
          ...(args.kind ? { kind: args.kind } : {}),
          depositCents: '2000',
          feeCents: '500',
        },
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
  mocks.applyStripeDepositSucceededInTransaction.mockResolvedValue({
    handled: true,
    alreadyPaid: false,
  })
})

describe('handleStripeEvent — deposit PI never reaches the final-bill applier', () => {
  it('deposit PI × payment_failed is a deliberate no-op — final-bill fields stay untouched (M16)', async () => {
    const result = await handleStripeEvent(
      tx,
      depositPaymentIntentEvent({
        type: 'payment_intent.payment_failed',
        kind: 'DISCOVERY_DEPOSIT',
      }),
    )

    expect(result.handled).toBe(true)
    expect(result.message).toContain('deposit')
    // The whole point: the final-bill FAILED writer must never see a deposit PI.
    expect(mocks.applyStripePaymentFailedInTransaction).not.toHaveBeenCalled()
    expect(mocks.applyStripeDepositSucceededInTransaction).not.toHaveBeenCalled()
  })

  it('deposit PI × succeeded routes to the DEPOSIT applier, not the final-bill one (regression pin)', async () => {
    const result = await handleStripeEvent(
      tx,
      depositPaymentIntentEvent({
        type: 'payment_intent.succeeded',
        kind: 'DISCOVERY_DEPOSIT',
      }),
    )

    expect(result.handled).toBe(true)
    expect(mocks.applyStripeDepositSucceededInTransaction).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        stripePaymentIntentId: 'pi_deposit_1',
        bookingIdHint: 'booking_1',
      }),
    )
    expect(
      mocks.applyStripePaymentSucceededInTransaction,
    ).not.toHaveBeenCalled()
  })

  it('ALLOW: a real final-bill PI (no kind) × payment_failed still reaches the applier', async () => {
    const result = await handleStripeEvent(
      tx,
      depositPaymentIntentEvent({ type: 'payment_intent.payment_failed' }),
    )

    expect(result.handled).toBe(true)
    expect(mocks.applyStripePaymentFailedInTransaction).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        bookingIdHint: 'booking_1',
        stripePaymentIntentId: 'pi_deposit_1',
      }),
    )
  })
})
