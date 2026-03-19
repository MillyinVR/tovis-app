import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  BookingServiceItemType,
  BookingSource,
  BookingStatus,
  NotificationType,
  Prisma,
  ServiceLocationType,
} from '@prisma/client'

const mocks = vi.hoisted(() => ({
  requireClient: vi.fn(),
  pickString: vi.fn((value: unknown) =>
    typeof value === 'string' && value.trim() ? value.trim() : null,
  ),
  jsonFail: vi.fn(),
  jsonOk: vi.fn(),

  professionalServiceOfferingFindUnique: vi.fn(),
  aftercareSummaryFindUnique: vi.fn(),

  bookingHoldFindUnique: vi.fn(),
  clientAddressFindFirst: vi.fn(),
  lastMinuteOpeningFindFirst: vi.fn(),
  lastMinuteOpeningUpdateMany: vi.fn(),
  offeringAddOnFindMany: vi.fn(),
  professionalServiceOfferingFindMany: vi.fn(),
  bookingCreate: vi.fn(),
  bookingServiceItemCreate: vi.fn(),
  bookingServiceItemCreateMany: vi.fn(),
  openingNotificationUpdateMany: vi.fn(),
  bookingHoldDelete: vi.fn(),

  createProNotification: vi.fn(),
  getTimeRangeConflict: vi.fn(),
  logBookingConflict: vi.fn(),
  resolveValidatedBookingContext: vi.fn(),
  checkSlotReadiness: vi.fn(),
  withLockedProfessionalTransaction: vi.fn(),
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
      findMany: mocks.professionalServiceOfferingFindMany,
    },
    aftercareSummary: {
      findUnique: mocks.aftercareSummaryFindUnique,
    },
  },
}))

vi.mock('@/lib/notifications/proNotifications', () => ({
  createProNotification: mocks.createProNotification,
}))

vi.mock('@/lib/booking/conflictQueries', () => ({
  getTimeRangeConflict: mocks.getTimeRangeConflict,
}))

vi.mock('@/lib/booking/conflictLogging', () => ({
  logBookingConflict: mocks.logBookingConflict,
}))

vi.mock('@/lib/booking/locationContext', () => ({
  normalizeLocationType: (value: unknown) => {
    const normalized =
      typeof value === 'string' ? value.trim().toUpperCase() : ''
    if (normalized === 'SALON') return ServiceLocationType.SALON
    if (normalized === 'MOBILE') return ServiceLocationType.MOBILE
    return null
  },
  resolveValidatedBookingContext: mocks.resolveValidatedBookingContext,
}))

vi.mock('@/lib/booking/slotReadiness', () => ({
  checkSlotReadiness: mocks.checkSlotReadiness,
}))

vi.mock('@/lib/booking/scheduleTransaction', () => ({
  withLockedProfessionalTransaction: mocks.withLockedProfessionalTransaction,
}))

vi.mock('@/lib/timeZone', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/timeZone')>()
  return {
    ...actual,
    DEFAULT_TIME_ZONE: 'UTC',
  }
})

vi.mock('@/lib/booking/snapshots', () => ({
  buildAddressSnapshot: (formattedAddress: string) => ({ formattedAddress }),
  decimalFromUnknown: (value: unknown) => {
    const raw =
      typeof value === 'number'
        ? value
        : typeof value === 'string'
          ? Number(value)
          : value instanceof Prisma.Decimal
            ? Number(value.toString())
            : 0

    return new Prisma.Decimal(String(Number.isFinite(raw) ? raw : 0))
  },
  decimalToNumber: (value: unknown) => {
    if (typeof value === 'number' && Number.isFinite(value)) return value
    if (value instanceof Prisma.Decimal) return Number(value.toString())
    return null
  },
  pickFormattedAddressFromSnapshot: (value: unknown) => {
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
  },
}))

import { POST } from './route'

const tx = {
  bookingHold: {
    findUnique: mocks.bookingHoldFindUnique,
    delete: mocks.bookingHoldDelete,
  },
  clientAddress: {
    findFirst: mocks.clientAddressFindFirst,
  },
  lastMinuteOpening: {
    findFirst: mocks.lastMinuteOpeningFindFirst,
    updateMany: mocks.lastMinuteOpeningUpdateMany,
  },
  offeringAddOn: {
    findMany: mocks.offeringAddOnFindMany,
  },
  professionalServiceOffering: {
    findMany: mocks.professionalServiceOfferingFindMany,
  },
  booking: {
    create: mocks.bookingCreate,
  },
  bookingServiceItem: {
    create: mocks.bookingServiceItemCreate,
    createMany: mocks.bookingServiceItemCreateMany,
  },
  openingNotification: {
    updateMany: mocks.openingNotificationUpdateMany,
  },
}

function makeRequest(body: unknown): Request {
  return new Request('http://localhost/api/bookings/finalize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/bookings/finalize', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-11T19:00:00.000Z'))

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

    mocks.professionalServiceOfferingFindUnique.mockResolvedValue({
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
    })

    mocks.aftercareSummaryFindUnique.mockResolvedValue(null)

    mocks.withLockedProfessionalTransaction.mockImplementation(
      async (
        _professionalId: string,
        callback: (args: { tx: typeof tx; now: Date }) => Promise<unknown>,
      ) => callback({ tx, now: new Date('2026-03-11T19:00:00.000Z') }),
    )

    mocks.bookingHoldFindUnique.mockResolvedValue({
      id: 'hold_1',
      offeringId: 'offering_1',
      professionalId: 'pro_123',
      clientId: 'client_1',
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
    })

    mocks.clientAddressFindFirst.mockResolvedValue({ id: 'addr_1' })
    mocks.lastMinuteOpeningFindFirst.mockResolvedValue(null)
    mocks.lastMinuteOpeningUpdateMany.mockResolvedValue({ count: 1 })
    mocks.offeringAddOnFindMany.mockResolvedValue([])
    mocks.professionalServiceOfferingFindMany.mockResolvedValue([])

    mocks.bookingCreate.mockResolvedValue({
      id: 'booking_1',
      status: BookingStatus.PENDING,
      scheduledFor: new Date('2026-03-11T19:30:00.000Z'),
      professionalId: 'pro_123',
    })

    mocks.bookingServiceItemCreate.mockResolvedValue({ id: 'item_base_1' })
    mocks.bookingServiceItemCreateMany.mockResolvedValue({ count: 0 })
    mocks.openingNotificationUpdateMany.mockResolvedValue({ count: 0 })
    mocks.bookingHoldDelete.mockResolvedValue({ id: 'hold_1' })

    mocks.resolveValidatedBookingContext.mockResolvedValue({
      ok: true,
      durationMinutes: 60,
      priceStartingAt: new Prisma.Decimal('100'),
      context: {
        locationId: 'loc_1',
        location: {
          id: 'loc_1',
        },
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

    mocks.checkSlotReadiness.mockReturnValue({
      ok: true,
      startUtc: new Date('2026-03-11T19:30:00.000Z'),
      endUtc: new Date('2026-03-11T20:45:00.000Z'),
      timeZone: 'America/Los_Angeles',
      stepMinutes: 15,
      durationMinutes: 60,
      bufferMinutes: 15,
    })

    mocks.getTimeRangeConflict.mockResolvedValue(null)
    mocks.createProNotification.mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns LOCATION_TYPE_REQUIRED when locationType is missing', async () => {
    const result = await POST(
      makeRequest({
        offeringId: 'offering_1',
        holdId: 'hold_1',
      }),
    )

    expect(mocks.jsonFail).toHaveBeenCalledWith(400, 'Missing location type.', {
      code: 'LOCATION_TYPE_REQUIRED',
      retryable: false,
      uiAction: 'NONE',
      message: 'Location type is required.',
    })

    expect(result).toEqual({
      ok: false,
      status: 400,
      error: 'Missing location type.',
      code: 'LOCATION_TYPE_REQUIRED',
      retryable: false,
      uiAction: 'NONE',
      message: 'Location type is required.',
    })
  })

  it('returns HOLD_EXPIRED when the hold is expired', async () => {
    mocks.bookingHoldFindUnique.mockResolvedValueOnce({
      id: 'hold_1',
      offeringId: 'offering_1',
      professionalId: 'pro_123',
      clientId: 'client_1',
      scheduledFor: new Date('2026-03-11T19:30:00.000Z'),
      expiresAt: new Date('2000-01-01T00:00:00.000Z'),
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
    })

    const result = await POST(
      makeRequest({
        offeringId: 'offering_1',
        holdId: 'hold_1',
        locationType: 'SALON',
      }),
    )

    expect(mocks.jsonFail).toHaveBeenCalledWith(
      409,
      'That hold expired. Please pick a new slot.',
      {
        code: 'HOLD_EXPIRED',
        retryable: true,
        uiAction: 'PICK_NEW_SLOT',
        message: 'Hold expired.',
      },
    )

    expect(result).toEqual({
      ok: false,
      status: 409,
      error: 'That hold expired. Please pick a new slot.',
      code: 'HOLD_EXPIRED',
      retryable: true,
      uiAction: 'PICK_NEW_SLOT',
      message: 'Hold expired.',
    })
  })

  it('logs STEP_BOUNDARY and returns STEP_MISMATCH when the held time is off step', async () => {
    mocks.bookingHoldFindUnique.mockResolvedValueOnce({
      id: 'hold_1',
      offeringId: 'offering_1',
      professionalId: 'pro_123',
      clientId: 'client_1',
      scheduledFor: new Date('2026-03-11T19:37:00.000Z'),
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
    })

    mocks.resolveValidatedBookingContext.mockResolvedValueOnce({
      ok: true,
      durationMinutes: 60,
      priceStartingAt: new Prisma.Decimal('100'),
      context: {
        locationId: 'loc_1',
        location: { id: 'loc_1' },
        timeZone: 'America/Los_Angeles',
        workingHours: {
          wed: { enabled: true, start: '09:00', end: '18:00' },
        },
        stepMinutes: 30,
        advanceNoticeMinutes: 0,
        maxDaysAhead: 30,
        bufferMinutes: 15,
        formattedAddress: '123 Salon St',
        lat: 34.05,
        lng: -118.25,
      },
    })

    mocks.checkSlotReadiness.mockReturnValueOnce({
      ok: false,
      code: 'STEP_MISMATCH',
      meta: {},
    })

    const result = await POST(
      makeRequest({
        offeringId: 'offering_1',
        holdId: 'hold_1',
        locationType: 'SALON',
      }),
    )

    expect(mocks.logBookingConflict).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'BOOKING_FINALIZE',
        professionalId: 'pro_123',
        locationId: 'loc_1',
        locationType: ServiceLocationType.SALON,
        requestedStart: new Date('2026-03-11T19:37:00.000Z'),
        requestedEnd: new Date('2026-03-11T19:38:00.000Z'),
        meta: expect.objectContaining({
          route: 'app/api/bookings/finalize/route.ts',
          stepMinutes: 30,
        }),
      }),
    )

    expect(mocks.jsonFail).toHaveBeenCalledWith(
      400,
      'Start time must be on a 30-minute boundary.',
      {
        code: 'STEP_MISMATCH',
        retryable: true,
        uiAction: 'PICK_NEW_SLOT',
        message: 'Start time must be on a 30-minute boundary.',
      },
    )

    expect(result).toEqual({
      ok: false,
      status: 400,
      error: 'Start time must be on a 30-minute boundary.',
      code: 'STEP_MISMATCH',
      retryable: true,
      uiAction: 'PICK_NEW_SLOT',
      message: 'Start time must be on a 30-minute boundary.',
    })
  })

  it('logs BLOCKED and returns TIME_BLOCKED when blocked by calendar block', async () => {
    mocks.getTimeRangeConflict.mockResolvedValueOnce('BLOCKED')

    const result = await POST(
      makeRequest({
        offeringId: 'offering_1',
        holdId: 'hold_1',
        locationType: 'SALON',
      }),
    )

    expect(mocks.logBookingConflict).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'BOOKING_FINALIZE',
        professionalId: 'pro_123',
        locationId: 'loc_1',
        locationType: ServiceLocationType.SALON,
        requestedStart: new Date('2026-03-11T19:30:00.000Z'),
        requestedEnd: new Date('2026-03-11T20:45:00.000Z'),
        conflictType: 'BLOCKED',
        holdId: 'hold_1',
        meta: expect.objectContaining({
          route: 'app/api/bookings/finalize/route.ts',
        }),
      }),
    )

    expect(mocks.jsonFail).toHaveBeenCalledWith(
      409,
      'That time is blocked. Please choose another slot.',
      {
        code: 'TIME_BLOCKED',
        retryable: true,
        uiAction: 'PICK_NEW_SLOT',
        message: 'Requested time is blocked.',
      },
    )

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
        holdId: 'hold_1',
        locationType: 'SALON',
      }),
    )

    expect(mocks.logBookingConflict).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'BOOKING_FINALIZE',
        professionalId: 'pro_123',
        locationId: 'loc_1',
        locationType: ServiceLocationType.SALON,
        requestedStart: new Date('2026-03-11T19:30:00.000Z'),
        requestedEnd: new Date('2026-03-11T20:45:00.000Z'),
        conflictType: 'BOOKING',
        holdId: 'hold_1',
        meta: expect.objectContaining({
          route: 'app/api/bookings/finalize/route.ts',
        }),
      }),
    )

    expect(mocks.jsonFail).toHaveBeenCalledWith(
      409,
      'That time was just taken. Please choose another slot.',
      {
        code: 'TIME_BOOKED',
        retryable: true,
        uiAction: 'PICK_NEW_SLOT',
        message: 'Requested time already has a booking.',
      },
    )

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

  it('logs HOLD and returns TIME_HELD when blocked by existing hold', async () => {
    mocks.getTimeRangeConflict.mockResolvedValueOnce('HOLD')

    const result = await POST(
      makeRequest({
        offeringId: 'offering_1',
        holdId: 'hold_1',
        locationType: 'SALON',
      }),
    )

    expect(mocks.logBookingConflict).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'BOOKING_FINALIZE',
        professionalId: 'pro_123',
        locationId: 'loc_1',
        locationType: ServiceLocationType.SALON,
        requestedStart: new Date('2026-03-11T19:30:00.000Z'),
        requestedEnd: new Date('2026-03-11T20:45:00.000Z'),
        conflictType: 'HOLD',
        holdId: 'hold_1',
        meta: expect.objectContaining({
          route: 'app/api/bookings/finalize/route.ts',
        }),
      }),
    )

    expect(mocks.jsonFail).toHaveBeenCalledWith(
      409,
      'Someone is already holding that time. Please try another slot.',
      {
        code: 'TIME_HELD',
        retryable: true,
        uiAction: 'PICK_NEW_SLOT',
        message: 'Requested time is currently held.',
      },
    )

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

  it('creates the booking, deletes the hold, and notifies the pro when valid', async () => {
    const result = await POST(
      makeRequest({
        offeringId: 'offering_1',
        holdId: 'hold_1',
        locationType: 'SALON',
        source: 'REQUESTED',
      }),
    )

    expect(mocks.withLockedProfessionalTransaction).toHaveBeenCalledWith(
      'pro_123',
      expect.any(Function),
    )

    expect(mocks.checkSlotReadiness).toHaveBeenCalled()
    expect(mocks.bookingCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        clientId: 'client_1',
        professionalId: 'pro_123',
        serviceId: 'service_1',
        offeringId: 'offering_1',
        locationType: ServiceLocationType.SALON,
        locationId: 'loc_1',
        locationTimeZone: 'America/Los_Angeles',
        totalDurationMinutes: 60,
        bufferMinutes: 15,
        status: BookingStatus.PENDING,
        source: BookingSource.REQUESTED,
      }),
      select: {
        id: true,
        status: true,
        scheduledFor: true,
        professionalId: true,
      },
    })

    expect(mocks.bookingServiceItemCreate).toHaveBeenCalledWith({
      data: {
        bookingId: 'booking_1',
        serviceId: 'service_1',
        offeringId: 'offering_1',
        itemType: BookingServiceItemType.BASE,
        priceSnapshot: new Prisma.Decimal('100'),
        durationMinutesSnapshot: 60,
        sortOrder: 0,
      },
      select: { id: true },
    })

    expect(mocks.bookingHoldDelete).toHaveBeenCalledWith({
      where: { id: 'hold_1' },
    })

    expect(mocks.createProNotification).toHaveBeenCalledWith({
      professionalId: 'pro_123',
      type: NotificationType.BOOKING_REQUEST,
      title: 'New booking request',
      body: '',
      href: '/pro/bookings/booking_1',
      actorUserId: 'user_1',
      bookingId: 'booking_1',
      dedupeKey: 'PRO_NOTIF:BOOKING_REQUEST:booking_1',
    })

    expect(mocks.logBookingConflict).not.toHaveBeenCalled()

    expect(result).toEqual({
      ok: true,
      status: 201,
      data: {
        booking: {
          id: 'booking_1',
          status: BookingStatus.PENDING,
          scheduledFor: new Date('2026-03-11T19:30:00.000Z'),
          professionalId: 'pro_123',
        },
      },
    })
  })
})