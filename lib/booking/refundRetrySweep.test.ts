import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  BookingDepositStatus,
  BookingRefundStatus,
  BookingRefundTrigger,
  BookingStatus,
  Role,
  StripePaymentStatus,
} from '@prisma/client'

const mocks = vi.hoisted(() => ({
  refundFindMany: vi.fn(),
  refundCount: vi.fn(),
  refundFindFirst: vi.fn(),
  refundBookingPayment: vi.fn(),
  applyLateCaptureCancelRefund: vi.fn(),
  captureRetriesExhausted: vi.fn(),
  captureBookingException: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    bookingRefund: {
      findMany: mocks.refundFindMany,
      count: mocks.refundCount,
      findFirst: mocks.refundFindFirst,
    },
  },
}))

vi.mock('@/lib/booking/refunds', () => ({
  refundBookingPayment: mocks.refundBookingPayment,
}))

vi.mock('@/lib/booking/cancelRefund', () => ({
  applyLateCaptureCancelRefund: mocks.applyLateCaptureCancelRefund,
}))

vi.mock('@/lib/observability/bookingEvents', () => ({
  captureAutoCancelRefundRetriesExhausted: mocks.captureRetriesExhausted,
  captureBookingException: mocks.captureBookingException,
}))

import {
  DEPOSIT_RETRY_BACKOFF_MS,
  MAX_ATTEMPTS,
  MAX_RETRIES_PER_RUN,
  RETRY_BACKOFF_MS,
  retryFailedAutoCancelRefunds,
} from './refundRetrySweep'

const NOW = new Date('2026-07-22T12:00:00.000Z')

function serviceBooking(overrides: Record<string, unknown> = {}) {
  return {
    status: BookingStatus.CANCELLED,
    stripePaymentIntentId: 'pi_service',
    stripePaymentStatus: StripePaymentStatus.SUCCEEDED,
    depositStripePaymentIntentId: 'pi_deposit',
    depositStatus: BookingDepositStatus.NONE,
    cancelledAt: new Date('2026-07-21T12:00:00.000Z'),
    cancelledByRole: Role.CLIENT,
    ...overrides,
  }
}

/** A FAILED row as returned by the sweep's discovery query. */
function failedRow(overrides: Record<string, unknown> = {}) {
  return {
    bookingId: 'booking_1',
    stripePaymentIntentId: 'pi_service',
    createdAt: new Date(NOW.getTime() - 2 * RETRY_BACKOFF_MS),
    booking: serviceBooking(),
    ...overrides,
  }
}

beforeEach(() => {
  for (const fn of Object.values(mocks)) fn.mockReset()
  mocks.refundFindMany.mockResolvedValue([])
  mocks.refundCount.mockResolvedValue(1)
  mocks.refundFindFirst.mockResolvedValue({ status: BookingRefundStatus.FAILED })
  mocks.refundBookingPayment.mockResolvedValue({
    outcome: 'REFUNDED',
    refund: { id: 'refund_new' },
    bookingFullyRefunded: true,
  })
  mocks.applyLateCaptureCancelRefund.mockResolvedValue({
    outcome: 'REFUNDED',
    refundAmountCents: 4000,
    feeRefunded: true,
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('retryFailedAutoCancelRefunds — discovery', () => {
  it('only looks at FAILED AUTO_CANCELLATION rows on CANCELLED bookings', async () => {
    await retryFailedAutoCancelRefunds({ now: NOW })

    expect(mocks.refundFindMany).toHaveBeenCalledTimes(1)
    const where = mocks.refundFindMany.mock.calls.at(0)?.[0]?.where
    expect(where).toMatchObject({
      status: BookingRefundStatus.FAILED,
      trigger: BookingRefundTrigger.AUTO_CANCELLATION,
      booking: { status: BookingStatus.CANCELLED },
    })
    expect(where?.createdAt?.gte).toBeInstanceOf(Date)
  })

  it('retries a service-flavor pair through refundBookingPayment for the full remainder', async () => {
    mocks.refundFindMany.mockResolvedValue([failedRow()])

    const run = await retryFailedAutoCancelRefunds({ now: NOW })

    expect(mocks.refundBookingPayment).toHaveBeenCalledTimes(1)
    const input = mocks.refundBookingPayment.mock.calls.at(0)?.[0]
    expect(input).toMatchObject({
      bookingId: 'booking_1',
      trigger: BookingRefundTrigger.AUTO_CANCELLATION,
    })
    // Full remaining amount — the remaining math re-checks current state.
    expect(input?.amountCents).toBeUndefined()
    expect(run.tally.retried_succeeded).toBe(1)
  })

  it('routes a deposit-flavor pair through the cancel-policy re-run, marked as sweep-sourced', async () => {
    mocks.refundFindMany.mockResolvedValue([
      failedRow({
        stripePaymentIntentId: 'pi_deposit',
        createdAt: new Date(NOW.getTime() - DEPOSIT_RETRY_BACKOFF_MS - 1000),
        booking: serviceBooking({ depositStatus: BookingDepositStatus.PAID }),
      }),
    ])

    const run = await retryFailedAutoCancelRefunds({ now: NOW })

    expect(mocks.applyLateCaptureCancelRefund).toHaveBeenCalledWith({
      bookingId: 'booking_1',
      flavor: 'DEPOSIT',
      source: 'RETRY_SWEEP',
    })
    expect(mocks.refundBookingPayment).not.toHaveBeenCalled()
    expect(run.tally.retried_succeeded).toBe(1)
  })

  it('skips a deposit-flavor pair whose deposit charge is under dispute (M4) — never attempts', async () => {
    // A disputed deposit still reads depositStatus=PAID and passes backoff/
    // provenance; the depositDisputedAt freeze is what keeps the sweep off it,
    // so Stripe already pulled the funds and a retry would double-return them.
    mocks.refundFindMany.mockResolvedValue([
      failedRow({
        stripePaymentIntentId: 'pi_deposit',
        createdAt: new Date(NOW.getTime() - DEPOSIT_RETRY_BACKOFF_MS - 1000),
        booking: serviceBooking({
          depositStatus: BookingDepositStatus.PAID,
          depositDisputedAt: new Date('2026-07-21T00:00:00.000Z'),
        }),
      }),
    ])

    const run = await retryFailedAutoCancelRefunds({ now: NOW })

    expect(mocks.applyLateCaptureCancelRefund).not.toHaveBeenCalled()
    expect(mocks.refundBookingPayment).not.toHaveBeenCalled()
    expect(run.tally.not_retryable).toBe(1)
    expect(run.tally.retried_succeeded).toBe(0)
  })

  it('collapses several FAILED rows for one pair into a single retry', async () => {
    mocks.refundFindMany.mockResolvedValue([
      failedRow({ createdAt: new Date(NOW.getTime() - 5 * RETRY_BACKOFF_MS) }),
      failedRow({ createdAt: new Date(NOW.getTime() - 2 * RETRY_BACKOFF_MS) }),
    ])
    mocks.refundCount.mockResolvedValue(2)

    const run = await retryFailedAutoCancelRefunds({ now: NOW })

    expect(run.pairsScanned).toBe(1)
    expect(mocks.refundBookingPayment).toHaveBeenCalledTimes(1)
  })

  it('caps the pairs processed per run and reports the cap', async () => {
    mocks.refundFindMany.mockResolvedValue(
      Array.from({ length: MAX_RETRIES_PER_RUN + 3 }, (_, i) =>
        failedRow({ bookingId: `booking_${i}` }),
      ),
    )

    const run = await retryFailedAutoCancelRefunds({ now: NOW })

    expect(run.pairsScanned).toBe(MAX_RETRIES_PER_RUN + 3)
    expect(run.capped).toBe(true)
    expect(mocks.refundBookingPayment).toHaveBeenCalledTimes(MAX_RETRIES_PER_RUN)
  })
})

describe('retryFailedAutoCancelRefunds — bounds', () => {
  it('waits out the service backoff after the most recent failure', async () => {
    mocks.refundFindMany.mockResolvedValue([
      failedRow({ createdAt: new Date(NOW.getTime() - RETRY_BACKOFF_MS / 2) }),
    ])

    const run = await retryFailedAutoCancelRefunds({ now: NOW })

    expect(mocks.refundBookingPayment).not.toHaveBeenCalled()
    expect(run.tally.waiting_backoff).toBe(1)
  })

  it('uses the longer (> Stripe idempotency TTL) backoff for deposit retries', async () => {
    // Old enough for the service backoff, NOT old enough for the deposit one.
    mocks.refundFindMany.mockResolvedValue([
      failedRow({
        stripePaymentIntentId: 'pi_deposit',
        createdAt: new Date(NOW.getTime() - 2 * RETRY_BACKOFF_MS),
        booking: serviceBooking({ depositStatus: BookingDepositStatus.PAID }),
      }),
    ])

    const run = await retryFailedAutoCancelRefunds({ now: NOW })

    expect(mocks.applyLateCaptureCancelRefund).not.toHaveBeenCalled()
    expect(run.tally.waiting_backoff).toBe(1)
  })

  it('stops once the all-time attempt budget is spent', async () => {
    mocks.refundFindMany.mockResolvedValue([failedRow()])
    mocks.refundCount.mockResolvedValue(MAX_ATTEMPTS)

    const run = await retryFailedAutoCancelRefunds({ now: NOW })

    expect(mocks.refundBookingPayment).not.toHaveBeenCalled()
    // The page fired when the exhausting ATTEMPT failed; skipping is silent.
    expect(mocks.captureRetriesExhausted).not.toHaveBeenCalled()
    expect(run.tally.retries_exhausted).toBe(1)
  })

  it('pages exactly when a failing attempt exhausts the budget', async () => {
    mocks.refundFindMany.mockResolvedValue([failedRow()])
    mocks.refundCount.mockResolvedValue(MAX_ATTEMPTS - 1)
    mocks.refundBookingPayment.mockResolvedValue({
      outcome: 'FAILED',
      refund: { id: 'refund_new' },
      message: 'still refusing',
    })

    const run = await retryFailedAutoCancelRefunds({ now: NOW })

    expect(mocks.captureRetriesExhausted).toHaveBeenCalledWith({
      bookingId: 'booking_1',
      paymentIntentId: 'pi_service',
      flavor: 'SERVICE',
      attempts: MAX_ATTEMPTS,
      detail: 'still refusing',
    })
    expect(run.tally.retries_exhausted).toBe(1)
  })

  it('a failing attempt below the budget just tallies and waits for the next run', async () => {
    mocks.refundFindMany.mockResolvedValue([failedRow()])
    mocks.refundCount.mockResolvedValue(1)
    mocks.refundBookingPayment.mockResolvedValue({
      outcome: 'FAILED',
      refund: { id: 'refund_new' },
      message: 'still refusing',
    })

    const run = await retryFailedAutoCancelRefunds({ now: NOW })

    expect(mocks.captureRetriesExhausted).not.toHaveBeenCalled()
    expect(run.tally.retried_failed).toBe(1)
  })
})

describe('retryFailedAutoCancelRefunds — staleness guards', () => {
  it('skips a pair whose latest refund row is no longer FAILED', async () => {
    mocks.refundFindMany.mockResolvedValue([failedRow()])
    mocks.refundFindFirst.mockResolvedValue({
      status: BookingRefundStatus.SUCCEEDED,
    })

    const run = await retryFailedAutoCancelRefunds({ now: NOW })

    expect(mocks.refundBookingPayment).not.toHaveBeenCalled()
    expect(run.tally.not_retryable).toBe(1)
  })

  it('skips a PI that is no longer the booking payment for either flavor', async () => {
    mocks.refundFindMany.mockResolvedValue([
      failedRow({ stripePaymentIntentId: 'pi_superseded' }),
    ])

    const run = await retryFailedAutoCancelRefunds({ now: NOW })

    expect(mocks.refundBookingPayment).not.toHaveBeenCalled()
    expect(mocks.applyLateCaptureCancelRefund).not.toHaveBeenCalled()
    expect(run.tally.not_retryable).toBe(1)
  })

  it('skips a service PI whose payment is no longer SUCCEEDED (refunded or disputed)', async () => {
    mocks.refundFindMany.mockResolvedValue([
      failedRow({
        booking: serviceBooking({
          stripePaymentStatus: StripePaymentStatus.DISPUTED,
        }),
      }),
    ])

    const run = await retryFailedAutoCancelRefunds({ now: NOW })

    expect(mocks.refundBookingPayment).not.toHaveBeenCalled()
    expect(run.tally.not_retryable).toBe(1)
  })

  it('skips a deposit pair without provenance or a PAID deposit', async () => {
    mocks.refundFindMany.mockResolvedValue([
      failedRow({
        stripePaymentIntentId: 'pi_deposit',
        createdAt: new Date(NOW.getTime() - DEPOSIT_RETRY_BACKOFF_MS - 1000),
        booking: serviceBooking({
          depositStatus: BookingDepositStatus.PAID,
          cancelledByRole: null,
        }),
      }),
      failedRow({
        bookingId: 'booking_2',
        stripePaymentIntentId: 'pi_deposit',
        createdAt: new Date(NOW.getTime() - DEPOSIT_RETRY_BACKOFF_MS - 1000),
        booking: serviceBooking({
          depositStatus: BookingDepositStatus.REFUNDED,
        }),
      }),
    ])

    const run = await retryFailedAutoCancelRefunds({ now: NOW })

    expect(mocks.applyLateCaptureCancelRefund).not.toHaveBeenCalled()
    expect(run.tally.not_retryable).toBe(2)
  })

  it('a gate refusal from the refund owner tallies as not retryable', async () => {
    mocks.refundFindMany.mockResolvedValue([failedRow()])
    mocks.refundBookingPayment.mockResolvedValue({
      outcome: 'SKIPPED',
      reason: 'NOTHING_TO_REFUND',
    })

    const run = await retryFailedAutoCancelRefunds({ now: NOW })

    expect(run.tally.not_retryable).toBe(1)
    expect(mocks.captureRetriesExhausted).not.toHaveBeenCalled()
  })

  it('one pair blowing up never blocks the rest of the sweep', async () => {
    mocks.refundFindMany.mockResolvedValue([
      failedRow(),
      failedRow({ bookingId: 'booking_2' }),
    ])
    mocks.refundBookingPayment
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({
        outcome: 'REFUNDED',
        refund: { id: 'refund_new' },
        bookingFullyRefunded: true,
      })

    const run = await retryFailedAutoCancelRefunds({ now: NOW })

    expect(mocks.captureBookingException).toHaveBeenCalledTimes(1)
    expect(run.tally.retry_error).toBe(1)
    expect(run.tally.retried_succeeded).toBe(1)
  })
})
