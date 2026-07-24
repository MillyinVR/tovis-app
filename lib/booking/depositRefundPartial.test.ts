// N5 — partial discovery-deposit refunds.
//
// The deposit rides ONE charge: the deposit portion (to the pro, via destination
// transfer) plus the one-time platform fee (the application fee). Before this,
// both the charge.refunded webhook (reconcileDepositChargeRefundInTransaction)
// and the app-side refund (refundDiscoveryDeposit) flipped depositStatus ->
// REFUNDED on ANY refunded amount, so a partial refund marked the whole deposit
// REFUNDED and blocked a later legitimate refund. These tests pin the new model:
// depositStatus flips to REFUNDED only when the deposit PORTION is fully back;
// partials stay PAID and accumulate depositRefundedCents; and the app-side path
// never over-refunds the charge.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  BookingDepositStatus,
  BookingRefundTrigger,
  Prisma,
} from '@prisma/client'

const mocks = vi.hoisted(() => {
  const stripeRefundsCreate = vi.fn()
  const captureException = vi.fn()
  const emitPaymentRefunded = vi.fn()
  // Single stateful booking row the mocks read/mutate.
  const state = {
    booking: {} as Record<string, unknown>,
    refundRows: [] as Array<Record<string, unknown>>,
  }

  // Resolve Prisma increment/decrement atomic ops against the current value.
  const applyData = (
    row: Record<string, unknown>,
    data: Record<string, unknown>,
  ): void => {
    for (const [key, value] of Object.entries(data)) {
      if (value && typeof value === 'object') {
        if ('increment' in value) {
          row[key] =
            (Number(row[key]) || 0) + Number((value as { increment: number }).increment)
          continue
        }
        if ('decrement' in value) {
          row[key] =
            (Number(row[key]) || 0) - Number((value as { decrement: number }).decrement)
          continue
        }
      }
      row[key] = value
    }
  }

  // refundDiscoveryDeposit records the row (and the fee-reset) inside a
  // prisma.$transaction now (M6), so the tx client needs bookingRefund.create too.
  const bookingRefundCreate = vi.fn(
    async ({ data }: { data: Record<string, unknown> }) => {
      const row = { id: `refund_${state.refundRows.length + 1}`, ...data }
      state.refundRows.push(row)
      return row
    },
  )

  const txMock = {
    $executeRaw: vi.fn().mockResolvedValue(1),
    booking: {
      findFirst: vi.fn(async () => ({ ...state.booking })),
      findUnique: vi.fn(async () => ({ ...state.booking })),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        applyData(state.booking, data)
        return { ...state.booking }
      }),
    },
    bookingRefund: { create: bookingRefundCreate },
  }

  const prismaMock = {
    $transaction: (cb: (tx: typeof txMock) => unknown) => cb(txMock),
    booking: { update: txMock.booking.update },
    bookingRefund: { create: bookingRefundCreate },
  }

  return {
    stripeRefundsCreate,
    captureException,
    emitPaymentRefunded,
    state,
    txMock,
    prismaMock,
  }
})

vi.mock('@/lib/stripe/server', () => ({
  getStripe: () => ({ refunds: { create: mocks.stripeRefundsCreate } }),
}))

vi.mock('@sentry/nextjs', () => ({ captureException: mocks.captureException }))

// Only the EMITs are mocked; `...actual` keeps the real buildAuxRefundDiscriminator
// so the discriminator this suite asserts on is the shared builder's real output.
vi.mock('@/lib/notifications/paymentNotifications', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/notifications/paymentNotifications')>()),
  emitPaymentRefundedNotifications: mocks.emitPaymentRefunded,
  emitPaymentCollectedNotifications: vi.fn(),
  emitPaymentActionRequiredNotifications: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({ prisma: mocks.prismaMock }))

import { refundDiscoveryDeposit } from './refunds'
import { reconcileDepositChargeRefundInTransaction } from './writeBoundary'

const tx = mocks.txMock as unknown as Prisma.TransactionClient

function setBooking(overrides: Record<string, unknown> = {}): void {
  mocks.state.booking = {
    id: 'booking_1',
    depositStatus: BookingDepositStatus.PAID,
    // $50 deposit + $5 platform fee → $55 charge.
    depositAmount: new Prisma.Decimal('50.00'),
    discoveryFeeAmount: 500,
    depositRefundedCents: 0,
    discoveryFeeRefundedAt: null,
    depositStripePaymentIntentId: 'pi_deposit_1',
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.state.refundRows = []
  mocks.stripeRefundsCreate.mockResolvedValue({ id: 're_deposit_1' })
  setBooking()
})

afterEach(() => vi.restoreAllMocks())

describe('reconcileDepositChargeRefundInTransaction — partial deposit refunds (webhook)', () => {
  it('keeps depositStatus PAID on a sub-deposit partial and records the cents', async () => {
    // Dashboard refunds $25 of the $50 deposit on the $55 charge.
    const result = await reconcileDepositChargeRefundInTransaction(tx, {
      paymentIntentId: 'pi_deposit_1',
      amountRefundedCents: 2500,
      chargeAmountCents: 5500,
    })

    expect(result.handled).toBe(true)
    expect(mocks.state.booking.depositRefundedCents).toBe(2500)
    expect(mocks.state.booking.depositStatus).toBe(BookingDepositStatus.PAID)
    expect(mocks.state.booking.discoveryFeeRefundedAt).toBeNull()
    // A partial still notifies, with the delta as the amount.
    expect(mocks.emitPaymentRefunded).toHaveBeenCalledTimes(1)
    expect(mocks.emitPaymentRefunded).toHaveBeenCalledWith(
      expect.objectContaining({ amountRefundedCents: 2500 }),
    )
  })

  it('flips to REFUNDED once the deposit portion is fully back (fee kept)', async () => {
    // The full $50 deposit is refunded; the $5 fee is kept.
    await reconcileDepositChargeRefundInTransaction(tx, {
      paymentIntentId: 'pi_deposit_1',
      amountRefundedCents: 5000,
      chargeAmountCents: 5500,
    })

    expect(mocks.state.booking.depositRefundedCents).toBe(5000)
    expect(mocks.state.booking.depositStatus).toBe(BookingDepositStatus.REFUNDED)
    // Fee NOT returned (only the deposit portion), so no fee-reset stamp.
    expect(mocks.state.booking.discoveryFeeRefundedAt).toBeNull()
  })

  it('stamps the fee-refund timestamp only when the FULL charge is refunded', async () => {
    await reconcileDepositChargeRefundInTransaction(tx, {
      paymentIntentId: 'pi_deposit_1',
      amountRefundedCents: 5500,
      chargeAmountCents: 5500,
    })

    expect(mocks.state.booking.depositStatus).toBe(BookingDepositStatus.REFUNDED)
    expect(mocks.state.booking.discoveryFeeRefundedAt).not.toBeNull()
  })

  it('is monotonic + idempotent: a stale/replayed cumulative does not roll back or re-notify', async () => {
    setBooking({ depositRefundedCents: 5000, depositStatus: BookingDepositStatus.REFUNDED })

    const result = await reconcileDepositChargeRefundInTransaction(tx, {
      paymentIntentId: 'pi_deposit_1',
      amountRefundedCents: 2500, // stale, smaller than already recorded
      chargeAmountCents: 5500,
    })

    expect(result.handled).toBe(true)
    expect(mocks.state.booking.depositRefundedCents).toBe(5000)
    expect(mocks.emitPaymentRefunded).not.toHaveBeenCalled()
  })
})

describe('refundDiscoveryDeposit — partial deposit refunds (app-side)', () => {
  it('refunds the full deposit + fee (pro/admin) → REFUNDED, fee stamped', async () => {
    const result = await refundDiscoveryDeposit({
      bookingId: 'booking_1',
      paymentIntentId: 'pi_deposit_1',
      refundAmountCents: 5500, // deposit + fee
      refundFee: true,
      trigger: BookingRefundTrigger.AUTO_CANCELLATION,
    })

    expect(result.outcome).toBe('REFUNDED')
    expect(mocks.state.booking.depositRefundedCents).toBe(5500)
    expect(mocks.state.booking.depositStatus).toBe(BookingDepositStatus.REFUNDED)
    expect(mocks.state.booking.discoveryFeeRefundedAt).not.toBeNull()
    expect(mocks.state.refundRows).toHaveLength(1)
  })

  it('refunds the deposit but keeps the fee (client) → REFUNDED, fee NOT stamped', async () => {
    const result = await refundDiscoveryDeposit({
      bookingId: 'booking_1',
      paymentIntentId: 'pi_deposit_1',
      refundAmountCents: 5000, // deposit only
      refundFee: false,
      trigger: BookingRefundTrigger.AUTO_CANCELLATION,
    })

    expect(result.outcome).toBe('REFUNDED')
    expect(mocks.state.booking.depositRefundedCents).toBe(5000)
    // Deposit portion fully returned → REFUNDED even though the fee was kept.
    expect(mocks.state.booking.depositStatus).toBe(BookingDepositStatus.REFUNDED)
    expect(mocks.state.booking.discoveryFeeRefundedAt).toBeNull()
  })

  it('keeps depositStatus PAID on a sub-deposit partial so a later refund is not blocked', async () => {
    const result = await refundDiscoveryDeposit({
      bookingId: 'booking_1',
      paymentIntentId: 'pi_deposit_1',
      refundAmountCents: 2000, // partial of the $50 deposit
      refundFee: false,
      trigger: BookingRefundTrigger.DISCRETIONARY,
    })

    expect(result.outcome).toBe('REFUNDED')
    expect(mocks.state.booking.depositRefundedCents).toBe(2000)
    expect(mocks.state.booking.depositStatus).toBe(BookingDepositStatus.PAID)

    // A later refund of the remaining deposit is NOT blocked and completes it.
    const second = await refundDiscoveryDeposit({
      bookingId: 'booking_1',
      paymentIntentId: 'pi_deposit_1',
      refundAmountCents: 3000,
      refundFee: false,
      trigger: BookingRefundTrigger.DISCRETIONARY,
    })

    expect(second.outcome).toBe('REFUNDED')
    expect(mocks.state.booking.depositRefundedCents).toBe(5000)
    expect(mocks.state.booking.depositStatus).toBe(BookingDepositStatus.REFUNDED)
  })

  it('does not attempt when the deposit is not PAID', async () => {
    setBooking({ depositStatus: BookingDepositStatus.REFUNDED })

    const result = await refundDiscoveryDeposit({
      bookingId: 'booking_1',
      paymentIntentId: 'pi_deposit_1',
      refundAmountCents: 5000,
      refundFee: false,
      trigger: BookingRefundTrigger.DISCRETIONARY,
    })

    expect(result.outcome).toBe('NOT_ATTEMPTED')
    expect(mocks.stripeRefundsCreate).not.toHaveBeenCalled()
  })

  it('refuses to over-refund the charge (NOT_ATTEMPTED, no Stripe call)', async () => {
    setBooking({ depositRefundedCents: 5000 }) // $50 already back; $5 fee headroom left

    const result = await refundDiscoveryDeposit({
      bookingId: 'booking_1',
      paymentIntentId: 'pi_deposit_1',
      refundAmountCents: 1000, // would exceed the $55 charge
      refundFee: false,
      trigger: BookingRefundTrigger.DISCRETIONARY,
    })

    expect(result.outcome).toBe('NOT_ATTEMPTED')
    expect(mocks.stripeRefundsCreate).not.toHaveBeenCalled()
  })

  it('releases the reservation when the Stripe refund fails', async () => {
    mocks.stripeRefundsCreate.mockRejectedValueOnce(new Error('stripe down'))

    const result = await refundDiscoveryDeposit({
      bookingId: 'booking_1',
      paymentIntentId: 'pi_deposit_1',
      refundAmountCents: 5000,
      refundFee: false,
      trigger: BookingRefundTrigger.AUTO_CANCELLATION,
    })

    expect(result.outcome).toBe('FAILED')
    // Reservation rolled back so the refund can be retried.
    expect(mocks.state.booking.depositRefundedCents).toBe(0)
    expect(mocks.state.booking.depositStatus).toBe(BookingDepositStatus.PAID)
  })

  it('uses a per-refund idempotency key carrying the pre-refund cumulative', async () => {
    await refundDiscoveryDeposit({
      bookingId: 'booking_1',
      paymentIntentId: 'pi_deposit_1',
      refundAmountCents: 2000,
      refundFee: false,
      trigger: BookingRefundTrigger.DISCRETIONARY,
    })

    expect(mocks.stripeRefundsCreate).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 2000 }),
      { idempotencyKey: 'tovis:deposit-refund:booking_1:0' },
    )
  })
})
