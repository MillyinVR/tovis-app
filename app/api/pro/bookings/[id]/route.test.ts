import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BookingStatus, Prisma, ServiceLocationType } from '@prisma/client'

const mocks = vi.hoisted(() => ({
  requirePro: vi.fn(),
  jsonFail: vi.fn(),
  jsonOk: vi.fn(),
  pickBool: vi.fn(),
  pickInt: vi.fn(),
  pickIsoDate: vi.fn(),
  pickString: vi.fn(),

  prismaTransaction: vi.fn(),

  resolveAppointmentSchedulingContext: vi.fn(),
  isValidIanaTimeZone: vi.fn(),
  sanitizeTimeZone: vi.fn(),
  minutesSinceMidnightInTimeZone: vi.fn(),

  moneyToFixed2String: vi.fn(),
  clampInt: vi.fn(),

  normalizeStepMinutes: vi.fn(),
  ensureWithinWorkingHours: vi.fn(),
  getTimeRangeConflict: vi.fn(),
  logBookingConflict: vi.fn(),

  buildNormalizedBookingItemsFromRequestedOfferings: vi.fn(),
  computeBookingItemLikeTotals: vi.fn(),
  snapToStepMinutes: vi.fn(),
  sumDecimal: vi.fn(),

  decimalToNullableNumber: vi.fn(),
  pickFormattedAddressFromSnapshot: vi.fn(),

  lockProfessionalSchedule: vi.fn(),

  txBookingFindFirst: vi.fn(),
  txBookingUpdate: vi.fn(),
  txProfessionalLocationFindFirst: vi.fn(),
  txProfessionalServiceOfferingFindMany: vi.fn(),
  txBookingServiceItemFindMany: vi.fn(),
  txBookingServiceItemDeleteMany: vi.fn(),
  txBookingServiceItemCreate: vi.fn(),
  txBookingServiceItemCreateMany: vi.fn(),
  txClientNotificationCreate: vi.fn(),
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
  resolveAppointmentSchedulingContext: mocks.resolveAppointmentSchedulingContext,
}))

vi.mock('@/lib/timeZone', () => ({
  isValidIanaTimeZone: mocks.isValidIanaTimeZone,
  sanitizeTimeZone: mocks.sanitizeTimeZone,
  minutesSinceMidnightInTimeZone: mocks.minutesSinceMidnightInTimeZone,
}))

vi.mock('@/lib/money', () => ({
  moneyToFixed2String: mocks.moneyToFixed2String,
}))

vi.mock('@/lib/pick', () => ({
  clampInt: mocks.clampInt,
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

vi.mock('@/lib/booking/snapshots', () => ({
  decimalToNullableNumber: mocks.decimalToNullableNumber,
  pickFormattedAddressFromSnapshot: mocks.pickFormattedAddressFromSnapshot,
}))

vi.mock('@/lib/booking/scheduleLock', () => ({
  lockProfessionalSchedule: mocks.lockProfessionalSchedule,
}))

import { PATCH } from './route'

const tx = {
  booking: {
    findFirst: mocks.txBookingFindFirst,
    update: mocks.txBookingUpdate,
  },
  professionalLocation: {
    findFirst: mocks.txProfessionalLocationFindFirst,
  },
  professionalServiceOffering: {
    findMany: mocks.txProfessionalServiceOfferingFindMany,
  },
  bookingServiceItem: {
    findMany: mocks.txBookingServiceItemFindMany,
    deleteMany: mocks.txBookingServiceItemDeleteMany,
    create: mocks.txBookingServiceItemCreate,
    createMany: mocks.txBookingServiceItemCreateMany,
  },
  clientNotification: {
    create: mocks.txClientNotificationCreate,
  },
}

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

describe('PATCH /api/pro/bookings/[id]', () => {
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

    mocks.lockProfessionalSchedule.mockResolvedValue(undefined)

    mocks.resolveAppointmentSchedulingContext.mockResolvedValue({
      ok: true,
      context: {
        appointmentTimeZone: 'America/Los_Angeles',
        timeZoneSource: 'BOOKING_SNAPSHOT',
        locationId: 'loc_1',
        locationTimeZone: 'America/Los_Angeles',
        businessTimeZone: 'America/Los_Angeles',
      },
    })

    mocks.isValidIanaTimeZone.mockReturnValue(true)
    mocks.sanitizeTimeZone.mockImplementation((tz: string) => tz)
    mocks.moneyToFixed2String.mockImplementation((value: Prisma.Decimal) =>
      value.toFixed(2),
    )

    mocks.clampInt.mockImplementation((value: unknown, min: number, max: number) => {
      const parsed = Number(value)
      const n = Number.isFinite(parsed) ? Math.trunc(parsed) : min
      return Math.max(min, Math.min(max, n))
    })

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

    mocks.buildNormalizedBookingItemsFromRequestedOfferings.mockReturnValue(null)
    mocks.sumDecimal.mockReturnValue(new Prisma.Decimal('50.00'))

    mocks.decimalToNullableNumber.mockReturnValue(null)
    mocks.pickFormattedAddressFromSnapshot.mockReturnValue(null)

    mocks.txBookingFindFirst.mockResolvedValue(existingBooking)

    mocks.txBookingUpdate.mockImplementation(
      async ({
        data,
      }: {
        data: {
          scheduledFor?: Date
          bufferMinutes?: number
          totalDurationMinutes?: number
          status?: BookingStatus
          subtotalSnapshot?: Prisma.Decimal
        }
      }) => ({
        id: 'booking_1',
        scheduledFor: data.scheduledFor ?? existingBooking.scheduledFor,
        bufferMinutes: data.bufferMinutes ?? 15,
        totalDurationMinutes: data.totalDurationMinutes ?? 60,
        status: data.status ?? BookingStatus.ACCEPTED,
        subtotalSnapshot: data.subtotalSnapshot ?? new Prisma.Decimal('50.00'),
      }),
    )

    mocks.txProfessionalLocationFindFirst.mockResolvedValue(location)
    mocks.txProfessionalServiceOfferingFindMany.mockResolvedValue([])
    mocks.txBookingServiceItemFindMany.mockResolvedValue(existingItems)
    mocks.txBookingServiceItemDeleteMany.mockResolvedValue({ count: 0 })
    mocks.txBookingServiceItemCreate.mockResolvedValue({ id: 'item_1' })
    mocks.txBookingServiceItemCreateMany.mockResolvedValue({ count: 0 })
    mocks.txClientNotificationCreate.mockResolvedValue({ id: 'notif_1' })

    mocks.prismaTransaction.mockImplementation(
      async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx),
    )
  })

  it('acquires the professional schedule lock before conflict check and booking update', async () => {
    const result = await PATCH(
      makeRequest({
        scheduledFor: '2026-03-11T19:30:00.000Z',
      }),
      makeCtx(),
    )

    expect(mocks.lockProfessionalSchedule).toHaveBeenCalledWith(tx, 'pro_123')

    expect(mocks.lockProfessionalSchedule.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.getTimeRangeConflict.mock.invocationCallOrder[0],
    )

    expect(mocks.lockProfessionalSchedule.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.txBookingUpdate.mock.invocationCallOrder[0],
    )

    expect(result).toEqual({
      ok: true,
      status: 200,
      data: {
        booking: {
          id: 'booking_1',
          scheduledFor: '2026-03-11T19:30:00.000Z',
          endsAt: '2026-03-11T20:45:00.000Z',
          bufferMinutes: 15,
          durationMinutes: 60,
          totalDurationMinutes: 60,
          status: BookingStatus.ACCEPTED,
          subtotalSnapshot: '50.00',
          timeZone: 'America/Los_Angeles',
          timeZoneSource: 'BOOKING_SNAPSHOT',
          locationId: 'loc_1',
          locationType: ServiceLocationType.SALON,
          locationAddressSnapshot: null,
          locationLatSnapshot: null,
          locationLngSnapshot: null,
        },
      },
    })
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