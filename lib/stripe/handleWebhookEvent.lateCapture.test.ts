// lib/stripe/handleWebhookEvent.lateCapture.test.ts
//
// M1 — when a success applier reports capturedOnCancelledBooking, the dispatch
// result must carry lateCaptureRefund so the arrival paths (webhook route,
// requeue cron) can settle the money post-commit. The boundary is mocked; the
// appliers' own flag computation is covered in
// lib/booking/applyStripeLateCaptureFlag.test.ts.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type Stripe from 'stripe'
import type { Prisma } from '@prisma/client'

import { asTestStripeEvent } from '@/lib/typed/stripeTestEvent'
import { asTestTransactionClient } from '@/lib/typed/prismaTestClient'

const mocks = vi.hoisted(() => ({
  applyStripePaymentSucceededInTransaction: vi.fn(),
  applyStripeDepositSucceededInTransaction: vi.fn(),
}))

vi.mock('@/lib/booking/writeBoundary', () => ({
  applyStripeCheckoutSessionStatusInTransaction: vi.fn(),
  applyStripeDepositSucceededInTransaction:
    mocks.applyStripeDepositSucceededInTransaction,
  applyStripeDisputeInTransaction: vi.fn(),
  applyStripePaymentFailedInTransaction: vi.fn(),
  applyStripePaymentSucceededInTransaction:
    mocks.applyStripePaymentSucceededInTransaction,
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

function paymentIntentEvent(): Stripe.Event {
  return asTestStripeEvent({
    id: 'evt_1',
    type: 'payment_intent.succeeded',
    data: {
      object: {
        id: 'pi_1',
        object: 'payment_intent',
        metadata: { bookingId: 'booking_1' },
        amount: 10000,
        amount_received: 10000,
        currency: 'usd',
        latest_charge: 'ch_1',
      },
    },
  })
}

function depositSessionEvent(): Stripe.Event {
  return asTestStripeEvent({
    id: 'evt_2',
    type: 'checkout.session.completed',
    data: {
      object: {
        id: 'cs_1',
        object: 'checkout.session',
        payment_intent: 'pi_dep_1',
        client_reference_id: 'booking_1',
        metadata: { kind: 'DISCOVERY_DEPOSIT', bookingId: 'booking_1' },
        amount_subtotal: 3000,
        amount_total: 3000,
        currency: 'usd',
      },
    },
  })
}

beforeEach(() => {
  mocks.applyStripePaymentSucceededInTransaction.mockReset()
  mocks.applyStripeDepositSucceededInTransaction.mockReset()
})

describe('handleStripeEvent — lateCaptureRefund propagation', () => {
  it('carries SERVICE lateCaptureRefund when the payment applied onto a cancelled booking', async () => {
    mocks.applyStripePaymentSucceededInTransaction.mockResolvedValue({
      bookingId: 'booking_1',
      bookingCompleted: false,
      meta: { mutated: true },
      capturedOnCancelledBooking: true,
    })

    const result = await handleStripeEvent(tx, paymentIntentEvent())

    expect(result.handled).toBe(true)
    expect(result.lateCaptureRefund).toEqual({
      bookingId: 'booking_1',
      flavor: 'SERVICE',
    })
  })

  it('omits lateCaptureRefund for a payment onto a live booking', async () => {
    mocks.applyStripePaymentSucceededInTransaction.mockResolvedValue({
      bookingId: 'booking_1',
      bookingCompleted: false,
      meta: { mutated: true },
      capturedOnCancelledBooking: false,
    })

    const result = await handleStripeEvent(tx, paymentIntentEvent())

    expect(result.handled).toBe(true)
    expect(result.lateCaptureRefund).toBeUndefined()
  })

  it('carries DEPOSIT lateCaptureRefund when the deposit landed on a cancelled booking', async () => {
    mocks.applyStripeDepositSucceededInTransaction.mockResolvedValue({
      handled: true,
      alreadyPaid: false,
      bookingId: 'booking_1',
      capturedOnCancelledBooking: true,
    })

    const result = await handleStripeEvent(tx, depositSessionEvent())

    expect(result.handled).toBe(true)
    expect(result.lateCaptureRefund).toEqual({
      bookingId: 'booking_1',
      flavor: 'DEPOSIT',
    })
  })

  it('omits lateCaptureRefund for a deposit onto a live booking', async () => {
    mocks.applyStripeDepositSucceededInTransaction.mockResolvedValue({
      handled: true,
      alreadyPaid: false,
      bookingId: 'booking_1',
      capturedOnCancelledBooking: false,
    })

    const result = await handleStripeEvent(tx, depositSessionEvent())

    expect(result.handled).toBe(true)
    expect(result.lateCaptureRefund).toBeUndefined()
  })
})
