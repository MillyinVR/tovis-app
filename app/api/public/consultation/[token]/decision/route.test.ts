// app/api/public/consultation/[token]/decision/route.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ClientActionTokenKind, Role } from '@prisma/client'

const IDEMPOTENCY_ROUTE = 'POST /api/public/consultation/[token]/decision'
const OPERATION = 'POST /api/public/consultation/[token]/decision'

const approvedResponseBody = {
  action: 'APPROVE',
  booking: {
    id: 'booking_1',
    serviceId: 'svc_1',
    offeringId: 'off_1',
    subtotalSnapshot: '125.00',
    totalDurationMinutes: 75,
    consultationConfirmedAt: '2026-04-12T18:00:00.000Z',
  },
  approval: {
    id: 'approval_1',
    status: 'APPROVED',
    approvedAt: '2026-04-12T18:00:00.000Z',
    rejectedAt: null,
  },
  proof: {
    id: 'proof_1',
    decision: 'APPROVED',
    method: 'REMOTE_SECURE_LINK',
    actedAt: '2026-04-12T18:00:00.000Z',
    recordedByUserId: null,
    clientActionTokenId: 'token_row_1',
    contactMethod: 'EMAIL',
    destinationSnapshot: 'client@example.com',
  },
  meta: {
    mutated: true,
    noOp: false,
  },
}

const rejectedResponseBody = {
  action: 'REJECT',
  approval: {
    id: 'approval_1',
    status: 'REJECTED',
    approvedAt: null,
    rejectedAt: '2026-04-12T18:30:00.000Z',
  },
  proof: {
    id: 'proof_2',
    decision: 'REJECTED',
    method: 'REMOTE_SECURE_LINK',
    actedAt: '2026-04-12T18:30:00.000Z',
    recordedByUserId: null,
    clientActionTokenId: 'token_row_2',
    contactMethod: 'SMS',
    destinationSnapshot: '+15551234567',
  },
  meta: {
    mutated: true,
    noOp: false,
  },
}

const mocks = vi.hoisted(() => ({
  jsonOk: vi.fn(),
  jsonFail: vi.fn(),
  pickString: vi.fn(),
  upper: vi.fn(),

  enforceRateLimit: vi.fn(),
  rateLimitIdentity: vi.fn(),
  tokenRateLimitIdentity: vi.fn(),

  getBookingFailPayload: vi.fn(),
  isBookingError: vi.fn(),

  approveConsultationByClientActionToken: vi.fn(),
  rejectConsultationByClientActionToken: vi.fn(),

  clientActionTokenFindUnique: vi.fn(),
  hashClientActionToken: vi.fn(),
  clientActionTokenRateLimitPrefix: vi.fn(),

  beginRouteIdempotency: vi.fn(),
  completeRouteIdempotency: vi.fn(),
  failStartedRouteIdempotency: vi.fn(),
  isRouteIdempotencyHandled: vi.fn(),

  buildPublicConsultationTokenActorKey: vi.fn(),

  captureBookingException: vi.fn(),
}))

vi.mock('@/app/api/_utils', () => ({
  jsonOk: mocks.jsonOk,
  jsonFail: mocks.jsonFail,
  pickString: mocks.pickString,
  upper: mocks.upper,
}))

vi.mock('@/app/api/_utils/rateLimit', () => ({
  enforceRateLimit: mocks.enforceRateLimit,
  rateLimitIdentity: mocks.rateLimitIdentity,
  tokenRateLimitIdentity: mocks.tokenRateLimitIdentity,
}))

vi.mock('@/app/api/_utils/idempotency', () => ({
  beginRouteIdempotency: mocks.beginRouteIdempotency,
  completeRouteIdempotency: mocks.completeRouteIdempotency,
  failStartedRouteIdempotency: mocks.failStartedRouteIdempotency,
  isRouteIdempotencyHandled: mocks.isRouteIdempotencyHandled,
}))

vi.mock('@/lib/booking/errors', () => ({
  getBookingFailPayload: mocks.getBookingFailPayload,
  isBookingError: mocks.isBookingError,
}))

vi.mock('@/lib/booking/writeBoundary', () => ({
  approveConsultationByClientActionToken:
    mocks.approveConsultationByClientActionToken,
  rejectConsultationByClientActionToken:
    mocks.rejectConsultationByClientActionToken,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    clientActionToken: {
      findUnique: mocks.clientActionTokenFindUnique,
    },
  },
}))

vi.mock('@/lib/consultation/clientActionTokens', () => ({
  hashClientActionToken: mocks.hashClientActionToken,
  clientActionTokenRateLimitPrefix: mocks.clientActionTokenRateLimitPrefix,
}))

vi.mock('@/lib/idempotency', () => ({
  buildPublicConsultationTokenActorKey:
    mocks.buildPublicConsultationTokenActorKey,
  IDEMPOTENCY_ROUTES: {
    CONSULTATION_PUBLIC_DECISION:
      'POST /api/public/consultation/[token]/decision',
  },
}))

vi.mock('@/lib/observability/bookingEvents', () => ({
  captureBookingException: mocks.captureBookingException,
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

function makeRequest(args?: {
  body?: unknown
  headers?: Record<string, string>
}): Request {
  return new Request(
    'http://localhost/api/public/consultation/token_1/decision',
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(args?.headers ?? {}),
      },
      body: JSON.stringify(args?.body ?? {}),
    },
  )
}

function makeIdempotentRequest(args?: {
  body?: unknown
  key?: string
  headers?: Record<string, string>
}): Request {
  return makeRequest({
    body: args?.body,
    headers: {
      'idempotency-key': args?.key ?? 'idem_public_consultation_1',
      ...(args?.headers ?? {}),
    },
  })
}

function makeCtx(token = 'token_1') {
  return {
    params: Promise.resolve({ token }),
  }
}

function mockApproveResult() {
  return {
    booking: {
      id: 'booking_1',
      serviceId: 'svc_1',
      offeringId: 'off_1',
      subtotalSnapshot: new String('125.00'),
      totalDurationMinutes: 75,
      consultationConfirmedAt: new Date('2026-04-12T18:00:00.000Z'),
    },
    approval: {
      id: 'approval_1',
      status: 'APPROVED',
      approvedAt: new Date('2026-04-12T18:00:00.000Z'),
      rejectedAt: null,
    },
    proof: {
      id: 'proof_1',
      decision: 'APPROVED',
      method: 'REMOTE_SECURE_LINK',
      actedAt: new Date('2026-04-12T18:00:00.000Z'),
      recordedByUserId: null,
      clientActionTokenId: 'token_row_1',
      contactMethod: 'EMAIL',
      destinationSnapshot: 'client@example.com',
    },
    meta: {
      mutated: true,
      noOp: false,
    },
  }
}

function mockRejectResult() {
  return {
    approval: {
      id: 'approval_1',
      status: 'REJECTED',
      approvedAt: null,
      rejectedAt: new Date('2026-04-12T18:30:00.000Z'),
    },
    proof: {
      id: 'proof_2',
      decision: 'REJECTED',
      method: 'REMOTE_SECURE_LINK',
      actedAt: new Date('2026-04-12T18:30:00.000Z'),
      recordedByUserId: null,
      clientActionTokenId: 'token_row_2',
      contactMethod: 'SMS',
      destinationSnapshot: '+15551234567',
    },
    meta: {
      mutated: true,
      noOp: false,
    },
  }
}

function expectIdempotencyStarted(key = 'idem_public_consultation_1'): void {
  mocks.beginRouteIdempotency.mockResolvedValueOnce({
    kind: 'started',
    idempotencyRecordId: 'idem_record_1',
    idempotencyKey: key,
    requestHash: 'hash_1',
  })

  mocks.isRouteIdempotencyHandled.mockReturnValue(false)
}

function expectIdempotencyHandled(response: Response): void {
  mocks.beginRouteIdempotency.mockReset()
  mocks.isRouteIdempotencyHandled.mockReset()

  mocks.beginRouteIdempotency.mockResolvedValueOnce({
    kind: 'handled',
    response,
  })

  mocks.isRouteIdempotencyHandled.mockReturnValueOnce(true)
}

function expectRouteIdempotencyStartedWith(args: {
  tokenRowId: string
  action: 'APPROVE' | 'REJECT'
}) {
  expect(mocks.beginRouteIdempotency).toHaveBeenCalledWith({
    request: expect.any(Request),
    actor: {
      actorUserId: null,
      actorKey: `public-consultation-token:${args.tokenRowId}`,
      actorRole: Role.CLIENT,
    },
    route: IDEMPOTENCY_ROUTE,
    requestLabel: 'public consultation decision',
    requestBody: {
      clientActionTokenId: args.tokenRowId,
      action: args.action,
    },
    messages: {
      missingKey: 'Missing idempotency key.',
      inProgress:
        'A matching consultation decision request is already in progress.',
      conflict:
        'This idempotency key was already used with a different request body.',
    },
  })
}

describe('POST /api/public/consultation/[token]/decision', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mocks.jsonOk.mockImplementation(
      (data: Record<string, unknown>, status = 200) =>
        makeJsonResponse(status, { ok: true, ...(data ?? {}) }),
    )

    mocks.jsonFail.mockImplementation(
      (
        status: number,
        error: string,
        extra?: Record<string, unknown>,
      ) => makeJsonResponse(status, { ok: false, error, ...(extra ?? {}) }),
    )

    mocks.pickString.mockImplementation((value: unknown) => {
      if (typeof value !== 'string') return null
      const trimmed = value.trim()
      return trimmed.length > 0 ? trimmed : null
    })

    mocks.upper.mockImplementation((value: unknown) =>
      typeof value === 'string' ? value.trim().toUpperCase() : '',
    )

    mocks.isBookingError.mockImplementation(
      (error: unknown) =>
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        typeof (error as { code?: unknown }).code === 'string',
    )

    mocks.getBookingFailPayload.mockImplementation(
      (
        code: string,
        overrides?: {
          message?: string
          userMessage?: string
        },
      ) => ({
        httpStatus:
          code === 'FORBIDDEN'
            ? 403
            : code === 'BOOKING_NOT_FOUND'
              ? 404
              : 400,
        userMessage: overrides?.userMessage ?? `booking error: ${code}`,
        extra: {
          code,
          ...(overrides?.message ? { message: overrides.message } : {}),
        },
      }),
    )

    mocks.hashClientActionToken.mockReturnValue('hashed_token_1')
    mocks.clientActionTokenRateLimitPrefix.mockReturnValue('hash_prefix_1')

    mocks.enforceRateLimit.mockResolvedValue(null)
    mocks.rateLimitIdentity.mockResolvedValue({ kind: 'ip', id: '1.2.3.4' })
    mocks.tokenRateLimitIdentity.mockImplementation((prefix: string) => ({
      kind: 'token' as const,
      id: prefix,
    }))

    mocks.clientActionTokenFindUnique.mockResolvedValue({
      id: 'token_row_1',
      kind: ClientActionTokenKind.CONSULTATION_ACTION,
    })

    mocks.buildPublicConsultationTokenActorKey.mockImplementation(
      (tokenId: string) => `public-consultation-token:${tokenId}`,
    )

    expectIdempotencyStarted()

    mocks.completeRouteIdempotency.mockResolvedValue(undefined)
    mocks.failStartedRouteIdempotency.mockResolvedValue(undefined)

    mocks.approveConsultationByClientActionToken.mockResolvedValue(
      mockApproveResult(),
    )
    mocks.rejectConsultationByClientActionToken.mockResolvedValue(
      mockRejectResult(),
    )
  })

  it('returns 400 when token is missing', async () => {
    const response = await POST(
      makeRequest({
        body: { action: 'APPROVE' },
      }),
      makeCtx('   '),
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: 'Missing token.',
    })

    expect(mocks.rateLimitIdentity).not.toHaveBeenCalled()
    expect(mocks.enforceRateLimit).not.toHaveBeenCalled()
    expect(mocks.hashClientActionToken).not.toHaveBeenCalled()
    expect(mocks.clientActionTokenFindUnique).not.toHaveBeenCalled()
    expect(mocks.beginRouteIdempotency).not.toHaveBeenCalled()
    expect(mocks.approveConsultationByClientActionToken).not.toHaveBeenCalled()
    expect(mocks.rejectConsultationByClientActionToken).not.toHaveBeenCalled()
  })

  it('returns 400 when action is invalid', async () => {
    const response = await POST(
      makeRequest({
        body: { action: 'MAYBE' },
      }),
      makeCtx('token_1'),
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: 'Invalid action.',
    })

    expect(mocks.rateLimitIdentity).not.toHaveBeenCalled()
    expect(mocks.enforceRateLimit).not.toHaveBeenCalled()
    expect(mocks.hashClientActionToken).not.toHaveBeenCalled()
    expect(mocks.clientActionTokenFindUnique).not.toHaveBeenCalled()
    expect(mocks.beginRouteIdempotency).not.toHaveBeenCalled()
    expect(mocks.approveConsultationByClientActionToken).not.toHaveBeenCalled()
    expect(mocks.rejectConsultationByClientActionToken).not.toHaveBeenCalled()
  })

  it('returns 429 from the IP rate-limit guard before token-prefix guard, DB lookup, idempotency, or mutation', async () => {
    const limitResponse = makeJsonResponse(429, {
      ok: false,
      error: 'Too many requests.',
    })

    mocks.enforceRateLimit.mockResolvedValueOnce(limitResponse)

    const response = await POST(
      makeIdempotentRequest({
        body: { action: 'APPROVE' },
      }),
      makeCtx(),
    )

    expect(response).toBe(limitResponse)

    expect(mocks.rateLimitIdentity).toHaveBeenCalledTimes(1)
    expect(mocks.enforceRateLimit).toHaveBeenCalledTimes(1)
    expect(mocks.enforceRateLimit).toHaveBeenNthCalledWith(1, {
      bucket: 'consultation:decision',
      identity: { kind: 'ip', id: '1.2.3.4' },
    })

    expect(mocks.clientActionTokenRateLimitPrefix).not.toHaveBeenCalled()
    expect(mocks.tokenRateLimitIdentity).not.toHaveBeenCalled()
    expect(mocks.clientActionTokenFindUnique).not.toHaveBeenCalled()
    expect(mocks.beginRouteIdempotency).not.toHaveBeenCalled()
    expect(mocks.approveConsultationByClientActionToken).not.toHaveBeenCalled()
    expect(mocks.rejectConsultationByClientActionToken).not.toHaveBeenCalled()
  })

  it('returns 429 from the token-prefix rate-limit guard before DB lookup, idempotency, or mutation', async () => {
    const limitResponse = makeJsonResponse(429, {
      ok: false,
      error: 'Too many requests.',
    })

    mocks.enforceRateLimit
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(limitResponse)

    const response = await POST(
      makeIdempotentRequest({
        body: { action: 'APPROVE' },
      }),
      makeCtx(),
    )

    expect(response).toBe(limitResponse)

    expect(mocks.rateLimitIdentity).toHaveBeenCalledTimes(1)
    expect(mocks.clientActionTokenRateLimitPrefix).toHaveBeenCalledWith(
      'token_1',
    )
    expect(mocks.tokenRateLimitIdentity).toHaveBeenCalledWith('hash_prefix_1')

    expect(mocks.enforceRateLimit).toHaveBeenCalledTimes(2)
    expect(mocks.enforceRateLimit).toHaveBeenNthCalledWith(1, {
      bucket: 'consultation:decision',
      identity: { kind: 'ip', id: '1.2.3.4' },
    })
    expect(mocks.enforceRateLimit).toHaveBeenNthCalledWith(2, {
      bucket: 'consultation:decision:token',
      identity: {
        kind: 'token',
        id: 'hash_prefix_1',
      },
    })

    expect(mocks.clientActionTokenFindUnique).not.toHaveBeenCalled()
    expect(mocks.beginRouteIdempotency).not.toHaveBeenCalled()
    expect(mocks.approveConsultationByClientActionToken).not.toHaveBeenCalled()
    expect(mocks.rejectConsultationByClientActionToken).not.toHaveBeenCalled()
  })

  it('returns invalid token when token hash lookup misses', async () => {
    mocks.clientActionTokenFindUnique.mockResolvedValueOnce(null)

    const response = await POST(
      makeIdempotentRequest({
        body: { action: 'APPROVE' },
      }),
      makeCtx('token_missing'),
    )

    expect(mocks.clientActionTokenRateLimitPrefix).toHaveBeenCalledWith(
      'token_missing',
    )
    expect(mocks.hashClientActionToken).toHaveBeenCalledWith('token_missing')
    expect(mocks.clientActionTokenFindUnique).toHaveBeenCalledWith({
      where: { tokenHash: 'hashed_token_1' },
      select: {
        id: true,
        kind: true,
      },
    })

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: 'That link is invalid or expired.',
      code: 'FORBIDDEN',
      message: 'Consultation action token was not found or is not usable.',
    })

    expect(mocks.beginRouteIdempotency).not.toHaveBeenCalled()
    expect(mocks.approveConsultationByClientActionToken).not.toHaveBeenCalled()
    expect(mocks.rejectConsultationByClientActionToken).not.toHaveBeenCalled()
  })

  it('returns invalid token when token kind is not consultation action', async () => {
    mocks.clientActionTokenFindUnique.mockResolvedValueOnce({
      id: 'token_row_wrong_kind',
      kind: 'AFTERCARE_ACCESS',
    })

    const response = await POST(
      makeIdempotentRequest({
        body: { action: 'APPROVE' },
      }),
      makeCtx('token_wrong_kind'),
    )

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: 'That link is invalid or expired.',
      code: 'FORBIDDEN',
      message: 'Consultation action token was not found or is not usable.',
    })

    expect(mocks.beginRouteIdempotency).not.toHaveBeenCalled()
    expect(mocks.approveConsultationByClientActionToken).not.toHaveBeenCalled()
    expect(mocks.rejectConsultationByClientActionToken).not.toHaveBeenCalled()
  })

  it('returns handled idempotency response for missing idempotency key', async () => {
    const handledResponse = makeJsonResponse(400, {
      ok: false,
      error: 'Missing idempotency key.',
      code: 'IDEMPOTENCY_KEY_REQUIRED',
    })

    expectIdempotencyHandled(handledResponse)

    const response = await POST(
      makeRequest({
        body: { action: 'APPROVE' },
      }),
      makeCtx('token_1'),
    )

    expect(response).toBe(handledResponse)

    expectRouteIdempotencyStartedWith({
      tokenRowId: 'token_row_1',
      action: 'APPROVE',
    })

    expect(mocks.approveConsultationByClientActionToken).not.toHaveBeenCalled()
    expect(mocks.rejectConsultationByClientActionToken).not.toHaveBeenCalled()
    expect(mocks.completeRouteIdempotency).not.toHaveBeenCalled()
  })

  it('returns handled in-progress idempotency response', async () => {
    const handledResponse = makeJsonResponse(409, {
      ok: false,
      error: 'A matching consultation decision request is already in progress.',
      code: 'IDEMPOTENCY_REQUEST_IN_PROGRESS',
    })

    expectIdempotencyHandled(handledResponse)

    const response = await POST(
      makeIdempotentRequest({
        body: { action: 'APPROVE' },
      }),
      makeCtx('token_1'),
    )

    expect(response).toBe(handledResponse)
    expect(mocks.approveConsultationByClientActionToken).not.toHaveBeenCalled()
    expect(mocks.rejectConsultationByClientActionToken).not.toHaveBeenCalled()
    expect(mocks.completeRouteIdempotency).not.toHaveBeenCalled()
  })

  it('returns handled conflict idempotency response', async () => {
    const handledResponse = makeJsonResponse(409, {
      ok: false,
      error:
        'This idempotency key was already used with a different request body.',
      code: 'IDEMPOTENCY_KEY_CONFLICT',
    })

    expectIdempotencyHandled(handledResponse)

    const response = await POST(
      makeIdempotentRequest({
        body: { action: 'APPROVE' },
      }),
      makeCtx('token_1'),
    )

    expect(response).toBe(handledResponse)
    expect(mocks.approveConsultationByClientActionToken).not.toHaveBeenCalled()
    expect(mocks.rejectConsultationByClientActionToken).not.toHaveBeenCalled()
    expect(mocks.completeRouteIdempotency).not.toHaveBeenCalled()
  })

  it('replays completed idempotency response without approving or rejecting again', async () => {
    const handledResponse = makeJsonResponse(200, {
      ok: true,
      ...approvedResponseBody,
    })

    expectIdempotencyHandled(handledResponse)

    const response = await POST(
      makeIdempotentRequest({
        body: { action: 'APPROVE' },
      }),
      makeCtx('token_1'),
    )

    expect(response).toBe(handledResponse)
    expect(mocks.approveConsultationByClientActionToken).not.toHaveBeenCalled()
    expect(mocks.rejectConsultationByClientActionToken).not.toHaveBeenCalled()
    expect(mocks.completeRouteIdempotency).not.toHaveBeenCalled()
  })

  it('forwards APPROVE requests, completes idempotency, and returns the result payload', async () => {
    expectIdempotencyStarted('idem_approve_1')

    const response = await POST(
      makeIdempotentRequest({
        key: 'idem_approve_1',
        body: { action: 'APPROVE' },
        headers: {
          'x-request-id': 'req_approve_1',
          'x-forwarded-for': '203.0.113.5, 70.1.1.1',
          'user-agent': 'Mozilla/5.0 Test Browser',
        },
      }),
      makeCtx('token_1'),
    )

    expect(mocks.hashClientActionToken).toHaveBeenCalledWith('token_1')
    expect(mocks.clientActionTokenFindUnique).toHaveBeenCalledWith({
      where: { tokenHash: 'hashed_token_1' },
      select: {
        id: true,
        kind: true,
      },
    })

    expectRouteIdempotencyStartedWith({
      tokenRowId: 'token_row_1',
      action: 'APPROVE',
    })

    expect(mocks.approveConsultationByClientActionToken).toHaveBeenCalledWith({
      rawToken: 'token_1',
      requestId: 'req_approve_1',
      idempotencyKey: 'idem_approve_1',
      ipAddress: '203.0.113.5',
      userAgent: 'Mozilla/5.0 Test Browser',
    })

    expect(mocks.rejectConsultationByClientActionToken).not.toHaveBeenCalled()

    expect(mocks.completeRouteIdempotency).toHaveBeenCalledWith({
      idempotencyRecordId: 'idem_record_1',
      responseStatus: 200,
      responseBody: approvedResponseBody,
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      ok: true,
      ...approvedResponseBody,
    })
  })

  it('forwards REJECT requests, completes idempotency, and returns the result payload', async () => {
    mocks.clientActionTokenFindUnique.mockResolvedValueOnce({
      id: 'token_row_2',
      kind: ClientActionTokenKind.CONSULTATION_ACTION,
    })

    expectIdempotencyStarted('idem_reject_1')

    const response = await POST(
      makeIdempotentRequest({
        key: 'idem_reject_1',
        body: { action: 'REJECT' },
        headers: {
          'request-id': 'req_reject_1',
          'x-real-ip': '198.51.100.8',
          'user-agent': 'Mobile Safari',
        },
      }),
      makeCtx('token_2'),
    )

    expectRouteIdempotencyStartedWith({
      tokenRowId: 'token_row_2',
      action: 'REJECT',
    })

    expect(mocks.rejectConsultationByClientActionToken).toHaveBeenCalledWith({
      rawToken: 'token_2',
      requestId: 'req_reject_1',
      idempotencyKey: 'idem_reject_1',
      ipAddress: '198.51.100.8',
      userAgent: 'Mobile Safari',
    })

    expect(mocks.approveConsultationByClientActionToken).not.toHaveBeenCalled()

    expect(mocks.completeRouteIdempotency).toHaveBeenCalledWith({
      idempotencyRecordId: 'idem_record_1',
      responseStatus: 200,
      responseBody: rejectedResponseBody,
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      ok: true,
      ...rejectedResponseBody,
    })
  })

  it('maps booking errors through bookingJsonFail and marks idempotency failed', async () => {
    expectIdempotencyStarted('idem_booking_error_1')

    mocks.approveConsultationByClientActionToken.mockRejectedValueOnce({
      code: 'FORBIDDEN',
      message: 'Nope',
      userMessage: 'Blocked',
    })

    const response = await POST(
      makeIdempotentRequest({
        key: 'idem_booking_error_1',
        body: { action: 'APPROVE' },
      }),
      makeCtx('token_3'),
    )

    expect(mocks.failStartedRouteIdempotency).toHaveBeenCalledWith({
      idempotencyRecordId: 'idem_record_1',
      operation: OPERATION,
    })

    expect(mocks.getBookingFailPayload).toHaveBeenCalledWith('FORBIDDEN', {
      message: 'Nope',
      userMessage: 'Blocked',
    })

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: 'Blocked',
      code: 'FORBIDDEN',
      message: 'Nope',
    })
  })

  it('returns 500 for unexpected errors, captures exception, and marks idempotency failed', async () => {
    expectIdempotencyStarted('idem_boom_1')

    mocks.rejectConsultationByClientActionToken.mockRejectedValueOnce(
      new Error('boom'),
    )

    const response = await POST(
      makeIdempotentRequest({
        key: 'idem_boom_1',
        body: { action: 'REJECT' },
      }),
      makeCtx('token_4'),
    )

    expect(mocks.failStartedRouteIdempotency).toHaveBeenCalledWith({
      idempotencyRecordId: 'idem_record_1',
      operation: OPERATION,
    })

    expect(mocks.captureBookingException).toHaveBeenCalledWith({
      error: expect.any(Error),
      route: OPERATION,
    })

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: 'Internal server error',
    })
  })
})