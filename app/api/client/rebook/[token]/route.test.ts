import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'
import { AftercareRebookMode } from '@prisma/client'

const TEST_NOW = new Date('2026-04-12T18:00:00.000Z')
const IDEMPOTENCY_ROUTE = 'POST /api/client/rebook/[token]'

const mocks = vi.hoisted(() => ({
  pickIsoDate: vi.fn(),
  pickString: vi.fn(),
  jsonFail: vi.fn(),
  jsonOk: vi.fn(),

  isRecord: vi.fn(),

  getBookingFailPayload: vi.fn(),
  isBookingError: vi.fn(),

  createClientRebookedBookingFromAftercare: vi.fn(),
  resolveAftercareAccessByToken: vi.fn(),

  beginIdempotency: vi.fn(),
  buildPublicAftercareTokenActorKey: vi.fn(),
  completeIdempotency: vi.fn(),
  failIdempotency: vi.fn(),

  captureBookingException: vi.fn(),
}))

vi.mock('@/app/api/_utils', () => ({
  pickIsoDate: mocks.pickIsoDate,
  pickString: mocks.pickString,
  jsonFail: mocks.jsonFail,
  jsonOk: mocks.jsonOk,
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

vi.mock('@/lib/aftercare/unclaimedAftercareAccess', () => ({
  resolveAftercareAccessByToken: mocks.resolveAftercareAccessByToken,
}))

vi.mock('@/lib/idempotency', () => ({
  beginIdempotency: mocks.beginIdempotency,
  buildPublicAftercareTokenActorKey: mocks.buildPublicAftercareTokenActorKey,
  completeIdempotency: mocks.completeIdempotency,
  failIdempotency: mocks.failIdempotency,
  IDEMPOTENCY_ROUTES: {
    CLIENT_AFTERCARE_REBOOK: 'POST /api/client/rebook/[token]',
  },
}))

vi.mock('@/lib/observability/bookingEvents', () => ({
  captureBookingException: mocks.captureBookingException,
}))

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
}): NextRequest {
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
  }) as unknown as NextRequest
}

function makeIdempotentRequest(args?: {
  body?: unknown
  key?: string
  headers?: Record<string, string>
}): NextRequest {
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
  subtotalSnapshot?: string
}) {
  return {
    accessSource: 'clientActionToken' as const,
    token: {
      id: 'token_row_1',
      expiresAt: new Date('2026-04-20T18:00:00.000Z'),
      firstUsedAt:
        overrides?.firstUsedAt === undefined ? null : overrides.firstUsedAt,
      lastUsedAt:
        overrides?.lastUsedAt === undefined ? null : overrides.lastUsedAt,
      useCount: overrides?.useCount ?? 0,
      singleUse: overrides?.singleUse ?? false,
    },
    aftercare: {
      id: 'aftercare_1',
      bookingId: 'booking_1',
      publicToken: 'legacy_public_token_should_not_drive_response',
      notes: 'Use a sulfate-free shampoo.',
      rebookMode:
        overrides?.rebookMode ?? AftercareRebookMode.BOOKED_NEXT_APPOINTMENT,
      rebookedFor: new Date('2026-05-01T18:00:00.000Z'),
      rebookWindowStart:
        overrides?.rebookWindowStart ??
        new Date('2026-04-20T18:00:00.000Z'),
      rebookWindowEnd:
        overrides?.rebookWindowEnd ??
        new Date('2026-04-30T18:00:00.000Z'),
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
      subtotalSnapshot: overrides?.subtotalSnapshot ?? '125.00',
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
    scheduledFor: new Date('2026-04-25T18:00:00.000Z'),
  }
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

    mocks.resolveAftercareAccessByToken.mockResolvedValue(
      makeResolvedAftercareAccess(),
    )

    mocks.buildPublicAftercareTokenActorKey.mockImplementation(
      (tokenId: string) => `public-aftercare-token:${tokenId}`,
    )

    mocks.beginIdempotency.mockImplementation(
      async (args: { key: string | null }) => {
        const key = args.key?.trim()

        if (!key) {
          return { kind: 'missing_key' }
        }

        return {
          kind: 'started',
          idempotencyRecordId: 'idem_record_1',
          requestHash: 'hash_1',
        }
      },
    )

    mocks.completeIdempotency.mockResolvedValue(undefined)
    mocks.failIdempotency.mockResolvedValue(undefined)

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

    expect(mocks.resolveAftercareAccessByToken).not.toHaveBeenCalled()
  })

  it('GET resolves token-backed access and returns the secure-link payload using the route token', async () => {
    mocks.resolveAftercareAccessByToken.mockResolvedValueOnce(
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

    expect(mocks.resolveAftercareAccessByToken).toHaveBeenCalledWith({
      rawToken: 'token_from_route',
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
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

    expect(mocks.resolveAftercareAccessByToken).not.toHaveBeenCalled()
    expect(mocks.beginIdempotency).not.toHaveBeenCalled()
    expect(
      mocks.createClientRebookedBookingFromAftercare,
    ).not.toHaveBeenCalled()
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

    expect(mocks.resolveAftercareAccessByToken).not.toHaveBeenCalled()
    expect(mocks.beginIdempotency).not.toHaveBeenCalled()
    expect(
      mocks.createClientRebookedBookingFromAftercare,
    ).not.toHaveBeenCalled()
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

    expect(mocks.resolveAftercareAccessByToken).not.toHaveBeenCalled()
    expect(mocks.beginIdempotency).not.toHaveBeenCalled()
  })

  it('POST returns 409 when requested time is outside the recommended window', async () => {
    mocks.resolveAftercareAccessByToken.mockResolvedValueOnce(
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

    expect(mocks.resolveAftercareAccessByToken).toHaveBeenCalledWith({
      rawToken: 'token_1',
    })

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: 'Selected time is outside the recommended rebook window.',
    })

    expect(mocks.beginIdempotency).not.toHaveBeenCalled()
    expect(
      mocks.createClientRebookedBookingFromAftercare,
    ).not.toHaveBeenCalled()
  })

  it('POST returns missing idempotency key for valid rebook request without idempotency header', async () => {
    const response = await POST(
      makeRequest({
        body: { scheduledFor: '2026-04-25T18:00:00.000Z' },
      }),
      makeCtx('token_1'),
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: 'Missing idempotency key.',
      code: 'IDEMPOTENCY_KEY_REQUIRED',
    })

    expect(mocks.beginIdempotency).toHaveBeenCalledWith({
      actor: {
        actorUserId: null,
        actorKey: 'public-aftercare-token:token_row_1',
        actorRole: 'CLIENT',
      },
      route: IDEMPOTENCY_ROUTE,
      key: null,
      requestBody: expectedIdempotencyRequestBody(),
    })

    expect(
      mocks.createClientRebookedBookingFromAftercare,
    ).not.toHaveBeenCalled()
    expect(mocks.completeIdempotency).not.toHaveBeenCalled()
  })

  it('POST returns in-progress when idempotency ledger has an active matching request', async () => {
    mocks.beginIdempotency.mockResolvedValueOnce({
      kind: 'in_progress',
    })

    const response = await POST(
      makeIdempotentRequest({
        body: { scheduledFor: '2026-04-25T18:00:00.000Z' },
      }),
      makeCtx('token_1'),
    )

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: 'A matching rebook request is already in progress.',
      code: 'IDEMPOTENCY_REQUEST_IN_PROGRESS',
    })

    expect(
      mocks.createClientRebookedBookingFromAftercare,
    ).not.toHaveBeenCalled()
    expect(mocks.completeIdempotency).not.toHaveBeenCalled()
  })

  it('POST returns conflict when idempotency key was reused with a different body', async () => {
    mocks.beginIdempotency.mockResolvedValueOnce({
      kind: 'conflict',
    })

    const response = await POST(
      makeIdempotentRequest({
        body: { scheduledFor: '2026-04-25T18:00:00.000Z' },
      }),
      makeCtx('token_1'),
    )

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error:
        'This idempotency key was already used with a different request body.',
      code: 'IDEMPOTENCY_KEY_CONFLICT',
    })

    expect(
      mocks.createClientRebookedBookingFromAftercare,
    ).not.toHaveBeenCalled()
    expect(mocks.completeIdempotency).not.toHaveBeenCalled()
  })

  it('POST replays completed idempotency response without creating another booking', async () => {
    const replayBody = expectedRebookResponseBody()

    mocks.beginIdempotency.mockResolvedValueOnce({
      kind: 'replay',
      responseStatus: 201,
      responseBody: replayBody,
    })

    const response = await POST(
      makeIdempotentRequest({
        body: { scheduledFor: '2026-04-25T18:00:00.000Z' },
      }),
      makeCtx('token_1'),
    )

    expect(response.status).toBe(201)
    await expect(response.json()).resolves.toEqual({
      ok: true,
      ...replayBody,
    })

    expect(
      mocks.createClientRebookedBookingFromAftercare,
    ).not.toHaveBeenCalled()
    expect(mocks.completeIdempotency).not.toHaveBeenCalled()
  })

  it('POST creates a rebooked booking using token-resolved ownership, request metadata, and durable idempotency', async () => {
    mocks.resolveAftercareAccessByToken.mockResolvedValueOnce(
      makeResolvedAftercareAccess({
        rebookMode: AftercareRebookMode.BOOKED_NEXT_APPOINTMENT,
      }),
    )

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

    expect(mocks.resolveAftercareAccessByToken).toHaveBeenCalledWith({
      rawToken: 'token_1',
    })

    expect(mocks.beginIdempotency).toHaveBeenCalledWith({
      actor: {
        actorUserId: null,
        actorKey: 'public-aftercare-token:token_row_1',
        actorRole: 'CLIENT',
      },
      route: IDEMPOTENCY_ROUTE,
      key: 'idem_1',
      requestBody: expectedIdempotencyRequestBody(),
    })

    expect(
      mocks.createClientRebookedBookingFromAftercare,
    ).toHaveBeenCalledWith({
      aftercareId: 'aftercare_1',
      bookingId: 'booking_1',
      clientId: 'client_1',
      scheduledFor: new Date('2026-04-25T18:00:00.000Z'),
      requestId: 'req_1',
      idempotencyKey: 'idem_1',
    })

    const responseBody = expectedRebookResponseBody()

    expect(mocks.completeIdempotency).toHaveBeenCalledWith({
      idempotencyRecordId: 'idem_record_1',
      responseStatus: 201,
      responseBody,
    })

    expect(response.status).toBe(201)
    await expect(response.json()).resolves.toEqual({
      ok: true,
      ...responseBody,
    })
  })

  it('maps BookingError through bookingJsonFail for GET', async () => {
    const bookingError = {
      code: 'AFTERCARE_TOKEN_INVALID',
      message: 'Aftercare access token was not found.',
      userMessage: 'That aftercare link is invalid or expired.',
    }

    mocks.resolveAftercareAccessByToken.mockRejectedValueOnce(bookingError)
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

    expect(mocks.failIdempotency).toHaveBeenCalledWith({
      idempotencyRecordId: 'idem_record_1',
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
  })

  it('returns 500 for unexpected GET errors', async () => {
    mocks.resolveAftercareAccessByToken.mockRejectedValueOnce(new Error('boom'))

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

    expect(mocks.failIdempotency).toHaveBeenCalledWith({
      idempotencyRecordId: 'idem_record_1',
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
  })
})