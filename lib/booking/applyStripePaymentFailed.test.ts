// Guards `applyStripePaymentFailedInTransaction` against the out-of-order webhook
// hazard: a stale `payment_intent.payment_failed` (a failed *attempt*) arriving
// AFTER capture must NOT downgrade a paid booking to FAILED.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  BookingStatus,
  PaymentProvider,
  Prisma,
  StripePaymentStatus,
} from '@prisma/client'

const emitPaymentActionRequired = vi.hoisted(() => vi.fn())

vi.mock('@/lib/prisma', () => ({ prisma: {} }))

vi.mock('@/lib/notifications/paymentNotifications', () => ({
  emitPaymentActionRequiredNotifications: emitPaymentActionRequired,
  emitPaymentCollectedNotifications: vi.fn(),
  emitPaymentRefundedNotifications: vi.fn(),
}))

import { applyStripePaymentFailedInTransaction } from './writeBoundary'

type BookingState = {
  id: string
  professionalId: string
  status: BookingStatus
  stripePaymentStatus: StripePaymentStatus | null
  stripeLastEventId: string | null
}

function makeTx(booking: BookingState) {
  const update = vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
    id: booking.id,
    status: booking.status,
    ...data,
  }))

  const tx = {
    $executeRaw: vi.fn().mockResolvedValue(1),
    booking: {
      findFirst: vi.fn(async () => ({
        id: booking.id,
        professionalId: booking.professionalId,
      })),
      findUnique: vi.fn(async () => ({
        ...FULL_BOOKING_DEFAULTS,
        ...booking,
      })),
      update,
    },
  }

  // The mock implements only the handful of tx methods this path touches; cast
  // it to the client type the function expects (same pattern as refunds.test).
  return { tx: tx as unknown as Prisma.TransactionClient, update }
}

// STRIPE_WEBHOOK_BOOKING_SELECT pulls many fields; the handler only branches on
// a few, so default the rest to harmless values.
const FULL_BOOKING_DEFAULTS = {
  clientId: 'client_1',
  finishedAt: null,
  sessionStep: null,
  subtotalSnapshot: 0,
  serviceSubtotalSnapshot: 0,
  productSubtotalSnapshot: 0,
  tipAmount: 0,
  taxAmount: 0,
  discountAmount: 0,
  totalAmount: 0,
  checkoutStatus: null,
  selectedPaymentMethod: null,
  paymentProvider: PaymentProvider.STRIPE,
  paymentAuthorizedAt: null,
  paymentCollectedAt: null,
  stripeCheckoutSessionId: null,
  stripePaymentIntentId: 'pi_1',
  stripeConnectedAccountId: null,
  stripeCheckoutSessionStatus: null,
  stripeAmountSubtotal: 0,
  stripeAmountTotal: 10000,
}

const ARGS = {
  stripePaymentIntentId: 'pi_1',
  stripeEventId: 'evt_failed_stale',
}

describe('applyStripePaymentFailedInTransaction — no downgrade of captured payments', () => {
  beforeEach(() => emitPaymentActionRequired.mockReset())
  afterEach(() => vi.restoreAllMocks())

  it.each([
    StripePaymentStatus.SUCCEEDED,
    StripePaymentStatus.REFUNDED,
    StripePaymentStatus.DISPUTED,
  ])('treats a stale failed-attempt as a no-op when status is %s', async (status) => {
    const { tx, update } = makeTx({
      id: 'booking_1',
      professionalId: 'pro_1',
      status: BookingStatus.COMPLETED,
      stripePaymentStatus: status,
      stripeLastEventId: 'evt_succeeded_1',
    })

    const result = await applyStripePaymentFailedInTransaction(tx, ARGS)

    expect(update).not.toHaveBeenCalled()
    expect(emitPaymentActionRequired).not.toHaveBeenCalled()
    expect(result?.bookingId).toBe('booking_1')
  })

  it('still records a genuine failure when no payment has been captured', async () => {
    const { tx, update } = makeTx({
      id: 'booking_1',
      professionalId: 'pro_1',
      status: BookingStatus.ACCEPTED,
      stripePaymentStatus: StripePaymentStatus.PROCESSING,
      stripeLastEventId: null,
    })

    await applyStripePaymentFailedInTransaction(tx, ARGS)

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          stripePaymentStatus: StripePaymentStatus.FAILED,
        }),
      }),
    )
    expect(emitPaymentActionRequired).toHaveBeenCalledTimes(1)
  })
})
