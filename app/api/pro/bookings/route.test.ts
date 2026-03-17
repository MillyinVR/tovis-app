// app/api/pro/bookings/route.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  BookingStatus,
  ClientAddressKind,
  Prisma,
  ServiceLocationType,
} from '@prisma/client'

const mocks = vi.hoisted(() => ({
  requirePro: vi.fn(),
  jsonFail: vi.fn(),
  jsonOk: vi.fn(),
  pickString: vi.fn(),
  pickBool: vi.fn(),
  pickInt: vi.fn(),
  clampInt: vi.fn(),

  moneyToString: vi.fn(),
  minutesSinceMidnightInTimeZone: vi.fn(),

  getTimeRangeConflict: vi.fn(),
  logBookingConflict: vi.fn(),

  normalizeLocationType: vi.fn(),
  resolveValidatedBookingContext: vi.fn(),

  buildAddressSnapshot: vi.fn(),
  decimalFromUnknown: vi.fn(),
  decimalToNumber: vi.fn(),

  ensureWithinWorkingHours: vi.fn(),
  snapToStepMinutes: vi.fn(),
  getProCreatedBookingStatus: vi.fn(),

  withLockedProfessionalTransaction: vi.fn(),

  txClientProfileFindUnique: vi.fn(),
  txClientAddressFindFirst: vi.fn(),
  txProfessionalServiceOfferingFindFirst: vi.fn(),
  txBookingCreate: vi.fn(),
  txBookingServiceItemCreate: vi.fn(),
}))

vi.mock('@/app/api/_utils', () => ({
  requirePro: mocks.requirePro,
  jsonFail: mocks.jsonFail,
  jsonOk: mocks.jsonOk,
  pickString: mocks.pickString,
}))

vi.mock('@/lib/pick', () => ({
  clampInt: mocks.clampInt,
  pickBool: mocks.pickBool,
  pickInt: mocks.pickInt,
}))

vi.mock('@/lib/money', () => ({
  moneyToString: mocks.moneyToString,
}))

vi.mock('@/lib/timeZone', () => ({
  minutesSinceMidnightInTimeZone: mocks.minutesSinceMidnightInTimeZone,
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
  decimalFromUnknown: mocks.decimalFromUnknown,
  decimalToNumber: mocks.decimalToNumber,
}))

vi.mock('@/lib/booking/workingHoursGuard', () => ({
  ensureWithinWorkingHours: mocks.ensureWithinWorkingHours,
}))

vi.mock('@/lib/booking/serviceItems', () => ({
  snapToStepMinutes: mocks.snapToStepMinutes,
}))

vi.mock('@/lib/booking/statusRules', () => ({
  getProCreatedBookingStatus: mocks.getProCreatedBookingStatus,
}))

vi.mock('@/lib/booking/scheduleTransaction', () => ({
  withLockedProfessionalTransaction: mocks.withLockedProfessionalTransaction,
}))

import { POST } from './route'

const tx = {
  clientProfile: {
    findUnique: mocks.txClientProfileFindUnique,
  },
  clientAddress: {
    findFirst: mocks.txClientAddressFindFirst,
  },
  professionalServiceOffering: {
    findFirst: mocks.txProfessionalServiceOfferingFindFirst,
  },
  booking: {
    create: mocks.txBookingCreate,
  },
  bookingServiceItem: {
    create: mocks.txBookingServiceItemCreate,
  },
}

function makeRequest(body: unknown): Request {
  return new Request('http://localhost/api/pro/bookings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const requestedStart = new Date('2026-03-11T19:30:00.000Z')

describe('POST /api/pro/bookings', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mocks.requirePro.mockResolvedValue({
      ok: true,
      professionalId: 'pro_123',
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

    mocks.decimalFromUnknown.mockReturnValue(new Prisma.Decimal('50.00'))
    mocks.decimalToNumber.mockReturnValue(null)
    mocks.buildAddressSnapshot.mockImplementation((formattedAddress: string) => ({
      formattedAddress,
    }))
    mocks.snapToStepMinutes.mockImplementation((value: number) => value)
    mocks.minutesSinceMidnightInTimeZone.mockReturnValue(30)
    mocks.ensureWithinWorkingHours.mockReturnValue({ ok: true })
    mocks.getTimeRangeConflict.mockResolvedValue(null)
    mocks.moneyToString.mockReturnValue('50.00')
    mocks.getProCreatedBookingStatus.mockReturnValue(BookingStatus.ACCEPTED)

    mocks.resolveValidatedBookingContext.mockResolvedValue({
      ok: true,
      context: {
        locationId: 'loc_1',
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
        formattedAddress: '123 Salon St',
        lat: null,
        lng: null,
        advanceNoticeMinutes: 0,
        maxDaysAhead: 30,
      },
      durationMinutes: 60,
      priceStartingAt: new Prisma.Decimal('50.00'),
    })

    mocks.txClientProfileFindUnique.mockResolvedValue({ id: 'client_1' })

    mocks.txClientAddressFindFirst.mockResolvedValue({
      id: 'addr_1',
      formattedAddress: '789 Client Ave',
      lat: null,
      lng: null,
      kind: ClientAddressKind.SERVICE_ADDRESS,
    })

    mocks.txProfessionalServiceOfferingFindFirst.mockResolvedValue({
      id: 'offering_1',
      serviceId: 'service_1',
      offersInSalon: true,
      offersMobile: true,
      salonPriceStartingAt: new Prisma.Decimal('50.00'),
      mobilePriceStartingAt: new Prisma.Decimal('60.00'),
      salonDurationMinutes: 60,
      mobileDurationMinutes: 75,
      service: {
        id: 'service_1',
        name: 'Haircut',
      },
    })

    mocks.txBookingCreate.mockResolvedValue({
      id: 'booking_1',
      scheduledFor: requestedStart,
      totalDurationMinutes: 60,
      bufferMinutes: 15,
      status: BookingStatus.ACCEPTED,
    })

    mocks.txBookingServiceItemCreate.mockResolvedValue({ id: 'item_1' })

    mocks.withLockedProfessionalTransaction.mockImplementation(
      async (
        professionalId: string,
        callback: (args: { tx: typeof tx; now: Date }) => Promise<unknown>,
      ) => callback({ tx, now: new Date('2026-03-11T19:00:00.000Z') }),
    )
  })

  it('creates a booking successfully', async () => {
    const result = await POST(
      makeRequest({
        clientId: 'client_1',
        scheduledFor: '2026-03-11T19:30:00.000Z',
        locationId: 'loc_1',
        locationType: 'SALON',
        offeringId: 'offering_1',
      }),
    )

    expect(mocks.withLockedProfessionalTransaction).toHaveBeenCalledWith(
      'pro_123',
      expect.any(Function),
    )

    expect(mocks.getTimeRangeConflict).toHaveBeenCalled()
    expect(mocks.txBookingCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        professionalId: 'pro_123',
        clientId: 'client_1',
        serviceId: 'service_1',
        offeringId: 'offering_1',
        scheduledFor: new Date('2026-03-11T19:30:00.000Z'),
        status: BookingStatus.ACCEPTED,
        locationType: ServiceLocationType.SALON,
        locationId: 'loc_1',
        locationTimeZone: 'America/Los_Angeles',
        bufferMinutes: 15,
        totalDurationMinutes: 60,
        subtotalSnapshot: new Prisma.Decimal('50.00'),
      }),
      select: {
        id: true,
        scheduledFor: true,
        totalDurationMinutes: true,
        bufferMinutes: true,
        status: true,
      },
    })

    expect(result).toEqual({
      ok: true,
      status: 201,
      data: {
        booking: {
          id: 'booking_1',
          scheduledFor: '2026-03-11T19:30:00.000Z',
          endsAt: '2026-03-11T20:45:00.000Z',
          totalDurationMinutes: 60,
          bufferMinutes: 15,
          status: BookingStatus.ACCEPTED,
          serviceName: 'Haircut',
          subtotalSnapshot: '50.00',
          subtotalCents: 5000,
          locationId: 'loc_1',
          locationType: ServiceLocationType.SALON,
          clientAddressId: null,
          stepMinutes: 15,
          timeZone: 'America/Los_Angeles',
        },
      },
    })
  })

  it('logs STEP_BOUNDARY and returns STEP_MISMATCH when scheduled time is off step', async () => {
    mocks.minutesSinceMidnightInTimeZone.mockReturnValueOnce(17)

    const result = await POST(
      makeRequest({
        clientId: 'client_1',
        scheduledFor: '2026-03-11T19:17:00.000Z',
        locationId: 'loc_1',
        locationType: 'SALON',
        offeringId: 'offering_1',
      }),
    )

    expect(mocks.logBookingConflict).toHaveBeenCalledWith({
      action: 'BOOKING_CREATE',
      professionalId: 'pro_123',
      locationId: 'loc_1',
      locationType: ServiceLocationType.SALON,
      requestedStart: new Date('2026-03-11T19:17:00.000Z'),
      requestedEnd: new Date('2026-03-11T19:18:00.000Z'),
      conflictType: 'STEP_BOUNDARY',
      meta: {
        route: 'app/api/pro/bookings/route.ts',
        stepMinutes: 15,
        offeringId: 'offering_1',
        clientId: 'client_1',
      },
    })

    expect(result).toEqual({
      ok: false,
      status: 400,
      error: 'Start time must be on a 15-minute boundary.',
      code: 'STEP_MISMATCH',
      retryable: true,
      uiAction: 'PICK_NEW_SLOT',
      message: 'Start time must be on a 15-minute boundary.',
    })
  })

  it('logs WORKING_HOURS and returns OUTSIDE_WORKING_HOURS when outside working hours', async () => {
    mocks.ensureWithinWorkingHours.mockReturnValueOnce({
      ok: false,
      error: 'BOOKING_WORKING_HOURS:OUTSIDE_WORKING_HOURS',
    })

    const result = await POST(
      makeRequest({
        clientId: 'client_1',
        scheduledFor: '2026-03-11T19:30:00.000Z',
        locationId: 'loc_1',
        locationType: 'SALON',
        offeringId: 'offering_1',
      }),
    )

    expect(mocks.logBookingConflict).toHaveBeenCalledWith({
      action: 'BOOKING_CREATE',
      professionalId: 'pro_123',
      locationId: 'loc_1',
      locationType: ServiceLocationType.SALON,
      requestedStart: new Date('2026-03-11T19:30:00.000Z'),
      requestedEnd: new Date('2026-03-11T20:45:00.000Z'),
      conflictType: 'WORKING_HOURS',
      meta: {
        route: 'app/api/pro/bookings/route.ts',
        offeringId: 'offering_1',
        clientId: 'client_1',
        workingHoursError: 'BOOKING_WORKING_HOURS:OUTSIDE_WORKING_HOURS',
      },
    })

    expect(result).toEqual({
      ok: false,
      status: 400,
      error: 'That time is outside working hours.',
      code: 'OUTSIDE_WORKING_HOURS',
      retryable: true,
      uiAction: 'PICK_NEW_SLOT',
      message: 'Requested time is outside working hours.',
    })
  })

  it('logs BLOCKED and returns TIME_BLOCKED when blocked by calendar block', async () => {
    mocks.getTimeRangeConflict.mockResolvedValueOnce('BLOCKED')

    const result = await POST(
      makeRequest({
        clientId: 'client_1',
        scheduledFor: '2026-03-11T19:30:00.000Z',
        locationId: 'loc_1',
        locationType: 'SALON',
        offeringId: 'offering_1',
      }),
    )

    expect(mocks.logBookingConflict).toHaveBeenCalledWith({
      action: 'BOOKING_CREATE',
      professionalId: 'pro_123',
      locationId: 'loc_1',
      locationType: ServiceLocationType.SALON,
      requestedStart: new Date('2026-03-11T19:30:00.000Z'),
      requestedEnd: new Date('2026-03-11T20:45:00.000Z'),
      conflictType: 'BLOCKED',
      meta: {
        route: 'app/api/pro/bookings/route.ts',
        offeringId: 'offering_1',
        clientId: 'client_1',
      },
    })

    expect(result).toEqual({
      ok: false,
      status: 409,
      error: 'That time is blocked on your calendar.',
      code: 'TIME_BLOCKED',
      retryable: true,
      uiAction: 'PICK_NEW_SLOT',
      message: 'Requested time is blocked.',
    })
  })

  it('logs BOOKING and returns TIME_BOOKED when blocked by another booking', async () => {
    mocks.getTimeRangeConflict.mockResolvedValueOnce('BOOKING')

    const result = await POST(
      makeRequest({
        clientId: 'client_1',
        scheduledFor: '2026-03-11T19:30:00.000Z',
        locationId: 'loc_1',
        locationType: 'SALON',
        offeringId: 'offering_1',
      }),
    )

    expect(mocks.logBookingConflict).toHaveBeenCalledWith({
      action: 'BOOKING_CREATE',
      professionalId: 'pro_123',
      locationId: 'loc_1',
      locationType: ServiceLocationType.SALON,
      requestedStart: new Date('2026-03-11T19:30:00.000Z'),
      requestedEnd: new Date('2026-03-11T20:45:00.000Z'),
      conflictType: 'BOOKING',
      meta: {
        route: 'app/api/pro/bookings/route.ts',
        offeringId: 'offering_1',
        clientId: 'client_1',
      },
    })

    expect(result).toEqual({
      ok: false,
      status: 409,
      error: 'That time is not available.',
      code: 'TIME_BOOKED',
      retryable: true,
      uiAction: 'PICK_NEW_SLOT',
      message: 'Requested time already has a booking.',
    })
  })

  it('logs HOLD and returns TIME_HELD when blocked by an active hold', async () => {
    mocks.getTimeRangeConflict.mockResolvedValueOnce('HOLD')

    const result = await POST(
      makeRequest({
        clientId: 'client_1',
        scheduledFor: '2026-03-11T19:30:00.000Z',
        locationId: 'loc_1',
        locationType: 'SALON',
        offeringId: 'offering_1',
      }),
    )

    expect(mocks.logBookingConflict).toHaveBeenCalledWith({
      action: 'BOOKING_CREATE',
      professionalId: 'pro_123',
      locationId: 'loc_1',
      locationType: ServiceLocationType.SALON,
      requestedStart: new Date('2026-03-11T19:30:00.000Z'),
      requestedEnd: new Date('2026-03-11T20:45:00.000Z'),
      conflictType: 'HOLD',
      meta: {
        route: 'app/api/pro/bookings/route.ts',
        offeringId: 'offering_1',
        clientId: 'client_1',
      },
    })

    expect(result).toEqual({
      ok: false,
      status: 409,
      error: 'That time is not available.',
      code: 'TIME_HELD',
      retryable: true,
      uiAction: 'PICK_NEW_SLOT',
      message: 'Requested time is currently held.',
    })
  })
})