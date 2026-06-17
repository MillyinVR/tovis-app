// lib/migration/migrationReview.test.ts

import { Prisma } from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  offeringCount: vi.fn(),
  clientCount: vi.fn(),
  bookingCount: vi.fn(),
  blockCount: vi.fn(),
  rampFindMany: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    professionalServiceOffering: { count: mocks.offeringCount },
    clientProfile: { count: mocks.clientCount },
    booking: { count: mocks.bookingCount },
    calendarBlock: { count: mocks.blockCount },
    offeringPriceRamp: { findMany: mocks.rampFindMany },
  },
}))

import { loadMigrationReviewSummary } from './migrationReview'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.offeringCount.mockResolvedValue(5)
  mocks.clientCount.mockResolvedValue(12)
  mocks.bookingCount.mockResolvedValue(3)
  mocks.blockCount.mockResolvedValue(2)
  mocks.rampFindMany.mockResolvedValue([
    {
      currentPrice: new Prisma.Decimal(30),
      targetPrice: new Prisma.Decimal(50),
      stepMode: 'PCT',
      stepValue: new Prisma.Decimal(10),
      cadenceWeeks: 10,
      offering: { service: { name: 'Haircut' } },
    },
  ])
})

describe('loadMigrationReviewSummary', () => {
  it('aggregates counts and maps active price ramps', async () => {
    const summary = await loadMigrationReviewSummary('pro-1', new Date('2026-09-01T00:00:00Z'))

    expect(summary).toMatchObject({
      offerings: 5,
      clients: 12,
      importedBookings: 3,
      importedBlocks: 2,
    })
    expect(summary.raises).toEqual([
      {
        serviceName: 'Haircut',
        from: 30,
        to: 50,
        stepMode: 'PCT',
        stepValue: 10,
        cadenceWeeks: 10,
      },
    ])
  })

  it('counts imported bookings by source and import-tagged blocks', async () => {
    await loadMigrationReviewSummary('pro-1')

    expect(mocks.bookingCount).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ professionalId: 'pro-1', source: 'IMPORTED' }),
      }),
    )
    expect(mocks.blockCount).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          professionalId: 'pro-1',
          note: { contains: 'import:' },
        }),
      }),
    )
    expect(mocks.rampFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ completedAt: null }),
      }),
    )
  })
})
