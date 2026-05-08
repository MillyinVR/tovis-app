// lib/booking/writeBoundary.holdCleanup.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

const NOW = new Date('2026-04-01T12:00:00.000Z')

const mocks = vi.hoisted(() => ({
  bookingHoldFindMany: vi.fn(),
  bookingHoldDeleteMany: vi.fn(),
  bumpScheduleConfigVersion: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    bookingHold: {
      findMany: mocks.bookingHoldFindMany,
      deleteMany: mocks.bookingHoldDeleteMany,
    },
  },
}))

vi.mock('@/lib/booking/cacheVersion', () => ({
  bumpScheduleConfigVersion: mocks.bumpScheduleConfigVersion,
  bumpScheduleVersion: vi.fn(),
}))

import { cleanupAllExpiredHolds } from './writeBoundary'

describe('cleanupAllExpiredHolds', () => {
  beforeEach(() => {
    mocks.bookingHoldFindMany.mockReset()
    mocks.bookingHoldDeleteMany.mockReset()
    mocks.bumpScheduleConfigVersion.mockReset()
    mocks.bumpScheduleConfigVersion.mockResolvedValue(1)
  })

  it('deletes expired holds and bumps schedule version once per affected pro', async () => {
    mocks.bookingHoldFindMany.mockResolvedValue([
      { professionalId: 'pro_a' },
      { professionalId: 'pro_b' },
    ])
    mocks.bookingHoldDeleteMany.mockResolvedValue({ count: 7 })

    const result = await cleanupAllExpiredHolds({ now: NOW })

    expect(result.deletedCount).toBe(7)
    expect(result.affectedProfessionalIds).toEqual(['pro_a', 'pro_b'])

    // findMany must filter by expiresAt <= now and use distinct
    expect(mocks.bookingHoldFindMany).toHaveBeenCalledWith({
      where: { expiresAt: { lte: NOW } },
      select: { professionalId: true },
      distinct: ['professionalId'],
    })

    // deleteMany matches the same filter
    expect(mocks.bookingHoldDeleteMany).toHaveBeenCalledWith({
      where: { expiresAt: { lte: NOW } },
    })

    // Version bumped once per pro
    expect(mocks.bumpScheduleConfigVersion).toHaveBeenCalledTimes(2)
    expect(mocks.bumpScheduleConfigVersion).toHaveBeenCalledWith('pro_a')
    expect(mocks.bumpScheduleConfigVersion).toHaveBeenCalledWith('pro_b')
  })

  it('returns zero count and skips bumps when nothing expired', async () => {
    mocks.bookingHoldFindMany.mockResolvedValue([])
    mocks.bookingHoldDeleteMany.mockResolvedValue({ count: 0 })

    const result = await cleanupAllExpiredHolds({ now: NOW })

    expect(result.deletedCount).toBe(0)
    expect(result.affectedProfessionalIds).toEqual([])
    expect(mocks.bumpScheduleConfigVersion).not.toHaveBeenCalled()
  })

  it('skips bumps when distinct query returns IDs but deleteMany finds nothing (race lost)', async () => {
    // Distinct query saw rows, but they were swept by another worker before
    // our deleteMany fired. We should not bump versions for unaffected pros.
    mocks.bookingHoldFindMany.mockResolvedValue([
      { professionalId: 'pro_a' },
    ])
    mocks.bookingHoldDeleteMany.mockResolvedValue({ count: 0 })

    const result = await cleanupAllExpiredHolds({ now: NOW })

    expect(result.deletedCount).toBe(0)
    expect(result.affectedProfessionalIds).toEqual(['pro_a'])
    expect(mocks.bumpScheduleConfigVersion).not.toHaveBeenCalled()
  })

  it('filters out null/empty professionalIds defensively', async () => {
    mocks.bookingHoldFindMany.mockResolvedValue([
      { professionalId: 'pro_a' },
      { professionalId: '' },
      { professionalId: null },
      { professionalId: 'pro_b' },
    ])
    mocks.bookingHoldDeleteMany.mockResolvedValue({ count: 3 })

    const result = await cleanupAllExpiredHolds({ now: NOW })

    expect(result.affectedProfessionalIds).toEqual(['pro_a', 'pro_b'])
    expect(mocks.bumpScheduleConfigVersion).toHaveBeenCalledTimes(2)
  })
})
