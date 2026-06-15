// app/api/client/rebook/[token]/route.test.ts

import { AftercareRebookMode, Role } from '@prisma/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const TEST_NOW = new Date('2026-04-12T18:00:00.000Z')

const mocks = vi.hoisted(() => ({
  pickIsoDate: vi.fn(),
  pickString: vi.fn(),
  jsonFail: vi.fn(),
  jsonOk: vi.fn(),

  isRecord: vi.fn(),

  getBookingFailPayload: vi.fn(),
  isBookingError: vi.fn(),

  createClientRebookedBookingFromAftercare: vi.fn(),

  resolveAftercareAccessTokenForRead: vi.fn(),
  resolveAftercareAccessTokenForMutation: vi.fn(),
  markAftercareAccessTokenUsed: vi.fn(),

  withRouteIdempotency: vi.fn(),
  beginRouteIdempotency: vi.fn(),
  completeRouteIdempotency: vi.fn(),
  failStartedRouteIdempotency: vi.fn(),
  isRouteIdempotencyHandled: vi.fn(),

  captureBookingException: vi.fn(),

  enforceRateLimit: vi.fn(),
  tokenActorRateLimitKey: vi.fn(),
  rateLimitExceededResponse: vi.fn(),
}))

vi.mock('@/app/api/_utils', () => ({
  pickIsoDate: mocks.pickIsoDate,
  pickString: mocks.pickString,
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

vi.mock('@/lib/guards', () => ({
  isRecord: mocks.isRecord,
}))

vi.mock('@/lib/booking/errors', () => ({
  getBookingFailPayload: mocks.getBookingFailPayload,
  isBookingError: mocks.isBookingError,
}))

vi.mock('@/lib/booking/writeBoundary', () => ({
  createClientRebookedBookingFromAftercare:
    mocks.createClientRebookedBookingFromAftercare,
}))

vi.mock('@/lib/aftercare/aftercareAccessTokens', () => ({
  resolveAftercareAccessTokenForRead:
    mocks.resolveAftercareAccessTokenForRead,
  resolveAftercareAccessTokenForMutation:
    mocks.resolveAftercareAccessTokenForMutation,
  markAftercareAccessTokenUsed: mocks.markAftercareAccessTokenUsed,
}))

vi.mock('@/lib/idempotency', () => ({
  IDEMPOTENCY_ROUTES: {
    CLIENT_AFTERCARE_REBOOK: 'POST /api/client/rebook/[token]',
  },
}))

vi.mock('@/lib/observability/bookingEvents', () => ({
  captureBookingException: mocks.captureBookingException,
}))

vi.mock('@/lib/rateLimit/enforce', () => ({
  enforceRateLimit: mocks.enforceRateLimit,
}))

vi.mock('@/lib/rateLimit/identity', () => ({
  tokenActorRateLimitKey: mocks.tokenActorRateLimitKey,
}))

vi.mock('@/lib/rateLimit/response', () => ({
  rateLimitExceededResponse: mocks.rateLimitExceededResponse,
}))

import { IDEMPOTENCY_ROUTES } from '@/lib/idempotency'
import { GET, POST } from './route'

function makeJsonResponse(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'content-type': 'application/json',
    },
  })
}

function makeCtx(token = 'token_1') {
  return {
    params: Promise.resolve({ token }),
  }
}

function makeRequest(args?: {
  method?: 'GET' | 'POST'
  body?: unknown
  headers?: Record<string, string>
}): Request {
  return new Request('http://localhost/api/client/rebook/token_1', {
    method: args?.method ?? 'POST',
    headers: {
      'content-type': 'application/json',
      ...(args?.headers ?? {}),
    },
    body:
      args?.method === 'GET'
        ? undefined
        : JSON.stringify(args?.body ?? {}),
  })
}

function makeIdempotentRequest(args?: {
  body?: unknown
  key?: string
  headers?: Record<string, string>
}): Request {
  return makeRequest({
    body: args?.body,
    headers: {
      'idempotency-key': args?.key ?? 'idem_rebook_1',
      ...(args?.headers ?? {}),
    },
  })
}

function makeResolvedAftercareAccess(overrides?: {
  rebookMode?: AftercareRebookMode
  rebookWindowStart?: Date | null
  rebookWindowEnd?: Date | null
  firstUsedAt?: Date | null
  lastUsedAt?: Date | null
  useCount?: number
  singleUse?: boolean
  subtotalSnapshot?: { toString: () => string } | string
}) {
  const subtotalSnapshot =
    typeof overrides?.subtotalSnapshot === 'string'
      ? {
          toString: () => overrides.subtotalSnapshot,
        }
      : overrides?.subtotalSnapshot ?? {
          toString: () => '125.00',
        }

  return {
    accessSource: 'clientActionToken' as const,
    idempotencyActorKey: 'aftercare-token:token_row_1',
    token: {
      id: 'token_row_1',
      expiresAt: new Date('2026-04-20T18:00:00.000Z'),
      firstUsedAt:
        overrides && 'firstUsedAt' in overrides
          ? (overrides.firstUsedAt ?? null)
          : null,
      lastUsedAt:
        overrides && 'lastUsedAt' in overrides
          ? (overrides.lastUsedAt ?? null)
          : null,
      useCount: overrides?.useCount ?? 0,
      singleUse: overrides?.singleUse ?? false,
    },
    aftercare: {
      id: 'aftercare_1',
      bookingId: 'booking_1',
      notes: 'Use a sulfate-free shampoo.',
      rebookMode:
        overrides?.rebookMode ?? AftercareRebookMode.BOOKED_NEXT_APPOINTMENT,
      rebookedFor: new Date('2026-05-01T18:00:00.000Z'),
      rebookWindowStart:
        overrides && 'rebookWindowStart' in overrides
          ? (overrides.rebookWindowStart ?? null)
          : new Date('2026-04-20T18:00:00.000Z'),
      rebookWindowEnd:
        overrides && 'rebookWindowEnd' in overrides
          ? (overrides.rebookWindowEnd ?? null)
          : new Date('2026-04-30T18:00:00.000Z'),
      draftSavedAt: new Date('2026-04-12T17:00:00.000Z'),
      sentToClientAt: new Date('2026-04-12T17:30:00.000Z'),
      lastEditedAt: new Date('2026-04-12T17:15:00.000Z'),
      version: 2,
    },
    booking: {
      id: 'booking_1',
      clientId: 'client_1',
      professionalId: 'pro_1',
      serviceId: 'service_1',
      offeringId: 'offering_1',
      status: 'COMPLETED',
      scheduledFor: new Date('2026-04-10T18:00:00.000Z'),
      locationType: 'SALON',
      locationId: 'location_1',
      totalDurationMinutes: 75,
      subtotalSnapshot,
      service: {
        id: 'service_1',
        name: 'Haircut',
      },
      professional: {
        id: 'pro_1',
        businessName: 'TOVIS Studio',
        timeZone: 'America/Los_Angeles',
        location: null,
      },
    },
  }
}

function makeCreateRebookResult() {
  return {
    booking: {
      id: 'booking_2',
      status: 'PENDING',
      scheduledFor: new Date('2026-04-25T18:00:00.000Z'),
    },
    aftercare: {
      id: 'aftercare_1',
      rebookMode: AftercareRebookMode.BOOKED_NEXT_APPOINTMENT,
      rebookedFor: new Date('2026-05-01T18:00:00.000Z'),
    },
    meta: {
      mutated: true,
      noOp: false,
    },
  }
}

function expectedRebookResponseBody() {
  return {
    ok: true,
    booking: {
      id: 'booking_2',
      status: 'PENDING',
      scheduledFor: '2026-04-25T18:00:00.000Z',
    },
    aftercare: {
      id: 'aftercare_1',
      rebookMode: AftercareRebookMode.BOOKED_NEXT_APPOINTMENT,
      rebookedFor: '2026-05-01T18:00:00.000Z',
    },
    meta: {
      mutated: true,
      noOp: false,
    },
  }
}

function expectedIdempotencyRequestBody() {
  return {
    aftercareTokenId: 'token_row_1',
    aftercareId: 'aftercare_1',
    sourceBookingId: 'booking_1',
    clientId: 'client_1',
    scheduledFor: '2026-04-25T18:00:00.000Z',
  }
}

function setStartedIdempotencyDefault(key = 'idem_rebook_1'): void {
  mocks.beginRouteIdempotency.mockResolvedValue({
    kind: 'started',
    idempotencyRecordId: 'idem_record_1',
    idempotencyKey: key,
    requestHash: 'hash_1',
  })
}

describe('app/api/client/rebook/[token]/route.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(TEST_NOW)

    mocks.pickString.mockImplementation((value: unknown) => {
      if (typeof value !== 'string') return null
      const trimmed = value.trim()
      return trimmed.length > 0 ? trimmed : null
    })

    mocks.pickIsoDate.mockImplementation((value: unknown) => {
      if (typeof value !== 'string') return null
      const parsed = new Date(value)
      return Number.isNaN(parsed.getTime()) ? null : parsed
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

    mocks.isRecord.mockImplementation(
      (value: unknown) =>
        typeof value === 'object' && value !== null && !Array.isArray(value),
    )

    mocks.isBookingError.mockReturnValue(false)

    mocks.getBookingFailPayload.mockImplementation(
      (
        code: string,
        overrides?: { message?: string; userMessage?: string },
      ) => ({
        httpStatus:
          code === 'AFTERCARE_TOKEN_MISSING'
            ? 400
            : code === 'AFTERCARE_TOKEN_INVALID'
              ? 400
              : 409,
        userMessage: overrides?.userMessage ?? code,
        extra: {
          code,
          ...(overrides?.message ? { message: overrides.message } : {}),
        },
      }),
    )

    mocks.resolveAftercareAccessTokenForRead.mockResolvedValue(
      makeResolvedAftercareAccess(),
    )

    mocks.resolveAftercareAccessTokenForMutation.mockResolvedValue(
      makeResolvedAftercareAccess(),
    )

    mocks.markAftercareAccessTokenUsed.mockResolvedValue({
      id: 'token_row_1',
      expiresAt: new Date('2026-04-20T18:00:00.000Z'),
      firstUsedAt: TEST_NOW,
      lastUsedAt: TEST_NOW,
      useCount: 1,
      singleUse: false,
    })

    mocks.tokenActorRateLimitKey.mockReturnValue(
      'token:hashed_token_1|ip:unknown-ip',
    )

    mocks.enforceRateLimit.mockResolvedValue({
      allowed: true,
      bucket: 'client:rebook:token',
      key: 'token:hashed_token_1|ip:unknown-ip',
      limit: 10,
      remaining: 9,
      resetAt: new Date('2026-04-12T18:05:00.000Z'),
      retryAfterSeconds: 300,
      source: 'redis',
    })

    setStartedIdempotencyDefault()

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

    mocks.completeRouteIdempotency.mockResolvedValue(undefined)
    mocks.failStartedRouteIdempotency.mockResolvedValue(undefined)

    mocks.createClientRebookedBookingFromAftercare.mockResolvedValue(
      makeCreateRebookResult(),
    )
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('GET maps missing route token through bookingJsonFail', async () => {
    const response = await GET(makeRequest({ method: 'GET' }), makeCtx('   '))

    expect(mocks.getBookingFailPayload).toHaveBeenCalledWith(
      'AFTERCARE_TOKEN_MISSING',
      {
        message: 'Aftercare access token is missing from route params.',
        userMessage: 'That aftercare link is invalid or expired.',
      },
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: 'That aftercare link is invalid or expired.',
      code: 'AFTERCARE_TOKEN_MISSING',
      message: 'Aftercare access token is missing from route params.',
    })

    expect(mocks.resolveAftercareAccessTokenForRead).not.toHaveBeenCalled()
    expect(mocks.markAftercareAccessTokenUsed).not.toHaveBeenCalled()
  })

  it('GET resolves token-backed access without consuming token usage and returns secure-link payload', async () => {
    mocks.resolveAftercareAccessTokenForRead.mockResolvedValueOnce(
      makeResolvedAftercareAccess({
        firstUsedAt: new Date('2026-04-12T17:55:00.000Z'),
        lastUsedAt: new Date('2026-04-12T17:58:00.000Z'),
        useCount: 2,
        singleUse: true,
        subtotalSnapshot: '125.00',
      }),
    )

    const response = await GET(
      makeRequest({ method: 'GET' }),
      makeCtx('token_from_route'),
    )

    expect(mocks.resolveAftercareAccessTokenForRead).toHaveBeenCalledWith({
      rawToken: 'token_from_route',
    })

    expect(mocks.markAftercareAccessTokenUsed).not.toHaveBeenCalled()

    expect(response.status).toBe(200)

    const body = await response.json()

    expect(JSON.stringify(body)).not.toContain('publicToken')

    expect(body).toEqual({
      ok: true,
      accessSource: 'clientActionToken',
      token: {
        id: 'token_row_1',
        expiresAt: '2026-04-20T18:00:00.000Z',
        firstUsedAt: '2026-04-12T17:55:00.000Z',
        lastUsedAt: '2026-04-12T17:58:00.000Z',
        useCount: 2,
        singleUse: true,
      },
      aftercare: {
        id: 'aftercare_1',
        bookingId: 'booking_1',
        notes: 'Use a sulfate-free shampoo.',
        rebookMode: AftercareRebookMode.BOOKED_NEXT_APPOINTMENT,
        rebookedFor: '2026-05-01T18:00:00.000Z',
        rebookWindowStart: '2026-04-20T18:00:00.000Z',
        rebookWindowEnd: '2026-04-30T18:00:00.000Z',
        draftSavedAt: '2026-04-12T17:00:00.000Z',
        sentToClientAt: '2026-04-12T17:30:00.000Z',
        lastEditedAt: '2026-04-12T17:15:00.000Z',
        version: 2,
        isFinalized: true,
        publicAccess: {
          accessMode: 'SECURE_LINK',
          hasPublicAccess: true,
          clientAftercareHref: '/client/rebook/token_from_route',
        },
      },
      booking: {
        id: 'booking_1',
        clientId: 'client_1',
        professionalId: 'pro_1',
        serviceId: 'service_1',
        offeringId: 'offering_1',
        status: 'COMPLETED',
        scheduledFor: '2026-04-10T18:00:00.000Z',
        locationType: 'SALON',
        locationId: 'location_1',
        totalDurationMinutes: 75,
        subtotalSnapshot: '125.00',
        service: {
          id: 'service_1',
          name: 'Haircut',
        },
        professional: {
          id: 'pro_1',
          businessName: 'TOVIS Studio',
          timeZone: 'America/Los_Angeles',
          location: null,
        },
      },
    })
  })

  it('POST maps missing route token through bookingJsonFail', async () => {
    const response = await POST(
      makeRequest({
        body: { scheduledFor: '2026-04-25T18:00:00.000Z' },
      }),
      makeCtx('   '),
    )

    expect(mocks.getBookingFailPayload).toHaveBeenCalledWith(
      'AFTERCARE_TOKEN_MISSING',
      {
        message: 'Aftercare access token is missing from route params.',
        userMessage: 'That aftercare link is invalid or expired.',
      },
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: 'That aftercare link is invalid or expired.',
      code: 'AFTERCARE_TOKEN_MISSING',
      message: 'Aftercare access token is missing from route params.',
    })

    expect(mocks.resolveAftercareAccessTokenForMutation).not.toHaveBeenCalled()
    expect(mocks.beginRouteIdempotency).not.toHaveBeenCalled()
    expect(
      mocks.createClientRebookedBookingFromAftercare,
    ).not.toHaveBeenCalled()
    expect(mocks.markAftercareAccessTokenUsed).not.toHaveBeenCalled()
  })

  it('POST returns 400 when scheduledFor is missing or invalid', async () => {
    const response = await POST(
      makeRequest({
        body: { scheduledFor: 'definitely-not-a-date' },
      }),
      makeCtx('token_1'),
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: 'Missing or invalid scheduledFor.',
    })

    expect(mocks.enforceRateLimit).not.toHaveBeenCalled()
    expect(mocks.resolveAftercareAccessTokenForMutation).not.toHaveBeenCalled()
    expect(mocks.beginRouteIdempotency).not.toHaveBeenCalled()
    expect(
      mocks.createClientRebookedBookingFromAftercare,
    ).not.toHaveBeenCalled()
    expect(mocks.markAftercareAccessTokenUsed).not.toHaveBeenCalled()
  })

  it('POST returns 400 when scheduledFor is in the past', async () => {
    const response = await POST(
      makeRequest({
        body: { scheduledFor: '2026-04-10T18:00:00.000Z' },
      }),
      makeCtx('token_1'),
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: 'Pick a future time.',
    })

    expect(mocks.enforceRateLimit).not.toHaveBeenCalled()
    expect(mocks.resolveAftercareAccessTokenForMutation).not.toHaveBeenCalled()
    expect(mocks.beginRouteIdempotency).not.toHaveBeenCalled()
    expect(mocks.markAftercareAccessTokenUsed).not.toHaveBeenCalled()
  })

  it('POST returns rate-limit response before token mutation lookup or idempotency', async () => {
    const blockedDecision = {
      allowed: false,
      bucket: 'client:rebook:token',
      key: 'token:hashed_token_1|ip:unknown-ip',
      limit: 10,
      remaining: 0,
      resetAt: new Date('2026-04-12T18:05:00.000Z'),
      retryAfterSeconds: 300,
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

    const response = await POST(
      makeIdempotentRequest({
        key: 'idem_rate_limited_1',
        body: { scheduledFor: '2026-04-25T18:00:00.000Z' },
      }),
      makeCtx('token_1'),
    )

    expect(response).toBe(limitedResponse)

    expect(mocks.tokenActorRateLimitKey).toHaveBeenCalledWith({
      actorKey: 'token_1',
      request: expect.any(Request),
    })

    expect(mocks.enforceRateLimit).toHaveBeenCalledWith({
      bucket: 'client:rebook:token',
      key: 'token:hashed_token_1|ip:unknown-ip',
    })

    expect(mocks.rateLimitExceededResponse).toHaveBeenCalledWith(
      blockedDecision,
    )

    expect(mocks.resolveAftercareAccessTokenForMutation).not.toHaveBeenCalled()
    expect(mocks.beginRouteIdempotency).not.toHaveBeenCalled()
    expect(
      mocks.createClientRebookedBookingFromAftercare,
    ).not.toHaveBeenCalled()
    expect(mocks.markAftercareAccessTokenUsed).not.toHaveBeenCalled()
    expect(mocks.completeRouteIdempotency).not.toHaveBeenCalled()
  })

  it('POST returns 409 when requested time is outside the recommended window before idempotency starts', async () => {
    mocks.resolveAftercareAccessTokenForMutation.mockResolvedValueOnce(
      makeResolvedAftercareAccess({
        rebookMode: AftercareRebookMode.RECOMMENDED_WINDOW,
        rebookWindowStart: new Date('2026-04-20T18:00:00.000Z'),
        rebookWindowEnd: new Date('2026-04-25T18:00:00.000Z'),
      }),
    )

    const response = await POST(
      makeRequest({
        body: { scheduledFor: '2026-04-28T18:00:00.000Z' },
      }),
      makeCtx('token_1'),
    )

    expect(mocks.enforceRateLimit).toHaveBeenCalledWith({
      bucket: 'client:rebook:token',
      key: 'token:hashed_token_1|ip:unknown-ip',
    })

    expect(mocks.resolveAftercareAccessTokenForMutation).toHaveBeenCalledWith({
      rawToken: 'token_1',
    })

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: 'Selected time is outside the recommended rebook window.',
    })

    expect(mocks.beginRouteIdempotency).not.toHaveBeenCalled()
    expect(
      mocks.createClientRebookedBookingFromAftercare,
    ).not.toHaveBeenCalled()
    expect(mocks.markAftercareAccessTokenUsed).not.toHaveBeenCalled()
  })

  it('POST returns handled idempotency response without creating another booking or marking token used', async () => {
    const handledResponse = makeJsonResponse(400, {
      ok: false,
      error: 'Missing idempotency key.',
      code: 'IDEMPOTENCY_KEY_REQUIRED',
    })

    mocks.beginRouteIdempotency.mockResolvedValueOnce({
      kind: 'handled',
      response: handledResponse,
    })

    const response = await POST(
      makeRequest({
        body: { scheduledFor: '2026-04-25T18:00:00.000Z' },
      }),
      makeCtx('token_1'),
    )

    expect(response).toBe(handledResponse)
    expect(
      mocks.createClientRebookedBookingFromAftercare,
    ).not.toHaveBeenCalled()
    expect(mocks.completeRouteIdempotency).not.toHaveBeenCalled()
    expect(mocks.markAftercareAccessTokenUsed).not.toHaveBeenCalled()
  })

  it.each([
    [
      'missing idempotency key',
      {
        status: 400,
        body: {
          ok: false,
          error: 'Missing idempotency key.',
          code: 'IDEMPOTENCY_KEY_REQUIRED',
        },
      },
    ],
    [
      'in-progress idempotency request',
      {
        status: 409,
        body: {
          ok: false,
          error: 'A matching rebook request is already in progress.',
          code: 'IDEMPOTENCY_IN_PROGRESS',
        },
      },
    ],
    [
      'idempotency conflict',
      {
        status: 409,
        body: {
          ok: false,
          error:
            'This idempotency key was already used with a different request body.',
          code: 'IDEMPOTENCY_CONFLICT',
        },
      },
    ],
  ])(
    'POST returns handled idempotency response for %s without side effects',
    async (_label, handled) => {
      const handledResponse = makeJsonResponse(handled.status, handled.body)

      mocks.beginRouteIdempotency.mockResolvedValueOnce({
        kind: 'handled',
        response: handledResponse,
      })

      const response = await POST(
        makeRequest({
          body: { scheduledFor: '2026-04-25T18:00:00.000Z' },
        }),
        makeCtx('token_1'),
      )

      expect(response).toBe(handledResponse)
      await expect(response.clone().json()).resolves.toEqual(handled.body)

      expect(
        mocks.createClientRebookedBookingFromAftercare,
      ).not.toHaveBeenCalled()
      expect(mocks.completeRouteIdempotency).not.toHaveBeenCalled()
      expect(mocks.markAftercareAccessTokenUsed).not.toHaveBeenCalled()
    },
  )

  it('POST replays a completed idempotent response without creating another booking or marking token used', async () => {
    const replayBody = expectedRebookResponseBody()
    const replayResponse = makeJsonResponse(201, replayBody)

    mocks.beginRouteIdempotency.mockResolvedValueOnce({
      kind: 'handled',
      response: replayResponse,
    })

    const response = await POST(
      makeIdempotentRequest({
        key: 'idem_replay_1',
        body: { scheduledFor: '2026-04-25T18:00:00.000Z' },
      }),
      makeCtx('token_1'),
    )

    expect(response).toBe(replayResponse)
    await expect(response.clone().json()).resolves.toEqual(replayBody)

    expect(
      mocks.createClientRebookedBookingFromAftercare,
    ).not.toHaveBeenCalled()
    expect(mocks.completeRouteIdempotency).not.toHaveBeenCalled()
    expect(mocks.markAftercareAccessTokenUsed).not.toHaveBeenCalled()
  })

  it('POST stops before idempotency when mutation token resolution fails', async () => {
    const bookingError = {
      code: 'AFTERCARE_TOKEN_INVALID',
      message: 'Aftercare access token was revoked.',
      userMessage: 'That aftercare link is invalid or expired.',
    }

    mocks.resolveAftercareAccessTokenForMutation.mockRejectedValueOnce(
      bookingError,
    )
    mocks.isBookingError.mockReturnValueOnce(true)
    mocks.getBookingFailPayload.mockReturnValueOnce({
      httpStatus: 400,
      userMessage: 'That aftercare link is invalid or expired.',
      extra: {
        code: 'AFTERCARE_TOKEN_INVALID',
        message: 'Aftercare access token was revoked.',
      },
    })

    const response = await POST(
      makeIdempotentRequest({
        key: 'idem_revoked_token_1',
        body: { scheduledFor: '2026-04-25T18:00:00.000Z' },
      }),
      makeCtx('revoked_token'),
    )

    expect(mocks.tokenActorRateLimitKey).toHaveBeenCalledWith({
      actorKey: 'revoked_token',
      request: expect.any(Request),
    })

    expect(mocks.enforceRateLimit).toHaveBeenCalledWith({
      bucket: 'client:rebook:token',
      key: 'token:hashed_token_1|ip:unknown-ip',
    })

    expect(mocks.resolveAftercareAccessTokenForMutation).toHaveBeenCalledWith({
      rawToken: 'revoked_token',
    })

    expect(mocks.beginRouteIdempotency).not.toHaveBeenCalled()
    expect(
      mocks.createClientRebookedBookingFromAftercare,
    ).not.toHaveBeenCalled()
    expect(mocks.markAftercareAccessTokenUsed).not.toHaveBeenCalled()
    expect(mocks.failStartedRouteIdempotency).not.toHaveBeenCalled()

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: 'That aftercare link is invalid or expired.',
      code: 'AFTERCARE_TOKEN_INVALID',
      message: 'Aftercare access token was revoked.',
    })
  })

  it('POST starts idempotency with token actor and normalized request body', async () => {
    await POST(
      makeIdempotentRequest({
        body: { scheduledFor: '2026-04-25T18:00:00.000Z' },
        key: 'idem_1',
      }),
      makeCtx('token_1'),
    )

    expect(mocks.beginRouteIdempotency).toHaveBeenCalledWith({
      request: expect.any(Request),
      actor: {
        actorKey: 'aftercare-token:token_row_1',
        actorRole: Role.CLIENT,
      },
      route: IDEMPOTENCY_ROUTES.CLIENT_AFTERCARE_REBOOK,
      requestLabel: 'aftercare rebook',
      requestBody: expectedIdempotencyRequestBody(),
      messages: {
        missingKey: 'Missing idempotency key.',
        inProgress: 'A matching rebook request is already in progress.',
        conflict:
          'This idempotency key was already used with a different request body.',
      },
      operation: 'POST /api/client/rebook/[token]',
    })
  })

  it('POST creates a rebooked booking, marks token used, completes idempotency, and returns response', async () => {
    mocks.beginRouteIdempotency.mockResolvedValueOnce({
      kind: 'started',
      idempotencyRecordId: 'idem_record_1',
      idempotencyKey: 'idem_1',
      requestHash: 'hash_1',
    })

    const response = await POST(
      makeIdempotentRequest({
        key: 'idem_1',
        body: { scheduledFor: '2026-04-25T18:00:00.000Z' },
        headers: {
          'x-request-id': 'req_1',
        },
      }),
      makeCtx('token_1'),
    )

    expect(mocks.resolveAftercareAccessTokenForMutation).toHaveBeenCalledWith({
      rawToken: 'token_1',
    })

    expect(
      mocks.createClientRebookedBookingFromAftercare,
    ).toHaveBeenCalledWith({
      aftercareId: 'aftercare_1',
      bookingId: 'booking_1',
      clientId: 'client_1',
      aftercareClientActionTokenId: 'token_row_1',
      scheduledFor: new Date('2026-04-25T18:00:00.000Z'),
      requestId: 'req_1',
      idempotencyKey: 'idem_1',
    })

    expect(mocks.markAftercareAccessTokenUsed).toHaveBeenCalledWith({
      tokenId: 'token_row_1',
    })

    const responseBody = expectedRebookResponseBody()

    expect(mocks.completeRouteIdempotency).toHaveBeenCalledWith({
      idempotencyRecordId: 'idem_record_1',
      responseStatus: 201,
      responseBody,
    })

    expect(response.status).toBe(201)
    await expect(response.json()).resolves.toEqual(responseBody)
  })

  it('maps BookingError through bookingJsonFail for GET', async () => {
    const bookingError = {
      code: 'AFTERCARE_TOKEN_INVALID',
      message: 'Aftercare access token was not found.',
      userMessage: 'That aftercare link is invalid or expired.',
    }

    mocks.resolveAftercareAccessTokenForRead.mockRejectedValueOnce(bookingError)
    mocks.isBookingError.mockReturnValueOnce(true)
    mocks.getBookingFailPayload.mockReturnValueOnce({
      httpStatus: 400,
      userMessage: 'That aftercare link is invalid or expired.',
      extra: {
        code: 'AFTERCARE_TOKEN_INVALID',
        message: 'Aftercare access token was not found.',
      },
    })

    const response = await GET(
      makeRequest({ method: 'GET' }),
      makeCtx('token_1'),
    )

    expect(mocks.getBookingFailPayload).toHaveBeenCalledWith(
      'AFTERCARE_TOKEN_INVALID',
      {
        message: 'Aftercare access token was not found.',
        userMessage: 'That aftercare link is invalid or expired.',
      },
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: 'That aftercare link is invalid or expired.',
      code: 'AFTERCARE_TOKEN_INVALID',
      message: 'Aftercare access token was not found.',
    })
  })

  it('maps BookingError through bookingJsonFail for POST and marks idempotency failed', async () => {
    const bookingError = {
      code: 'TIME_NOT_AVAILABLE',
      message: 'Requested time is no longer available.',
      userMessage:
        'That time is no longer available. Please refresh and select a different slot.',
    }

    mocks.createClientRebookedBookingFromAftercare.mockRejectedValueOnce(
      bookingError,
    )
    mocks.isBookingError.mockReturnValueOnce(true)
    mocks.getBookingFailPayload.mockReturnValueOnce({
      httpStatus: 409,
      userMessage:
        'That time is no longer available. Please refresh and select a different slot.',
      extra: {
        code: 'TIME_NOT_AVAILABLE',
        message: 'Requested time is no longer available.',
      },
    })

    const response = await POST(
      makeIdempotentRequest({
        key: 'idem_booking_error_1',
        body: { scheduledFor: '2026-04-25T18:00:00.000Z' },
      }),
      makeCtx('token_1'),
    )

    expect(mocks.failStartedRouteIdempotency).toHaveBeenCalledWith({
      idempotencyRecordId: 'idem_record_1',
      operation: 'POST /api/client/rebook/[token]',
    })

    expect(mocks.getBookingFailPayload).toHaveBeenCalledWith(
      'TIME_NOT_AVAILABLE',
      {
        message: 'Requested time is no longer available.',
        userMessage:
          'That time is no longer available. Please refresh and select a different slot.',
      },
    )

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error:
        'That time is no longer available. Please refresh and select a different slot.',
      code: 'TIME_NOT_AVAILABLE',
      message: 'Requested time is no longer available.',
    })

    expect(mocks.markAftercareAccessTokenUsed).not.toHaveBeenCalled()
  })

  it('returns 500 for unexpected GET errors', async () => {
    mocks.resolveAftercareAccessTokenForRead.mockRejectedValueOnce(
      new Error('boom'),
    )

    const response = await GET(
      makeRequest({ method: 'GET' }),
      makeCtx('token_1'),
    )

    expect(mocks.captureBookingException).toHaveBeenCalledWith({
      error: expect.any(Error),
      route: 'GET /api/client/rebook/[token]',
    })

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: 'Internal server error',
    })
  })

  it('returns 500 for unexpected POST errors and marks idempotency failed', async () => {
    mocks.createClientRebookedBookingFromAftercare.mockRejectedValueOnce(
      new Error('boom'),
    )

    const response = await POST(
      makeIdempotentRequest({
        key: 'idem_boom_1',
        body: { scheduledFor: '2026-04-25T18:00:00.000Z' },
      }),
      makeCtx('token_1'),
    )

    expect(mocks.failStartedRouteIdempotency).toHaveBeenCalledWith({
      idempotencyRecordId: 'idem_record_1',
      operation: 'POST /api/client/rebook/[token]',
    })

    expect(mocks.captureBookingException).toHaveBeenCalledWith({
      error: expect.any(Error),
      route: 'POST /api/client/rebook/[token]',
    })

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: 'Internal server error',
    })

    expect(mocks.markAftercareAccessTokenUsed).not.toHaveBeenCalled()
  })

  it('marks idempotency failed when token usage update fails after booking creation', async () => {
    const bookingError = {
      code: 'AFTERCARE_TOKEN_INVALID',
      message: 'Token usage failed.',
      userMessage: 'That aftercare link is invalid or expired.',
    }

    mocks.markAftercareAccessTokenUsed.mockRejectedValueOnce(bookingError)
    mocks.isBookingError.mockReturnValueOnce(true)
    mocks.getBookingFailPayload.mockReturnValueOnce({
      httpStatus: 400,
      userMessage: 'That aftercare link is invalid or expired.',
      extra: {
        code: 'AFTERCARE_TOKEN_INVALID',
        message: 'Token usage failed.',
      },
    })

    const response = await POST(
      makeIdempotentRequest({
        key: 'idem_token_usage_failure',
        body: { scheduledFor: '2026-04-25T18:00:00.000Z' },
      }),
      makeCtx('token_1'),
    )

    expect(
      mocks.createClientRebookedBookingFromAftercare,
    ).toHaveBeenCalled()

    expect(mocks.markAftercareAccessTokenUsed).toHaveBeenCalledWith({
      tokenId: 'token_row_1',
    })

    expect(mocks.completeRouteIdempotency).not.toHaveBeenCalled()

    expect(mocks.failStartedRouteIdempotency).toHaveBeenCalledWith({
      idempotencyRecordId: 'idem_record_1',
      operation: 'POST /api/client/rebook/[token]',
    })

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: 'That aftercare link is invalid or expired.',
      code: 'AFTERCARE_TOKEN_INVALID',
      message: 'Token usage failed.',
    })
  })
})