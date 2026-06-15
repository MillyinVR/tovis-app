import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BookingRefundTrigger, Role } from '@prisma/client'

const mocks = vi.hoisted(() => ({
  refundBookingPayment: vi.fn(),
  bookingFindUnique: vi.fn(),
  captureException: vi.fn(),
}))

vi.mock('@/lib/booking/refunds', () => ({
  refundBookingPayment: mocks.refundBookingPayment,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: { booking: { findUnique: mocks.bookingFindUnique } },
}))

vi.mock('@sentry/nextjs', () => ({
  captureException: mocks.captureException,
}))

import {
  applyAutoCancelRefund,
  isAutoCancelRefundEligible,
  CLIENT_FULL_REFUND_WINDOW_MS,
} from './cancelRefund'

const NOW = new Date('2026-04-10T12:00:00.000Z')

beforeEach(() => {
  mocks.refundBookingPayment.mockReset()
  mocks.bookingFindUnique.mockReset()
  mocks.captureException.mockReset()
  mocks.refundBookingPayment.mockResolvedValue({
    outcome: 'REFUNDED',
    refund: { id: 'refund_1' },
    bookingFullyRefunded: true,
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('isAutoCancelRefundEligible', () => {
  it('always allows pro and admin cancellations regardless of timing', () => {
    const soon = new Date(NOW.getTime() + 60 * 1000) // 1 minute out
    expect(
      isAutoCancelRefundEligible({ actorKind: 'pro', scheduledFor: soon, now: NOW }),
    ).toBe(true)
    expect(
      isAutoCancelRefundEligible({ actorKind: 'admin', scheduledFor: soon, now: NOW }),
    ).toBe(true)
  })

  it('allows a client cancellation exactly at the 24h boundary', () => {
    const at24h = new Date(NOW.getTime() + CLIENT_FULL_REFUND_WINDOW_MS)
    expect(
      isAutoCancelRefundEligible({
        actorKind: 'client',
        scheduledFor: at24h,
        now: NOW,
      }),
    ).toBe(true)
  })

  it('blocks a client cancellation inside the 24h window', () => {
    const justInside = new Date(
      NOW.getTime() + CLIENT_FULL_REFUND_WINDOW_MS - 60 * 1000,
    )
    expect(
      isAutoCancelRefundEligible({
        actorKind: 'client',
        scheduledFor: justInside,
        now: NOW,
      }),
    ).toBe(false)
  })
})

describe('applyAutoCancelRefund', () => {
  it('does nothing when the cancellation did not mutate (idempotent re-cancel)', async () => {
    const result = await applyAutoCancelRefund({
      bookingId: 'booking_1',
      actorKind: 'pro',
      actorUserId: 'user_pro',
      cancelMutated: false,
    })

    expect(result).toEqual({ outcome: 'NOT_ATTEMPTED' })
    expect(mocks.refundBookingPayment).not.toHaveBeenCalled()
  })

  it('refunds immediately for a pro cancel without reading scheduledFor', async () => {
    const result = await applyAutoCancelRefund({
      bookingId: 'booking_1',
      actorKind: 'pro',
      actorUserId: 'user_pro',
      cancelMutated: true,
      now: NOW,
      reason: 'pro sick',
    })

    expect(mocks.bookingFindUnique).not.toHaveBeenCalled()
    expect(mocks.refundBookingPayment).toHaveBeenCalledWith({
      bookingId: 'booking_1',
      trigger: BookingRefundTrigger.AUTO_CANCELLATION,
      actor: { userId: 'user_pro', role: Role.PRO },
      reason: 'pro sick',
    })
    expect(result.outcome).toBe('REFUNDED')
  })

  it('refunds an admin cancel with the admin role', async () => {
    await applyAutoCancelRefund({
      bookingId: 'booking_1',
      actorKind: 'admin',
      actorUserId: 'user_admin',
      cancelMutated: true,
      now: NOW,
    })

    expect(mocks.refundBookingPayment).toHaveBeenCalledWith(
      expect.objectContaining({ actor: { userId: 'user_admin', role: Role.ADMIN } }),
    )
  })

  it('refunds a client cancel made at least 24h out', async () => {
    mocks.bookingFindUnique.mockResolvedValue({
      scheduledFor: new Date(NOW.getTime() + CLIENT_FULL_REFUND_WINDOW_MS + 60 * 1000),
    })

    const result = await applyAutoCancelRefund({
      bookingId: 'booking_1',
      actorKind: 'client',
      actorUserId: 'user_client',
      cancelMutated: true,
      now: NOW,
    })

    expect(mocks.bookingFindUnique).toHaveBeenCalled()
    expect(mocks.refundBookingPayment).toHaveBeenCalledWith(
      expect.objectContaining({ actor: { userId: 'user_client', role: Role.CLIENT } }),
    )
    expect(result.outcome).toBe('REFUNDED')
  })

  it('does NOT refund a client cancel inside the 24h window', async () => {
    mocks.bookingFindUnique.mockResolvedValue({
      scheduledFor: new Date(NOW.getTime() + 60 * 60 * 1000), // 1h out
    })

    const result = await applyAutoCancelRefund({
      bookingId: 'booking_1',
      actorKind: 'client',
      actorUserId: 'user_client',
      cancelMutated: true,
      now: NOW,
    })

    expect(result).toEqual({ outcome: 'NOT_ATTEMPTED' })
    expect(mocks.refundBookingPayment).not.toHaveBeenCalled()
  })

  it('swallows unexpected errors and reports them (never throws)', async () => {
    mocks.bookingFindUnique.mockRejectedValue(new Error('db down'))

    const result = await applyAutoCancelRefund({
      bookingId: 'booking_1',
      actorKind: 'client',
      actorUserId: 'user_client',
      cancelMutated: true,
      now: NOW,
    })

    expect(result).toEqual({ outcome: 'NOT_ATTEMPTED' })
    expect(mocks.captureException).toHaveBeenCalled()
  })

  it('returns the FAILED outcome from the refund service without throwing', async () => {
    mocks.refundBookingPayment.mockResolvedValue({
      outcome: 'FAILED',
      refund: { id: 'refund_x' },
      message: 'stripe boom',
    })

    const result = await applyAutoCancelRefund({
      bookingId: 'booking_1',
      actorKind: 'pro',
      actorUserId: 'user_pro',
      cancelMutated: true,
      now: NOW,
    })

    expect(result.outcome).toBe('FAILED')
  })
})
