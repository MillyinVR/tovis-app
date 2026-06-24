import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  paymentIntentsRetrieve: vi.fn(),
  refundsList: vi.fn(),
  findMany: vi.fn(),
  transaction: vi.fn(),
  reconcileChargeRefund: vi.fn(),
  captureException: vi.fn(),
}))

vi.mock('@/lib/stripe/server', () => ({
  getStripe: () => ({
    paymentIntents: { retrieve: mocks.paymentIntentsRetrieve },
    refunds: { list: mocks.refundsList },
  }),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    booking: { findMany: mocks.findMany },
    $transaction: mocks.transaction,
  },
}))

vi.mock('@/lib/booking/refunds', () => ({
  reconcileChargeRefundInTransaction: mocks.reconcileChargeRefund,
}))

vi.mock('@/lib/observability/bookingEvents', () => ({
  captureBookingException: mocks.captureException,
}))

import { reconcileStripeRefunds } from '@/lib/booking/stripeReconciliation'

type CandidateOverrides = {
  id?: string
  stripePaymentIntentId?: string
  stripeAmountTotal?: number | null
  stripeAmountRefunded?: number
  pendingRefundIds?: string[]
}

function candidate(overrides: CandidateOverrides = {}) {
  return {
    id: overrides.id ?? 'booking_1',
    stripePaymentIntentId: overrides.stripePaymentIntentId ?? 'pi_1',
    stripeAmountTotal: overrides.stripeAmountTotal ?? 10_000,
    stripeAmountRefunded: overrides.stripeAmountRefunded ?? 0,
    refunds: (overrides.pendingRefundIds ?? []).map((id) => ({ id })),
  }
}

function chargeIntent(opts: { amount?: number; amountRefunded?: number; charge?: unknown } = {}) {
  const charge =
    opts.charge === undefined
      ? {
          object: 'charge',
          amount: opts.amount ?? 10_000,
          amount_refunded: opts.amountRefunded ?? 0,
        }
      : opts.charge
  return { id: 'pi_1', object: 'payment_intent', latest_charge: charge }
}

beforeEach(() => {
  vi.clearAllMocks()
  // Default: the reconcile transaction simply runs its callback with a stub tx.
  mocks.transaction.mockImplementation((cb: (tx: unknown) => unknown) => cb({}))
  mocks.reconcileChargeRefund.mockResolvedValue({ handled: true })
})

describe('reconcileStripeRefunds', () => {
  it('marks a booking in_sync without listing refunds or opening a transaction', async () => {
    mocks.findMany.mockResolvedValue([candidate()])
    mocks.paymentIntentsRetrieve.mockResolvedValue(chargeIntent({ amountRefunded: 0 }))

    const run = await reconcileStripeRefunds()

    expect(run.tally.in_sync).toBe(1)
    expect(mocks.refundsList).not.toHaveBeenCalled()
    expect(mocks.transaction).not.toHaveBeenCalled()
    expect(mocks.reconcileChargeRefund).not.toHaveBeenCalled()
  })

  it('heals a Dashboard refund drift the webhook never recorded', async () => {
    mocks.findMany.mockResolvedValue([candidate({ stripeAmountRefunded: 0 })])
    mocks.paymentIntentsRetrieve.mockResolvedValue(
      chargeIntent({ amount: 10_000, amountRefunded: 2_500 }),
    )
    mocks.refundsList.mockResolvedValue({
      data: [{ id: 're_1', status: 'succeeded', amount: 2_500 }],
    })

    const run = await reconcileStripeRefunds()

    expect(run.tally.refund_drift_healed).toBe(1)
    expect(mocks.reconcileChargeRefund).toHaveBeenCalledTimes(1)
    const input = mocks.reconcileChargeRefund.mock.calls[0]![1]
    expect(input).toMatchObject({
      paymentIntentId: 'pi_1',
      amountRefundedCents: 2_500,
      chargeAmountCents: 10_000,
      refunds: [{ id: 're_1', status: 'succeeded', amountCents: 2_500 }],
    })
  })

  it('settles in-flight PENDING refund rows even when the amount already matches', async () => {
    mocks.findMany.mockResolvedValue([
      candidate({ stripeAmountRefunded: 2_500, pendingRefundIds: ['refund_row_1'] }),
    ])
    mocks.paymentIntentsRetrieve.mockResolvedValue(
      chargeIntent({ amount: 10_000, amountRefunded: 2_500 }),
    )
    mocks.refundsList.mockResolvedValue({
      data: [{ id: 're_1', status: 'succeeded', amount: 2_500 }],
    })

    const run = await reconcileStripeRefunds()

    expect(run.tally.refund_rows_synced).toBe(1)
    expect(mocks.reconcileChargeRefund).toHaveBeenCalledTimes(1)
  })

  it('falls back to the local captured total when the charge amount is absent', async () => {
    mocks.findMany.mockResolvedValue([
      candidate({ stripeAmountTotal: 8_000, stripeAmountRefunded: 0 }),
    ])
    mocks.paymentIntentsRetrieve.mockResolvedValue(
      chargeIntent({ charge: { object: 'charge', amount_refunded: 1_000 } }),
    )
    mocks.refundsList.mockResolvedValue({
      data: [{ id: 're_1', status: 'succeeded', amount: 1_000 }],
    })

    await reconcileStripeRefunds()

    const input = mocks.reconcileChargeRefund.mock.calls[0]![1]
    expect(input.chargeAmountCents).toBe(8_000)
  })

  it('classifies a charge-less PaymentIntent as charge_missing', async () => {
    mocks.findMany.mockResolvedValue([candidate()])
    mocks.paymentIntentsRetrieve.mockResolvedValue(chargeIntent({ charge: null }))

    const run = await reconcileStripeRefunds()

    expect(run.tally.charge_missing).toBe(1)
    expect(mocks.reconcileChargeRefund).not.toHaveBeenCalled()
  })

  it('isolates a Stripe lookup failure to the one booking', async () => {
    mocks.findMany.mockResolvedValue([
      candidate({ id: 'booking_bad', stripePaymentIntentId: 'pi_bad' }),
      candidate({ id: 'booking_ok', stripePaymentIntentId: 'pi_ok' }),
    ])
    mocks.paymentIntentsRetrieve.mockImplementation(async (id: string) => {
      if (id === 'pi_bad') throw new Error('stripe down')
      return chargeIntent({ amountRefunded: 0 })
    })

    const run = await reconcileStripeRefunds()

    expect(run.tally.stripe_lookup_failed).toBe(1)
    expect(run.tally.in_sync).toBe(1)
    expect(mocks.captureException).toHaveBeenCalledTimes(1)
  })

  it('reports booking_not_found when the reconcile path finds no booking', async () => {
    mocks.findMany.mockResolvedValue([candidate({ stripeAmountRefunded: 0 })])
    mocks.paymentIntentsRetrieve.mockResolvedValue(
      chargeIntent({ amount: 10_000, amountRefunded: 2_500 }),
    )
    mocks.refundsList.mockResolvedValue({ data: [] })
    mocks.reconcileChargeRefund.mockResolvedValue({ handled: false })

    const run = await reconcileStripeRefunds()

    expect(run.tally.booking_not_found).toBe(1)
  })

  it('captures reconcile transaction failures without aborting the sweep', async () => {
    mocks.findMany.mockResolvedValue([candidate({ stripeAmountRefunded: 0 })])
    mocks.paymentIntentsRetrieve.mockResolvedValue(
      chargeIntent({ amount: 10_000, amountRefunded: 2_500 }),
    )
    mocks.refundsList.mockResolvedValue({
      data: [{ id: 're_1', status: 'succeeded', amount: 2_500 }],
    })
    mocks.transaction.mockRejectedValue(new Error('deadlock'))

    const run = await reconcileStripeRefunds()

    expect(run.tally.reconcile_failed).toBe(1)
    expect(mocks.captureException).toHaveBeenCalledTimes(1)
  })

  it('flags a capped run so the truncation is never silent', async () => {
    const many = Array.from({ length: 150 }, (_, i) =>
      candidate({ id: `b_${i}`, stripePaymentIntentId: `pi_${i}` }),
    )
    mocks.findMany.mockResolvedValue(many)
    mocks.paymentIntentsRetrieve.mockResolvedValue(chargeIntent({ amountRefunded: 0 }))

    const run = await reconcileStripeRefunds()

    expect(run.candidatesScanned).toBe(150)
    expect(run.capped).toBe(true)
  })

  it('queries Stripe-paid bookings within the reconciliation window', async () => {
    mocks.findMany.mockResolvedValue([])
    const now = new Date('2026-06-24T12:00:00Z')

    await reconcileStripeRefunds({ now })

    const args = mocks.findMany.mock.calls[0]![0]
    expect(args.take).toBe(150)
    expect(args.where.stripePaymentIntentId).toEqual({ not: null })
    expect(args.where.OR).toEqual([
      { stripePaidAt: { gte: new Date('2026-05-10T12:00:00Z') } },
      { paymentCollectedAt: { gte: new Date('2026-05-10T12:00:00Z') } },
    ])
  })
})
