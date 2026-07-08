// app/api/v1/bookings/finalize/route.test.ts

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  AftercareRebookMode,
  BookingCheckoutStatus,
  BookingSource,
  BookingStatus,
  NotificationEventKey,
  Prisma,
  Role,
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
  bookingFindUnique: vi.fn(),

  resolveAftercareAccessTokenForMutation: vi.fn(),
  markAftercareAccessTokenUsed: vi.fn(),

  finalizeBookingFromHold: vi.fn(),
  resolveDiscoveryFinalize: vi.fn(),
  createProNotification: vi.fn(),
  captureBookingException: vi.fn(),

  withRouteIdempotency: vi.fn(),
  beginRouteIdempotency: vi.fn(),
  completeRouteIdempotency: vi.fn(),
  failStartedRouteIdempotency: vi.fn(),
  isRouteIdempotencyHandled: vi.fn(),

  enforceRateLimit: vi.fn(),
  clientRateLimitKey: vi.fn(),
  tokenActorRateLimitKey: vi.fn(),
  rateLimitExceededResponse: vi.fn(),

  safeError: vi.fn(),
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

vi.mock('@/app/api/_utils/idempotency', () => ({
  withRouteIdempotency: mocks.withRouteIdempotency,
  beginRouteIdempotency: mocks.beginRouteIdempotency,
  completeRouteIdempotency: mocks.completeRouteIdempotency,
  failStartedRouteIdempotency: mocks.failStartedRouteIdempotency,
  isRouteIdempotencyHandled: mocks.isRouteIdempotencyHandled,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    professionalServiceOffering: {
      findUnique: mocks.professionalServiceOfferingFindUnique,
    },
    booking: {
      findUnique: mocks.bookingFindUnique,
    },
  },
}))

vi.mock('@/lib/notifications/proNotifications', () => ({
  createProNotification: mocks.createProNotification,
}))

vi.mock('@/lib/observability/bookingEvents', () => ({
  captureBookingException: mocks.captureBookingException,
}))

vi.mock('@/lib/security/logging', () => ({
  safeError: mocks.safeError,
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

vi.mock('@/lib/booking/resolveDiscoveryFinalize', () => ({
  resolveDiscoveryFinalize: mocks.resolveDiscoveryFinalize,
}))

vi.mock('@/lib/aftercare/aftercareAccessTokens', () => ({
  resolveAftercareAccessTokenForMutation:
    mocks.resolveAftercareAccessTokenForMutation,
  markAftercareAccessTokenUsed: mocks.markAftercareAccessTokenUsed,
}))

vi.mock('@/lib/idempotency', () => ({
  IDEMPOTENCY_ROUTES: {
    BOOKING_FINALIZE: 'POST /api/v1/bookings/finalize',
  },
}))

vi.mock('@/lib/rateLimit/enforce', () => ({
  enforceRateLimit: mocks.enforceRateLimit,
}))

vi.mock('@/lib/rateLimit/identity', () => ({
  clientRateLimitKey: mocks.clientRateLimitKey,
  tokenActorRateLimitKey: mocks.tokenActorRateLimitKey,
}))

vi.mock('@/lib/rateLimit/response', () => ({
  rateLimitExceededResponse: mocks.rateLimitExceededResponse,
}))

import { IDEMPOTENCY_ROUTES } from '@/lib/idempotency'
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
  return new Request('http://localhost/api/v1/bookings/finalize', {
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

function expectIdempotencyStarted(key = 'idem_finalize_1'): void {
  mocks.beginRouteIdempotency.mockResolvedValue({
    kind: 'started',
    idempotencyRecordId: 'idem_record_1',
    idempotencyKey: key,
    requestHash: 'hash_1',
  })

  mocks.isRouteIdempotencyHandled.mockImplementation(
    (result: { kind: string }) => result.kind === 'handled',
  )

  // The route now calls withRouteIdempotency; this mock reproduces the real
  // wrapper by driving the same begin/complete/failStarted helpers, so the
  // existing lifecycle assertions still apply.
  mocks.withRouteIdempotency.mockImplementation(
    async (
      args: { operation: string },
      run: (ctx: {
        idempotencyKey: string
        idempotencyRecordId: string
        requestHash: string
      }) => Promise<{ status: number; body: Record<string, unknown> }>,
    ) => {
      const begin = await mocks.beginRouteIdempotency(args)

      if (mocks.isRouteIdempotencyHandled(begin)) {
        return begin.response
      }

      try {
        const { status, body } = await run({
          idempotencyKey: begin.idempotencyKey,
          idempotencyRecordId: begin.idempotencyRecordId,
          requestHash: begin.requestHash,
        })

        await mocks.completeRouteIdempotency({
          idempotencyRecordId: begin.idempotencyRecordId,
          responseStatus: status,
          responseBody: body,
        })

        return mocks.jsonOk(body, status)
      } catch (error) {
        await mocks.failStartedRouteIdempotency({
          idempotencyRecordId: begin.idempotencyRecordId,
          operation: args.operation,
        })

        throw error
      }
    },
  )
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
  service: {
    minPrice: new Prisma.Decimal('80'),
  },
  priceRamps: [],
}

const finalizeOffering = {
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
  serviceMinPrice: new Prisma.Decimal('80'),
  priceRamps: [],
}

function expectedBookingEntryPointForSource(
  source: BookingSource,
): 'BROAD_DISCOVERY' | 'DIRECT_PROFILE' {
  switch (source) {
    case BookingSource.DISCOVERY:
      return 'BROAD_DISCOVERY'

    case BookingSource.REQUESTED:
    case BookingSource.AFTERCARE:
      return 'DIRECT_PROFILE'

    case BookingSource.IMPORTED:
      return 'BROAD_DISCOVERY'
  }
}

function makeExpectedFinalizeArgs(
  overrides: Partial<{
    clientId: string
    bookingEntryPoint: 'BROAD_DISCOVERY' | 'DIRECT_PROFILE'
    holdId: string
    openingId: string | null
    addOnIds: string[]
    locationType: ServiceLocationType
    source: BookingSource
    initialStatus: BookingStatus
    rebookOfBookingId: string | null
    fallbackTimeZone: string
    requestId: string | null
    idempotencyKey: string | null
    discovery: unknown
  }> = {},
) {
  const source = overrides.source ?? BookingSource.REQUESTED

  return {
    clientId: overrides.clientId ?? 'client_1',
    bookingEntryPoint:
      overrides.bookingEntryPoint ?? expectedBookingEntryPointForSource(source),
    holdId: overrides.holdId ?? 'hold_1',
    openingId: overrides.openingId ?? null,
    addOnIds: overrides.addOnIds ?? [],
    locationType: overrides.locationType ?? ServiceLocationType.SALON,
    source,
    initialStatus: overrides.initialStatus ?? BookingStatus.PENDING,
    rebookOfBookingId: overrides.rebookOfBookingId ?? null,
    offering: finalizeOffering,
    discovery: overrides.discovery ?? {
      provenance: 'DIRECT_PROFILE',
      feeEligible: false,
      depositSettings: {
        depositEnabled: false,
        depositType: 'FLAT',
        depositFlatAmountCents: null,
        depositPercent: null,
      },
      discoveryFeeCents: 500,
    },
    fallbackTimeZone: overrides.fallbackTimeZone ?? 'UTC',
    requestId: overrides.requestId ?? null,
    idempotencyKey: overrides.idempotencyKey ?? 'idem_finalize_1',
  }
}

function makeSuccessResponseBody(
  overrides: Partial<{
    id: string
    status: BookingStatus
    scheduledFor: string
    professionalId: string
    mutated: boolean
    noOp: boolean
  }> = {},
) {
  return {
    ok: true,
    booking: {
      id: overrides.id ?? 'booking_1',
      status: overrides.status ?? BookingStatus.PENDING,
      scheduledFor: overrides.scheduledFor ?? HOLD_START.toISOString(),
      professionalId: overrides.professionalId ?? 'pro_123',
    },
    meta: {
      mutated: overrides.mutated ?? true,
      noOp: overrides.noOp ?? false,
    },
  }
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
    idempotencyActorKey: 'aftercare-token:token_row_1',
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

describe('POST /api/v1/bookings/finalize', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    vi.clearAllMocks()

    mocks.beginRouteIdempotency.mockReset()
    mocks.completeRouteIdempotency.mockReset()
    mocks.failStartedRouteIdempotency.mockReset()
    mocks.isRouteIdempotencyHandled.mockReset()

    mocks.requireClient.mockResolvedValue({
      ok: true,
      clientId: 'client_1',
      user: { id: 'user_1' },
    })

    mocks.clientRateLimitKey.mockReturnValue(
      'user:user_1|client:client_1|ip:unknown-ip',
    )

    mocks.tokenActorRateLimitKey.mockReturnValue(
      'token:aftercare_actor_hash|ip:unknown-ip',
    )

    mocks.enforceRateLimit.mockResolvedValue({
      allowed: true,
      bucket: 'bookings:finalize',
      key: 'user:user_1|client:client_1|ip:unknown-ip',
      limit: 12,
      remaining: 11,
      resetAt: new Date('2026-03-11T19:05:00.000Z'),
      retryAfterSeconds: 60,
      source: 'redis',
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

    mocks.safeError.mockImplementation((error: unknown) => ({
      name: error instanceof Error ? error.name : 'UnknownError',
      message: error instanceof Error ? error.message : 'Unknown error',
    }))

    mocks.professionalServiceOfferingFindUnique.mockResolvedValue(offering)

    // Source booking lookup for payment-confirmation coupling. Default: source
    // is not awaiting confirmation, so a rebook uses the standard request flow.
    mocks.bookingFindUnique.mockResolvedValue({
      checkoutStatus: BookingCheckoutStatus.PAID,
    })

    mocks.resolveDiscoveryFinalize.mockResolvedValue({
      provenance: 'DIRECT_PROFILE',
      feeEligible: false,
      depositSettings: {
        depositEnabled: false,
        depositType: 'FLAT',
        depositFlatAmountCents: null,
        depositPercent: null,
      },
      discoveryFeeCents: 500,
    })

    mocks.resolveAftercareAccessTokenForMutation.mockResolvedValue(
      makeResolvedAftercareAccess(),
    )

    mocks.markAftercareAccessTokenUsed.mockResolvedValue({
      id: 'token_row_1',
      expiresAt: new Date('2026-03-20T19:00:00.000Z'),
      firstUsedAt: NOW,
      lastUsedAt: NOW,
      useCount: 1,
      singleUse: false,
    })

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

    expectIdempotencyStarted()

    mocks.completeRouteIdempotency.mockResolvedValue(undefined)
    mocks.failStartedRouteIdempotency.mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('returns LOCATION_TYPE_REQUIRED when locationType is missing before idempotency starts', async () => {
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
    expect(mocks.beginRouteIdempotency).not.toHaveBeenCalled()
  })

  it('returns OFFERING_ID_REQUIRED when offeringId is missing before idempotency starts', async () => {
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
    expect(mocks.beginRouteIdempotency).not.toHaveBeenCalled()
  })

  it('returns HOLD_ID_REQUIRED when holdId is missing before idempotency starts', async () => {
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
    expect(mocks.beginRouteIdempotency).not.toHaveBeenCalled()
  })

  it('returns ADDONS_INVALID when addOnIds contains duplicates before idempotency starts', async () => {
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
    expect(mocks.beginRouteIdempotency).not.toHaveBeenCalled()
  })

  it('returns MISSING_MEDIA_ID when source is discovery without lookPostId or mediaId before idempotency starts', async () => {
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
    expect(mocks.beginRouteIdempotency).not.toHaveBeenCalled()
  })

  it('allows discovery finalize when mediaId is provided without lookPostId', async () => {
    expectIdempotencyStarted('idem_discovery_media_1')

    await POST(
      makeIdempotentRequest(
        {
          offeringId: 'offering_1',
          holdId: 'hold_1',
          locationType: 'SALON',
          source: 'DISCOVERY',
          mediaId: 'media_123',
        },
        'idem_discovery_media_1',
      ),
    )

    expect(mocks.beginRouteIdempotency).toHaveBeenCalledWith(
      expect.objectContaining({
        requestBody: expect.objectContaining({
          source: BookingSource.DISCOVERY,
          bookingEntryPoint: 'BROAD_DISCOVERY',
          mediaId: 'media_123',
          lookPostId: null,
        }),
      }),
    )

    expect(mocks.finalizeBookingFromHold).toHaveBeenCalledWith(
      makeExpectedFinalizeArgs({
        source: BookingSource.DISCOVERY,
        bookingEntryPoint: 'BROAD_DISCOVERY',
        idempotencyKey: 'idem_discovery_media_1',
      }),
    )
  })

  it('returns OFFERING_NOT_FOUND when offering is missing before idempotency starts', async () => {
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
    expect(mocks.beginRouteIdempotency).not.toHaveBeenCalled()
    expect(mocks.finalizeBookingFromHold).not.toHaveBeenCalled()
  })

  it('returns OFFERING_NOT_FOUND when offering is inactive before idempotency starts', async () => {
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
    expect(mocks.beginRouteIdempotency).not.toHaveBeenCalled()
    expect(mocks.finalizeBookingFromHold).not.toHaveBeenCalled()
  })

  it('returns auth response before idempotency starts when auth fails for non-aftercare finalize', async () => {
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
    expect(mocks.beginRouteIdempotency).not.toHaveBeenCalled()
    expect(mocks.finalizeBookingFromHold).not.toHaveBeenCalled()
  })

  it('returns rate-limit response before idempotency or finalize for authenticated finalize', async () => {
    const blockedDecision = {
      allowed: false,
      bucket: 'bookings:finalize',
      key: 'user:user_1|client:client_1|ip:unknown-ip',
      limit: 12,
      remaining: 0,
      resetAt: new Date('2026-03-11T19:05:00.000Z'),
      retryAfterSeconds: 60,
      source: 'redis',
      reason: 'rate_limited',
    } as const

    const limitedResponse = makeJsonResponse(429, {
      ok: false,
      error: 'Too many requests. Please try again later.',
      code: 'RATE_LIMITED',
    })

    mocks.enforceRateLimit.mockResolvedValueOnce(blockedDecision)
    mocks.rateLimitExceededResponse.mockReturnValueOnce(limitedResponse)

    const result = await POST(
      makeIdempotentRequest({
        offeringId: 'offering_1',
        holdId: 'hold_1',
        locationType: 'SALON',
        source: 'REQUESTED',
      }),
    )

    expect(result).toBe(limitedResponse)
    expect(result.status).toBe(429)

    expect(mocks.clientRateLimitKey).toHaveBeenCalledWith({
      clientId: 'client_1',
      userId: 'user_1',
      request: expect.any(Request),
    })

    expect(mocks.enforceRateLimit).toHaveBeenCalledWith({
      bucket: 'bookings:finalize',
      key: 'user:user_1|client:client_1|ip:unknown-ip',
    })

    expect(mocks.rateLimitExceededResponse).toHaveBeenCalledWith(
      blockedDecision,
    )

    expect(mocks.beginRouteIdempotency).not.toHaveBeenCalled()
    expect(mocks.finalizeBookingFromHold).not.toHaveBeenCalled()
    expect(mocks.createProNotification).not.toHaveBeenCalled()
    expect(mocks.completeRouteIdempotency).not.toHaveBeenCalled()
    expect(mocks.markAftercareAccessTokenUsed).not.toHaveBeenCalled()
  })

  it('returns handled idempotency response for authenticated finalize without calling boundary', async () => {
    const handledResponse = makeJsonResponse(400, {
      ok: false,
      error: 'Missing idempotency key.',
      code: 'IDEMPOTENCY_KEY_REQUIRED',
    })

    mocks.beginRouteIdempotency.mockResolvedValueOnce({
      kind: 'handled',
      response: handledResponse,
    })

    const result = await POST(
      makeRequest({
        offeringId: 'offering_1',
        holdId: 'hold_1',
        locationType: 'SALON',
        source: 'REQUESTED',
      }),
    )

    expect(result).toBe(handledResponse)
    expect(mocks.finalizeBookingFromHold).not.toHaveBeenCalled()
    expect(mocks.createProNotification).not.toHaveBeenCalled()
    expect(mocks.completeRouteIdempotency).not.toHaveBeenCalled()
    expect(mocks.markAftercareAccessTokenUsed).not.toHaveBeenCalled()
  })

  it('starts idempotency for authenticated requested finalize', async () => {
    expectIdempotencyStarted('idem_requested_1')

    await POST(
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

    expect(mocks.clientRateLimitKey).toHaveBeenCalledWith({
      clientId: 'client_1',
      userId: 'user_1',
      request: expect.any(Request),
    })

    expect(mocks.enforceRateLimit).toHaveBeenCalledWith({
      bucket: 'bookings:finalize',
      key: 'user:user_1|client:client_1|ip:unknown-ip',
    })

    expect(mocks.beginRouteIdempotency).toHaveBeenCalledWith({
      request: expect.any(Request),
      actor: {
        actorUserId: 'user_1',
        actorRole: Role.CLIENT,
      },
      route: IDEMPOTENCY_ROUTES.BOOKING_FINALIZE,
      requestLabel: 'booking finalize',
      requestBody: {
        clientId: 'client_1',
        offeringId: 'offering_1',
        holdId: 'hold_1',
        openingId: null,
        addOnIds: [],
        locationType: ServiceLocationType.SALON,
        source: BookingSource.REQUESTED,
        bookingEntryPoint: 'DIRECT_PROFILE',
        mediaId: null,
        lookPostId: null,
        aftercareToken: null,
        rebookOfBookingId: null,
      },
      messages: {
        missingKey: 'Missing idempotency key.',
        inProgress: 'A matching booking request is already in progress.',
        conflict:
          'This idempotency key was already used with a different request body.',
      },
      operation: 'POST /api/v1/bookings/finalize',
    })

    expect(mocks.markAftercareAccessTokenUsed).not.toHaveBeenCalled()
  })

  it('normalizes PROFILE source to requested direct-profile readiness', async () => {
    expectIdempotencyStarted('idem_profile_1')

    await POST(
      makeIdempotentRequest(
        {
          offeringId: 'offering_1',
          holdId: 'hold_1',
          locationType: 'SALON',
          source: 'PROFILE',
        },
        'idem_profile_1',
      ),
    )

    expect(mocks.beginRouteIdempotency).toHaveBeenCalledWith(
      expect.objectContaining({
        requestBody: expect.objectContaining({
          source: BookingSource.REQUESTED,
          bookingEntryPoint: 'DIRECT_PROFILE',
        }),
      }),
    )

    expect(mocks.finalizeBookingFromHold).toHaveBeenCalledWith(
      makeExpectedFinalizeArgs({
        source: BookingSource.REQUESTED,
        bookingEntryPoint: 'DIRECT_PROFILE',
        idempotencyKey: 'idem_profile_1',
      }),
    )
  })

  it('defaults unknown source without discovery reference to requested direct-profile readiness', async () => {
    expectIdempotencyStarted('idem_unknown_1')

    await POST(
      makeIdempotentRequest(
        {
          offeringId: 'offering_1',
          holdId: 'hold_1',
          locationType: 'SALON',
          source: 'banana',
        },
        'idem_unknown_1',
      ),
    )

    expect(mocks.beginRouteIdempotency).toHaveBeenCalledWith(
      expect.objectContaining({
        requestBody: expect.objectContaining({
          source: BookingSource.REQUESTED,
          bookingEntryPoint: 'DIRECT_PROFILE',
        }),
      }),
    )

    expect(mocks.finalizeBookingFromHold).toHaveBeenCalledWith(
      makeExpectedFinalizeArgs({
        source: BookingSource.REQUESTED,
        bookingEntryPoint: 'DIRECT_PROFILE',
        idempotencyKey: 'idem_unknown_1',
      }),
    )
  })

  it('returns handled replay response without finalizing, notifying, or marking token used', async () => {
    const replayBody = makeSuccessResponseBody({
      id: 'booking_replayed',
    })

    const handledResponse = makeJsonResponse(201, replayBody)

    mocks.beginRouteIdempotency.mockResolvedValueOnce({
      kind: 'handled',
      response: handledResponse,
    })

    const result = await POST(
      makeIdempotentRequest({
        offeringId: 'offering_1',
        holdId: 'hold_1',
        locationType: 'SALON',
      }),
    )

    expect(result.status).toBe(201)
    await expect(result.json()).resolves.toEqual(replayBody)

    expect(mocks.finalizeBookingFromHold).not.toHaveBeenCalled()
    expect(mocks.createProNotification).not.toHaveBeenCalled()
    expect(mocks.completeRouteIdempotency).not.toHaveBeenCalled()
    expect(mocks.markAftercareAccessTokenUsed).not.toHaveBeenCalled()
  })

  it('allows discovery finalize when lookPostId is provided without mediaId', async () => {
    expectIdempotencyStarted('idem_discovery_1')

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

    expect(mocks.beginRouteIdempotency).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: {
          actorUserId: 'user_1',
          actorRole: Role.CLIENT,
        },
        route: IDEMPOTENCY_ROUTES.BOOKING_FINALIZE,
        requestBody: expect.objectContaining({
          clientId: 'client_1',
          offeringId: 'offering_1',
          holdId: 'hold_1',
          openingId: null,
          addOnIds: [],
          locationType: ServiceLocationType.SALON,
          source: BookingSource.DISCOVERY,
          bookingEntryPoint: 'BROAD_DISCOVERY',
          mediaId: null,
          lookPostId: 'look_123',
          aftercareToken: null,
          rebookOfBookingId: null,
        }),
      }),
    )

    expect(mocks.finalizeBookingFromHold).toHaveBeenCalledWith(
      makeExpectedFinalizeArgs({
        source: BookingSource.DISCOVERY,
        idempotencyKey: 'idem_discovery_1',
      }),
    )

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

    expect(mocks.completeRouteIdempotency).toHaveBeenCalledWith({
      idempotencyRecordId: 'idem_record_1',
      responseStatus: 201,
      responseBody: makeSuccessResponseBody(),
    })

    await expect(result.json()).resolves.toEqual(makeSuccessResponseBody())
  })

  it('logs safely and still finalizes when pro notification creation fails', async () => {
    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined)

    expectIdempotencyStarted('idem_notification_fails_1')

    const notificationError = new Error('notification blew up')
    mocks.createProNotification.mockRejectedValueOnce(notificationError)

    const result = await POST(
      makeRequest(
        {
          offeringId: 'offering_1',
          holdId: 'hold_1',
          locationType: 'SALON',
          source: 'REQUESTED',
        },
        {
          'idempotency-key': 'idem_notification_fails_1',
          'x-request-id': 'request_123',
        },
      ),
    )

    expect(result.status).toBe(201)

    expect(mocks.safeError).toHaveBeenCalledWith(notificationError)

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'POST /api/v1/bookings/finalize pro notification error',
      {
        requestId: 'request_123',
        bookingId: 'booking_1',
        professionalId: 'pro_123',
        error: {
          name: 'Error',
          message: 'notification blew up',
        },
      },
    )

    expect(mocks.completeRouteIdempotency).toHaveBeenCalledWith({
      idempotencyRecordId: 'idem_record_1',
      responseStatus: 201,
      responseBody: makeSuccessResponseBody(),
    })

    await expect(result.json()).resolves.toEqual(makeSuccessResponseBody())
  })

  it('returns AFTERCARE_TOKEN_MISSING when source is aftercare without token before idempotency starts', async () => {
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
    expect(mocks.resolveAftercareAccessTokenForMutation).not.toHaveBeenCalled()
    expect(mocks.beginRouteIdempotency).not.toHaveBeenCalled()
    expect(mocks.finalizeBookingFromHold).not.toHaveBeenCalled()
    expect(mocks.markAftercareAccessTokenUsed).not.toHaveBeenCalled()
  })

  it('treats aftercareToken as authoritative even when source claims REQUESTED', async () => {
    await POST(
      makeIdempotentRequest({
        offeringId: 'offering_1',
        holdId: 'hold_1',
        locationType: 'SALON',
        source: 'REQUESTED',
        aftercareToken: 'token_1',
      }),
    )

    expect(mocks.requireClient).not.toHaveBeenCalled()
    expect(mocks.resolveAftercareAccessTokenForMutation).toHaveBeenCalledWith({
      rawToken: 'token_1',
    })

    expect(mocks.tokenActorRateLimitKey).toHaveBeenCalledWith({
      actorKey: 'aftercare-token:token_row_1',
      request: expect.any(Request),
    })

    expect(mocks.enforceRateLimit).toHaveBeenCalledWith({
      bucket: 'bookings:finalize',
      key: 'token:aftercare_actor_hash|ip:unknown-ip',
    })

    expect(mocks.beginRouteIdempotency).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: {
          actorKey: 'aftercare-token:token_row_1',
          actorRole: Role.CLIENT,
        },
        route: IDEMPOTENCY_ROUTES.BOOKING_FINALIZE,
        requestBody: expect.objectContaining({
          clientId: 'client_1',
          source: BookingSource.AFTERCARE,
          bookingEntryPoint: 'DIRECT_PROFILE',
          aftercareToken: 'token_1',
          rebookOfBookingId: 'booking_old',
        }),
      }),
    )

    expect(mocks.finalizeBookingFromHold).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: 'client_1',
        bookingEntryPoint: 'DIRECT_PROFILE',
        source: BookingSource.AFTERCARE,
        rebookOfBookingId: 'booking_old',
        idempotencyKey: 'idem_finalize_1',
      }),
    )

    expect(mocks.markAftercareAccessTokenUsed).toHaveBeenCalledWith({
      tokenId: 'token_row_1',
    })
  })

  it('returns AFTERCARE_NOT_COMPLETED when aftercare booking is not completed before idempotency starts', async () => {
    const descriptor = getBookingErrorDescriptor('AFTERCARE_NOT_COMPLETED')

    mocks.resolveAftercareAccessTokenForMutation.mockResolvedValueOnce(
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

    expect(mocks.resolveAftercareAccessTokenForMutation).toHaveBeenCalledWith({
      rawToken: 'token_1',
    })

    expect(result.status).toBe(descriptor.httpStatus)
    expectBookingFailPayload(await result.json(), 'AFTERCARE_NOT_COMPLETED')
    expect(mocks.beginRouteIdempotency).not.toHaveBeenCalled()
    expect(mocks.markAftercareAccessTokenUsed).not.toHaveBeenCalled()
  })

  it('returns AFTERCARE_OFFERING_MISMATCH when aftercare booking does not match offering before idempotency starts', async () => {
    const descriptor = getBookingErrorDescriptor('AFTERCARE_OFFERING_MISMATCH')

    mocks.resolveAftercareAccessTokenForMutation.mockResolvedValueOnce(
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
    expect(mocks.beginRouteIdempotency).not.toHaveBeenCalled()
    expect(mocks.markAftercareAccessTokenUsed).not.toHaveBeenCalled()
  })

  it('returns rate-limit response before idempotency or finalize for aftercare-token finalize', async () => {
    const blockedDecision = {
      allowed: false,
      bucket: 'bookings:finalize',
      key: 'token:aftercare_actor_hash|ip:unknown-ip',
      limit: 12,
      remaining: 0,
      resetAt: new Date('2026-03-11T19:05:00.000Z'),
      retryAfterSeconds: 60,
      source: 'redis',
      reason: 'rate_limited',
    } as const

    const limitedResponse = makeJsonResponse(429, {
      ok: false,
      error: 'Too many requests. Please try again later.',
      code: 'RATE_LIMITED',
    })

    mocks.enforceRateLimit.mockResolvedValueOnce(blockedDecision)
    mocks.rateLimitExceededResponse.mockReturnValueOnce(limitedResponse)

    const result = await POST(
      makeIdempotentRequest({
        offeringId: 'offering_1',
        holdId: 'hold_1',
        locationType: 'SALON',
        source: 'AFTERCARE',
        aftercareToken: 'token_1',
      }),
    )

    expect(result).toBe(limitedResponse)
    expect(result.status).toBe(429)

    expect(mocks.requireClient).not.toHaveBeenCalled()
    expect(mocks.resolveAftercareAccessTokenForMutation).toHaveBeenCalledWith({
      rawToken: 'token_1',
    })

    expect(mocks.tokenActorRateLimitKey).toHaveBeenCalledWith({
      actorKey: 'aftercare-token:token_row_1',
      request: expect.any(Request),
    })

    expect(mocks.enforceRateLimit).toHaveBeenCalledWith({
      bucket: 'bookings:finalize',
      key: 'token:aftercare_actor_hash|ip:unknown-ip',
    })

    expect(mocks.rateLimitExceededResponse).toHaveBeenCalledWith(
      blockedDecision,
    )

    expect(mocks.beginRouteIdempotency).not.toHaveBeenCalled()
    expect(mocks.finalizeBookingFromHold).not.toHaveBeenCalled()
    expect(mocks.createProNotification).not.toHaveBeenCalled()
    expect(mocks.completeRouteIdempotency).not.toHaveBeenCalled()
    expect(mocks.markAftercareAccessTokenUsed).not.toHaveBeenCalled()
  })

  it('calls finalizeBookingFromHold with token-resolved client ownership for aftercare', async () => {
    mocks.resolveAftercareAccessTokenForMutation.mockResolvedValueOnce(
      makeResolvedAftercareAccess({
        clientId: 'client_from_token',
      }),
    )

    await POST(
      makeIdempotentRequest({
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

    expect(mocks.beginRouteIdempotency).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: {
          actorKey: 'aftercare-token:token_row_1',
          actorRole: Role.CLIENT,
        },
        requestBody: expect.objectContaining({
          clientId: 'client_from_token',
          source: BookingSource.AFTERCARE,
          bookingEntryPoint: 'DIRECT_PROFILE',
          rebookOfBookingId: 'booking_old',
        }),
      }),
    )

    expect(mocks.finalizeBookingFromHold).toHaveBeenCalledWith(
      makeExpectedFinalizeArgs({
        clientId: 'client_from_token',
        openingId: 'opening_1',
        addOnIds: ['addon_1', 'addon_2'],
        source: BookingSource.AFTERCARE,
        rebookOfBookingId: 'booking_old',
      }),
    )

    expect(mocks.markAftercareAccessTokenUsed).toHaveBeenCalledWith({
      tokenId: 'token_row_1',
    })
  })

  it('uses original booking id as fallback rebookOfBookingId for aftercare', async () => {
    await POST(
      makeIdempotentRequest({
        offeringId: 'offering_1',
        holdId: 'hold_1',
        locationType: 'SALON',
        source: 'AFTERCARE',
        aftercareToken: 'token_1',
      }),
    )

    expect(mocks.finalizeBookingFromHold).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: 'client_1',
        bookingEntryPoint: 'DIRECT_PROFILE',
        source: BookingSource.AFTERCARE,
        rebookOfBookingId: 'booking_old',
      }),
    )

    expect(mocks.markAftercareAccessTokenUsed).toHaveBeenCalledWith({
      tokenId: 'token_row_1',
    })
  })

  it('creates the booking through the boundary, completes idempotency, and notifies the pro for standard requested flow', async () => {
    expectIdempotencyStarted('idem_requested_1')

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

    expect(mocks.finalizeBookingFromHold).toHaveBeenCalledWith(
      makeExpectedFinalizeArgs({
        source: BookingSource.REQUESTED,
        idempotencyKey: 'idem_requested_1',
      }),
    )

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

    expect(mocks.completeRouteIdempotency).toHaveBeenCalledWith({
      idempotencyRecordId: 'idem_record_1',
      responseStatus: 201,
      responseBody: makeSuccessResponseBody(),
    })

    expect(mocks.markAftercareAccessTokenUsed).not.toHaveBeenCalled()

    expect(result.status).toBe(201)
    await expect(result.json()).resolves.toEqual(makeSuccessResponseBody())
  })

  it('creates pro notification with null actorUserId for aftercare finalize', async () => {
    await POST(
      makeIdempotentRequest({
        offeringId: 'offering_1',
        holdId: 'hold_1',
        locationType: 'SALON',
        source: 'AFTERCARE',
        aftercareToken: 'token_1',
      }),
    )

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

    expect(mocks.markAftercareAccessTokenUsed).toHaveBeenCalledWith({
      tokenId: 'token_row_1',
    })
  })

  it('emits PAYMENT_CONFIRMATION_REQUIRED (not a booking request) when the aftercare source payment is awaiting confirmation', async () => {
    // Source booking's off-platform payment is still pending confirmation, so the
    // PENDING rebook is coupled to it — payment confirmation is the sole approval
    // surface. The finalize pro-notification switches accordingly.
    mocks.bookingFindUnique.mockResolvedValue({
      checkoutStatus: BookingCheckoutStatus.AWAITING_CONFIRMATION,
    })

    await POST(
      makeIdempotentRequest({
        offeringId: 'offering_1',
        holdId: 'hold_1',
        locationType: 'SALON',
        source: 'AFTERCARE',
        aftercareToken: 'token_1',
      }),
    )

    expect(mocks.bookingFindUnique).toHaveBeenCalledWith({
      where: { id: 'booking_old' },
      select: { checkoutStatus: true },
    })

    expect(mocks.createProNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        professionalId: 'pro_123',
        eventKey: NotificationEventKey.PAYMENT_CONFIRMATION_REQUIRED,
        title: 'Confirm payment to approve the next appointment',
        dedupeKey:
          'PRO_NOTIF:PAYMENT_CONFIRMATION_REQUIRED:booking_1',
      }),
    )
    expect(mocks.createProNotification).not.toHaveBeenCalledWith(
      expect.objectContaining({
        eventKey: NotificationEventKey.BOOKING_REQUEST_CREATED,
      }),
    )
  })

  it('uses booking confirmed event when booking is auto-confirmed', async () => {
    expectIdempotencyStarted('idem_auto_accept_1')

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

    expect(mocks.completeRouteIdempotency).toHaveBeenCalledWith({
      idempotencyRecordId: 'idem_record_1',
      responseStatus: 201,
      responseBody: makeSuccessResponseBody({
        status: BookingStatus.ACCEPTED,
      }),
    })

    expect(mocks.markAftercareAccessTokenUsed).not.toHaveBeenCalled()
  })

  it('maps BookingError from resolveAftercareAccessTokenForMutation before idempotency starts', async () => {
    const descriptor = getBookingErrorDescriptor('AFTERCARE_TOKEN_INVALID')

    mocks.resolveAftercareAccessTokenForMutation.mockRejectedValueOnce(
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

    expect(mocks.beginRouteIdempotency).not.toHaveBeenCalled()
    expect(mocks.markAftercareAccessTokenUsed).not.toHaveBeenCalled()
    // Error is thrown before withRouteIdempotency is entered, so no record is
    // started and nothing needs to be failed (the wrapper owns failStarted).
    expect(mocks.failStartedRouteIdempotency).not.toHaveBeenCalled()
  })

  it('maps BookingError from finalizeBookingFromHold and marks idempotency failed without marking token used', async () => {
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

    expect(mocks.failStartedRouteIdempotency).toHaveBeenCalledWith({
      idempotencyRecordId: 'idem_record_1',
      operation: 'POST /api/v1/bookings/finalize',
    })

    expect(mocks.completeRouteIdempotency).not.toHaveBeenCalled()
    expect(mocks.markAftercareAccessTokenUsed).not.toHaveBeenCalled()
    expect(mocks.safeError).not.toHaveBeenCalled()
  })

  it('returns internal error, logs safely, captures exception, and marks idempotency failed without marking token used', async () => {
    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined)

    const thrown = new Error('boom')
    mocks.finalizeBookingFromHold.mockRejectedValueOnce(thrown)

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
      message: 'Internal server error',
    })

    expect(mocks.failStartedRouteIdempotency).toHaveBeenCalledWith({
      idempotencyRecordId: 'idem_record_1',
      operation: 'POST /api/v1/bookings/finalize',
    })

    expect(mocks.safeError).toHaveBeenCalledWith(thrown)

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'POST /api/v1/bookings/finalize error',
      {
        requestId: null,
        error: {
          name: 'Error',
          message: 'boom',
        },
      },
    )

    expect(mocks.completeRouteIdempotency).not.toHaveBeenCalled()
    expect(mocks.markAftercareAccessTokenUsed).not.toHaveBeenCalled()
    expect(mocks.captureBookingException).toHaveBeenCalledWith({
      error: thrown,
      route: 'POST /api/v1/bookings/finalize',
    })
  })

  it('includes request id in safe unexpected-error logs', async () => {
    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined)

    const thrown = new Error('boom with request id')
    mocks.finalizeBookingFromHold.mockRejectedValueOnce(thrown)

    const result = await POST(
      makeRequest(
        {
          offeringId: 'offering_1',
          holdId: 'hold_1',
          locationType: 'SALON',
        },
        {
          'idempotency-key': 'idem_boom_request_id_1',
          'x-request-id': 'request_123',
        },
      ),
    )

    expect(result.status).toBe(500)

    expect(mocks.safeError).toHaveBeenCalledWith(thrown)

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'POST /api/v1/bookings/finalize error',
      {
        requestId: 'request_123',
        error: {
          name: 'Error',
          message: 'boom with request id',
        },
      },
    )

    expect(mocks.captureBookingException).toHaveBeenCalledWith({
      error: thrown,
      route: 'POST /api/v1/bookings/finalize',
    })
  })

  it('marks idempotency failed when aftercare token usage update fails after finalize success', async () => {
    mocks.markAftercareAccessTokenUsed.mockRejectedValueOnce(
      new BookingError('AFTERCARE_TOKEN_INVALID', {
        message: 'Token usage failed.',
        userMessage: 'That aftercare link is invalid or expired.',
      }),
    )

    const result = await POST(
      makeIdempotentRequest({
        offeringId: 'offering_1',
        holdId: 'hold_1',
        locationType: 'SALON',
        source: 'AFTERCARE',
        aftercareToken: 'token_1',
      }),
    )

    expect(mocks.finalizeBookingFromHold).toHaveBeenCalled()
    expect(mocks.markAftercareAccessTokenUsed).toHaveBeenCalledWith({
      tokenId: 'token_row_1',
    })

    expect(mocks.completeRouteIdempotency).not.toHaveBeenCalled()

    expect(mocks.failStartedRouteIdempotency).toHaveBeenCalledWith({
      idempotencyRecordId: 'idem_record_1',
      operation: 'POST /api/v1/bookings/finalize',
    })

    expect(result.status).toBe(400)
    expectBookingFailPayload(await result.json(), 'AFTERCARE_TOKEN_INVALID', {
      error: 'That aftercare link is invalid or expired.',
      message: 'Token usage failed.',
    })
  })
})