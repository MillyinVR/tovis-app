// lib/booking/depositReleaseSweep.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BookingDepositStatus, BookingStatus } from '@prisma/client'

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  release: vi.fn(),
  captureBookingException: vi.fn(),
  enabled: vi.fn(() => true),
  deadlineHours: vi.fn(() => 24),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: { booking: { findMany: mocks.findMany } },
}))

vi.mock('@/lib/booking/writeBoundary', () => ({
  releaseUnpaidDepositBookingBySystem: mocks.release,
}))

vi.mock('@/lib/booking/depositDeadline', () => ({
  depositAutoReleaseEnabled: mocks.enabled,
  depositUnpaidDeadlineHours: mocks.deadlineHours,
}))

vi.mock('@/lib/observability/bookingEvents', () => ({
  captureBookingException: mocks.captureBookingException,
}))

import {
  MAX_RELEASES_PER_RUN,
  releaseAbandonedDepositBookings,
} from './depositReleaseSweep'

const NOW = new Date('2026-07-03T12:00:00.000Z')

function makeCandidate(id: string, overrides?: Record<string, unknown>) {
  return {
    id,
    professionalId: 'pro_1',
    clientId: 'client_1',
    createdAt: new Date(NOW.getTime() - 30 * 60 * 60 * 1000),
    scheduledFor: new Date(NOW.getTime() + 48 * 60 * 60 * 1000),
    status: BookingStatus.PENDING,
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.enabled.mockReturnValue(true)
  mocks.deadlineHours.mockReturnValue(24)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('releaseAbandonedDepositBookings', () => {
  it('scans with the right filters and cutoff', async () => {
    mocks.findMany.mockResolvedValue([])

    await releaseAbandonedDepositBookings({ now: NOW })

    const where = mocks.findMany.mock.calls[0]?.[0]?.where
    expect(where?.depositStatus).toBe(BookingDepositStatus.PENDING)
    expect(where?.status).toEqual({
      in: [BookingStatus.PENDING, BookingStatus.ACCEPTED],
    })
    expect(where?.scheduledFor).toEqual({ gt: NOW })
    // cutoff = now - 24h
    expect(where?.createdAt).toEqual({
      lte: new Date(NOW.getTime() - 24 * 60 * 60 * 1000),
    })
  })

  it('releases each candidate and tallies the outcome', async () => {
    mocks.findMany.mockResolvedValue([makeCandidate('b1'), makeCandidate('b2')])
    mocks.release.mockResolvedValue({
      released: true,
      bookingId: 'x',
      previousStatus: BookingStatus.PENDING,
    })

    const result = await releaseAbandonedDepositBookings({ now: NOW })

    expect(mocks.release).toHaveBeenCalledTimes(2)
    expect(mocks.release).toHaveBeenCalledWith({ bookingId: 'b1' })
    expect(result.enabled).toBe(true)
    expect(result.releasedCount).toBe(2)
    expect(result.tally.released).toBe(2)
  })

  it('does not release when the kill switch is off (observe only)', async () => {
    mocks.enabled.mockReturnValue(false)
    mocks.findMany.mockResolvedValue([makeCandidate('b1'), makeCandidate('b2')])

    const result = await releaseAbandonedDepositBookings({ now: NOW })

    expect(mocks.release).not.toHaveBeenCalled()
    expect(result.enabled).toBe(false)
    expect(result.releasedCount).toBe(0)
    expect(result.candidatesScanned).toBe(2)
  })

  it('caps the batch and flags truncation', async () => {
    const many = Array.from({ length: MAX_RELEASES_PER_RUN + 5 }, (_, i) =>
      makeCandidate(`b${i}`),
    )
    mocks.findMany.mockResolvedValue(many)
    mocks.release.mockResolvedValue({
      released: true,
      bookingId: 'x',
      previousStatus: BookingStatus.PENDING,
    })

    const result = await releaseAbandonedDepositBookings({ now: NOW })

    // take = cap + 1 to detect overflow; only cap are processed.
    expect(mocks.findMany.mock.calls[0]?.[0]?.take).toBe(MAX_RELEASES_PER_RUN + 1)
    expect(result.capped).toBe(true)
    expect(mocks.release).toHaveBeenCalledTimes(MAX_RELEASES_PER_RUN)
  })

  it('tallies skips and errors without aborting the run', async () => {
    mocks.findMany.mockResolvedValue([
      makeCandidate('paid'),
      makeCandidate('boom'),
      makeCandidate('ok'),
    ])
    mocks.release.mockImplementation(async ({ bookingId }: { bookingId: string }) => {
      if (bookingId === 'paid') {
        return { released: false, reason: 'DEPOSIT_NOT_PENDING' as const }
      }
      if (bookingId === 'boom') throw new Error('db down')
      return {
        released: true,
        bookingId,
        previousStatus: BookingStatus.ACCEPTED,
      }
    })

    const result = await releaseAbandonedDepositBookings({ now: NOW })

    expect(result.tally.released).toBe(1)
    expect(result.tally.deposit_not_pending).toBe(1)
    expect(result.tally.release_error).toBe(1)
    expect(mocks.captureBookingException).toHaveBeenCalledTimes(1)
  })
})
