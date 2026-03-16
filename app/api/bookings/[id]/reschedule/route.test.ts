import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  BookingStatus,
  ClientAddressKind,
  Prisma,
  ServiceLocationType,
} from '@prisma/client'

const mocks = vi.hoisted(() => ({
  requireClient: vi.fn(),
  pickString: vi.fn(),
  jsonFail: vi.fn(),
  jsonOk: vi.fn(),

  prismaTransaction: vi.fn(),

  minutesSinceMidnightInTimeZone: vi.fn(),

  clampInt: vi.fn(),

  assertTimeRangeAvailable: vi.fn(),

  normalizeLocationType: vi.fn(),
  resolveValidatedBookingContext: vi.fn(),

  buildAddressSnapshot: vi.fn(),
  decimalToNumber: vi.fn(),
  pickFormattedAddressFromSnapshot: vi.fn(),

  ensureWithinWorkingHours: vi.fn(),

  lockProfessionalSchedule: vi.fn(),

  txBookingFindUnique: vi.fn(),
  txProfessionalServiceOfferingFindUnique: vi.fn(),
  txBookingHoldFindUnique: vi.fn(),
  txClientAddressFindFirst: vi.fn(),
  txBookingUpdate: vi.fn(),
  txBookingHoldDelete: vi.fn(),
}))

vi.mock('@/app/api/_utils/auth/requireClient', () => ({
  requireClient: mocks.requireClient,
}))

vi.mock('@/app/api/_utils/pick', () => ({
  pickString: mocks.pickString,
}))

vi.mock('@/app/api/_utils/responses', () => ({
  jsonFail: mocks.jsonFail,
  jsonOk: mocks.jsonOk,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    $transaction: mocks.prismaTransaction,
  },
}))

vi.mock('@/lib/timeZone', () => ({
  DEFAULT_TIME_ZONE: 'UTC',
  minutesSinceMidnightInTimeZone: mocks.minutesSinceMidnightInTimeZone,
}))

vi.mock('@/lib/pick', () => ({
  clampInt: mocks.clampInt,
}))

vi.mock('@/lib/booking/conflictQueries', () => ({
  assertTimeRangeAvailable: mocks.assertTimeRangeAvailable,
}))

vi.mock('@/lib/booking/locationContext', () => ({
  normalizeLocationType: mocks.normalizeLocationType,
  resolveValidatedBookingContext: mocks.resolveValidatedBookingContext,
}))

vi.mock('@/lib/booking/snapshots', () => ({
  buildAddressSnapshot: mocks.buildAddressSnapshot,
  decimalToNumber: mocks.decimalToNumber,
  pickFormattedAddressFromSnapshot: mocks.pickFormattedAddressFromSnapshot,
}))

vi.mock('@/lib/booking/workingHoursGuard', () => ({
  ensureWithinWorkingHours: mocks.ensureWithinWorkingHours,
}))

vi.mock('@/lib/booking/scheduleLock', () => ({
  lockProfessionalSchedule: mocks.lockProfessionalSchedule,
}))

import { POST } from './route'

const tx = {
  booking: {
    findUnique: mocks.txBookingFindUnique,
    update: mocks.txBookingUpdate,
  },
  professionalServiceOffering: {
    findUnique: mocks.txProfessionalServiceOfferingFindUnique,
  },
  bookingHold: {
    findUnique: mocks.txBookingHoldFindUnique,
    delete: mocks.txBookingHoldDelete,
  },
  clientAddress: {
    findFirst: mocks.txClientAddressFindFirst,
  },
}

function makeRequest(body: unknown): Request {
  return new Request('http://localhost/api/bookings/booking_1/reschedule', {
    method: 'POST',
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
  clientId: 'client_1',
  professionalId: 'pro_123',
  offeringId: 'offering_1',
  startedAt: null,
  finishedAt: null,
  totalDurationMinutes: 60,
  bufferMinutes: 15,
}

const bookingOffering = {
  id: 'offering_1',
  offersInSalon: true,
  offersMobile: true,
  salonPriceStartingAt: new Prisma.Decimal('100.00'),
  salonDurationMinutes: 60,
  mobilePriceStartingAt: new Prisma.Decimal('120.00'),
  mobileDurationMinutes: 75,
}

const hold = {
  id: 'hold_1',
  clientId: 'client_1',
  professionalId: 'pro_123',
  offeringId: 'offering_1',
  scheduledFor: new Date('2026-03-11T19:30:00.000Z'),
  expiresAt: new Date('2026-03-11T19:45:00.000Z'),
  locationType: ServiceLocationType.SALON,
  locationId: 'loc_1',
  locationTimeZone: 'America/Los_Angeles',
  locationAddressSnapshot: { formattedAddress: '123 Salon St' },
  locationLatSnapshot: 34.05,
  locationLngSnapshot: -118.25,
  clientAddressId: null,
  clientAddressSnapshot: null,
  clientAddressLatSnapshot: null,
  clientAddressLngSnapshot: null,
}

describe('POST /api/bookings/[id]/reschedule', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-11T19:00:00.000Z'))

    vi.clearAllMocks()

    mocks.requireClient.mockResolvedValue({
      ok: true,
      clientId: 'client_1',
    })

    mocks.pickString.mockImplementation((value: unknown) =>
      typeof value === 'string' && value.trim() ? value.trim() : null,
    )

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

    mocks.clampInt.mockImplementation((value: unknown, min: number, max: number) => {
      const parsed = Number(value)
      const n = Number.isFinite(parsed) ? Math.trunc(parsed) : min
      return Math.max(min, Math.min(max, n))
    })

    mocks.normalizeLocationType.mockImplementation((value: unknown) => {
      if (value === 'SALON') return ServiceLocationType.SALON
      if (value === 'MOBILE') return ServiceLocationType.MOBILE
      return null
    })

    mocks.minutesSinceMidnightInTimeZone.mockReturnValue(30)

    mocks.resolveValidatedBookingContext.mockResolvedValue({
      ok: true,
      durationMinutes: 60,
      priceStartingAt: new Prisma.Decimal('100.00'),
      context: {
        locationId: 'loc_1',
        timeZone: 'America/Los_Angeles',
        workingHours: {
          wed: { enabled: true, start: '09:00', end: '18:00' },
        },
        stepMinutes: 15,
        advanceNoticeMinutes: 0,
        maxDaysAhead: 30,
        bufferMinutes: 15,
        formattedAddress: '123 Salon St',
        lat: 34.05,
        lng: -118.25,
      },
    })

    mocks.buildAddressSnapshot.mockImplementation((formattedAddress: string) => ({
      formattedAddress,
    }))

    mocks.decimalToNumber.mockImplementation((value: unknown) => {
      if (typeof value === 'number' && Number.isFinite(value)) return value
      if (value instanceof Prisma.Decimal) return Number(value.toString())
      return null
    })

    mocks.pickFormattedAddressFromSnapshot.mockImplementation((value: unknown) => {
      if (
        value &&
        typeof value === 'object' &&
        'formattedAddress' in value &&
        typeof value.formattedAddress === 'string' &&
        value.formattedAddress.trim()
      ) {
        return value.formattedAddress.trim()
      }
      return null
    })

    mocks.ensureWithinWorkingHours.mockReturnValue({ ok: true })

    mocks.assertTimeRangeAvailable.mockResolvedValue(undefined)

    mocks.lockProfessionalSchedule.mockResolvedValue(undefined)

    mocks.txBookingFindUnique.mockResolvedValue(existingBooking)
    mocks.txProfessionalServiceOfferingFindUnique.mockResolvedValue(bookingOffering)
    mocks.txBookingHoldFindUnique.mockResolvedValue(hold)
    mocks.txClientAddressFindFirst.mockResolvedValue({
      id: 'addr_1',
      kind: ClientAddressKind.SERVICE_ADDRESS,
    })

    mocks.txBookingUpdate.mockResolvedValue({
      id: 'booking_1',
      status: BookingStatus.ACCEPTED,
      scheduledFor: new Date('2026-03-11T19:30:00.000Z'),
      locationType: ServiceLocationType.SALON,
      bufferMinutes: 15,
      totalDurationMinutes: 60,
      locationTimeZone: 'America/Los_Angeles',
    })

    mocks.txBookingHoldDelete.mockResolvedValue({ id: 'hold_1' })

    mocks.prismaTransaction.mockImplementation(
      async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx),
    )
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('acquires the professional schedule lock before availability check and booking update', async () => {
    const result = await POST(
      makeRequest({
        holdId: 'hold_1',
        locationType: 'SALON',
      }),
      makeCtx(),
    )

    expect(mocks.lockProfessionalSchedule).toHaveBeenCalledWith(tx, 'pro_123')

    expect(mocks.lockProfessionalSchedule.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.assertTimeRangeAvailable.mock.invocationCallOrder[0],
    )

    expect(mocks.lockProfessionalSchedule.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.txBookingUpdate.mock.invocationCallOrder[0],
    )

    expect(mocks.txBookingUpdate).toHaveBeenCalledWith({
      where: { id: 'booking_1' },
      data: expect.objectContaining({
        scheduledFor: new Date('2026-03-11T19:30:00.000Z'),
        locationType: ServiceLocationType.SALON,
        bufferMinutes: 15,
        locationId: 'loc_1',
        locationTimeZone: 'America/Los_Angeles',
      }),
      select: {
        id: true,
        status: true,
        scheduledFor: true,
        locationType: true,
        bufferMinutes: true,
        totalDurationMinutes: true,
        locationTimeZone: true,
      },
    })

    expect(mocks.txBookingHoldDelete).toHaveBeenCalledWith({
      where: { id: 'hold_1' },
    })

    expect(result).toEqual({
      ok: true,
      status: 200,
      data: {
        booking: {
          id: 'booking_1',
          status: BookingStatus.ACCEPTED,
          scheduledFor: '2026-03-11T19:30:00.000Z',
          locationType: ServiceLocationType.SALON,
          bufferMinutes: 15,
          totalDurationMinutes: 60,
          locationTimeZone: 'America/Los_Angeles',
        },
      },
    })
  })

  it('returns 409 when the hold is expired', async () => {
    mocks.txBookingHoldFindUnique.mockResolvedValueOnce({
      ...hold,
      expiresAt: new Date('2000-01-01T00:00:00.000Z'),
    })

    const result = await POST(
      makeRequest({
        holdId: 'hold_1',
      }),
      makeCtx(),
    )

    expect(result).toEqual({
      ok: false,
      status: 409,
      error: 'Hold expired. Please pick a new time.',
    })
  })

  it('returns 400 when the held time is off step', async () => {
    mocks.minutesSinceMidnightInTimeZone.mockReturnValueOnce(17)

    const result = await POST(
      makeRequest({
        holdId: 'hold_1',
      }),
      makeCtx(),
    )

    expect(result).toEqual({
      ok: false,
      status: 400,
      error: 'Start time must be on a 15-minute boundary.',
    })
  })

  it('returns 400 when outside working hours', async () => {
    mocks.ensureWithinWorkingHours.mockReturnValueOnce({
      ok: false,
      error: 'That time is outside this professional’s working hours.',
    })

    const result = await POST(
      makeRequest({
        holdId: 'hold_1',
      }),
      makeCtx(),
    )

    expect(result).toEqual({
      ok: false,
      status: 400,
      error: 'That time is outside this professional’s working hours.',
    })
  })

  it('returns 409 when the time is blocked', async () => {
    mocks.assertTimeRangeAvailable.mockRejectedValueOnce(new Error('BLOCKED'))

    const result = await POST(
      makeRequest({
        holdId: 'hold_1',
      }),
      makeCtx(),
    )

    expect(result).toEqual({
      ok: false,
      status: 409,
      error: 'That time is blocked. Please choose a new slot.',
    })
  })

  it('returns 409 when the time is no longer available', async () => {
    mocks.assertTimeRangeAvailable.mockRejectedValueOnce(
      new Error('TIME_NOT_AVAILABLE'),
    )

    const result = await POST(
      makeRequest({
        holdId: 'hold_1',
      }),
      makeCtx(),
    )

    expect(result).toEqual({
      ok: false,
      status: 409,
      error: 'That time is no longer available. Please choose a new slot.',
    })
  })
})