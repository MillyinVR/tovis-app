import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BookingStatus } from '@prisma/client'

const prismaMockFns = vi.hoisted(() => ({
  bookingFindMany: vi.fn(),
  bookingHoldFindMany: vi.fn(),
  calendarBlockFindMany: vi.fn(),
  calendarBlockFindFirst: vi.fn(),
  professionalServiceOfferingFindMany: vi.fn(),
  professionalLocationFindMany: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    booking: {
      findMany: prismaMockFns.bookingFindMany,
    },
    bookingHold: {
      findMany: prismaMockFns.bookingHoldFindMany,
    },
    calendarBlock: {
      findMany: prismaMockFns.calendarBlockFindMany,
      findFirst: prismaMockFns.calendarBlockFindFirst,
    },
    professionalServiceOffering: {
      findMany: prismaMockFns.professionalServiceOfferingFindMany,
    },
    professionalLocation: {
      findMany: prismaMockFns.professionalLocationFindMany,
    },
  },
}))

import {
  getTimeRangeConflict,
  hasBookingConflict,
  hasHoldConflict,
  loadBusyIntervalsForWindow,
} from '@/lib/booking/conflictQueries'

describe('conflictQueries', () => {
  const professionalId = 'pro_1'
  const locationId = 'loc_1'
  const nowUtc = new Date('2026-03-07T12:00:00.000Z')
  const windowStartUtc = new Date('2026-03-10T00:00:00.000Z')
  const windowEndUtc = new Date('2026-03-11T00:00:00.000Z')
  const requestedStart = new Date('2026-03-10T10:00:00.000Z')
  const requestedEnd = new Date('2026-03-10T11:00:00.000Z')

  beforeEach(() => {
    vi.clearAllMocks()

    prismaMockFns.bookingFindMany.mockResolvedValue([])
    prismaMockFns.bookingHoldFindMany.mockResolvedValue([])
    prismaMockFns.calendarBlockFindMany.mockResolvedValue([])
    prismaMockFns.calendarBlockFindFirst.mockResolvedValue(null)
    prismaMockFns.professionalServiceOfferingFindMany.mockResolvedValue([])
    prismaMockFns.professionalLocationFindMany.mockResolvedValue([])
  })

  describe('loadBusyIntervalsForWindow', () => {
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
          offering: {
            id: 'off_1',
            salonDurationMinutes: 45,
            mobileDurationMinutes: 30,
          },
          location: {
            id: locationId,
            bufferMinutes: 15,
          },
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

    it('includes a location-specific or global block via location-aware query', async () => {
      prismaMockFns.calendarBlockFindMany.mockResolvedValue([
        {
          startsAt: new Date('2026-03-10T10:00:00.000Z'),
          endsAt: new Date('2026-03-10T11:00:00.000Z'),
        },
      ])

      await loadBusyIntervalsForWindow({
        professionalId,
        locationId,
        windowStartUtc,
        windowEndUtc,
        nowUtc,
        fallbackDurationMinutes: 60,
        defaultBufferMinutes: 0,
      })

      expect(prismaMockFns.calendarBlockFindMany).toHaveBeenCalledWith({
        where: {
          professionalId,
          startsAt: { lt: windowEndUtc },
          endsAt: { gt: windowStartUtc },
          OR: [{ locationId: null }, { locationId }],
        },
        select: {
          startsAt: true,
          endsAt: true,
        },
        take: 5000,
      })
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
          offering: {
            id: 'off_1',
            salonDurationMinutes: 30,
            mobileDurationMinutes: 30,
          },
          location: {
            id: locationId,
            bufferMinutes: 0,
          },
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

  describe('hasBookingConflict', () => {
    it('treats bookings as pro-wide conflicts regardless of location', async () => {
      prismaMockFns.bookingFindMany.mockResolvedValue([
        {
          scheduledFor: new Date('2026-03-10T10:30:00.000Z'),
          totalDurationMinutes: 30,
          bufferMinutes: 0,
        },
      ])

      const result = await hasBookingConflict({
        professionalId,
        requestedStart,
        requestedEnd,
      })

      expect(result).toBe(true)
      expect(prismaMockFns.bookingFindMany).toHaveBeenCalledWith({
        where: {
          professionalId,
          scheduledFor: {
            gte: expect.any(Date),
            lt: requestedEnd,
          },
          status: {
            in: [
              BookingStatus.PENDING,
              BookingStatus.ACCEPTED,
              BookingStatus.COMPLETED,
            ],
          },
        },
        select: {
          scheduledFor: true,
          totalDurationMinutes: true,
          bufferMinutes: true,
        },
        take: 2000,
      })
    })

    it('returns false when no booking overlaps', async () => {
      prismaMockFns.bookingFindMany.mockResolvedValue([
        {
          scheduledFor: new Date('2026-03-10T12:00:00.000Z'),
          totalDurationMinutes: 30,
          bufferMinutes: 0,
        },
      ])

      const result = await hasBookingConflict({
        professionalId,
        requestedStart,
        requestedEnd,
      })

      expect(result).toBe(false)
    })
  })

  describe('hasHoldConflict', () => {
    it('treats holds as pro-wide conflicts regardless of location', async () => {
      prismaMockFns.bookingHoldFindMany.mockResolvedValue([
        {
          id: 'hold_1',
          scheduledFor: new Date('2026-03-10T10:30:00.000Z'),
          offeringId: 'off_1',
          locationId: 'other_loc',
          locationType: 'MOBILE',
          offering: {
            id: 'off_1',
            salonDurationMinutes: 30,
            mobileDurationMinutes: 30,
          },
          location: {
            id: 'other_loc',
            bufferMinutes: 0,
          },
        },
      ])

      const result = await hasHoldConflict({
        professionalId,
        requestedStart,
        requestedEnd,
        defaultBufferMinutes: 0,
        nowUtc,
      })

      expect(result).toBe(true)
    })

    it('ignores expired holds in the query', async () => {
      await hasHoldConflict({
        professionalId,
        requestedStart,
        requestedEnd,
        defaultBufferMinutes: 15,
        nowUtc,
      })

      expect(prismaMockFns.bookingHoldFindMany).toHaveBeenCalledWith({
        where: {
          professionalId,
          expiresAt: { gt: nowUtc },
          scheduledFor: {
            gte: new Date('2026-03-09T19:00:00.000Z'),
            lt: requestedEnd,
          },
        },
        select: {
          id: true,
          scheduledFor: true,
          offeringId: true,
          locationId: true,
          locationType: true,
          durationMinutesSnapshot: true,
          bufferMinutesSnapshot: true,
          endsAtSnapshot: true,
          offering: {
            select: {
              id: true,
              salonDurationMinutes: true,
              mobileDurationMinutes: true,
            },
          },
          location: {
            select: {
              id: true,
              bufferMinutes: true,
            },
          },
        },
        take: 2000,
      })
    })

    it('returns false when no hold overlaps', async () => {
      prismaMockFns.bookingHoldFindMany.mockResolvedValue([
        {
          id: 'hold_1',
          scheduledFor: new Date('2026-03-10T12:30:00.000Z'),
          offeringId: 'off_1',
          locationId,
          locationType: 'SALON',
          offering: {
            id: 'off_1',
            salonDurationMinutes: 30,
            mobileDurationMinutes: 30,
          },
          location: {
            id: locationId,
            bufferMinutes: 0,
          },
        },
      ])

      const result = await hasHoldConflict({
        professionalId,
        requestedStart,
        requestedEnd,
        defaultBufferMinutes: 0,
        nowUtc,
      })

      expect(result).toBe(false)
    })
  })

  describe('getTimeRangeConflict', () => {
    it('returns BLOCKED when a calendar block conflict exists', async () => {
      prismaMockFns.calendarBlockFindFirst.mockResolvedValue({
        id: 'block_1',
      })

      const result = await getTimeRangeConflict({
        professionalId,
        locationId,
        requestedStart,
        requestedEnd,
        defaultBufferMinutes: 15,
        nowUtc,
      })

      expect(result).toBe('BLOCKED')

      const blockCallArg = prismaMockFns.calendarBlockFindFirst.mock.calls[0]?.[0]

      expect(blockCallArg).toMatchObject({
        where: {
          professionalId,
          startsAt: { lt: requestedEnd },
          endsAt: { gt: requestedStart },
        },
        select: { id: true },
      })

      expect(blockCallArg?.where?.OR).toEqual(
        expect.arrayContaining([{ locationId }, { locationId: null }]),
      )
      expect(blockCallArg?.where?.OR).toHaveLength(2)

      expect(prismaMockFns.bookingFindMany).toHaveBeenCalled()
      expect(prismaMockFns.bookingHoldFindMany).toHaveBeenCalled()
    })

    it('returns BOOKING when no block exists and a booking overlaps', async () => {
      prismaMockFns.bookingFindMany.mockResolvedValue([
        {
          scheduledFor: new Date('2026-03-10T10:15:00.000Z'),
          totalDurationMinutes: 45,
          bufferMinutes: 0,
        },
      ])

      const result = await getTimeRangeConflict({
        professionalId,
        locationId,
        requestedStart,
        requestedEnd,
        defaultBufferMinutes: 15,
        nowUtc,
      })

      expect(result).toBe('BOOKING')
    })

    it('returns HOLD when no block or booking exists and a hold overlaps', async () => {
      prismaMockFns.bookingHoldFindMany.mockResolvedValue([
        {
          id: 'hold_1',
          scheduledFor: new Date('2026-03-10T10:15:00.000Z'),
          offeringId: 'off_1',
          locationId,
          locationType: 'SALON',
          offering: {
            id: 'off_1',
            salonDurationMinutes: 45,
            mobileDurationMinutes: 30,
          },
          location: {
            id: locationId,
            bufferMinutes: 0,
          },
        },
      ])

      const result = await getTimeRangeConflict({
        professionalId,
        locationId,
        requestedStart,
        requestedEnd,
        defaultBufferMinutes: 15,
        nowUtc,
      })

      expect(result).toBe('HOLD')
    })

    it('returns null when the range is fully available', async () => {
      const result = await getTimeRangeConflict({
        professionalId,
        locationId,
        requestedStart,
        requestedEnd,
        defaultBufferMinutes: 15,
        nowUtc,
      })

      expect(result).toBeNull()
    })
  })
})