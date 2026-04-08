import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  BookingSource,
  BookingStatus,
  NotificationEventKey,
  Prisma,
  ServiceLocationType,
} from '@prisma/client'
import { BookingError, getBookingErrorDescriptor } from '@/lib/booking/errors'

const HOLD_START = new Date('2026-03-11T19:30:00.000Z')
const NOW = new Date('2026-03-11T19:00:00.000Z')

const mocks = vi.hoisted(() => ({
  requireClient: vi.fn(),
  pickString: vi.fn((value: unknown) =>
    typeof value === 'string' && value.trim() ? value.trim() : null,
  ),
  jsonFail: vi.fn(),
  jsonOk: vi.fn(),

  professionalServiceOfferingFindUnique: vi.fn(),
  aftercareSummaryFindUnique: vi.fn(),

  finalizeBookingFromHold: vi.fn(),
  createProNotification: vi.fn(),
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
    professionalServiceOffering: {
      findUnique: mocks.professionalServiceOfferingFindUnique,
    },
    aftercareSummary: {
      findUnique: mocks.aftercareSummaryFindUnique,
    },
  },
}))

vi.mock('@/lib/notifications/proNotifications', () => ({
  createProNotification: mocks.createProNotification,
}))

vi.mock('@/lib/booking/locationContext', () => ({
  normalizeLocationType: (value: unknown) => {
    const normalized =
      typeof value === 'string' ? value.trim().toUpperCase() : ''
    if (normalized === 'SALON') return ServiceLocationType.SALON
    if (normalized === 'MOBILE') return ServiceLocationType.MOBILE
    return null
  },
}))

vi.mock('@/lib/booking/writeBoundary', () => ({
  finalizeBookingFromHold: mocks.finalizeBookingFromHold,
}))

import { POST } from './route'

function makeRequest(body: unknown): Request {
  return new Request('http://localhost/api/bookings/finalize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const offering = {
  id: 'offering_1',
  isActive: true,
  professionalId: 'pro_123',
  serviceId: 'service_1',
  offersInSalon: true,
  offersMobile: true,
  salonPriceStartingAt: new Prisma.Decimal('100'),
  salonDurationMinutes: 60,
  mobilePriceStartingAt: new Prisma.Decimal('120'),
  mobileDurationMinutes: 75,
  professional: {
    autoAcceptBookings: false,
    timeZone: 'America/Los_Angeles',
  },
}

describe('POST /api/bookings/finalize', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)

    vi.clearAllMocks()

    mocks.requireClient.mockResolvedValue({
      ok: true,
      clientId: 'client_1',
      user: { id: 'user_1' },
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

    mocks.professionalServiceOfferingFindUnique.mockResolvedValue(offering)
    mocks.aftercareSummaryFindUnique.mockResolvedValue(null)

    mocks.finalizeBookingFromHold.mockResolvedValue({
      booking: {
        id: 'booking_1',
        status: BookingStatus.PENDING,
        scheduledFor: HOLD_START,
        professionalId: 'pro_123',
      },
      meta: {
        mutated: true,
        noOp: false,
      },
    })

    mocks.createProNotification.mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns auth response when auth fails', async () => {
    const authRes = { ok: false, status: 401, error: 'Unauthorized' }
    mocks.requireClient.mockResolvedValueOnce({
      ok: false,
      res: authRes,
    })

    const result = await POST(
      makeRequest({
        offeringId: 'offering_1',
        holdId: 'hold_1',
        locationType: 'SALON',
      }),
    )

    expect(result).toBe(authRes)
    expect(mocks.professionalServiceOfferingFindUnique).not.toHaveBeenCalled()
    expect(mocks.finalizeBookingFromHold).not.toHaveBeenCalled()
  })

  it('returns LOCATION_TYPE_REQUIRED when locationType is missing', async () => {
    const descriptor = getBookingErrorDescriptor('LOCATION_TYPE_REQUIRED')

    const result = await POST(
      makeRequest({
        offeringId: 'offering_1',
        holdId: 'hold_1',
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
  })

  it('returns OFFERING_ID_REQUIRED when offeringId is missing', async () => {
    const descriptor = getBookingErrorDescriptor('OFFERING_ID_REQUIRED')

    const result = await POST(
      makeRequest({
        holdId: 'hold_1',
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

    expect(mocks.finalizeBookingFromHold).not.toHaveBeenCalled()
  })

  it('returns HOLD_ID_REQUIRED when holdId is missing', async () => {
    const descriptor = getBookingErrorDescriptor('HOLD_ID_REQUIRED')

    const result = await POST(
      makeRequest({
        offeringId: 'offering_1',
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

    expect(mocks.finalizeBookingFromHold).not.toHaveBeenCalled()
  })

  it('returns ADDONS_INVALID when addOnIds contains duplicates', async () => {
    const descriptor = getBookingErrorDescriptor('ADDONS_INVALID')

    const result = await POST(
      makeRequest({
        offeringId: 'offering_1',
        holdId: 'hold_1',
        locationType: 'SALON',
        addOnIds: ['addon_1', 'addon_1'],
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

    expect(mocks.finalizeBookingFromHold).not.toHaveBeenCalled()
  })

  it('returns MISSING_MEDIA_ID when source is discovery without mediaId', async () => {
    const descriptor = getBookingErrorDescriptor('MISSING_MEDIA_ID')

    const result = await POST(
      makeRequest({
        offeringId: 'offering_1',
        holdId: 'hold_1',
        locationType: 'SALON',
        source: 'DISCOVERY',
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

    expect(mocks.finalizeBookingFromHold).not.toHaveBeenCalled()
  })

  it('returns OFFERING_NOT_FOUND when offering is missing', async () => {
    const descriptor = getBookingErrorDescriptor('OFFERING_NOT_FOUND')
    mocks.professionalServiceOfferingFindUnique.mockResolvedValueOnce(null)

    const result = await POST(
      makeRequest({
        offeringId: 'missing_offering',
        holdId: 'hold_1',
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

    expect(mocks.finalizeBookingFromHold).not.toHaveBeenCalled()
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
        holdId: 'hold_1',
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

    expect(mocks.finalizeBookingFromHold).not.toHaveBeenCalled()
  })

  it('returns AFTERCARE_TOKEN_MISSING when source is aftercare without token', async () => {
    const descriptor = getBookingErrorDescriptor('AFTERCARE_TOKEN_MISSING')

    const result = await POST(
      makeRequest({
        offeringId: 'offering_1',
        holdId: 'hold_1',
        locationType: 'SALON',
        source: 'AFTERCARE',
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

    expect(mocks.finalizeBookingFromHold).not.toHaveBeenCalled()
  })

  it('returns AFTERCARE_TOKEN_INVALID when token does not resolve', async () => {
    const descriptor = getBookingErrorDescriptor('AFTERCARE_TOKEN_INVALID')
    mocks.aftercareSummaryFindUnique.mockResolvedValueOnce(null)

    const result = await POST(
      makeRequest({
        offeringId: 'offering_1',
        holdId: 'hold_1',
        locationType: 'SALON',
        source: 'AFTERCARE',
        aftercareToken: 'bad_token',
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

    expect(mocks.finalizeBookingFromHold).not.toHaveBeenCalled()
  })

  it('returns AFTERCARE_NOT_COMPLETED when aftercare booking is not completed', async () => {
    const descriptor = getBookingErrorDescriptor('AFTERCARE_NOT_COMPLETED')
    mocks.aftercareSummaryFindUnique.mockResolvedValueOnce({
      booking: {
        id: 'booking_old',
        status: BookingStatus.PENDING,
        clientId: 'client_1',
        professionalId: 'pro_123',
        serviceId: 'service_1',
        offeringId: 'offering_1',
      },
    })

    const result = await POST(
      makeRequest({
        offeringId: 'offering_1',
        holdId: 'hold_1',
        locationType: 'SALON',
        source: 'AFTERCARE',
        aftercareToken: 'token_1',
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

  it('returns AFTERCARE_CLIENT_MISMATCH when aftercare booking belongs to another client', async () => {
    const descriptor = getBookingErrorDescriptor('AFTERCARE_CLIENT_MISMATCH')
    mocks.aftercareSummaryFindUnique.mockResolvedValueOnce({
      booking: {
        id: 'booking_old',
        status: BookingStatus.COMPLETED,
        clientId: 'client_other',
        professionalId: 'pro_123',
        serviceId: 'service_1',
        offeringId: 'offering_1',
      },
    })

    const result = await POST(
      makeRequest({
        offeringId: 'offering_1',
        holdId: 'hold_1',
        locationType: 'SALON',
        source: 'AFTERCARE',
        aftercareToken: 'token_1',
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

  it('returns AFTERCARE_OFFERING_MISMATCH when aftercare booking does not match offering', async () => {
    const descriptor = getBookingErrorDescriptor('AFTERCARE_OFFERING_MISMATCH')
    mocks.aftercareSummaryFindUnique.mockResolvedValueOnce({
      booking: {
        id: 'booking_old',
        status: BookingStatus.COMPLETED,
        clientId: 'client_1',
        professionalId: 'pro_other',
        serviceId: 'service_other',
        offeringId: 'offering_other',
      },
    })

    const result = await POST(
      makeRequest({
        offeringId: 'offering_1',
        holdId: 'hold_1',
        locationType: 'SALON',
        source: 'AFTERCARE',
        aftercareToken: 'token_1',
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

  it('calls finalizeBookingFromHold with normalized args', async () => {
    mocks.aftercareSummaryFindUnique.mockResolvedValueOnce({
      booking: {
        id: 'booking_old',
        status: BookingStatus.COMPLETED,
        clientId: 'client_1',
        professionalId: 'pro_123',
        serviceId: 'service_1',
        offeringId: 'offering_1',
      },
    })

    await POST(
      makeRequest({
        offeringId: 'offering_1',
        holdId: 'hold_1',
        openingId: 'opening_1',
        locationType: 'SALON',
        source: 'AFTERCARE',
        aftercareToken: 'token_1',
        rebookOfBookingId: 'booking_old',
        addOnIds: ['addon_1', 'addon_2'],
      }),
    )

    expect(mocks.finalizeBookingFromHold).toHaveBeenCalledWith({
      clientId: 'client_1',
      holdId: 'hold_1',
      openingId: 'opening_1',
      addOnIds: ['addon_1', 'addon_2'],
      locationType: ServiceLocationType.SALON,
      source: BookingSource.AFTERCARE,
      initialStatus: BookingStatus.PENDING,
      rebookOfBookingId: 'booking_old',
      offering: {
        id: 'offering_1',
        professionalId: 'pro_123',
        serviceId: 'service_1',
        offersInSalon: true,
        offersMobile: true,
        salonPriceStartingAt: new Prisma.Decimal('100'),
        salonDurationMinutes: 60,
        mobilePriceStartingAt: new Prisma.Decimal('120'),
        mobileDurationMinutes: 75,
        professionalTimeZone: 'America/Los_Angeles',
      },
      fallbackTimeZone: 'UTC',
    })
  })

  it('creates the booking through the boundary and notifies the pro when valid', async () => {
    const result = await POST(
      makeRequest({
        offeringId: 'offering_1',
        holdId: 'hold_1',
        locationType: 'SALON',
        source: 'REQUESTED',
      }),
    )

    expect(mocks.finalizeBookingFromHold).toHaveBeenCalledWith({
      clientId: 'client_1',
      holdId: 'hold_1',
      openingId: null,
      addOnIds: [],
      locationType: ServiceLocationType.SALON,
      source: BookingSource.REQUESTED,
      initialStatus: BookingStatus.PENDING,
      rebookOfBookingId: null,
      offering: {
        id: 'offering_1',
        professionalId: 'pro_123',
        serviceId: 'service_1',
        offersInSalon: true,
        offersMobile: true,
        salonPriceStartingAt: new Prisma.Decimal('100'),
        salonDurationMinutes: 60,
        mobilePriceStartingAt: new Prisma.Decimal('120'),
        mobileDurationMinutes: 75,
        professionalTimeZone: 'America/Los_Angeles',
      },
      fallbackTimeZone: 'UTC',
    })

    expect(mocks.createProNotification).toHaveBeenCalledWith({
      professionalId: 'pro_123',
      eventKey: NotificationEventKey.BOOKING_REQUEST_CREATED,
      title: 'New booking request',
      body: '',
      href: '/pro/bookings/booking_1',
      actorUserId: 'user_1',
      bookingId: 'booking_1',
      dedupeKey: 'PRO_NOTIF:BOOKING_REQUEST_CREATED:booking_1',
      data: {
        bookingId: 'booking_1',
        bookingStatus: BookingStatus.PENDING,
        source: BookingSource.REQUESTED,
        locationType: ServiceLocationType.SALON,
      },
    })

    expect(result).toEqual({
      ok: true,
      status: 201,
      data: {
        booking: {
          id: 'booking_1',
          status: BookingStatus.PENDING,
          scheduledFor: HOLD_START,
          professionalId: 'pro_123',
        },
        meta: {
          mutated: true,
          noOp: false,
        },
      },
    })
  })

  it('uses booking confirmed event when booking is auto-confirmed', async () => {
    mocks.professionalServiceOfferingFindUnique.mockResolvedValueOnce({
      ...offering,
      professional: {
        autoAcceptBookings: true,
        timeZone: 'America/Los_Angeles',
      },
    })

    mocks.finalizeBookingFromHold.mockResolvedValueOnce({
      booking: {
        id: 'booking_1',
        status: BookingStatus.ACCEPTED,
        scheduledFor: HOLD_START,
        professionalId: 'pro_123',
      },
      meta: {
        mutated: true,
        noOp: false,
      },
    })

    await POST(
      makeRequest({
        offeringId: 'offering_1',
        holdId: 'hold_1',
        locationType: 'SALON',
      }),
    )

    expect(mocks.createProNotification).toHaveBeenCalledWith({
      professionalId: 'pro_123',
      eventKey: NotificationEventKey.BOOKING_CONFIRMED,
      title: 'New booking confirmed',
      body: '',
      href: '/pro/bookings/booking_1',
      actorUserId: 'user_1',
      bookingId: 'booking_1',
      dedupeKey: 'PRO_NOTIF:BOOKING_CONFIRMED:booking_1',
      data: {
        bookingId: 'booking_1',
        bookingStatus: BookingStatus.ACCEPTED,
        source: BookingSource.REQUESTED,
        locationType: ServiceLocationType.SALON,
      },
    })
  })

  it('maps BookingError from finalizeBookingFromHold', async () => {
    const descriptor = getBookingErrorDescriptor('TIME_HELD')

    mocks.finalizeBookingFromHold.mockRejectedValueOnce(
      new BookingError('TIME_HELD'),
    )

    const result = await POST(
      makeRequest({
        offeringId: 'offering_1',
        holdId: 'hold_1',
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
  })

  it('returns internal error for unexpected failures', async () => {
    mocks.finalizeBookingFromHold.mockRejectedValueOnce(new Error('boom'))

    const result = await POST(
      makeRequest({
        offeringId: 'offering_1',
        holdId: 'hold_1',
        locationType: 'SALON',
      }),
    )

    expect(result).toEqual({
      ok: false,
      status: 500,
      error: 'Internal server error',
      code: 'INTERNAL_ERROR',
      retryable: false,
      uiAction: 'CONTACT_SUPPORT',
      message: 'boom',
    })
  })
})