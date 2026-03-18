import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ClientAddressKind,
  Prisma,
  ServiceLocationType,
} from '@prisma/client'
import { NextRequest } from 'next/server'

const TEST_NOW = new Date('2026-03-17T12:55:00.000Z')
const SLOT_START = new Date('2026-03-17T13:30:00.000Z')
const HOLD_EXPIRES = new Date('2026-03-17T13:05:00.000Z')

const mocks = vi.hoisted(() => ({
  requireClient: vi.fn(),
  jsonFail: vi.fn(),
  jsonOk: vi.fn(),
  pickString: vi.fn(),

  professionalServiceOfferingFindUnique: vi.fn(),

  getTimeRangeConflict: vi.fn(),
  logBookingConflict: vi.fn(),

  normalizeLocationType: vi.fn(),
  resolveValidatedBookingContext: vi.fn(),

  buildAddressSnapshot: vi.fn(),
  decimalToNumber: vi.fn(),

  checkSlotReadiness: vi.fn(),

  withLockedProfessionalTransaction: vi.fn(),

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

vi.mock('@/lib/booking/slotReadiness', () => ({
  checkSlotReadiness: mocks.checkSlotReadiness,
}))

vi.mock('@/lib/booking/scheduleTransaction', () => ({
  withLockedProfessionalTransaction: mocks.withLockedProfessionalTransaction,
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

function makeRequest(body: unknown): NextRequest {
  const req = new Request('http://localhost/api/holds', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  return req as NextRequest
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
  professional: {
    timeZone: 'America/Los_Angeles',
  },
}

describe('POST /api/holds', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(TEST_NOW)

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

    mocks.checkSlotReadiness.mockReturnValue({
      ok: true,
      startUtc: SLOT_START,
      endUtc: new Date('2026-03-17T14:45:00.000Z'),
      timeZone: 'America/Los_Angeles',
      stepMinutes: 15,
      durationMinutes: 60,
      bufferMinutes: 15,
    })

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
      expiresAt: HOLD_EXPIRES,
      scheduledFor: SLOT_START,
      locationType: ServiceLocationType.SALON,
      locationId: 'loc_1',
      locationTimeZone: 'America/Los_Angeles',
      clientAddressId: null,
      clientAddressSnapshot: null,
    })

    mocks.withLockedProfessionalTransaction.mockImplementation(
      async (
        professionalId: string,
        run: (args: { tx: typeof tx; now: Date }) => Promise<unknown>,
      ) => run({ tx, now: TEST_NOW }),
    )
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('uses the locked professional transaction before conflict check and hold create', async () => {
    const result = await POST(
      makeRequest({
        offeringId: 'offering_1',
        scheduledFor: SLOT_START.toISOString(),
        locationType: 'SALON',
        locationId: 'loc_1',
      }),
    )

    expect(mocks.withLockedProfessionalTransaction).toHaveBeenCalledWith(
      'pro_123',
      expect.any(Function),
    )

    expect(mocks.checkSlotReadiness).toHaveBeenCalled()
    expect(mocks.getTimeRangeConflict).toHaveBeenCalled()
    expect(mocks.txBookingHoldCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        offeringId: 'offering_1',
        professionalId: 'pro_123',
        clientId: 'client_1',
        scheduledFor: SLOT_START,
        expiresAt: HOLD_EXPIRES,
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
          expiresAt: HOLD_EXPIRES,
          scheduledFor: SLOT_START,
          locationType: ServiceLocationType.SALON,
          locationId: 'loc_1',
          locationTimeZone: 'America/Los_Angeles',
          clientAddressId: null,
          clientAddressSnapshot: null,
        },
      },
    })
  })

  it('logs STEP_BOUNDARY and returns STEP_MISMATCH when scheduled time is off step', async () => {
    const offStepStart = new Date('2026-03-17T13:17:00.000Z')

    mocks.checkSlotReadiness.mockReturnValueOnce({
      ok: false,
      code: 'STEP_MISMATCH',
      meta: {},
    })

    const result = await POST(
      makeRequest({
        offeringId: 'offering_1',
        scheduledFor: offStepStart.toISOString(),
        locationType: 'SALON',
        locationId: 'loc_1',
      }),
    )

    expect(mocks.logBookingConflict).toHaveBeenCalledWith({
      action: 'BOOKING_CREATE',
      professionalId: 'pro_123',
      locationId: 'loc_1',
      locationType: ServiceLocationType.SALON,
      requestedStart: offStepStart,
      requestedEnd: new Date('2026-03-17T14:32:00.000Z'),
      conflictType: 'STEP_BOUNDARY',
      note: null,
      meta: {
        route: 'app/api/holds/route.ts',
        offeringId: 'offering_1',
        clientId: 'client_1',
        clientAddressId: null,
        slotReadinessCode: 'STEP_MISMATCH',
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
    mocks.checkSlotReadiness.mockReturnValueOnce({
      ok: false,
      code: 'OUTSIDE_WORKING_HOURS',
      meta: {
        workingHoursError: 'That time is outside working hours.',
      },
    })

    const result = await POST(
      makeRequest({
        offeringId: 'offering_1',
        scheduledFor: SLOT_START.toISOString(),
        locationType: 'SALON',
        locationId: 'loc_1',
      }),
    )

    expect(mocks.logBookingConflict).toHaveBeenCalledWith({
      action: 'BOOKING_CREATE',
      professionalId: 'pro_123',
      locationId: 'loc_1',
      locationType: ServiceLocationType.SALON,
      requestedStart: SLOT_START,
      requestedEnd: new Date('2026-03-17T14:45:00.000Z'),
      conflictType: 'WORKING_HOURS',
      note: null,
      meta: {
        route: 'app/api/holds/route.ts',
        offeringId: 'offering_1',
        clientId: 'client_1',
        clientAddressId: null,
        slotReadinessCode: 'OUTSIDE_WORKING_HOURS',
        workingHoursError: 'That time is outside working hours.',
      },
    })

    expect(result).toEqual({
      ok: false,
      status: 400,
      error: 'That time is outside working hours.',
      code: 'OUTSIDE_WORKING_HOURS',
      retryable: true,
      uiAction: 'PICK_NEW_SLOT',
      message: 'That time is outside working hours.',
    })
  })

  it('logs BLOCKED and returns TIME_BLOCKED when blocked by calendar block', async () => {
    mocks.getTimeRangeConflict.mockResolvedValueOnce('BLOCKED')

    const result = await POST(
      makeRequest({
        offeringId: 'offering_1',
        scheduledFor: SLOT_START.toISOString(),
        locationType: 'SALON',
        locationId: 'loc_1',
      }),
    )

    expect(mocks.logBookingConflict).toHaveBeenCalledWith({
      action: 'BOOKING_CREATE',
      professionalId: 'pro_123',
      locationId: 'loc_1',
      locationType: ServiceLocationType.SALON,
      requestedStart: SLOT_START,
      requestedEnd: new Date('2026-03-17T14:45:00.000Z'),
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
      error: 'That time is blocked. Please choose another slot.',
      code: 'TIME_BLOCKED',
      retryable: true,
      uiAction: 'PICK_NEW_SLOT',
      message: 'Requested time is blocked.',
    })
  })

  it('logs BOOKING and returns TIME_BOOKED when blocked by existing booking', async () => {
    mocks.getTimeRangeConflict.mockResolvedValueOnce('BOOKING')

    const result = await POST(
      makeRequest({
        offeringId: 'offering_1',
        scheduledFor: SLOT_START.toISOString(),
        locationType: 'SALON',
        locationId: 'loc_1',
      }),
    )

    expect(mocks.logBookingConflict).toHaveBeenCalledWith({
      action: 'BOOKING_CREATE',
      professionalId: 'pro_123',
      locationId: 'loc_1',
      locationType: ServiceLocationType.SALON,
      requestedStart: SLOT_START,
      requestedEnd: new Date('2026-03-17T14:45:00.000Z'),
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
      error: 'That time was just taken. Please choose another slot.',
      code: 'TIME_BOOKED',
      retryable: true,
      uiAction: 'PICK_NEW_SLOT',
      message: 'Requested time already has a booking.',
    })
  })

  it('logs HOLD and returns TIME_HELD when blocked by active hold', async () => {
    mocks.getTimeRangeConflict.mockResolvedValueOnce('HOLD')

    const result = await POST(
      makeRequest({
        offeringId: 'offering_1',
        scheduledFor: SLOT_START.toISOString(),
        locationType: 'SALON',
        locationId: 'loc_1',
      }),
    )

    expect(mocks.logBookingConflict).toHaveBeenCalledWith({
      action: 'BOOKING_CREATE',
      professionalId: 'pro_123',
      locationId: 'loc_1',
      locationType: ServiceLocationType.SALON,
      requestedStart: SLOT_START,
      requestedEnd: new Date('2026-03-17T14:45:00.000Z'),
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
      error: 'Someone is already holding that time. Please try another slot.',
      code: 'TIME_HELD',
      retryable: true,
      uiAction: 'PICK_NEW_SLOT',
      message: 'Requested time is currently held.',
    })
  })

  it('returns CLIENT_SERVICE_ADDRESS_REQUIRED when mobile booking is missing client address id', async () => {
    const result = await POST(
      makeRequest({
        offeringId: 'offering_1',
        scheduledFor: SLOT_START.toISOString(),
        locationType: 'MOBILE',
        locationId: 'loc_1',
      }),
    )

    expect(result).toEqual({
      ok: false,
      status: 400,
      error: 'Add or select a mobile service address before booking this in-home appointment.',
      code: 'CLIENT_SERVICE_ADDRESS_REQUIRED',
      retryable: false,
      uiAction: 'ADD_SERVICE_ADDRESS',
      message: 'Client service address is required.',
    })
  })

  it('returns CLIENT_SERVICE_ADDRESS_INVALID when mobile selected address is invalid', async () => {
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
        scheduledFor: SLOT_START.toISOString(),
        locationType: 'MOBILE',
        locationId: 'loc_1',
        clientAddressId: 'addr_1',
      }),
    )

    expect(result).toEqual({
      ok: false,
      status: 400,
      error:
        'That service address is incomplete. Please update it before booking.',
      code: 'CLIENT_SERVICE_ADDRESS_INVALID',
      retryable: false,
      uiAction: 'ADD_SERVICE_ADDRESS',
      message: 'Client service address is invalid.',
    })
  })
})