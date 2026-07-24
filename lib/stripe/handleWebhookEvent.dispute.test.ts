// lib/stripe/handleWebhookEvent.dispute.test.ts
//
// Coverage for charge.dispute.* handling: outcome resolution (created/
// funds_withdrawn → OPEN, closed-won → WON, closed-lost → LOST), alert gating
// (alert on OPEN/LOST, never WON), and the missing-PI / booking-not-found
// short-circuits. The write-boundary + observability modules are mocked;
// applyStripeDisputeInTransaction's own state machine is covered separately.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type Stripe from 'stripe'
import type { Prisma } from '@prisma/client'

const mocks = vi.hoisted(() => ({
  applyStripeDisputeInTransaction: vi.fn(),
  applyStripeDepositDisputeInTransaction: vi.fn(),
  applyStripeNoShowFeeDisputeInTransaction: vi.fn(),
  captureStripeDisputeAlert: vi.fn(),
}))

vi.mock('@/lib/booking/writeBoundary', () => ({
  applyStripeCheckoutSessionStatusInTransaction: vi.fn(),
  applyStripeDepositDisputeInTransaction: mocks.applyStripeDepositDisputeInTransaction,
  applyStripeDepositSucceededInTransaction: vi.fn(),
  applyStripeDisputeInTransaction: mocks.applyStripeDisputeInTransaction,
  applyStripeNoShowFeeDisputeInTransaction:
    mocks.applyStripeNoShowFeeDisputeInTransaction,
  applyStripePaymentFailedInTransaction: vi.fn(),
  applyStripePaymentSucceededInTransaction: vi.fn(),
  reconcileDepositChargeRefundInTransaction: vi.fn(),
  reconcileNoShowFeeChargeRefundInTransaction: vi.fn(),
  DISCOVERY_DEPOSIT_CHECKOUT_KIND: 'DISCOVERY_DEPOSIT',
  NO_SHOW_FEE_CHARGE_KIND: 'NO_SHOW_FEE',
}))

vi.mock('@/lib/booking/refunds', () => ({
  reconcileChargeRefundInTransaction: vi.fn(),
}))

vi.mock('@/lib/membership/syncSubscription', () => ({
  applyStripeSubscriptionInTransaction: vi.fn(),
}))

vi.mock('@/lib/observability/bookingEvents', () => ({
  captureStripeDisputeAlert: mocks.captureStripeDisputeAlert,
}))

import { handleChargeDispute, resolveDisputeOutcome } from './handleWebhookEvent'

const tx = {} as Prisma.TransactionClient

function dispute(overrides: Partial<Stripe.Dispute>): Stripe.Dispute {
  return {
    id: 'dp_1',
    status: 'needs_response',
    payment_intent: 'pi_123',
    ...overrides,
  } as Stripe.Dispute
}

beforeEach(() => {
  mocks.applyStripeDisputeInTransaction.mockReset()
  mocks.applyStripeDepositDisputeInTransaction.mockReset()
  mocks.applyStripeNoShowFeeDisputeInTransaction.mockReset()
  mocks.captureStripeDisputeAlert.mockReset()
  mocks.applyStripeDisputeInTransaction.mockResolvedValue({
    bookingId: 'booking_1',
    bookingCompleted: false,
    meta: { mutated: true },
  })
  // Default: neither the deposit PI nor the fee PI matches (the service path
  // handles the common case).
  mocks.applyStripeDepositDisputeInTransaction.mockResolvedValue(null)
  mocks.applyStripeNoShowFeeDisputeInTransaction.mockResolvedValue(null)
})

describe('resolveDisputeOutcome', () => {
  it('maps open dispute events to OPEN', () => {
    expect(
      resolveDisputeOutcome('charge.dispute.created', dispute({ status: 'needs_response' })),
    ).toBe('OPEN')
    expect(
      resolveDisputeOutcome('charge.dispute.updated', dispute({ status: 'under_review' })),
    ).toBe('OPEN')
    expect(
      resolveDisputeOutcome(
        'charge.dispute.funds_withdrawn',
        dispute({ status: 'under_review' }),
      ),
    ).toBe('OPEN')
  })

  it('maps closed-lost to LOST and closed-won/warning_closed to WON', () => {
    expect(
      resolveDisputeOutcome('charge.dispute.closed', dispute({ status: 'lost' })),
    ).toBe('LOST')
    expect(
      resolveDisputeOutcome('charge.dispute.closed', dispute({ status: 'won' })),
    ).toBe('WON')
    expect(
      resolveDisputeOutcome('charge.dispute.closed', dispute({ status: 'warning_closed' })),
    ).toBe('WON')
  })
})

describe('handleChargeDispute', () => {
  it('created → applies OPEN and alerts', async () => {
    const result = await handleChargeDispute(
      tx,
      dispute({ status: 'needs_response', payment_intent: 'pi_123' }),
      'charge.dispute.created',
      'evt_1',
    )

    expect(result.handled).toBe(true)
    expect(mocks.applyStripeDisputeInTransaction).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        stripePaymentIntentId: 'pi_123',
        stripeEventId: 'evt_1',
        outcome: 'OPEN',
      }),
    )
    expect(mocks.captureStripeDisputeAlert).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'OPEN', bookingId: 'booking_1', flavor: 'SERVICE' }),
    )
    // A final-bill match never falls through to the deposit matcher.
    expect(mocks.applyStripeDepositDisputeInTransaction).not.toHaveBeenCalled()
  })

  it('closed-won → applies WON and does NOT alert', async () => {
    await handleChargeDispute(
      tx,
      dispute({ status: 'won' }),
      'charge.dispute.closed',
      'evt_1',
    )

    expect(mocks.applyStripeDisputeInTransaction).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ outcome: 'WON' }),
    )
    expect(mocks.captureStripeDisputeAlert).not.toHaveBeenCalled()
  })

  it('closed-lost → applies LOST and alerts', async () => {
    await handleChargeDispute(
      tx,
      dispute({ status: 'lost' }),
      'charge.dispute.closed',
      'evt_1',
    )

    expect(mocks.applyStripeDisputeInTransaction).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ outcome: 'LOST' }),
    )
    expect(mocks.captureStripeDisputeAlert).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'LOST' }),
    )
  })

  it('resolves payment_intent from an expanded object', async () => {
    await handleChargeDispute(
      tx,
      dispute({ payment_intent: { id: 'pi_expanded' } as Stripe.PaymentIntent }),
      'charge.dispute.created',
      'evt_1',
    )

    expect(mocks.applyStripeDisputeInTransaction).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ stripePaymentIntentId: 'pi_expanded' }),
    )
  })

  it('returns unhandled when the dispute has no payment_intent', async () => {
    const result = await handleChargeDispute(
      tx,
      dispute({ payment_intent: null }),
      'charge.dispute.created',
      'evt_1',
    )

    expect(result.handled).toBe(false)
    expect(mocks.applyStripeDisputeInTransaction).not.toHaveBeenCalled()
    expect(mocks.captureStripeDisputeAlert).not.toHaveBeenCalled()
  })

  it('returns unhandled (no alert) when neither a final-bill nor a deposit PI matches', async () => {
    mocks.applyStripeDisputeInTransaction.mockResolvedValue(null)
    mocks.applyStripeDepositDisputeInTransaction.mockResolvedValue(null)

    const result = await handleChargeDispute(
      tx,
      dispute({ payment_intent: 'pi_unknown' }),
      'charge.dispute.created',
      'evt_1',
    )

    expect(result.handled).toBe(false)
    expect(mocks.captureStripeDisputeAlert).not.toHaveBeenCalled()
  })

  it('a deposit-PI dispute (no final-bill match) freezes the deposit and alerts with DEPOSIT flavor', async () => {
    // Final-bill matcher misses (dispute is on the deposit PI); deposit matcher
    // hits. Previously this returned handled:false — no freeze, no alert (M4).
    mocks.applyStripeDisputeInTransaction.mockResolvedValue(null)
    mocks.applyStripeDepositDisputeInTransaction.mockResolvedValue({
      bookingId: 'booking_dep',
    })

    const result = await handleChargeDispute(
      tx,
      dispute({ payment_intent: 'pi_deposit', status: 'needs_response' }),
      'charge.dispute.created',
      'evt_1',
    )

    expect(result.handled).toBe(true)
    expect(result.message).toContain('deposit')
    expect(mocks.applyStripeDepositDisputeInTransaction).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ depositPaymentIntentId: 'pi_deposit', outcome: 'OPEN' }),
    )
    expect(mocks.captureStripeDisputeAlert).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'OPEN', bookingId: 'booking_dep', flavor: 'DEPOSIT' }),
    )
  })

  it('a WON deposit dispute clears the freeze and does NOT alert', async () => {
    mocks.applyStripeDisputeInTransaction.mockResolvedValue(null)
    mocks.applyStripeDepositDisputeInTransaction.mockResolvedValue({
      bookingId: 'booking_dep',
    })

    const result = await handleChargeDispute(
      tx,
      dispute({ payment_intent: 'pi_deposit', status: 'won' }),
      'charge.dispute.closed',
      'evt_1',
    )

    expect(result.handled).toBe(true)
    expect(mocks.applyStripeDepositDisputeInTransaction).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ outcome: 'WON' }),
    )
    expect(mocks.captureStripeDisputeAlert).not.toHaveBeenCalled()
  })
})
