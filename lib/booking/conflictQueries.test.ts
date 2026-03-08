// lib/booking/conflictQueries.test.ts 
import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMockFns = vi.hoisted(() => ({
  bookingFindMany: vi.fn(),
  bookingHoldFindMany: vi.fn(),
  calendarBlockFindMany: vi.fn(),
  professionalServiceOfferingFindMany: vi.fn(),
  professionalLocationFindMany: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    booking: { findMany: prismaMockFns.bookingFindMany },
    bookingHold: { findMany: prismaMockFns.bookingHoldFindMany },
    calendarBlock: { findMany: prismaMockFns.calendarBlockFindMany },
    professionalServiceOffering: {
      findMany: prismaMockFns.professionalServiceOfferingFindMany,
    },
    professionalLocation: {
      findMany: prismaMockFns.professionalLocationFindMany,
    },
  },
}))

import { loadBusyIntervalsForWindow } from '@/lib/booking/conflictQueries'

describe('loadBusyIntervalsForWindow', () => {
  const professionalId = 'pro_1'
  const locationId = 'loc_1'
  const nowUtc = new Date('2026-03-07T12:00:00.000Z')
  const windowStartUtc = new Date('2026-03-10T00:00:00.000Z')
  const windowEndUtc = new Date('2026-03-11T00:00:00.000Z')

  beforeEach(() => {
    vi.clearAllMocks()

    prismaMockFns.bookingFindMany.mockResolvedValue([])
    prismaMockFns.bookingHoldFindMany.mockResolvedValue([])
    prismaMockFns.calendarBlockFindMany.mockResolvedValue([])
    prismaMockFns.professionalServiceOfferingFindMany.mockResolvedValue([])
    prismaMockFns.professionalLocationFindMany.mockResolvedValue([])
  })

  it('includes a booking that starts before the window but overlaps it', async () => {
    prismaMockFns.bookingFindMany.mockResolvedValue([
      {
        scheduledFor: new Date('2026-03-09T23:30:00.000Z'),
        totalDurationMinutes: 60,
        bufferMinutes: 0,
      },
    ])

    const result = await loadBusyIntervalsForWindow({
      professionalId,
      locationId,
      windowStartUtc,
      windowEndUtc,
      nowUtc,
      fallbackDurationMinutes: 60,
      defaultBufferMinutes: 0,
    })

    expect(result).toEqual([
      {
        start: new Date('2026-03-09T23:30:00.000Z'),
        end: new Date('2026-03-10T00:30:00.000Z'),
      },
    ])
  })

  it('includes a hold that starts before the window but overlaps it', async () => {
    prismaMockFns.bookingHoldFindMany.mockResolvedValue([
      {
        id: 'hold_1',
        scheduledFor: new Date('2026-03-09T23:45:00.000Z'),
        offeringId: 'off_1',
        locationId,
        locationType: 'SALON',
      },
    ])

    prismaMockFns.professionalServiceOfferingFindMany.mockResolvedValue([
      {
        id: 'off_1',
        salonDurationMinutes: 45,
        mobileDurationMinutes: 30,
      },
    ])

    prismaMockFns.professionalLocationFindMany.mockResolvedValue([
      {
        id: locationId,
        bufferMinutes: 15,
      },
    ])

    const result = await loadBusyIntervalsForWindow({
      professionalId,
      locationId,
      windowStartUtc,
      windowEndUtc,
      nowUtc,
      fallbackDurationMinutes: 60,
      defaultBufferMinutes: 0,
    })

    expect(result).toEqual([
      {
        start: new Date('2026-03-09T23:45:00.000Z'),
        end: new Date('2026-03-10T00:45:00.000Z'),
      },
    ])
  })

  it('includes a location-specific block', async () => {
    prismaMockFns.calendarBlockFindMany.mockResolvedValue([
      {
        startsAt: new Date('2026-03-10T10:00:00.000Z'),
        endsAt: new Date('2026-03-10T11:00:00.000Z'),
      },
    ])

    const result = await loadBusyIntervalsForWindow({
      professionalId,
      locationId,
      windowStartUtc,
      windowEndUtc,
      nowUtc,
      fallbackDurationMinutes: 60,
      defaultBufferMinutes: 0,
    })

    expect(result).toEqual([
      {
        start: new Date('2026-03-10T10:00:00.000Z'),
        end: new Date('2026-03-10T11:00:00.000Z'),
      },
    ])
  })

  it('includes a global block', async () => {
    prismaMockFns.calendarBlockFindMany.mockResolvedValue([
      {
        startsAt: new Date('2026-03-10T13:00:00.000Z'),
        endsAt: new Date('2026-03-10T14:00:00.000Z'),
      },
    ])

    const result = await loadBusyIntervalsForWindow({
      professionalId,
      locationId,
      windowStartUtc,
      windowEndUtc,
      nowUtc,
      fallbackDurationMinutes: 60,
      defaultBufferMinutes: 0,
    })

    expect(result).toEqual([
      {
        start: new Date('2026-03-10T13:00:00.000Z'),
        end: new Date('2026-03-10T14:00:00.000Z'),
      },
    ])
  })

  it('does not include cancelled bookings', async () => {
    prismaMockFns.bookingFindMany.mockResolvedValue([])

    const result = await loadBusyIntervalsForWindow({
      professionalId,
      locationId,
      windowStartUtc,
      windowEndUtc,
      nowUtc,
      fallbackDurationMinutes: 60,
      defaultBufferMinutes: 0,
    })

    expect(result).toEqual([])
  })

  it('merges overlapping booking, hold, and block intervals', async () => {
    prismaMockFns.bookingFindMany.mockResolvedValue([
      {
        scheduledFor: new Date('2026-03-10T09:00:00.000Z'),
        totalDurationMinutes: 60,
        bufferMinutes: 0,
      },
    ])

    prismaMockFns.bookingHoldFindMany.mockResolvedValue([
      {
        id: 'hold_1',
        scheduledFor: new Date('2026-03-10T09:30:00.000Z'),
        offeringId: 'off_1',
        locationId,
        locationType: 'SALON',
      },
    ])

    prismaMockFns.professionalServiceOfferingFindMany.mockResolvedValue([
      {
        id: 'off_1',
        salonDurationMinutes: 30,
        mobileDurationMinutes: 30,
      },
    ])

    prismaMockFns.professionalLocationFindMany.mockResolvedValue([
      {
        id: locationId,
        bufferMinutes: 0,
      },
    ])

    prismaMockFns.calendarBlockFindMany.mockResolvedValue([
      {
        startsAt: new Date('2026-03-10T09:45:00.000Z'),
        endsAt: new Date('2026-03-10T10:30:00.000Z'),
      },
    ])

    const result = await loadBusyIntervalsForWindow({
      professionalId,
      locationId,
      windowStartUtc,
      windowEndUtc,
      nowUtc,
      fallbackDurationMinutes: 60,
      defaultBufferMinutes: 0,
    })

    expect(result).toEqual([
      {
        start: new Date('2026-03-10T09:00:00.000Z'),
        end: new Date('2026-03-10T10:30:00.000Z'),
      },
    ])
  })
})