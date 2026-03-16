import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ClientAddressKind,
  Prisma,
  ServiceLocationType,
} from '@prisma/client'

const mocks = vi.hoisted(() => ({
  requireClient: vi.fn(),
  jsonFail: vi.fn(),
  jsonOk: vi.fn(),
  pickString: vi.fn(),

  professionalServiceOfferingFindUnique: vi.fn(),
  prismaTransaction: vi.fn(),

  getTimeRangeConflict: vi.fn(),
  logBookingConflict: vi.fn(),

  normalizeLocationType: vi.fn(),
  resolveValidatedBookingContext: vi.fn(),

  buildAddressSnapshot: vi.fn(),
  decimalToNumber: vi.fn(),

  minutesSinceMidnightInTimeZone: vi.fn(),
  ensureWithinWorkingHours: vi.fn(),

  lockProfessionalSchedule: vi.fn(),

  txClientAddressFindFirst: vi.fn(),
  txBookingHoldCreate: vi.fn(),
}))

vi.mock('@/app/api/_utils', () => ({
  requireClient: mocks.requireClient,
  jsonFail: mocks.jsonFail,
  jsonOk: mocks.jsonOk,
  pickString: mocks.pickString,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    professionalServiceOffering: {
      findUnique: mocks.professionalServiceOfferingFindUnique,
    },
    $transaction: mocks.prismaTransaction,
  },
}))

vi.mock('@/lib/booking/conflictQueries', () => ({
  getTimeRangeConflict: mocks.getTimeRangeConflict,
}))

vi.mock('@/lib/booking/conflictLogging', () => ({
  logBookingConflict: mocks.logBookingConflict,
}))

vi.mock('@/lib/booking/locationContext', () => ({
  normalizeLocationType: mocks.normalizeLocationType,
  resolveValidatedBookingContext: mocks.resolveValidatedBookingContext,
}))

vi.mock('@/lib/booking/snapshots', () => ({
  buildAddressSnapshot: mocks.buildAddressSnapshot,
  decimalToNumber: mocks.decimalToNumber,
}))

vi.mock('@/lib/timeZone', () => ({
  minutesSinceMidnightInTimeZone: mocks.minutesSinceMidnightInTimeZone,
}))

vi.mock('@/lib/booking/workingHoursGuard', () => ({
  ensureWithinWorkingHours: mocks.ensureWithinWorkingHours,
}))

vi.mock('@/lib/booking/scheduleLock', () => ({
  lockProfessionalSchedule: mocks.lockProfessionalSchedule,
}))

import { POST } from './route'

const tx = {
  clientAddress: {
    findFirst: mocks.txClientAddressFindFirst,
  },
  bookingHold: {
    create: mocks.txBookingHoldCreate,
  },
}

function makeRequest(body: unknown): Request {
  return new Request('http://localhost/api/holds', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const offering = {
  id: 'offering_1',
  isActive: true,
  professionalId: 'pro_123',
  offersInSalon: true,
  offersMobile: true,
  salonDurationMinutes: 60,
  mobileDurationMinutes: 75,
  salonPriceStartingAt: new Prisma.Decimal('100.00'),
  mobilePriceStartingAt: new Prisma.Decimal('120.00'),
}

describe('POST /api/holds', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-11T19:00:00.000Z'))

    vi.clearAllMocks()

    mocks.requireClient.mockResolvedValue({
      ok: true,
      clientId: 'client_1',
    })

    mocks.jsonFail.mockImplementation(
      (status: number, error: string, extra?: unknown) => ({
        ok: false,
        status,
        error,
        ...(extra && typeof extra === 'object' ? extra : {}),
      }),
    )

    mocks.jsonOk.mockImplementation((data: unknown, status = 200) => ({
      ok: true,
      status,
      data,
    }))

    mocks.pickString.mockImplementation((value: unknown) =>
      typeof value === 'string' && value.trim() ? value.trim() : null,
    )

    mocks.normalizeLocationType.mockImplementation((value: unknown) => {
      if (value === 'SALON') return ServiceLocationType.SALON
      if (value === 'MOBILE') return ServiceLocationType.MOBILE
      return null
    })

    mocks.professionalServiceOfferingFindUnique.mockResolvedValue(offering)

    mocks.lockProfessionalSchedule.mockResolvedValue(undefined)

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

    mocks.minutesSinceMidnightInTimeZone.mockReturnValue(30)

    mocks.ensureWithinWorkingHours.mockReturnValue({ ok: true })

    mocks.getTimeRangeConflict.mockResolvedValue(null)

    mocks.txClientAddressFindFirst.mockResolvedValue({
      id: 'addr_1',
      formattedAddress: '789 Client Ave',
      lat: null,
      lng: null,
      kind: ClientAddressKind.SERVICE_ADDRESS,
    })

    mocks.txBookingHoldCreate.mockResolvedValue({
      id: 'hold_1',
      expiresAt: new Date('2026-03-11T19:10:00.000Z'),
      scheduledFor: new Date('2026-03-11T19:30:00.000Z'),
      locationType: ServiceLocationType.SALON,
      locationId: 'loc_1',
      locationTimeZone: 'America/Los_Angeles',
      clientAddressId: null,
      clientAddressSnapshot: null,
    })

    mocks.prismaTransaction.mockImplementation(
      async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx),
    )
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('acquires the professional schedule lock before conflict check and hold create', async () => {
    const result = await POST(
      makeRequest({
        offeringId: 'offering_1',
        scheduledFor: '2026-03-11T19:30:00.000Z',
        locationType: 'SALON',
        locationId: 'loc_1',
      }) as never,
    )

    expect(mocks.lockProfessionalSchedule).toHaveBeenCalledWith(tx, 'pro_123')

    expect(mocks.lockProfessionalSchedule.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.getTimeRangeConflict.mock.invocationCallOrder[0],
    )

    expect(mocks.lockProfessionalSchedule.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.txBookingHoldCreate.mock.invocationCallOrder[0],
    )

    expect(mocks.txBookingHoldCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        offeringId: 'offering_1',
        professionalId: 'pro_123',
        clientId: 'client_1',
        scheduledFor: new Date('2026-03-11T19:30:00.000Z'),
        expiresAt: new Date('2026-03-11T19:10:00.000Z'),
        locationType: ServiceLocationType.SALON,
        locationId: 'loc_1',
        locationTimeZone: 'America/Los_Angeles',
      }),
      select: {
        id: true,
        expiresAt: true,
        scheduledFor: true,
        locationType: true,
        locationId: true,
        locationTimeZone: true,
        clientAddressId: true,
        clientAddressSnapshot: true,
      },
    })

    expect(result).toEqual({
      ok: true,
      status: 201,
      data: {
        hold: {
          id: 'hold_1',
          expiresAt: new Date('2026-03-11T19:10:00.000Z'),
          scheduledFor: new Date('2026-03-11T19:30:00.000Z'),
          locationType: ServiceLocationType.SALON,
          locationId: 'loc_1',
          locationTimeZone: 'America/Los_Angeles',
          clientAddressId: null,
          clientAddressSnapshot: null,
        },
      },
    })
  })

  it('logs STEP_BOUNDARY and returns 400 when scheduled time is off step', async () => {
    mocks.minutesSinceMidnightInTimeZone.mockReturnValueOnce(17)

    const result = await POST(
      makeRequest({
        offeringId: 'offering_1',
        scheduledFor: '2026-03-11T19:17:00.000Z',
        locationType: 'SALON',
        locationId: 'loc_1',
      }) as never,
    )

    expect(mocks.logBookingConflict).toHaveBeenCalledWith({
      action: 'BOOKING_CREATE',
      professionalId: 'pro_123',
      locationId: 'loc_1',
      locationType: ServiceLocationType.SALON,
      requestedStart: new Date('2026-03-11T19:17:00.000Z'),
      requestedEnd: new Date('2026-03-11T20:32:00.000Z'),
      conflictType: 'STEP_BOUNDARY',
      note: null,
      meta: {
        route: 'app/api/holds/route.ts',
        offeringId: 'offering_1',
        clientId: 'client_1',
        clientAddressId: null,
        stepMinutes: 15,
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
      error: 'That time is outside this professional’s working hours.',
    })

    const result = await POST(
      makeRequest({
        offeringId: 'offering_1',
        scheduledFor: '2026-03-11T19:30:00.000Z',
        locationType: 'SALON',
        locationId: 'loc_1',
      }) as never,
    )

    expect(mocks.logBookingConflict).toHaveBeenCalledWith({
      action: 'BOOKING_CREATE',
      professionalId: 'pro_123',
      locationId: 'loc_1',
      locationType: ServiceLocationType.SALON,
      requestedStart: new Date('2026-03-11T19:30:00.000Z'),
      requestedEnd: new Date('2026-03-11T20:45:00.000Z'),
      conflictType: 'WORKING_HOURS',
      note: null,
      meta: {
        route: 'app/api/holds/route.ts',
        offeringId: 'offering_1',
        clientId: 'client_1',
        clientAddressId: null,
        workingHoursError: 'That time is outside this professional’s working hours.',
      },
    })

    expect(result).toEqual({
      ok: false,
      status: 400,
      error: 'That time is outside this professional’s working hours.',
    })
  })

  it('logs BLOCKED and returns 409 when blocked by calendar block', async () => {
    mocks.getTimeRangeConflict.mockResolvedValueOnce('BLOCKED')

    const result = await POST(
      makeRequest({
        offeringId: 'offering_1',
        scheduledFor: '2026-03-11T19:30:00.000Z',
        locationType: 'SALON',
        locationId: 'loc_1',
      }) as never,
    )

    expect(mocks.logBookingConflict).toHaveBeenCalledWith({
      action: 'BOOKING_CREATE',
      professionalId: 'pro_123',
      locationId: 'loc_1',
      locationType: ServiceLocationType.SALON,
      requestedStart: new Date('2026-03-11T19:30:00.000Z'),
      requestedEnd: new Date('2026-03-11T20:45:00.000Z'),
      conflictType: 'BLOCKED',
      note: null,
      meta: {
        route: 'app/api/holds/route.ts',
        offeringId: 'offering_1',
        clientId: 'client_1',
        clientAddressId: null,
      },
    })

    expect(result).toEqual({
      ok: false,
      status: 409,
      error: 'That time is blocked. Try another slot.',
    })
  })

  it('logs BOOKING and returns 409 when blocked by existing booking', async () => {
    mocks.getTimeRangeConflict.mockResolvedValueOnce('BOOKING')

    const result = await POST(
      makeRequest({
        offeringId: 'offering_1',
        scheduledFor: '2026-03-11T19:30:00.000Z',
        locationType: 'SALON',
        locationId: 'loc_1',
      }) as never,
    )

    expect(mocks.logBookingConflict).toHaveBeenCalledWith({
      action: 'BOOKING_CREATE',
      professionalId: 'pro_123',
      locationId: 'loc_1',
      locationType: ServiceLocationType.SALON,
      requestedStart: new Date('2026-03-11T19:30:00.000Z'),
      requestedEnd: new Date('2026-03-11T20:45:00.000Z'),
      conflictType: 'BOOKING',
      note: null,
      meta: {
        route: 'app/api/holds/route.ts',
        offeringId: 'offering_1',
        clientId: 'client_1',
        clientAddressId: null,
      },
    })

    expect(result).toEqual({
      ok: false,
      status: 409,
      error: 'That time was just taken.',
    })
  })

  it('logs HOLD and returns 409 when blocked by active hold', async () => {
    mocks.getTimeRangeConflict.mockResolvedValueOnce('HOLD')

    const result = await POST(
      makeRequest({
        offeringId: 'offering_1',
        scheduledFor: '2026-03-11T19:30:00.000Z',
        locationType: 'SALON',
        locationId: 'loc_1',
      }) as never,
    )

    expect(mocks.logBookingConflict).toHaveBeenCalledWith({
      action: 'BOOKING_CREATE',
      professionalId: 'pro_123',
      locationId: 'loc_1',
      locationType: ServiceLocationType.SALON,
      requestedStart: new Date('2026-03-11T19:30:00.000Z'),
      requestedEnd: new Date('2026-03-11T20:45:00.000Z'),
      conflictType: 'HOLD',
      note: null,
      meta: {
        route: 'app/api/holds/route.ts',
        offeringId: 'offering_1',
        clientId: 'client_1',
        clientAddressId: null,
      },
    })

    expect(result).toEqual({
      ok: false,
      status: 409,
      error: 'Someone is already holding that time. Try another slot.',
    })
  })

  it('returns 400 when mobile booking is missing client address id', async () => {
    const result = await POST(
      makeRequest({
        offeringId: 'offering_1',
        scheduledFor: '2026-03-11T19:30:00.000Z',
        locationType: 'MOBILE',
        locationId: 'loc_1',
      }) as never,
    )

    expect(result).toEqual({
      ok: false,
      status: 400,
      error: 'Select a saved service address before booking a mobile appointment.',
      code: 'CLIENT_SERVICE_ADDRESS_REQUIRED',
    })
  })

  it('returns 400 when mobile selected address is invalid', async () => {
    mocks.txClientAddressFindFirst.mockResolvedValueOnce({
      id: 'addr_1',
      formattedAddress: '',
      lat: null,
      lng: null,
      kind: ClientAddressKind.SERVICE_ADDRESS,
    })

    const result = await POST(
      makeRequest({
        offeringId: 'offering_1',
        scheduledFor: '2026-03-11T19:30:00.000Z',
        locationType: 'MOBILE',
        locationId: 'loc_1',
        clientAddressId: 'addr_1',
      }) as never,
    )

    expect(result).toEqual({
      ok: false,
      status: 400,
      error:
        'That service address is missing a formatted address. Please update it before booking mobile.',
      code: 'CLIENT_SERVICE_ADDRESS_INVALID',
    })
  })
})