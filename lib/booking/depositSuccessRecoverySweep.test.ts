// lib/booking/depositSuccessRecoverySweep.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BookingDepositStatus } from '@prisma/client'

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  transaction: vi.fn(),
  applyDeposit: vi.fn(),
  lateCaptureRefund: vi.fn(),
  captureBookingException: vi.fn(),
  captureStale: vi.fn(),
  retrieve: vi.fn(),
  enabled: vi.fn(() => true),
  minAge: vi.fn(() => 30),
  maxAge: vi.fn(() => 45),
  stale: vi.fn(() => 72),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    booking: { findMany: mocks.findMany },
    // Run the callback with a throwaway tx object; the applier is mocked.
    $transaction: (cb: (tx: unknown) => unknown) => mocks.transaction(cb),
  },
}))

vi.mock('@/lib/booking/writeBoundary', () => ({
  applyStripeDepositSucceededInTransaction: mocks.applyDeposit,
}))

vi.mock('@/lib/booking/cancelRefund', () => ({
  applyLateCaptureCancelRefund: mocks.lateCaptureRefund,
}))

vi.mock('@/lib/booking/depositDeadline', () => ({
  depositSuccessRecoveryEnabled: mocks.enabled,
  depositRecoveryMinAgeMinutes: mocks.minAge,
  depositRecoveryMaxAgeDays: mocks.maxAge,
  depositRecoveryStaleHours: mocks.stale,
}))

vi.mock('@/lib/observability/bookingEvents', () => ({
  captureBookingException: mocks.captureBookingException,
  captureLostDepositSuccessStale: mocks.captureStale,
}))

vi.mock('@/lib/stripe/server', () => ({
  getStripe: () => ({ paymentIntents: { retrieve: mocks.retrieve } }),
}))

import {
  MAX_RECOVERIES_PER_RUN,
  recoverAbandonedDepositSuccesses,
} from './depositSuccessRecoverySweep'

const NOW = new Date('2026-07-23T12:00:00.000Z')

function makeCandidate(id: string, overrides?: Record<string, unknown>) {
  return {
    id,
    professionalId: 'pro_1',
    clientId: 'client_1',
    // 2h old — inside the window, below the 72h stale threshold.
    createdAt: new Date(NOW.getTime() - 2 * 60 * 60 * 1000),
    depositStripePaymentIntentId: `pi_${id}`,
    ...overrides,
  }
}

function paidPaymentIntent(overrides?: Record<string, unknown>) {
  return { id: 'pi_x', status: 'succeeded', latest_charge: 'ch_1', ...overrides }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.enabled.mockReturnValue(true)
  mocks.minAge.mockReturnValue(30)
  mocks.maxAge.mockReturnValue(45)
  mocks.stale.mockReturnValue(72)
  // Default: the applier records a fresh, non-cancelled deposit.
  mocks.transaction.mockImplementation((cb: (tx: unknown) => unknown) => cb({}))
  mocks.applyDeposit.mockResolvedValue({
    handled: true,
    alreadyPaid: false,
    bookingId: 'b1',
    capturedOnCancelledBooking: false,
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('recoverAbandonedDepositSuccesses', () => {
  it('scans PENDING deposits with a recorded PI inside the age window', async () => {
    mocks.findMany.mockResolvedValue([])

    await recoverAbandonedDepositSuccesses({ now: NOW })

    const where = mocks.findMany.mock.calls[0]?.[0]?.where
    expect(where?.depositStatus).toBe(BookingDepositStatus.PENDING)
    expect(where?.depositStripePaymentIntentId).toEqual({ not: null })
    expect(where?.createdAt).toEqual({
      lte: new Date(NOW.getTime() - 30 * 60_000),
      gte: new Date(NOW.getTime() - 45 * 24 * 3_600_000),
    })
  })

  it('recovers a captured deposit by re-driving the deposit-paid applier', async () => {
    mocks.findMany.mockResolvedValue([makeCandidate('b1')])
    mocks.retrieve.mockResolvedValue(paidPaymentIntent({ id: 'pi_b1' }))

    const run = await recoverAbandonedDepositSuccesses({ now: NOW })

    expect(mocks.retrieve).toHaveBeenCalledWith('pi_b1', {
      expand: ['latest_charge'],
    })
    expect(mocks.applyDeposit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        stripePaymentIntentId: 'pi_b1',
        chargeId: 'ch_1',
        bookingIdHint: 'b1',
      }),
    )
    expect(mocks.lateCaptureRefund).not.toHaveBeenCalled()
    expect(run.tally.recovered).toBe(1)
    expect(run.recoveredCount).toBe(1)
  })

  it('settles a recovered deposit that lands on a cancelled booking via the late-capture seam', async () => {
    mocks.findMany.mockResolvedValue([makeCandidate('b1')])
    mocks.retrieve.mockResolvedValue(paidPaymentIntent())
    mocks.applyDeposit.mockResolvedValue({
      handled: true,
      alreadyPaid: false,
      bookingId: 'b1',
      capturedOnCancelledBooking: true,
    })

    const run = await recoverAbandonedDepositSuccesses({ now: NOW })

    expect(mocks.lateCaptureRefund).toHaveBeenCalledWith({
      bookingId: 'b1',
      flavor: 'DEPOSIT',
    })
    expect(run.tally.recovered_on_cancelled).toBe(1)
  })

  it('does NOT re-refund on an alreadyPaid replay even on a cancelled booking', async () => {
    mocks.findMany.mockResolvedValue([makeCandidate('b1')])
    mocks.retrieve.mockResolvedValue(paidPaymentIntent())
    mocks.applyDeposit.mockResolvedValue({
      handled: true,
      alreadyPaid: true,
      bookingId: 'b1',
      capturedOnCancelledBooking: true,
    })

    const run = await recoverAbandonedDepositSuccesses({ now: NOW })

    expect(mocks.lateCaptureRefund).not.toHaveBeenCalled()
    expect(run.tally.already_recorded).toBe(1)
  })

  it('skips an unpaid deposit — Stripe PI not succeeded — and never mutates', async () => {
    mocks.findMany.mockResolvedValue([makeCandidate('b1')])
    mocks.retrieve.mockResolvedValue(
      paidPaymentIntent({ status: 'requires_payment_method' }),
    )

    const run = await recoverAbandonedDepositSuccesses({ now: NOW })

    expect(mocks.applyDeposit).not.toHaveBeenCalled()
    expect(run.tally.not_captured).toBe(1)
  })

  it('observe-only (kill switch off): polls Stripe, records nothing', async () => {
    mocks.enabled.mockReturnValue(false)
    mocks.findMany.mockResolvedValue([makeCandidate('b1')])
    mocks.retrieve.mockResolvedValue(paidPaymentIntent())

    const run = await recoverAbandonedDepositSuccesses({ now: NOW })

    expect(mocks.retrieve).toHaveBeenCalledOnce()
    expect(mocks.applyDeposit).not.toHaveBeenCalled()
    expect(mocks.lateCaptureRefund).not.toHaveBeenCalled()
    expect(run.enabled).toBe(false)
    expect(run.tally.would_recover).toBe(1)
    expect(run.recoveredCount).toBe(0)
  })

  it('pages when a captured deposit stayed PENDING past the stale window', async () => {
    mocks.findMany.mockResolvedValue([
      makeCandidate('b1', {
        // 100h old > 72h stale threshold
        createdAt: new Date(NOW.getTime() - 100 * 60 * 60 * 1000),
      }),
    ])
    mocks.retrieve.mockResolvedValue(paidPaymentIntent())

    await recoverAbandonedDepositSuccesses({ now: NOW })

    expect(mocks.captureStale).toHaveBeenCalledWith(
      expect.objectContaining({ bookingId: 'b1', recovered: true }),
    )
  })

  it('does not page a fresh (non-stale) recovery', async () => {
    mocks.findMany.mockResolvedValue([makeCandidate('b1')])
    mocks.retrieve.mockResolvedValue(paidPaymentIntent())

    await recoverAbandonedDepositSuccesses({ now: NOW })

    expect(mocks.captureStale).not.toHaveBeenCalled()
  })

  it('isolates a Stripe lookup failure without blocking the run', async () => {
    mocks.findMany.mockResolvedValue([makeCandidate('b1'), makeCandidate('b2')])
    mocks.retrieve
      .mockRejectedValueOnce(new Error('stripe down'))
      .mockResolvedValueOnce(paidPaymentIntent())

    const run = await recoverAbandonedDepositSuccesses({ now: NOW })

    expect(mocks.captureBookingException).toHaveBeenCalledOnce()
    expect(run.tally.stripe_lookup_failed).toBe(1)
    expect(run.tally.recovered).toBe(1)
  })

  it('tallies an apply failure and pages if the failed deposit is stale', async () => {
    mocks.findMany.mockResolvedValue([
      makeCandidate('b1', {
        createdAt: new Date(NOW.getTime() - 100 * 60 * 60 * 1000),
      }),
    ])
    mocks.retrieve.mockResolvedValue(paidPaymentIntent())
    mocks.transaction.mockRejectedValue(new Error('db exploded'))

    const run = await recoverAbandonedDepositSuccesses({ now: NOW })

    expect(run.tally.apply_failed).toBe(1)
    expect(mocks.captureStale).toHaveBeenCalledWith(
      expect.objectContaining({ bookingId: 'b1', recovered: false }),
    )
  })

  it('caps the batch and flags truncation', async () => {
    const many = Array.from({ length: MAX_RECOVERIES_PER_RUN + 5 }, (_, i) =>
      makeCandidate(`b${i}`, {
        depositStripePaymentIntentId: `pi_b${i}`,
      }),
    )
    mocks.findMany.mockResolvedValue(many)
    mocks.retrieve.mockResolvedValue(
      paidPaymentIntent({ status: 'requires_payment_method' }),
    )

    const run = await recoverAbandonedDepositSuccesses({ now: NOW })

    expect(run.capped).toBe(true)
    expect(run.candidatesScanned).toBe(MAX_RECOVERIES_PER_RUN)
    expect(mocks.retrieve).toHaveBeenCalledTimes(MAX_RECOVERIES_PER_RUN)
  })
})
