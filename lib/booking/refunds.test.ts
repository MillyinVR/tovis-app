import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  BookingRefundStatus,
  BookingRefundTrigger,
  PaymentProvider,
  Role,
  StripePaymentStatus,
} from '@prisma/client'

const mocks = vi.hoisted(() => ({
  stripeRefundsCreate: vi.fn(),
  captureException: vi.fn(),
  // In-memory state configured per test.
  booking: null as Record<string, unknown> | null,
  refundRows: [] as Array<Record<string, unknown>>,
  bookingUpdates: [] as Array<Record<string, unknown>>,
  idCounter: 0,
}))

vi.mock('@/lib/stripe/server', () => ({
  getStripe: () => ({ refunds: { create: mocks.stripeRefundsCreate } }),
}))

vi.mock('@sentry/nextjs', () => ({
  captureException: mocks.captureException,
}))

function matchesStatus(rowStatus: unknown, filter: unknown): boolean {
  if (filter && typeof filter === 'object' && 'in' in filter) {
    return (filter.in as unknown[]).includes(rowStatus)
  }
  return rowStatus === filter
}

function makeTx() {
  return {
    $executeRaw: vi.fn().mockResolvedValue(1),
    booking: {
      findUnique: vi.fn(async () => mocks.booking),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        mocks.bookingUpdates.push(data)
        return { id: 'booking_1', ...data }
      }),
    },
    bookingRefund: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        mocks.idCounter += 1
        const row = { id: `refund_${mocks.idCounter}`, ...data }
        mocks.refundRows.push(row)
        return row
      }),
      update: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string }
          data: Record<string, unknown>
        }) => {
          const row = mocks.refundRows.find((r) => r.id === where.id)
          if (!row) throw new Error(`refund ${where.id} not found`)
          Object.assign(row, data)
          return row
        },
      ),
      aggregate: vi.fn(
        async ({
          where,
        }: {
          where: { bookingId: string; status: unknown }
        }) => {
          const sum = mocks.refundRows
            .filter(
              (r) =>
                r.bookingId === where.bookingId &&
                matchesStatus(r.status, where.status),
            )
            .reduce((acc, r) => acc + (r.amountCents as number), 0)
          return { _sum: { amountCents: sum } }
        },
      ),
    },
  }
}

const txRef = { current: makeTx() }

vi.mock('@/lib/prisma', () => ({
  prisma: {
    $transaction: (cb: (tx: ReturnType<typeof makeTx>) => unknown) =>
      cb(txRef.current),
    bookingRefund: {
      update: (args: { where: { id: string }; data: Record<string, unknown> }) =>
        txRef.current.bookingRefund.update(args),
    },
  },
}))

import { refundBookingPayment } from './refunds'

function setBooking(overrides: Record<string, unknown> = {}) {
  mocks.booking = {
    id: 'booking_1',
    paymentProvider: PaymentProvider.STRIPE,
    stripePaymentIntentId: 'pi_123',
    stripePaymentStatus: StripePaymentStatus.SUCCEEDED,
    stripeAmountTotal: 10000,
    stripeApplicationFeeAmount: null,
    stripeCurrency: 'usd',
    ...overrides,
  }
}

beforeEach(() => {
  mocks.stripeRefundsCreate.mockReset()
  mocks.captureException.mockReset()
  mocks.booking = null
  mocks.refundRows = []
  mocks.bookingUpdates = []
  mocks.idCounter = 0
  txRef.current = makeTx()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('refundBookingPayment — eligibility', () => {
  it('skips a non-Stripe (manual) booking', async () => {
    setBooking({ paymentProvider: PaymentProvider.MANUAL })

    const result = await refundBookingPayment({
      bookingId: 'booking_1',
      trigger: BookingRefundTrigger.AUTO_CANCELLATION,
    })

    expect(result).toEqual({ outcome: 'SKIPPED', reason: 'NOT_STRIPE_PAYMENT' })
    expect(mocks.stripeRefundsCreate).not.toHaveBeenCalled()
  })

  it('skips a Stripe booking whose payment is not captured', async () => {
    setBooking({ stripePaymentStatus: StripePaymentStatus.PROCESSING })

    const result = await refundBookingPayment({
      bookingId: 'booking_1',
      trigger: BookingRefundTrigger.AUTO_CANCELLATION,
    })

    expect(result).toEqual({ outcome: 'SKIPPED', reason: 'PAYMENT_NOT_CAPTURED' })
    expect(mocks.stripeRefundsCreate).not.toHaveBeenCalled()
  })

  it('returns INVALID for an unknown booking', async () => {
    mocks.booking = null

    const result = await refundBookingPayment({
      bookingId: 'missing',
      trigger: BookingRefundTrigger.DISCRETIONARY,
    })

    expect(result.outcome).toBe('INVALID')
    if (result.outcome === 'INVALID') {
      expect(result.code).toBe('BOOKING_NOT_FOUND')
    }
  })

  it('skips when the booking is already fully refunded', async () => {
    setBooking()
    mocks.refundRows.push({
      id: 'refund_existing',
      bookingId: 'booking_1',
      amountCents: 10000,
      status: BookingRefundStatus.SUCCEEDED,
    })

    const result = await refundBookingPayment({
      bookingId: 'booking_1',
      trigger: BookingRefundTrigger.DISCRETIONARY,
    })

    expect(result).toEqual({ outcome: 'SKIPPED', reason: 'NOTHING_TO_REFUND' })
    expect(mocks.stripeRefundsCreate).not.toHaveBeenCalled()
  })

  it('rejects an amount exceeding the remaining refundable', async () => {
    setBooking({ stripeAmountTotal: 5000 })

    const result = await refundBookingPayment({
      bookingId: 'booking_1',
      trigger: BookingRefundTrigger.DISCRETIONARY,
      amountCents: 6000,
    })

    expect(result.outcome).toBe('INVALID')
    if (result.outcome === 'INVALID') {
      expect(result.code).toBe('INVALID_AMOUNT')
    }
    expect(mocks.stripeRefundsCreate).not.toHaveBeenCalled()
  })

  it('rejects a non-positive amount', async () => {
    setBooking()

    const result = await refundBookingPayment({
      bookingId: 'booking_1',
      trigger: BookingRefundTrigger.DISCRETIONARY,
      amountCents: 0,
    })

    expect(result.outcome).toBe('INVALID')
  })
})

describe('refundBookingPayment — full refund', () => {
  it('refunds the full captured amount with reverse_transfer and flips the booking to REFUNDED', async () => {
    setBooking()
    mocks.stripeRefundsCreate.mockResolvedValue({ id: 're_full_1' })

    const result = await refundBookingPayment({
      bookingId: 'booking_1',
      trigger: BookingRefundTrigger.AUTO_CANCELLATION,
      actor: { userId: 'user_pro', role: Role.PRO },
      reason: 'pro cancelled',
    })

    expect(result.outcome).toBe('REFUNDED')
    if (result.outcome === 'REFUNDED') {
      expect(result.bookingFullyRefunded).toBe(true)
      expect(result.refund.status).toBe(BookingRefundStatus.SUCCEEDED)
      expect(result.refund.stripeRefundId).toBe('re_full_1')
      expect(result.refund.amountCents).toBe(10000)
    }

    expect(mocks.stripeRefundsCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        payment_intent: 'pi_123',
        amount: 10000,
        reverse_transfer: true,
      }),
      { idempotencyKey: 'tovis:refund:refund_1' },
    )
    // No application fee on this booking → refund_application_fee not sent.
    expect(mocks.stripeRefundsCreate.mock.calls[0]?.[0]).not.toHaveProperty(
      'refund_application_fee',
    )
    expect(mocks.bookingUpdates).toContainEqual({
      stripePaymentStatus: StripePaymentStatus.REFUNDED,
    })
  })

  it('sends refund_application_fee when the booking carries a platform fee', async () => {
    setBooking({ stripeApplicationFeeAmount: 500 })
    mocks.stripeRefundsCreate.mockResolvedValue({ id: 're_fee_1' })

    const result = await refundBookingPayment({
      bookingId: 'booking_1',
      trigger: BookingRefundTrigger.AUTO_CANCELLATION,
    })

    expect(result.outcome).toBe('REFUNDED')
    expect(mocks.stripeRefundsCreate.mock.calls[0]?.[0]).toMatchObject({
      refund_application_fee: true,
    })
    if (result.outcome === 'REFUNDED') {
      expect(result.refund.applicationFeeRefunded).toBe(true)
    }
  })
})

describe('refundBookingPayment — partial refunds', () => {
  it('does not flip the booking to REFUNDED on a partial refund', async () => {
    setBooking({ stripeAmountTotal: 10000 })
    mocks.stripeRefundsCreate.mockResolvedValue({ id: 're_partial_1' })

    const result = await refundBookingPayment({
      bookingId: 'booking_1',
      trigger: BookingRefundTrigger.DISCRETIONARY,
      amountCents: 4000,
    })

    expect(result.outcome).toBe('REFUNDED')
    if (result.outcome === 'REFUNDED') {
      expect(result.bookingFullyRefunded).toBe(false)
    }
    expect(mocks.stripeRefundsCreate.mock.calls[0]?.[0]).toMatchObject({
      amount: 4000,
    })
    expect(mocks.bookingUpdates).not.toContainEqual({
      stripePaymentStatus: StripePaymentStatus.REFUNDED,
    })
  })

  it('flips to REFUNDED only once cumulative partials reach the captured total', async () => {
    setBooking({ stripeAmountTotal: 10000 })

    mocks.stripeRefundsCreate.mockResolvedValueOnce({ id: 're_a' })
    await refundBookingPayment({
      bookingId: 'booking_1',
      trigger: BookingRefundTrigger.DISCRETIONARY,
      amountCents: 6000,
    })

    expect(mocks.bookingUpdates).not.toContainEqual({
      stripePaymentStatus: StripePaymentStatus.REFUNDED,
    })

    mocks.stripeRefundsCreate.mockResolvedValueOnce({ id: 're_b' })
    const second = await refundBookingPayment({
      bookingId: 'booking_1',
      trigger: BookingRefundTrigger.DISCRETIONARY,
      amountCents: 4000,
    })

    expect(second.outcome).toBe('REFUNDED')
    if (second.outcome === 'REFUNDED') {
      expect(second.bookingFullyRefunded).toBe(true)
    }
    expect(mocks.bookingUpdates).toContainEqual({
      stripePaymentStatus: StripePaymentStatus.REFUNDED,
    })
  })

  it('caps a second refund at the remaining amount', async () => {
    setBooking({ stripeAmountTotal: 10000 })
    mocks.refundRows.push({
      id: 'refund_prior',
      bookingId: 'booking_1',
      amountCents: 8000,
      status: BookingRefundStatus.SUCCEEDED,
    })

    const result = await refundBookingPayment({
      bookingId: 'booking_1',
      trigger: BookingRefundTrigger.DISCRETIONARY,
      amountCents: 3000, // remaining is only 2000
    })

    expect(result.outcome).toBe('INVALID')
    expect(mocks.stripeRefundsCreate).not.toHaveBeenCalled()
  })
})

describe('refundBookingPayment — Stripe failure', () => {
  it('marks the reserved refund FAILED and releases the reservation', async () => {
    setBooking()
    mocks.stripeRefundsCreate.mockRejectedValue(new Error('card_declined'))

    const result = await refundBookingPayment({
      bookingId: 'booking_1',
      trigger: BookingRefundTrigger.AUTO_CANCELLATION,
    })

    expect(result.outcome).toBe('FAILED')
    if (result.outcome === 'FAILED') {
      expect(result.refund.status).toBe(BookingRefundStatus.FAILED)
      expect(result.message).toContain('card_declined')
    }
    expect(mocks.captureException).toHaveBeenCalled()
    expect(mocks.bookingUpdates).not.toContainEqual({
      stripePaymentStatus: StripePaymentStatus.REFUNDED,
    })

    // Reservation released: a failed row no longer counts, so a retry sees the
    // full amount available again.
    mocks.stripeRefundsCreate.mockResolvedValueOnce({ id: 're_retry' })
    const retry = await refundBookingPayment({
      bookingId: 'booking_1',
      trigger: BookingRefundTrigger.AUTO_CANCELLATION,
    })
    expect(retry.outcome).toBe('REFUNDED')
    expect(mocks.stripeRefundsCreate.mock.calls.at(-1)?.[0]).toMatchObject({
      amount: 10000,
    })
  })
})
