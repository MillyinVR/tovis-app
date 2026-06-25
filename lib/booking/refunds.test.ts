import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  BookingRefundStatus,
  BookingRefundTrigger,
  PaymentProvider,
  type Prisma,
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

const mockEmitPaymentRefunded = vi.hoisted(() => vi.fn())

vi.mock('@/lib/notifications/paymentNotifications', () => ({
  emitPaymentRefundedNotifications: mockEmitPaymentRefunded,
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
      updateMany: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { bookingId: string; stripeRefundId: string }
          data: Record<string, unknown>
        }) => {
          let count = 0
          for (const row of mocks.refundRows) {
            if (
              row.bookingId === where.bookingId &&
              row.stripeRefundId === where.stripeRefundId
            ) {
              Object.assign(row, data)
              count += 1
            }
          }
          return { count }
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

import {
  refundBookingPayment,
  reconcileChargeRefundInTransaction,
} from './refunds'

function setBooking(overrides: Record<string, unknown> = {}) {
  mocks.booking = {
    id: 'booking_1',
    paymentProvider: PaymentProvider.STRIPE,
    stripePaymentIntentId: 'pi_123',
    stripePaymentStatus: StripePaymentStatus.SUCCEEDED,
    stripeAmountTotal: 10000,
    stripeAmountRefunded: 0,
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
  mockEmitPaymentRefunded.mockReset()
  mockEmitPaymentRefunded.mockResolvedValue(undefined)
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

  it('freezes refunds on a DISPUTED booking (no Stripe refund call)', async () => {
    // Captured total present, but the charge is disputed — Stripe has already
    // reversed the transfer, so we must not refund on top of the dispute.
    setBooking({ stripePaymentStatus: StripePaymentStatus.DISPUTED })

    const result = await refundBookingPayment({
      bookingId: 'booking_1',
      trigger: BookingRefundTrigger.AUTO_CANCELLATION,
    })

    expect(result).toEqual({ outcome: 'SKIPPED', reason: 'PAYMENT_DISPUTED' })
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

describe('refundBookingPayment — dashboard/external refunds (no BookingRefund row)', () => {
  it('caps an auto refund at the remainder after a Stripe-side refund we never itemized', async () => {
    // $30 already refunded via the Stripe Dashboard: no BookingRefund row, only
    // the cumulative total Stripe reported. A full auto-refund must NOT re-refund
    // the whole $100 — it can only give back the remaining $70.
    setBooking({ stripeAmountTotal: 10000, stripeAmountRefunded: 3000 })
    mocks.stripeRefundsCreate.mockResolvedValueOnce({ id: 're_auto' })

    const result = await refundBookingPayment({
      bookingId: 'booking_1',
      trigger: BookingRefundTrigger.AUTO_CANCELLATION,
    })

    expect(result.outcome).toBe('REFUNDED')
    expect(mocks.stripeRefundsCreate.mock.calls.at(-1)?.[0]).toMatchObject({
      amount: 7000,
    })
  })

  it('skips entirely when a dashboard refund already covered the full capture', async () => {
    setBooking({ stripeAmountTotal: 10000, stripeAmountRefunded: 10000 })

    const result = await refundBookingPayment({
      bookingId: 'booking_1',
      trigger: BookingRefundTrigger.AUTO_CANCELLATION,
    })

    expect(result.outcome).toBe('SKIPPED')
    expect(mocks.stripeRefundsCreate).not.toHaveBeenCalled()
  })

  it('rejects an explicit amount that exceeds the remainder after a dashboard refund', async () => {
    setBooking({ stripeAmountTotal: 10000, stripeAmountRefunded: 6000 })

    const result = await refundBookingPayment({
      bookingId: 'booking_1',
      trigger: BookingRefundTrigger.DISCRETIONARY,
      amountCents: 5000, // only 4000 remains
    })

    expect(result.outcome).toBe('INVALID')
    expect(mocks.stripeRefundsCreate).not.toHaveBeenCalled()
  })

  it('counts an in-flight PENDING refund AND a concurrent dashboard refund without overlap', async () => {
    // $40 of our own refund is in flight (PENDING, not yet reflected in Stripe's
    // total), and a separate $30 dashboard refund already succeeded on Stripe.
    // True committed = 4000 + 3000 = 7000, so only 3000 remains. A naive max()
    // would see max(4000, 3000) = 4000 and wrongly free 6000 → over-refund.
    setBooking({ stripeAmountTotal: 10000, stripeAmountRefunded: 3000 })
    mocks.refundRows.push({
      id: 'refund_pending',
      bookingId: 'booking_1',
      amountCents: 4000,
      status: BookingRefundStatus.PENDING,
    })

    const result = await refundBookingPayment({
      bookingId: 'booking_1',
      trigger: BookingRefundTrigger.DISCRETIONARY,
      amountCents: 4000, // exceeds the true 3000 remainder
    })

    expect(result.outcome).toBe('INVALID')
    expect(mocks.stripeRefundsCreate).not.toHaveBeenCalled()
  })

  it('does not double-count our own SUCCEEDED refund once its webhook syncs Stripe’s total', async () => {
    // We refunded $40 (SUCCEEDED row) and Stripe's total now reflects it (4000).
    // ourSucceeded (4000) is the overlap, so dashboardOnly = 4000 − 4000 = 0 and
    // reserved = 4000 (not 8000). The remaining $60 stays refundable.
    setBooking({ stripeAmountTotal: 10000, stripeAmountRefunded: 4000 })
    mocks.refundRows.push({
      id: 'refund_ours',
      bookingId: 'booking_1',
      amountCents: 4000,
      stripeRefundId: 're_ours',
      status: BookingRefundStatus.SUCCEEDED,
    })
    mocks.stripeRefundsCreate.mockResolvedValueOnce({ id: 're_next' })

    const result = await refundBookingPayment({
      bookingId: 'booking_1',
      trigger: BookingRefundTrigger.DISCRETIONARY,
      amountCents: 6000,
    })

    expect(result.outcome).toBe('REFUNDED')
    expect(mocks.stripeRefundsCreate.mock.calls.at(-1)?.[0]).toMatchObject({
      amount: 6000,
    })
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

// The in-memory mock tx implements only the handful of methods the reconcile
// path touches; cast it once to the Prisma client type the function expects.
function reconcileTx(): Prisma.TransactionClient {
  return txRef.current as unknown as Prisma.TransactionClient
}

describe('reconcileChargeRefundInTransaction', () => {
  it('returns not-handled when no booking matches the payment intent', async () => {
    mocks.booking = null

    const result = await reconcileChargeRefundInTransaction(reconcileTx(), {
      paymentIntentId: 'pi_missing',
      amountRefundedCents: 5000,
      chargeAmountCents: 5000,
      refunds: [],
    })

    expect(result).toEqual({ handled: false })
    expect(mocks.bookingUpdates).toHaveLength(0)
  })

  it('flips the booking to REFUNDED on a full charge refund', async () => {
    setBooking({ stripeAmountTotal: 10000 })

    const result = await reconcileChargeRefundInTransaction(reconcileTx(), {
      paymentIntentId: 'pi_123',
      amountRefundedCents: 10000,
      chargeAmountCents: 10000,
      refunds: [{ id: 're_1', status: 'succeeded', amountCents: 10000 }],
    })

    expect(result).toEqual({ handled: true })
    expect(mocks.bookingUpdates).toContainEqual({
      stripePaymentStatus: StripePaymentStatus.REFUNDED,
    })
  })

  it('does NOT flip the booking on a partial charge refund', async () => {
    setBooking({ stripeAmountTotal: 10000 })

    await reconcileChargeRefundInTransaction(reconcileTx(), {
      paymentIntentId: 'pi_123',
      amountRefundedCents: 4000,
      chargeAmountCents: 10000,
      refunds: [{ id: 're_1', status: 'succeeded', amountCents: 4000 }],
    })

    expect(mocks.bookingUpdates).not.toContainEqual({
      stripePaymentStatus: StripePaymentStatus.REFUNDED,
    })
  })

  it('syncs the status of a tracked refund row by stripeRefundId', async () => {
    setBooking({ stripeAmountTotal: 10000 })
    mocks.refundRows.push({
      id: 'refund_tracked',
      bookingId: 'booking_1',
      amountCents: 4000,
      stripeRefundId: 're_async',
      status: BookingRefundStatus.PENDING,
    })

    await reconcileChargeRefundInTransaction(reconcileTx(), {
      paymentIntentId: 'pi_123',
      amountRefundedCents: 4000,
      chargeAmountCents: 10000,
      refunds: [{ id: 're_async', status: 'succeeded', amountCents: 4000 }],
    })

    expect(mocks.refundRows[0]?.status).toBe(BookingRefundStatus.SUCCEEDED)
  })

  it('emits a PAYMENT_REFUNDED receipt per succeeded refund, keyed by refund id', async () => {
    setBooking({ stripeAmountTotal: 10000 })

    await reconcileChargeRefundInTransaction(reconcileTx(), {
      paymentIntentId: 'pi_123',
      amountRefundedCents: 4000,
      chargeAmountCents: 10000,
      refunds: [{ id: 're_1', status: 'succeeded', amountCents: 4000 }],
    })

    expect(mockEmitPaymentRefunded).toHaveBeenCalledTimes(1)
    expect(mockEmitPaymentRefunded).toHaveBeenCalledWith(
      expect.objectContaining({
        bookingId: 'booking_1',
        refundDiscriminator: 're_1',
        amountRefundedCents: 4000,
      }),
    )
  })

  it('does not emit a refund receipt for a non-succeeded refund', async () => {
    setBooking({ stripeAmountTotal: 10000 })

    await reconcileChargeRefundInTransaction(reconcileTx(), {
      paymentIntentId: 'pi_123',
      amountRefundedCents: 0,
      chargeAmountCents: 10000,
      refunds: [{ id: 're_pending', status: 'pending', amountCents: 4000 }],
    })

    expect(mockEmitPaymentRefunded).not.toHaveBeenCalled()
  })

  it('does not re-update a booking already marked REFUNDED and synced', async () => {
    setBooking({
      stripeAmountTotal: 10000,
      stripeAmountRefunded: 10000,
      stripePaymentStatus: StripePaymentStatus.REFUNDED,
    })

    await reconcileChargeRefundInTransaction(reconcileTx(), {
      paymentIntentId: 'pi_123',
      amountRefundedCents: 10000,
      chargeAmountCents: 10000,
      refunds: [{ id: 're_1', status: 'succeeded', amountCents: 10000 }],
    })

    expect(mocks.bookingUpdates).toHaveLength(0)
  })

  it('records Stripe’s cumulative refunded total so dashboard refunds are tracked', async () => {
    setBooking({ stripeAmountTotal: 10000, stripeAmountRefunded: 0 })

    await reconcileChargeRefundInTransaction(reconcileTx(), {
      paymentIntentId: 'pi_123',
      amountRefundedCents: 3000,
      chargeAmountCents: 10000,
      // Dashboard refund: succeeded on Stripe, but no BookingRefund row exists.
      refunds: [{ id: 're_dash', status: 'succeeded', amountCents: 3000 }],
    })

    expect(mocks.bookingUpdates).toContainEqual({ stripeAmountRefunded: 3000 })
  })

  it('never lowers the refunded total on an out-of-order (stale) webhook', async () => {
    setBooking({ stripeAmountTotal: 10000, stripeAmountRefunded: 5000 })

    await reconcileChargeRefundInTransaction(reconcileTx(), {
      paymentIntentId: 'pi_123',
      amountRefundedCents: 3000, // stale: less than what we already recorded
      chargeAmountCents: 10000,
      refunds: [{ id: 're_old', status: 'succeeded', amountCents: 3000 }],
    })

    expect(
      mocks.bookingUpdates.some((u) => 'stripeAmountRefunded' in u),
    ).toBe(false)
  })
})
