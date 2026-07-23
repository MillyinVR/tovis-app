// lib/stripe/handleWebhookEvent.checkoutSessionRouting.test.ts
//
// M2 — checkout.session events must route on the session's KIND, not its
// status. A discovery-deposit session (metadata.kind=DISCOVERY_DEPOSIT) must
// never reach applyStripeCheckoutSessionStatusInTransaction — the final-bill
// field writer — whatever the session's outcome: COMPLETE goes to the deposit
// applier, EXPIRED is a deliberate no-op. A final-bill session (no kind
// metadata) keeps flowing to the final-bill writer for BOTH statuses.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type Stripe from 'stripe'
import type { Prisma } from '@prisma/client'
import { StripeCheckoutSessionStatus } from '@prisma/client'

import { asTestStripeEvent } from '@/lib/typed/stripeTestEvent'
import { asTestTransactionClient } from '@/lib/typed/prismaTestClient'

const mocks = vi.hoisted(() => ({
  applyStripeCheckoutSessionStatusInTransaction: vi.fn(),
  applyStripeDepositSucceededInTransaction: vi.fn(),
}))

vi.mock('@/lib/booking/writeBoundary', () => ({
  applyStripeCheckoutSessionStatusInTransaction:
    mocks.applyStripeCheckoutSessionStatusInTransaction,
  applyStripeDepositSucceededInTransaction:
    mocks.applyStripeDepositSucceededInTransaction,
  applyStripeDisputeInTransaction: vi.fn(),
  applyStripePaymentFailedInTransaction: vi.fn(),
  applyStripePaymentSucceededInTransaction: vi.fn(),
  reconcileDepositChargeRefundInTransaction: vi.fn(),
  DISCOVERY_DEPOSIT_CHECKOUT_KIND: 'DISCOVERY_DEPOSIT',
}))

vi.mock('@/lib/booking/refunds', () => ({
  reconcileChargeRefundInTransaction: vi.fn(),
}))

vi.mock('@/lib/membership/syncSubscription', () => ({
  applyStripeSubscriptionInTransaction: vi.fn(),
}))

vi.mock('@/lib/observability/bookingEvents', () => ({
  captureStripeDisputeAlert: vi.fn(),
}))

import { handleStripeEvent } from './handleWebhookEvent'

const tx: Prisma.TransactionClient = asTestTransactionClient({})

function checkoutSessionEvent(args: {
  type: 'checkout.session.completed' | 'checkout.session.expired'
  kind?: 'DISCOVERY_DEPOSIT'
}): Stripe.Event {
  return asTestStripeEvent({
    id: 'evt_1',
    type: args.type,
    data: {
      object: {
        id: 'cs_1',
        object: 'checkout.session',
        payment_intent: 'pi_1',
        client_reference_id: 'booking_1',
        metadata: {
          bookingId: 'booking_1',
          ...(args.kind ? { kind: args.kind } : {}),
        },
        amount_subtotal: 3000,
        amount_total: 3000,
        currency: 'usd',
      },
    },
  })
}

beforeEach(() => {
  mocks.applyStripeCheckoutSessionStatusInTransaction.mockReset()
  mocks.applyStripeDepositSucceededInTransaction.mockReset()
  mocks.applyStripeCheckoutSessionStatusInTransaction.mockResolvedValue({
    bookingId: 'booking_1',
    bookingCompleted: false,
    meta: { mutated: true },
  })
  mocks.applyStripeDepositSucceededInTransaction.mockResolvedValue({
    handled: true,
    alreadyPaid: false,
    bookingId: 'booking_1',
    capturedOnCancelledBooking: false,
  })
})

describe('handleStripeEvent — checkout.session routing on KIND, not status', () => {
  it('deposit session × COMPLETE routes to the deposit applier, never the final-bill writer', async () => {
    const result = await handleStripeEvent(
      tx,
      checkoutSessionEvent({
        type: 'checkout.session.completed',
        kind: 'DISCOVERY_DEPOSIT',
      }),
    )

    expect(result.handled).toBe(true)
    expect(mocks.applyStripeDepositSucceededInTransaction).toHaveBeenCalledWith(
      tx,
      {
        stripePaymentIntentId: 'pi_1',
        chargeId: null,
        bookingIdHint: 'booking_1',
      },
    )
    expect(
      mocks.applyStripeCheckoutSessionStatusInTransaction,
    ).not.toHaveBeenCalled()
  })

  it('deposit session × EXPIRED touches NOTHING — neither applier runs', async () => {
    const result = await handleStripeEvent(
      tx,
      checkoutSessionEvent({
        type: 'checkout.session.expired',
        kind: 'DISCOVERY_DEPOSIT',
      }),
    )

    expect(result.handled).toBe(true)
    expect(result.message).toContain('deposit session ignored')
    expect(
      mocks.applyStripeCheckoutSessionStatusInTransaction,
    ).not.toHaveBeenCalled()
    expect(
      mocks.applyStripeDepositSucceededInTransaction,
    ).not.toHaveBeenCalled()
  })

  it('final-bill session × COMPLETE still reaches the final-bill writer', async () => {
    const result = await handleStripeEvent(
      tx,
      checkoutSessionEvent({ type: 'checkout.session.completed' }),
    )

    expect(result.handled).toBe(true)
    expect(
      mocks.applyStripeCheckoutSessionStatusInTransaction,
    ).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        bookingIdHint: 'booking_1',
        stripeCheckoutSessionId: 'cs_1',
        stripePaymentIntentId: 'pi_1',
        status: StripeCheckoutSessionStatus.COMPLETE,
      }),
    )
    expect(mocks.applyStripeDepositSucceededInTransaction).not.toHaveBeenCalled()
  })

  it('final-bill session × EXPIRED still records EXPIRED via the final-bill writer', async () => {
    const result = await handleStripeEvent(
      tx,
      checkoutSessionEvent({ type: 'checkout.session.expired' }),
    )

    expect(result.handled).toBe(true)
    expect(
      mocks.applyStripeCheckoutSessionStatusInTransaction,
    ).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        stripeCheckoutSessionId: 'cs_1',
        status: StripeCheckoutSessionStatus.EXPIRED,
      }),
    )
    expect(mocks.applyStripeDepositSucceededInTransaction).not.toHaveBeenCalled()
  })
})
