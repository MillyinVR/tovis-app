import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Prisma, ServiceLocationType } from '@prisma/client'
import { NextRequest } from 'next/server'
import { BookingError, getBookingErrorDescriptor } from '@/lib/booking/errors'

const TEST_NOW = new Date('2026-03-17T12:55:00.000Z')
const SLOT_START = new Date('2026-03-17T13:30:00.000Z')
const HOLD_EXPIRES = new Date('2026-03-17T13:05:00.000Z')

const mocks = vi.hoisted(() => ({
  requireClient: vi.fn(),
  jsonFail: vi.fn(),
  jsonOk: vi.fn(),
  pickString: vi.fn(),

  professionalServiceOfferingFindUnique: vi.fn(),

  normalizeLocationType: vi.fn(),

  createHold: vi.fn(),
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

vi.mock('@/lib/booking/locationContext', () => ({
  normalizeLocationType: mocks.normalizeLocationType,
}))

vi.mock('@/lib/booking/writeBoundary', () => ({
  createHold: mocks.createHold,
}))

import { POST } from './route'

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

    mocks.createHold.mockResolvedValue({
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
      meta: {
        mutated: true,
        noOp: false,
      },
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('calls createHold with parsed values and returns hold payload', async () => {
    const result = await POST(
      makeRequest({
        offeringId: 'offering_1',
        scheduledFor: SLOT_START.toISOString(),
        locationType: 'SALON',
        locationId: 'loc_1',
      }),
    )

    expect(mocks.professionalServiceOfferingFindUnique).toHaveBeenCalledWith({
      where: { id: 'offering_1' },
      select: {
        id: true,
        isActive: true,
        professionalId: true,
        offersInSalon: true,
        offersMobile: true,
        salonDurationMinutes: true,
        mobileDurationMinutes: true,
        salonPriceStartingAt: true,
        mobilePriceStartingAt: true,
        professional: {
          select: {
            timeZone: true,
          },
        },
      },
    })

    expect(mocks.createHold).toHaveBeenCalledWith({
      clientId: 'client_1',
      offering: {
        id: 'offering_1',
        professionalId: 'pro_123',
        offersInSalon: true,
        offersMobile: true,
        salonDurationMinutes: 60,
        mobileDurationMinutes: 75,
        salonPriceStartingAt: new Prisma.Decimal('100.00'),
        mobilePriceStartingAt: new Prisma.Decimal('120.00'),
        professionalTimeZone: 'America/Los_Angeles',
      },
      requestedStart: SLOT_START,
      requestedLocationId: 'loc_1',
      locationType: ServiceLocationType.SALON,
      clientAddressId: null,
    })

    expect(mocks.jsonOk).toHaveBeenCalledWith(
      {
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
        meta: {
          mutated: true,
          noOp: false,
        },
      },
      201,
    )

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
        meta: {
          mutated: true,
          noOp: false,
        },
      },
    })
  })

  it('returns auth response when client auth fails', async () => {
    const authRes = { ok: false, status: 401, error: 'Unauthorized' }

    mocks.requireClient.mockResolvedValueOnce({
      ok: false,
      res: authRes,
    })

    const result = await POST(
      makeRequest({
        offeringId: 'offering_1',
        scheduledFor: SLOT_START.toISOString(),
        locationType: 'SALON',
      }),
    )

    expect(result).toBe(authRes)
    expect(mocks.professionalServiceOfferingFindUnique).not.toHaveBeenCalled()
    expect(mocks.createHold).not.toHaveBeenCalled()
  })

  it('returns OFFERING_ID_REQUIRED when offering id is missing', async () => {
    const descriptor = getBookingErrorDescriptor('OFFERING_ID_REQUIRED')

    const result = await POST(
      makeRequest({
        scheduledFor: SLOT_START.toISOString(),
        locationType: 'SALON',
      }),
    )

    expect(mocks.jsonFail).toHaveBeenCalledWith(
      descriptor.httpStatus,
      descriptor.userMessage,
      {
        code: descriptor.code,
        retryable: descriptor.retryable,
        uiAction: descriptor.uiAction,
        message: descriptor.message,
      },
    )

    expect(result).toEqual({
      ok: false,
      status: descriptor.httpStatus,
      error: descriptor.userMessage,
      code: descriptor.code,
      retryable: descriptor.retryable,
      uiAction: descriptor.uiAction,
      message: descriptor.message,
    })

    expect(mocks.createHold).not.toHaveBeenCalled()
  })

  it('returns invalid scheduled time when scheduledFor is missing', async () => {
    const result = await POST(
      makeRequest({
        offeringId: 'offering_1',
        locationType: 'SALON',
      }),
    )

    expect(result).toEqual({
      ok: false,
      status: 400,
      error: 'Missing scheduled time.',
      code: 'INVALID_SCHEDULED_FOR',
      retryable: false,
      uiAction: 'NONE',
      message: 'Scheduled time is required.',
    })

    expect(mocks.createHold).not.toHaveBeenCalled()
  })

  it('returns LOCATION_TYPE_REQUIRED when location type is missing', async () => {
    const descriptor = getBookingErrorDescriptor('LOCATION_TYPE_REQUIRED')

    const result = await POST(
      makeRequest({
        offeringId: 'offering_1',
        scheduledFor: SLOT_START.toISOString(),
      }),
    )

    expect(result).toEqual({
      ok: false,
      status: descriptor.httpStatus,
      error: descriptor.userMessage,
      code: descriptor.code,
      retryable: descriptor.retryable,
      uiAction: descriptor.uiAction,
      message: descriptor.message,
    })

    expect(mocks.createHold).not.toHaveBeenCalled()
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

    expect(mocks.createHold).not.toHaveBeenCalled()

    expect(result).toEqual({
      ok: false,
      status: 400,
      error:
        'Add or select a mobile service address before booking this in-home appointment.',
      code: 'CLIENT_SERVICE_ADDRESS_REQUIRED',
      retryable: false,
      uiAction: 'ADD_SERVICE_ADDRESS',
      message: 'Client service address is required.',
    })
  })

  it('returns INVALID_SCHEDULED_FOR when date is invalid', async () => {
    const descriptor = getBookingErrorDescriptor('INVALID_SCHEDULED_FOR')

    const result = await POST(
      makeRequest({
        offeringId: 'offering_1',
        scheduledFor: 'definitely-not-a-date',
        locationType: 'SALON',
      }),
    )

    expect(result).toEqual({
      ok: false,
      status: descriptor.httpStatus,
      error: descriptor.userMessage,
      code: descriptor.code,
      retryable: descriptor.retryable,
      uiAction: descriptor.uiAction,
      message: descriptor.message,
    })

    expect(mocks.createHold).not.toHaveBeenCalled()
  })

  it('returns TIME_IN_PAST when requested time is too soon', async () => {
    const descriptor = getBookingErrorDescriptor('TIME_IN_PAST')

    const result = await POST(
      makeRequest({
        offeringId: 'offering_1',
        scheduledFor: '2026-03-17T12:55:30.000Z',
        locationType: 'SALON',
      }),
    )

    expect(result).toEqual({
      ok: false,
      status: descriptor.httpStatus,
      error: descriptor.userMessage,
      code: descriptor.code,
      retryable: descriptor.retryable,
      uiAction: descriptor.uiAction,
      message: descriptor.message,
    })

    expect(mocks.createHold).not.toHaveBeenCalled()
  })

  it('returns OFFERING_NOT_FOUND when offering does not exist', async () => {
    const descriptor = getBookingErrorDescriptor('OFFERING_NOT_FOUND')

    mocks.professionalServiceOfferingFindUnique.mockResolvedValueOnce(null)

    const result = await POST(
      makeRequest({
        offeringId: 'missing_offering',
        scheduledFor: SLOT_START.toISOString(),
        locationType: 'SALON',
      }),
    )

    expect(result).toEqual({
      ok: false,
      status: descriptor.httpStatus,
      error: descriptor.userMessage,
      code: descriptor.code,
      retryable: descriptor.retryable,
      uiAction: descriptor.uiAction,
      message: descriptor.message,
    })

    expect(mocks.createHold).not.toHaveBeenCalled()
  })

  it('returns OFFERING_NOT_FOUND when offering is inactive', async () => {
    const descriptor = getBookingErrorDescriptor('OFFERING_NOT_FOUND')

    mocks.professionalServiceOfferingFindUnique.mockResolvedValueOnce({
      ...offering,
      isActive: false,
    })

    const result = await POST(
      makeRequest({
        offeringId: 'offering_1',
        scheduledFor: SLOT_START.toISOString(),
        locationType: 'SALON',
      }),
    )

    expect(result).toEqual({
      ok: false,
      status: descriptor.httpStatus,
      error: descriptor.userMessage,
      code: descriptor.code,
      retryable: descriptor.retryable,
      uiAction: descriptor.uiAction,
      message: descriptor.message,
    })

    expect(mocks.createHold).not.toHaveBeenCalled()
  })

  it('maps BookingError from createHold', async () => {
    const descriptor = getBookingErrorDescriptor('TIME_HELD')

    mocks.createHold.mockRejectedValueOnce(new BookingError('TIME_HELD'))

    const result = await POST(
      makeRequest({
        offeringId: 'offering_1',
        scheduledFor: SLOT_START.toISOString(),
        locationType: 'SALON',
        locationId: 'loc_1',
      }),
    )

    expect(result).toEqual({
      ok: false,
      status: descriptor.httpStatus,
      error: descriptor.userMessage,
      code: descriptor.code,
      retryable: descriptor.retryable,
      uiAction: descriptor.uiAction,
      message: descriptor.message,
    })
  })

  it('returns 500 when createHold throws a non-booking error', async () => {
    mocks.createHold.mockRejectedValueOnce(new Error('boom'))

    const result = await POST(
      makeRequest({
        offeringId: 'offering_1',
        scheduledFor: SLOT_START.toISOString(),
        locationType: 'SALON',
      }),
    )

    expect(mocks.jsonFail).toHaveBeenCalledWith(
      500,
      'Something went wrong while processing the booking.',
      {
        code: 'INTERNAL_ERROR',
        retryable: false,
        uiAction: 'CONTACT_SUPPORT',
        message: 'Internal booking error.',
      },
    )

    expect(result).toEqual({
      ok: false,
      status: 500,
      error: 'Something went wrong while processing the booking.',
      code: 'INTERNAL_ERROR',
      retryable: false,
      uiAction: 'CONTACT_SUPPORT',
      message: 'Internal booking error.',
    })
  })
})