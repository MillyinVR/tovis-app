import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  AftercareRebookMode,
  BookingSource,
  BookingStatus,
  NotificationEventKey,
  Prisma,
  ServiceLocationType,
} from '@prisma/client'
import { BookingError, getBookingErrorDescriptor } from '@/lib/booking/errors'

const HOLD_START = new Date('2026-03-11T19:30:00.000Z')
const NOW = new Date('2026-03-11T19:00:00.000Z')

const IDEMPOTENCY_ROUTE = 'POST /api/bookings/finalize'

const mocks = vi.hoisted(() => ({
  requireClient: vi.fn(),
  pickString: vi.fn((value: unknown) =>
    typeof value === 'string' && value.trim() ? value.trim() : null,
  ),
  jsonFail: vi.fn(),
  jsonOk: vi.fn(),

  professionalServiceOfferingFindUnique: vi.fn(),
  resolveAftercareAccessByToken: vi.fn(),

  finalizeBookingFromHold: vi.fn(),
  createProNotification: vi.fn(),

  beginIdempotency: vi.fn(),
  completeIdempotency: vi.fn(),
  failIdempotency: vi.fn(),
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

vi.mock('@/lib/aftercare/unclaimedAftercareAccess', () => ({
  resolveAftercareAccessByToken: mocks.resolveAftercareAccessByToken,
}))

vi.mock('@/lib/idempotency', () => ({
  beginIdempotency: mocks.beginIdempotency,
  completeIdempotency: mocks.completeIdempotency,
  failIdempotency: mocks.failIdempotency,
  IDEMPOTENCY_ROUTES: {
    BOOKING_FINALIZE: 'POST /api/bookings/finalize',
  },
}))

import { POST } from './route'

function makeJsonResponse(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'content-type': 'application/json',
    },
  })
}

function makeRequest(
  body: unknown,
  headers?: Record<string, string>,
): Request {
  return new Request('http://localhost/api/bookings/finalize', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(headers ?? {}),
    },
    body: JSON.stringify(body),
  })
}

function makeIdempotentRequest(
  body: unknown,
  key = 'idem_finalize_1',
): Request {
  return makeRequest(body, {
    'idempotency-key': key,
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

function makeResolvedAftercareAccess(overrides?: {
  status?: BookingStatus
  clientId?: string
  professionalId?: string
  serviceId?: string
  offeringId?: string | null
}) {
  return {
    accessSource: 'clientActionToken' as const,
    token: {
      id: 'token_row_1',
      expiresAt: new Date('2026-03-20T19:00:00.000Z'),
      firstUsedAt: null,
      lastUsedAt: null,
      useCount: 0,
      singleUse: false,
    },
    aftercare: {
      id: 'aftercare_1',
      bookingId: 'booking_old',
      notes: 'Aftercare note',
      rebookMode: AftercareRebookMode.BOOKED_NEXT_APPOINTMENT,
      rebookedFor: new Date('2026-04-01T19:00:00.000Z'),
      rebookWindowStart: null,
      rebookWindowEnd: null,
      publicToken: 'legacy_public_token_should_not_drive_contract',
      draftSavedAt: new Date('2026-03-11T18:00:00.000Z'),
      sentToClientAt: new Date('2026-03-11T18:30:00.000Z'),
      lastEditedAt: new Date('2026-03-11T18:15:00.000Z'),
      version: 2,
    },
    booking: {
      id: 'booking_old',
      clientId: overrides?.clientId ?? 'client_1',
      professionalId: overrides?.professionalId ?? 'pro_123',
      serviceId: overrides?.serviceId ?? 'service_1',
      offeringId:
        overrides && 'offeringId' in overrides
          ? (overrides.offeringId ?? null)
          : 'offering_1',
      status: overrides?.status ?? BookingStatus.COMPLETED,
      scheduledFor: HOLD_START,
      locationType: ServiceLocationType.SALON,
      locationId: 'loc_1',
      totalDurationMinutes: 60,
      subtotalSnapshot: new Prisma.Decimal('100.00'),
      service: {
        id: 'service_1',
        name: 'Haircut',
      },
      professional: {
        id: 'pro_123',
        businessName: 'TOVIS Studio',
        timeZone: 'America/Los_Angeles',
        location: null,
      },
    },
  }
}

function expectBookingFailPayload(
  responseBody: unknown,
  code: Parameters<typeof getBookingErrorDescriptor>[0],
  overrides?: {
    error?: string
    message?: string
  },
) {
  const descriptor = getBookingErrorDescriptor(code)

  expect(responseBody).toEqual({
    ok: false,
    error: overrides?.error ?? descriptor.userMessage,
    code: descriptor.code,
    retryable: descriptor.retryable,
    uiAction: descriptor.uiAction,
    message: overrides?.message ?? descriptor.message,
  })
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
      (status: number, error: string, extra?: Record<string, unknown>) =>
        makeJsonResponse(status, {
          ok: false,
          error,
          ...(extra ?? {}),
        }),
    )

    mocks.jsonOk.mockImplementation(
      (data: Record<string, unknown>, status = 200) =>
        makeJsonResponse(status, {
          ok: true,
          ...(data ?? {}),
        }),
    )

    mocks.professionalServiceOfferingFindUnique.mockResolvedValue(offering)

    mocks.resolveAftercareAccessByToken.mockResolvedValue(
      makeResolvedAftercareAccess(),
    )

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

    mocks.beginIdempotency.mockImplementation(
      async (args: { key: string | null }) => {
        const key = args.key?.trim()
        if (!key) return { kind: 'missing_key' }

        return {
          kind: 'started',
          idempotencyRecordId: 'idem_record_1',
          requestHash: 'hash_1',
        }
      },
    )

    mocks.completeIdempotency.mockResolvedValue(undefined)
    mocks.failIdempotency.mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns LOCATION_TYPE_REQUIRED when locationType is missing', async () => {
    const descriptor = getBookingErrorDescriptor('LOCATION_TYPE_REQUIRED')

    const result = await POST(
      makeRequest({
        offeringId: 'offering_1',
        holdId: 'hold_1',
      }),
    )

    expect(result.status).toBe(descriptor.httpStatus)
    expectBookingFailPayload(await result.json(), 'LOCATION_TYPE_REQUIRED')

    expect(mocks.professionalServiceOfferingFindUnique).not.toHaveBeenCalled()
    expect(mocks.requireClient).not.toHaveBeenCalled()
    expect(mocks.beginIdempotency).not.toHaveBeenCalled()
  })

  it('returns OFFERING_ID_REQUIRED when offeringId is missing', async () => {
    const descriptor = getBookingErrorDescriptor('OFFERING_ID_REQUIRED')

    const result = await POST(
      makeRequest({
        holdId: 'hold_1',
        locationType: 'SALON',
      }),
    )

    expect(result.status).toBe(descriptor.httpStatus)
    expectBookingFailPayload(await result.json(), 'OFFERING_ID_REQUIRED')

    expect(mocks.professionalServiceOfferingFindUnique).not.toHaveBeenCalled()
    expect(mocks.requireClient).not.toHaveBeenCalled()
    expect(mocks.beginIdempotency).not.toHaveBeenCalled()
  })

  it('returns HOLD_ID_REQUIRED when holdId is missing', async () => {
    const descriptor = getBookingErrorDescriptor('HOLD_ID_REQUIRED')

    const result = await POST(
      makeRequest({
        offeringId: 'offering_1',
        locationType: 'SALON',
      }),
    )

    expect(result.status).toBe(descriptor.httpStatus)
    expectBookingFailPayload(await result.json(), 'HOLD_ID_REQUIRED')

    expect(mocks.professionalServiceOfferingFindUnique).not.toHaveBeenCalled()
    expect(mocks.requireClient).not.toHaveBeenCalled()
    expect(mocks.beginIdempotency).not.toHaveBeenCalled()
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

    expect(result.status).toBe(descriptor.httpStatus)
    expectBookingFailPayload(await result.json(), 'ADDONS_INVALID')

    expect(mocks.professionalServiceOfferingFindUnique).not.toHaveBeenCalled()
    expect(mocks.requireClient).not.toHaveBeenCalled()
    expect(mocks.beginIdempotency).not.toHaveBeenCalled()
  })

  it('returns MISSING_MEDIA_ID when source is discovery without lookPostId or mediaId', async () => {
    const descriptor = getBookingErrorDescriptor('MISSING_MEDIA_ID')

    const result = await POST(
      makeRequest({
        offeringId: 'offering_1',
        holdId: 'hold_1',
        locationType: 'SALON',
        source: 'DISCOVERY',
      }),
    )

    expect(result.status).toBe(descriptor.httpStatus)
    expectBookingFailPayload(await result.json(), 'MISSING_MEDIA_ID', {
      error: 'Discovery bookings require a look post id or media id.',
      message: 'Discovery bookings require a lookPostId or mediaId.',
    })

    expect(mocks.professionalServiceOfferingFindUnique).not.toHaveBeenCalled()
    expect(mocks.requireClient).not.toHaveBeenCalled()
    expect(mocks.beginIdempotency).not.toHaveBeenCalled()
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

    expect(result.status).toBe(descriptor.httpStatus)
    expectBookingFailPayload(await result.json(), 'OFFERING_NOT_FOUND')

    expect(mocks.requireClient).not.toHaveBeenCalled()
    expect(mocks.beginIdempotency).not.toHaveBeenCalled()
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

    expect(result.status).toBe(descriptor.httpStatus)
    expectBookingFailPayload(await result.json(), 'OFFERING_NOT_FOUND')

    expect(mocks.requireClient).not.toHaveBeenCalled()
    expect(mocks.beginIdempotency).not.toHaveBeenCalled()
    expect(mocks.finalizeBookingFromHold).not.toHaveBeenCalled()
  })

  it('returns auth response when auth fails for non-aftercare finalize', async () => {
    const authRes = makeJsonResponse(401, {
      ok: false,
      error: 'Unauthorized',
    })

    mocks.requireClient.mockResolvedValueOnce({
      ok: false,
      res: authRes,
    })

    const result = await POST(
      makeIdempotentRequest({
        offeringId: 'offering_1',
        holdId: 'hold_1',
        locationType: 'SALON',
        source: 'REQUESTED',
      }),
    )

    expect(mocks.professionalServiceOfferingFindUnique).toHaveBeenCalledWith({
      where: { id: 'offering_1' },
      select: expect.any(Object),
    })
    expect(mocks.requireClient).toHaveBeenCalledTimes(1)
    expect(result).toBe(authRes)
    expect(mocks.beginIdempotency).not.toHaveBeenCalled()
    expect(mocks.finalizeBookingFromHold).not.toHaveBeenCalled()
  })

  it('returns missing idempotency key for authenticated finalize without idempotency header', async () => {
    const result = await POST(
      makeRequest({
        offeringId: 'offering_1',
        holdId: 'hold_1',
        locationType: 'SALON',
        source: 'REQUESTED',
      }),
    )

    expect(result.status).toBe(400)
    await expect(result.json()).resolves.toEqual({
      ok: false,
      error: 'Missing idempotency key.',
      code: 'IDEMPOTENCY_KEY_REQUIRED',
    })

    expect(mocks.beginIdempotency).toHaveBeenCalledWith({
      actor: {
        actorUserId: 'user_1',
        actorRole: 'CLIENT',
      },
      route: IDEMPOTENCY_ROUTE,
      key: null,
      requestBody: {
        clientId: 'client_1',
        offeringId: 'offering_1',
        holdId: 'hold_1',
        openingId: null,
        addOnIds: [],
        locationType: ServiceLocationType.SALON,
        source: BookingSource.REQUESTED,
        mediaId: null,
        lookPostId: null,
        aftercareToken: null,
        rebookOfBookingId: null,
      },
    })

    expect(mocks.finalizeBookingFromHold).not.toHaveBeenCalled()
    expect(mocks.completeIdempotency).not.toHaveBeenCalled()
  })

  it('returns in-progress when idempotency ledger has an active matching request', async () => {
    mocks.beginIdempotency.mockResolvedValueOnce({
      kind: 'in_progress',
    })

    const result = await POST(
      makeIdempotentRequest({
        offeringId: 'offering_1',
        holdId: 'hold_1',
        locationType: 'SALON',
      }),
    )

    expect(result.status).toBe(409)
    await expect(result.json()).resolves.toEqual({
      ok: false,
      error: 'A matching booking request is already in progress.',
      code: 'IDEMPOTENCY_REQUEST_IN_PROGRESS',
    })

    expect(mocks.finalizeBookingFromHold).not.toHaveBeenCalled()
    expect(mocks.completeIdempotency).not.toHaveBeenCalled()
  })

  it('returns conflict when idempotency key was reused with a different body', async () => {
    mocks.beginIdempotency.mockResolvedValueOnce({
      kind: 'conflict',
    })

    const result = await POST(
      makeIdempotentRequest({
        offeringId: 'offering_1',
        holdId: 'hold_1',
        locationType: 'SALON',
      }),
    )

    expect(result.status).toBe(409)
    await expect(result.json()).resolves.toEqual({
      ok: false,
      error: 'This idempotency key was already used with a different request body.',
      code: 'IDEMPOTENCY_KEY_CONFLICT',
    })

    expect(mocks.finalizeBookingFromHold).not.toHaveBeenCalled()
    expect(mocks.completeIdempotency).not.toHaveBeenCalled()
  })

  it('replays a completed idempotency response without finalizing or notifying again', async () => {
    const replayBody = {
      booking: {
        id: 'booking_replayed',
        status: BookingStatus.PENDING,
        scheduledFor: HOLD_START.toISOString(),
        professionalId: 'pro_123',
      },
      meta: {
        mutated: true,
        noOp: false,
      },
    }

    mocks.beginIdempotency.mockResolvedValueOnce({
      kind: 'replay',
      responseStatus: 201,
      responseBody: replayBody,
    })

    const result = await POST(
      makeIdempotentRequest({
        offeringId: 'offering_1',
        holdId: 'hold_1',
        locationType: 'SALON',
      }),
    )

    expect(result.status).toBe(201)
    await expect(result.json()).resolves.toEqual({
      ok: true,
      ...replayBody,
    })

    expect(mocks.finalizeBookingFromHold).not.toHaveBeenCalled()
    expect(mocks.createProNotification).not.toHaveBeenCalled()
    expect(mocks.completeIdempotency).not.toHaveBeenCalled()
  })

  it('allows discovery finalize when lookPostId is provided without mediaId', async () => {
    const result = await POST(
      makeIdempotentRequest(
        {
          offeringId: 'offering_1',
          holdId: 'hold_1',
          locationType: 'SALON',
          source: 'DISCOVERY',
          lookPostId: 'look_123',
        },
        'idem_discovery_1',
      ),
    )

    expect(result.status).toBe(201)

    expect(mocks.requireClient).toHaveBeenCalledTimes(1)

    expect(mocks.beginIdempotency).toHaveBeenCalledWith({
      actor: {
        actorUserId: 'user_1',
        actorRole: 'CLIENT',
      },
      route: IDEMPOTENCY_ROUTE,
      key: 'idem_discovery_1',
      requestBody: {
        clientId: 'client_1',
        offeringId: 'offering_1',
        holdId: 'hold_1',
        openingId: null,
        addOnIds: [],
        locationType: ServiceLocationType.SALON,
        source: BookingSource.DISCOVERY,
        mediaId: null,
        lookPostId: 'look_123',
        aftercareToken: null,
        rebookOfBookingId: null,
      },
    })

    expect(mocks.finalizeBookingFromHold).toHaveBeenCalledWith({
      clientId: 'client_1',
      holdId: 'hold_1',
      openingId: null,
      addOnIds: [],
      locationType: ServiceLocationType.SALON,
      source: BookingSource.DISCOVERY,
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
      requestId: null,
      idempotencyKey: 'idem_discovery_1',
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
        source: BookingSource.DISCOVERY,
        locationType: ServiceLocationType.SALON,
      },
    })

    expect(mocks.completeIdempotency).toHaveBeenCalledWith({
      idempotencyRecordId: 'idem_record_1',
      responseStatus: 201,
      responseBody: {
        booking: {
          id: 'booking_1',
          status: BookingStatus.PENDING,
          scheduledFor: HOLD_START.toISOString(),
          professionalId: 'pro_123',
        },
        meta: {
          mutated: true,
          noOp: false,
        },
      },
    })

    await expect(result.json()).resolves.toEqual({
      ok: true,
      booking: {
        id: 'booking_1',
        status: BookingStatus.PENDING,
        scheduledFor: HOLD_START.toISOString(),
        professionalId: 'pro_123',
      },
      meta: {
        mutated: true,
        noOp: false,
      },
    })
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

    expect(result.status).toBe(descriptor.httpStatus)
    expectBookingFailPayload(await result.json(), 'AFTERCARE_TOKEN_MISSING')

    expect(mocks.requireClient).not.toHaveBeenCalled()
    expect(mocks.resolveAftercareAccessByToken).not.toHaveBeenCalled()
    expect(mocks.beginIdempotency).not.toHaveBeenCalled()
    expect(mocks.finalizeBookingFromHold).not.toHaveBeenCalled()
  })

  it('treats aftercareToken as authoritative even when source claims REQUESTED', async () => {
    await POST(
      makeRequest({
        offeringId: 'offering_1',
        holdId: 'hold_1',
        locationType: 'SALON',
        source: 'REQUESTED',
        aftercareToken: 'token_1',
      }),
    )

    expect(mocks.requireClient).not.toHaveBeenCalled()
    expect(mocks.beginIdempotency).not.toHaveBeenCalled()
    expect(mocks.resolveAftercareAccessByToken).toHaveBeenCalledWith({
      rawToken: 'token_1',
    })

    expect(mocks.finalizeBookingFromHold).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: 'client_1',
        source: BookingSource.AFTERCARE,
        rebookOfBookingId: 'booking_old',
      }),
    )
  })

  it('returns AFTERCARE_NOT_COMPLETED when aftercare booking is not completed', async () => {
    const descriptor = getBookingErrorDescriptor('AFTERCARE_NOT_COMPLETED')

    mocks.resolveAftercareAccessByToken.mockResolvedValueOnce(
      makeResolvedAftercareAccess({
        status: BookingStatus.PENDING,
      }),
    )

    const result = await POST(
      makeRequest({
        offeringId: 'offering_1',
        holdId: 'hold_1',
        locationType: 'SALON',
        source: 'AFTERCARE',
        aftercareToken: 'token_1',
      }),
    )

    expect(mocks.resolveAftercareAccessByToken).toHaveBeenCalledWith({
      rawToken: 'token_1',
    })

    expect(result.status).toBe(descriptor.httpStatus)
    expectBookingFailPayload(await result.json(), 'AFTERCARE_NOT_COMPLETED')
  })

  it('returns AFTERCARE_OFFERING_MISMATCH when aftercare booking does not match offering', async () => {
    const descriptor = getBookingErrorDescriptor('AFTERCARE_OFFERING_MISMATCH')

    mocks.resolveAftercareAccessByToken.mockResolvedValueOnce(
      makeResolvedAftercareAccess({
        professionalId: 'pro_other',
        serviceId: 'service_other',
        offeringId: 'offering_other',
      }),
    )

    const result = await POST(
      makeRequest({
        offeringId: 'offering_1',
        holdId: 'hold_1',
        locationType: 'SALON',
        source: 'AFTERCARE',
        aftercareToken: 'token_1',
      }),
    )

    expect(result.status).toBe(descriptor.httpStatus)
    expectBookingFailPayload(
      await result.json(),
      'AFTERCARE_OFFERING_MISMATCH',
    )
  })

  it('calls finalizeBookingFromHold with token-resolved client ownership for aftercare', async () => {
    mocks.resolveAftercareAccessByToken.mockResolvedValueOnce(
      makeResolvedAftercareAccess({
        clientId: 'client_from_token',
      }),
    )

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

    expect(mocks.requireClient).not.toHaveBeenCalled()
    expect(mocks.beginIdempotency).not.toHaveBeenCalled()

    expect(mocks.finalizeBookingFromHold).toHaveBeenCalledWith({
      clientId: 'client_from_token',
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
      requestId: null,
      idempotencyKey: null,
    })
  })

  it('uses original booking id as fallback rebookOfBookingId for aftercare', async () => {
    await POST(
      makeRequest({
        offeringId: 'offering_1',
        holdId: 'hold_1',
        locationType: 'SALON',
        source: 'AFTERCARE',
        aftercareToken: 'token_1',
      }),
    )

    expect(mocks.beginIdempotency).not.toHaveBeenCalled()
    expect(mocks.finalizeBookingFromHold).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: 'client_1',
        source: BookingSource.AFTERCARE,
        rebookOfBookingId: 'booking_old',
      }),
    )
  })

  it('creates the booking through the boundary, completes idempotency, and notifies the pro for standard requested flow', async () => {
    const result = await POST(
      makeIdempotentRequest(
        {
          offeringId: 'offering_1',
          holdId: 'hold_1',
          locationType: 'SALON',
          source: 'REQUESTED',
        },
        'idem_requested_1',
      ),
    )

    expect(mocks.requireClient).toHaveBeenCalledTimes(1)

    expect(mocks.beginIdempotency).toHaveBeenCalledWith({
      actor: {
        actorUserId: 'user_1',
        actorRole: 'CLIENT',
      },
      route: IDEMPOTENCY_ROUTE,
      key: 'idem_requested_1',
      requestBody: {
        clientId: 'client_1',
        offeringId: 'offering_1',
        holdId: 'hold_1',
        openingId: null,
        addOnIds: [],
        locationType: ServiceLocationType.SALON,
        source: BookingSource.REQUESTED,
        mediaId: null,
        lookPostId: null,
        aftercareToken: null,
        rebookOfBookingId: null,
      },
    })

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
      requestId: null,
      idempotencyKey: 'idem_requested_1',
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

    expect(mocks.completeIdempotency).toHaveBeenCalledWith({
      idempotencyRecordId: 'idem_record_1',
      responseStatus: 201,
      responseBody: {
        booking: {
          id: 'booking_1',
          status: BookingStatus.PENDING,
          scheduledFor: HOLD_START.toISOString(),
          professionalId: 'pro_123',
        },
        meta: {
          mutated: true,
          noOp: false,
        },
      },
    })

    expect(result.status).toBe(201)
    await expect(result.json()).resolves.toEqual({
      ok: true,
      booking: {
        id: 'booking_1',
        status: BookingStatus.PENDING,
        scheduledFor: HOLD_START.toISOString(),
        professionalId: 'pro_123',
      },
      meta: {
        mutated: true,
        noOp: false,
      },
    })
  })

  it('creates pro notification with null actorUserId for aftercare finalize', async () => {
    await POST(
      makeRequest({
        offeringId: 'offering_1',
        holdId: 'hold_1',
        locationType: 'SALON',
        source: 'AFTERCARE',
        aftercareToken: 'token_1',
      }),
    )

    expect(mocks.beginIdempotency).not.toHaveBeenCalled()

    expect(mocks.createProNotification).toHaveBeenCalledWith({
      professionalId: 'pro_123',
      eventKey: NotificationEventKey.BOOKING_REQUEST_CREATED,
      title: 'New booking request',
      body: '',
      href: '/pro/bookings/booking_1',
      actorUserId: null,
      bookingId: 'booking_1',
      dedupeKey: 'PRO_NOTIF:BOOKING_REQUEST_CREATED:booking_1',
      data: {
        bookingId: 'booking_1',
        bookingStatus: BookingStatus.PENDING,
        source: BookingSource.AFTERCARE,
        locationType: ServiceLocationType.SALON,
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
      makeIdempotentRequest(
        {
          offeringId: 'offering_1',
          holdId: 'hold_1',
          locationType: 'SALON',
        },
        'idem_auto_accept_1',
      ),
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

    expect(mocks.completeIdempotency).toHaveBeenCalledWith({
      idempotencyRecordId: 'idem_record_1',
      responseStatus: 201,
      responseBody: {
        booking: {
          id: 'booking_1',
          status: BookingStatus.ACCEPTED,
          scheduledFor: HOLD_START.toISOString(),
          professionalId: 'pro_123',
        },
        meta: {
          mutated: true,
          noOp: false,
        },
      },
    })
  })

  it('maps BookingError from resolveAftercareAccessByToken using the aftercare-specific code', async () => {
    const descriptor = getBookingErrorDescriptor('AFTERCARE_TOKEN_INVALID')

    mocks.resolveAftercareAccessByToken.mockRejectedValueOnce(
      new BookingError('AFTERCARE_TOKEN_INVALID', {
        message: 'Aftercare access token was not found.',
        userMessage: 'That aftercare link is invalid or expired.',
      }),
    )

    const result = await POST(
      makeRequest({
        offeringId: 'offering_1',
        holdId: 'hold_1',
        locationType: 'SALON',
        source: 'AFTERCARE',
        aftercareToken: 'bad_token',
      }),
    )

    expect(result.status).toBe(descriptor.httpStatus)
    expectBookingFailPayload(await result.json(), 'AFTERCARE_TOKEN_INVALID', {
      error: 'That aftercare link is invalid or expired.',
      message: 'Aftercare access token was not found.',
    })

    expect(mocks.beginIdempotency).not.toHaveBeenCalled()
    expect(mocks.failIdempotency).not.toHaveBeenCalled()
  })

  it('maps BookingError from finalizeBookingFromHold and marks idempotency failed', async () => {
    const descriptor = getBookingErrorDescriptor('TIME_HELD')

    mocks.finalizeBookingFromHold.mockRejectedValueOnce(
      new BookingError('TIME_HELD'),
    )

    const result = await POST(
      makeIdempotentRequest(
        {
          offeringId: 'offering_1',
          holdId: 'hold_1',
          locationType: 'SALON',
        },
        'idem_time_held_1',
      ),
    )

    expect(result.status).toBe(descriptor.httpStatus)
    expectBookingFailPayload(await result.json(), 'TIME_HELD')

    expect(mocks.failIdempotency).toHaveBeenCalledWith({
      idempotencyRecordId: 'idem_record_1',
    })
    expect(mocks.completeIdempotency).not.toHaveBeenCalled()
  })

  it('returns internal error for unexpected failures and marks idempotency failed', async () => {
    mocks.finalizeBookingFromHold.mockRejectedValueOnce(new Error('boom'))

    const result = await POST(
      makeIdempotentRequest(
        {
          offeringId: 'offering_1',
          holdId: 'hold_1',
          locationType: 'SALON',
        },
        'idem_boom_1',
      ),
    )

    expect(result.status).toBe(500)
    await expect(result.json()).resolves.toEqual({
      ok: false,
      error: 'Internal server error',
      code: 'INTERNAL_ERROR',
      retryable: false,
      uiAction: 'CONTACT_SUPPORT',
      message: 'boom',
    })

    expect(mocks.failIdempotency).toHaveBeenCalledWith({
      idempotencyRecordId: 'idem_record_1',
    })
    expect(mocks.completeIdempotency).not.toHaveBeenCalled()
  })
})