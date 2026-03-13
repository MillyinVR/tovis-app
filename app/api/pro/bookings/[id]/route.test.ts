// app/api/pro/bookings/[id]/route.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Prisma, BookingStatus, ServiceLocationType } from '@prisma/client'

const mocks = vi.hoisted(() => ({
  requirePro: vi.fn(),
  jsonFail: vi.fn(),
  jsonOk: vi.fn(),
  pickBool: vi.fn(),
  pickInt: vi.fn(),
  pickIsoDate: vi.fn(),
  pickString: vi.fn(),

  prismaTransaction: vi.fn(),

  resolveApptTimeZone: vi.fn(),
  isValidIanaTimeZone: vi.fn(),
  sanitizeTimeZone: vi.fn(),
  minutesSinceMidnightInTimeZone: vi.fn(),

  normalizeStepMinutes: vi.fn(),
  ensureWithinWorkingHours: vi.fn(),
  getTimeRangeConflict: vi.fn(),
  logBookingConflict: vi.fn(),

  buildNormalizedBookingItemsFromRequestedOfferings: vi.fn(),
  computeBookingItemLikeTotals: vi.fn(),
  snapToStepMinutes: vi.fn(),
  sumDecimal: vi.fn(),
}))

vi.mock('@/app/api/_utils', () => ({
  requirePro: mocks.requirePro,
  jsonFail: mocks.jsonFail,
  jsonOk: mocks.jsonOk,
  pickBool: mocks.pickBool,
  pickInt: mocks.pickInt,
  pickIsoDate: mocks.pickIsoDate,
  pickString: mocks.pickString,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    $transaction: mocks.prismaTransaction,
  },
}))

vi.mock('@/lib/booking/timeZoneTruth', () => ({
  resolveApptTimeZone: mocks.resolveApptTimeZone,
}))

vi.mock('@/lib/timeZone', () => ({
  isValidIanaTimeZone: mocks.isValidIanaTimeZone,
  sanitizeTimeZone: mocks.sanitizeTimeZone,
  minutesSinceMidnightInTimeZone: mocks.minutesSinceMidnightInTimeZone,
}))

vi.mock('@/lib/booking/locationContext', () => ({
  normalizeStepMinutes: mocks.normalizeStepMinutes,
}))

vi.mock('@/lib/booking/workingHoursGuard', () => ({
  ensureWithinWorkingHours: mocks.ensureWithinWorkingHours,
}))

vi.mock('@/lib/booking/conflictQueries', () => ({
  getTimeRangeConflict: mocks.getTimeRangeConflict,
}))

vi.mock('@/lib/booking/conflictLogging', () => ({
  logBookingConflict: mocks.logBookingConflict,
}))

vi.mock('@/lib/booking/serviceItems', () => ({
  buildNormalizedBookingItemsFromRequestedOfferings:
    mocks.buildNormalizedBookingItemsFromRequestedOfferings,
  computeBookingItemLikeTotals: mocks.computeBookingItemLikeTotals,
  snapToStepMinutes: mocks.snapToStepMinutes,
  sumDecimal: mocks.sumDecimal,
}))

import { PATCH } from './route'

function makeRequest(body: unknown): Request {
  return new Request('http://localhost/api/pro/bookings/booking_1', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function makeCtx(id = 'booking_1') {
  return {
    params: Promise.resolve({ id }),
  }
}

const existingBooking = {
  id: 'booking_1',
  status: BookingStatus.ACCEPTED,
  scheduledFor: new Date('2026-03-11T19:00:00.000Z'),
  locationType: ServiceLocationType.SALON,
  bufferMinutes: 15,
  totalDurationMinutes: 60,
  subtotalSnapshot: new Prisma.Decimal('50.00'),
  clientId: 'client_1',
  locationId: 'loc_1',
  locationTimeZone: 'America/Los_Angeles',
  locationAddressSnapshot: null,
  locationLatSnapshot: null,
  locationLngSnapshot: null,
  professionalId: 'pro_123',
  professional: {
    timeZone: 'America/Los_Angeles',
  },
}

const location = {
  id: 'loc_1',
  type: 'SALON',
  timeZone: 'America/Los_Angeles',
  workingHours: {
    mon: { enabled: true, start: '09:00', end: '17:00' },
    tue: { enabled: true, start: '09:00', end: '17:00' },
    wed: { enabled: true, start: '09:00', end: '17:00' },
    thu: { enabled: true, start: '09:00', end: '17:00' },
    fri: { enabled: true, start: '09:00', end: '17:00' },
    sat: { enabled: false, start: '09:00', end: '17:00' },
    sun: { enabled: false, start: '09:00', end: '17:00' },
  },
  stepMinutes: 15,
  bufferMinutes: 15,
}

const existingItems = [
  {
    serviceId: 'service_1',
    offeringId: 'offering_1',
    priceSnapshot: new Prisma.Decimal('50.00'),
    durationMinutesSnapshot: 60,
    itemType: 'BASE',
  },
]

describe('PATCH /api/pro/bookings/[id] conflict logging', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mocks.requirePro.mockResolvedValue({
      ok: true,
      professionalId: 'pro_123',
    })

    mocks.jsonFail.mockImplementation((status: number, error: string) => ({
      ok: false,
      status,
      error,
    }))

    mocks.jsonOk.mockImplementation((data: unknown, status = 200) => ({
      ok: true,
      status,
      data,
    }))

    mocks.pickString.mockImplementation((value: unknown) =>
      typeof value === 'string' && value.trim() ? value.trim() : null,
    )

    mocks.pickBool.mockImplementation((value: unknown) =>
      typeof value === 'boolean' ? value : null,
    )

    mocks.pickInt.mockImplementation((value: unknown) => {
      if (typeof value === 'number' && Number.isInteger(value)) return value
      if (typeof value === 'string' && value.trim()) {
        const parsed = Number.parseInt(value, 10)
        return Number.isFinite(parsed) ? parsed : null
      }
      return null
    })

    mocks.pickIsoDate.mockImplementation((value: unknown) => {
      if (typeof value !== 'string' || !value.trim()) return null
      const d = new Date(value)
      return Number.isFinite(d.getTime()) ? d : null
    })

    mocks.resolveApptTimeZone.mockResolvedValue({
      ok: true,
      timeZone: 'America/Los_Angeles',
      source: 'BOOKING_SNAPSHOT',
    })

    mocks.isValidIanaTimeZone.mockReturnValue(true)
    mocks.sanitizeTimeZone.mockImplementation((tz: string) => tz)
    mocks.normalizeStepMinutes.mockReturnValue(15)
    mocks.snapToStepMinutes.mockImplementation((value: number) => value)
    mocks.minutesSinceMidnightInTimeZone.mockReturnValue(30)

    mocks.ensureWithinWorkingHours.mockReturnValue({ ok: true })
    mocks.getTimeRangeConflict.mockResolvedValue(null)

    mocks.computeBookingItemLikeTotals.mockReturnValue({
      primaryServiceId: 'service_1',
      primaryOfferingId: 'offering_1',
      computedDurationMinutes: 60,
      computedSubtotal: new Prisma.Decimal('50.00'),
    })

    mocks.prismaTransaction.mockImplementation(
      async (callback: (tx: unknown) => unknown) => {
        const tx = {
          booking: {
            findFirst: vi.fn().mockResolvedValue(existingBooking),
            update: vi.fn().mockResolvedValue({
              id: 'booking_1',
              scheduledFor: new Date('2026-03-11T19:00:00.000Z'),
              bufferMinutes: 15,
              totalDurationMinutes: 60,
              status: BookingStatus.ACCEPTED,
              subtotalSnapshot: new Prisma.Decimal('50.00'),
            }),
          },
          professionalLocation: {
            findFirst: vi.fn().mockResolvedValue(location),
          },
          professionalServiceOffering: {
            findMany: vi.fn().mockResolvedValue([]),
          },
          bookingServiceItem: {
            findMany: vi.fn().mockResolvedValue(existingItems),
            deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
            create: vi.fn(),
            createMany: vi.fn(),
          },
          clientNotification: {
            create: vi.fn(),
          },
        }

        return callback(tx)
      },
    )
  })

  it('logs STEP_BOUNDARY and returns 400 when scheduled time is off step', async () => {
    mocks.minutesSinceMidnightInTimeZone.mockReturnValueOnce(17)

    const result = await PATCH(
      makeRequest({
        scheduledFor: '2026-03-11T19:17:00.000Z',
      }),
      makeCtx(),
    )

    expect(mocks.logBookingConflict).toHaveBeenCalledWith({
      action: 'BOOKING_UPDATE',
      professionalId: 'pro_123',
      locationId: 'loc_1',
      locationType: ServiceLocationType.SALON,
      requestedStart: new Date('2026-03-11T19:17:00.000Z'),
      requestedEnd: new Date('2026-03-11T19:18:00.000Z'),
      conflictType: 'STEP_BOUNDARY',
      bookingId: 'booking_1',
      meta: {
        route: 'app/api/pro/bookings/[id]/route.ts',
        stepMinutes: 15,
        timeZone: 'America/Los_Angeles',
        timeZoneSource: 'BOOKING_SNAPSHOT',
      },
    })

    expect(result).toEqual({
      ok: false,
      status: 400,
      error: 'Start time must be on a 15-minute boundary.',
    })
  })

  it('logs WORKING_HOURS and returns 400 when outside working hours', async () => {
    mocks.ensureWithinWorkingHours.mockReturnValueOnce({
      ok: false,
      error: 'That time is outside your working hours.',
    })

    const result = await PATCH(
      makeRequest({
        scheduledFor: '2026-03-11T19:30:00.000Z',
      }),
      makeCtx(),
    )

    expect(mocks.logBookingConflict).toHaveBeenCalledWith({
      action: 'BOOKING_UPDATE',
      professionalId: 'pro_123',
      locationId: 'loc_1',
      locationType: ServiceLocationType.SALON,
      requestedStart: new Date('2026-03-11T19:30:00.000Z'),
      requestedEnd: new Date('2026-03-11T20:45:00.000Z'),
      conflictType: 'WORKING_HOURS',
      bookingId: 'booking_1',
      meta: {
        route: 'app/api/pro/bookings/[id]/route.ts',
        workingHoursError: 'That time is outside your working hours.',
        timeZone: 'America/Los_Angeles',
        timeZoneSource: 'BOOKING_SNAPSHOT',
      },
    })

    expect(result).toEqual({
      ok: false,
      status: 400,
      error: 'That time is outside your working hours.',
    })
  })

  it('logs BLOCKED and returns 409 when blocked by calendar block', async () => {
    mocks.getTimeRangeConflict.mockResolvedValueOnce('BLOCKED')

    const result = await PATCH(
      makeRequest({
        scheduledFor: '2026-03-11T19:30:00.000Z',
      }),
      makeCtx(),
    )

    expect(mocks.logBookingConflict).toHaveBeenCalledWith({
      action: 'BOOKING_UPDATE',
      professionalId: 'pro_123',
      locationId: 'loc_1',
      locationType: ServiceLocationType.SALON,
      requestedStart: new Date('2026-03-11T19:30:00.000Z'),
      requestedEnd: new Date('2026-03-11T20:45:00.000Z'),
      conflictType: 'BLOCKED',
      bookingId: 'booking_1',
      meta: {
        route: 'app/api/pro/bookings/[id]/route.ts',
        timeZone: 'America/Los_Angeles',
        timeZoneSource: 'BOOKING_SNAPSHOT',
      },
    })

    expect(result).toEqual({
      ok: false,
      status: 409,
      error: 'That time is blocked on your calendar.',
    })
  })

  it('logs BOOKING and returns 409 when blocked by another booking', async () => {
    mocks.getTimeRangeConflict.mockResolvedValueOnce('BOOKING')

    const result = await PATCH(
      makeRequest({
        scheduledFor: '2026-03-11T19:30:00.000Z',
      }),
      makeCtx(),
    )

    expect(mocks.logBookingConflict).toHaveBeenCalledWith({
      action: 'BOOKING_UPDATE',
      professionalId: 'pro_123',
      locationId: 'loc_1',
      locationType: ServiceLocationType.SALON,
      requestedStart: new Date('2026-03-11T19:30:00.000Z'),
      requestedEnd: new Date('2026-03-11T20:45:00.000Z'),
      conflictType: 'BOOKING',
      bookingId: 'booking_1',
      meta: {
        route: 'app/api/pro/bookings/[id]/route.ts',
        timeZone: 'America/Los_Angeles',
        timeZoneSource: 'BOOKING_SNAPSHOT',
      },
    })

    expect(result).toEqual({
      ok: false,
      status: 409,
      error: 'That time is not available.',
    })
  })

  it('logs HOLD and returns 409 when blocked by an active hold', async () => {
    mocks.getTimeRangeConflict.mockResolvedValueOnce('HOLD')

    const result = await PATCH(
      makeRequest({
        scheduledFor: '2026-03-11T19:30:00.000Z',
      }),
      makeCtx(),
    )

    expect(mocks.logBookingConflict).toHaveBeenCalledWith({
      action: 'BOOKING_UPDATE',
      professionalId: 'pro_123',
      locationId: 'loc_1',
      locationType: ServiceLocationType.SALON,
      requestedStart: new Date('2026-03-11T19:30:00.000Z'),
      requestedEnd: new Date('2026-03-11T20:45:00.000Z'),
      conflictType: 'HOLD',
      bookingId: 'booking_1',
      meta: {
        route: 'app/api/pro/bookings/[id]/route.ts',
        timeZone: 'America/Los_Angeles',
        timeZoneSource: 'BOOKING_SNAPSHOT',
      },
    })

    expect(result).toEqual({
      ok: false,
      status: 409,
      error: 'That time is not available.',
    })
  })
})