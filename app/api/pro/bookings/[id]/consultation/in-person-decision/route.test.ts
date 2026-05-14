import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ConsultationApprovalStatus,
  ConsultationDecision,
  Role,
} from '@prisma/client'

const IDEMPOTENCY_ROUTE =
  'POST /api/pro/bookings/[id]/consultation/in-person-decision'

const OPERATION =
  'POST /api/pro/bookings/[id]/consultation/in-person-decision'

const approvedResponseBody = {
  action: ConsultationDecision.APPROVED,
  booking: {
    id: 'booking_1',
    serviceId: 'svc_1',
    offeringId: 'off_1',
    subtotalSnapshot: '125.00',
    totalDurationMinutes: 75,
    consultationConfirmedAt: '2026-04-12T20:00:00.000Z',
  },
  approval: {
    id: 'approval_1',
    status: ConsultationApprovalStatus.APPROVED,
    approvedAt: '2026-04-12T20:00:00.000Z',
    rejectedAt: null,
  },
  proof: {
    id: 'proof_1',
    decision: ConsultationDecision.APPROVED,
    method: 'IN_PERSON_PRO_DEVICE',
    actedAt: '2026-04-12T20:00:00.000Z',
    recordedByUserId: 'user_1',
    clientActionTokenId: null,
    contactMethod: null,
    destinationSnapshot: null,
  },
  nextHref: '/pro/bookings/booking_1/session',
  meta: {
    mutated: true,
    noOp: false,
  },
}

const rejectedResponseBody = {
  action: ConsultationDecision.REJECTED,
  approval: {
    id: 'approval_1',
    status: ConsultationApprovalStatus.REJECTED,
    approvedAt: null,
    rejectedAt: '2026-04-12T20:15:00.000Z',
  },
  proof: {
    id: 'proof_2',
    decision: ConsultationDecision.REJECTED,
    method: 'IN_PERSON_PRO_DEVICE',
    actedAt: '2026-04-12T20:15:00.000Z',
    recordedByUserId: 'user_1',
    clientActionTokenId: null,
    contactMethod: null,
    destinationSnapshot: null,
  },
  nextHref: '/pro/bookings/booking_1/session',
  meta: {
    mutated: true,
    noOp: false,
  },
}

const mocks = vi.hoisted(() => ({
  requirePro: vi.fn(),
  jsonFail: vi.fn(),
  jsonOk: vi.fn(),
  pickString: vi.fn(),
  upper: vi.fn(),

  isRecord: vi.fn(),

  getBookingFailPayload: vi.fn(),
  isBookingError: vi.fn(),

  recordInPersonConsultationDecision: vi.fn(),

  beginRouteIdempotency: vi.fn(),
  completeRouteIdempotency: vi.fn(),
  failStartedRouteIdempotency: vi.fn(),
  isRouteIdempotencyHandled: vi.fn(),

  captureBookingException: vi.fn(),
}))

vi.mock('@/app/api/_utils', () => ({
  requirePro: mocks.requirePro,
  jsonFail: mocks.jsonFail,
  jsonOk: mocks.jsonOk,
  pickString: mocks.pickString,
  upper: mocks.upper,
}))

vi.mock('@/lib/guards', () => ({
  isRecord: mocks.isRecord,
}))

vi.mock('@/lib/booking/errors', () => ({
  getBookingFailPayload: mocks.getBookingFailPayload,
  isBookingError: mocks.isBookingError,
}))

vi.mock('@/lib/booking/writeBoundary', () => ({
  recordInPersonConsultationDecision:
    mocks.recordInPersonConsultationDecision,
}))

vi.mock('@/app/api/_utils/idempotency', () => ({
  beginRouteIdempotency: mocks.beginRouteIdempotency,
  completeRouteIdempotency: mocks.completeRouteIdempotency,
  failStartedRouteIdempotency: mocks.failStartedRouteIdempotency,
  isRouteIdempotencyHandled: mocks.isRouteIdempotencyHandled,
}))

vi.mock('@/lib/idempotency', () => ({
  IDEMPOTENCY_ROUTES: {
    CONSULTATION_IN_PERSON_DECISION:
      'POST /api/pro/bookings/[id]/consultation/in-person-decision',
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

function makeCtx(id: string): { params: Promise<{ id: string }> } {
  return {
    params: Promise.resolve({ id }),
  }
}

function makeRequest(args?: {
  body?: unknown
  headers?: Record<string, string>
}): Request {
  return new Request(
    'http://localhost/api/pro/bookings/booking_1/consultation/in-person-decision',
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
      'idempotency-key': args?.key ?? 'idem_in_person_decision_1',
      ...(args?.headers ?? {}),
    },
  })
}

function expectedIdempotencyRequestBody(
  decision: ConsultationDecision = ConsultationDecision.APPROVED,
) {
  return {
    professionalId: 'pro_1',
    recordedByUserId: 'user_1',
    bookingId: 'booking_1',
    decision,
  }
}

function expectIdempotencyStarted(
  key = 'idem_in_person_decision_1',
): void {
  mocks.beginRouteIdempotency.mockReset()
  mocks.isRouteIdempotencyHandled.mockReset()

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

function expectRouteIdempotencyStartedWith(
  requestBody: Record<string, unknown>,
): void {
  expect(mocks.beginRouteIdempotency).toHaveBeenCalledWith({
    request: expect.any(Request),
    actor: {
      actorUserId: 'user_1',
      actorRole: Role.PRO,
    },
    route: IDEMPOTENCY_ROUTE,
    requestLabel: 'in-person consultation decision',
    requestBody,
    messages: {
      missingKey: 'Missing idempotency key.',
      inProgress:
        'A matching in-person consultation decision request is already in progress.',
      conflict:
        'This idempotency key was already used with a different request body.',
    },
  })
}

describe('app/api/pro/bookings/[id]/consultation/in-person-decision/route.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mocks.requirePro.mockResolvedValue({
      ok: true,
      professionalId: 'pro_1',
      user: {
        id: 'user_1',
      },
    })

    mocks.jsonFail.mockImplementation(
      (status: number, error: string, extra?: unknown) =>
        makeJsonResponse(status, {
          ok: false,
          error,
          ...(extra && typeof extra === 'object' ? extra : {}),
        }),
    )

    mocks.jsonOk.mockImplementation(
      (data: Record<string, unknown>, status = 200) =>
        makeJsonResponse(status, {
          ok: true,
          ...(data ?? {}),
        }),
    )

    mocks.pickString.mockImplementation((value: unknown) => {
      if (typeof value !== 'string') return null
      const trimmed = value.trim()
      return trimmed.length > 0 ? trimmed : null
    })

    mocks.upper.mockImplementation((value: unknown) =>
      typeof value === 'string' ? value.trim().toUpperCase() : '',
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
          code === 'FORBIDDEN'
            ? 403
            : code === 'BOOKING_NOT_FOUND'
              ? 404
              : code === 'BOOKING_ID_REQUIRED'
                ? 400
                : 400,
        userMessage: overrides?.userMessage ?? overrides?.message ?? code,
        extra: {
          code,
          ...(overrides?.message ? { message: overrides.message } : {}),
        },
      }),
    )

    expectIdempotencyStarted()

    mocks.completeRouteIdempotency.mockResolvedValue(undefined)
    mocks.failStartedRouteIdempotency.mockResolvedValue(undefined)

    mocks.recordInPersonConsultationDecision.mockResolvedValue({
      booking: {
        id: 'booking_1',
        serviceId: 'svc_1',
        offeringId: 'off_1',
        subtotalSnapshot: '125.00',
        totalDurationMinutes: 75,
        consultationConfirmedAt: new Date('2026-04-12T20:00:00.000Z'),
      },
      approval: {
        id: 'approval_1',
        status: ConsultationApprovalStatus.APPROVED,
        approvedAt: new Date('2026-04-12T20:00:00.000Z'),
        rejectedAt: null,
      },
      proof: {
        id: 'proof_1',
        decision: ConsultationDecision.APPROVED,
        method: 'IN_PERSON_PRO_DEVICE',
        actedAt: new Date('2026-04-12T20:00:00.000Z'),
        recordedByUserId: 'user_1',
        clientActionTokenId: null,
        contactMethod: null,
        destinationSnapshot: null,
      },
      meta: {
        mutated: true,
        noOp: false,
      },
    })
  })

  it('returns auth response when requirePro fails', async () => {
    const authRes = makeJsonResponse(401, {
      ok: false,
      error: 'Unauthorized',
    })

    mocks.requirePro.mockResolvedValueOnce({
      ok: false,
      res: authRes,
    })

    const result = await POST(makeRequest(), makeCtx('booking_1'))

    expect(result).toBe(authRes)
    expect(mocks.beginRouteIdempotency).not.toHaveBeenCalled()
    expect(mocks.recordInPersonConsultationDecision).not.toHaveBeenCalled()
  })

  it('returns FORBIDDEN when authenticated user id is missing', async () => {
    mocks.requirePro.mockResolvedValueOnce({
      ok: true,
      professionalId: 'pro_1',
      user: {
        id: '   ',
      },
    })

    const result = await POST(
      makeRequest({ body: { action: 'APPROVED' } }),
      makeCtx('booking_1'),
    )

    expect(mocks.getBookingFailPayload).toHaveBeenCalledWith('FORBIDDEN', {
      message: 'Authenticated actor user id is required.',
      userMessage:
        'You are not allowed to record this consultation decision.',
    })

    expect(result.status).toBe(403)
    await expect(result.json()).resolves.toEqual({
      ok: false,
      error: 'You are not allowed to record this consultation decision.',
      code: 'FORBIDDEN',
      message: 'Authenticated actor user id is required.',
    })

    expect(mocks.beginRouteIdempotency).not.toHaveBeenCalled()
    expect(mocks.recordInPersonConsultationDecision).not.toHaveBeenCalled()
  })

  it('returns BOOKING_ID_REQUIRED when booking id is missing after trim', async () => {
    const result = await POST(
      makeRequest({ body: { action: 'APPROVED' } }),
      makeCtx('   '),
    )

    expect(mocks.getBookingFailPayload).toHaveBeenCalledWith(
      'BOOKING_ID_REQUIRED',
      undefined,
    )

    expect(result.status).toBe(400)
    await expect(result.json()).resolves.toEqual({
      ok: false,
      error: 'BOOKING_ID_REQUIRED',
      code: 'BOOKING_ID_REQUIRED',
    })

    expect(mocks.beginRouteIdempotency).not.toHaveBeenCalled()
    expect(mocks.recordInPersonConsultationDecision).not.toHaveBeenCalled()
  })

  it('returns 400 when action is invalid', async () => {
    const result = await POST(
      makeRequest({ body: { action: 'maybe' } }),
      makeCtx('booking_1'),
    )

    expect(mocks.jsonFail).toHaveBeenCalledWith(
      400,
      'Invalid action. Use APPROVED or REJECTED.',
    )

    expect(result.status).toBe(400)
    await expect(result.json()).resolves.toEqual({
      ok: false,
      error: 'Invalid action. Use APPROVED or REJECTED.',
    })

    expect(mocks.beginRouteIdempotency).not.toHaveBeenCalled()
    expect(mocks.recordInPersonConsultationDecision).not.toHaveBeenCalled()
  })

  it('returns handled idempotency response for missing idempotency key', async () => {
    const handledResponse = makeJsonResponse(400, {
      ok: false,
      error: 'Missing idempotency key.',
      code: 'IDEMPOTENCY_KEY_REQUIRED',
    })

    expectIdempotencyHandled(handledResponse)

    const result = await POST(
      makeRequest({ body: { action: 'APPROVED' } }),
      makeCtx('booking_1'),
    )

    expect(result).toBe(handledResponse)
    expectRouteIdempotencyStartedWith(
      expectedIdempotencyRequestBody(ConsultationDecision.APPROVED),
    )

    expect(mocks.recordInPersonConsultationDecision).not.toHaveBeenCalled()
    expect(mocks.completeRouteIdempotency).not.toHaveBeenCalled()
  })

  it('returns handled in-progress idempotency response', async () => {
    const handledResponse = makeJsonResponse(409, {
      ok: false,
      error:
        'A matching in-person consultation decision request is already in progress.',
      code: 'IDEMPOTENCY_REQUEST_IN_PROGRESS',
    })

    expectIdempotencyHandled(handledResponse)

    const result = await POST(
      makeIdempotentRequest({
        body: { action: 'APPROVED' },
      }),
      makeCtx('booking_1'),
    )

    expect(result).toBe(handledResponse)
    expect(mocks.recordInPersonConsultationDecision).not.toHaveBeenCalled()
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

    const result = await POST(
      makeIdempotentRequest({
        body: { action: 'APPROVED' },
      }),
      makeCtx('booking_1'),
    )

    expect(result).toBe(handledResponse)
    expect(mocks.recordInPersonConsultationDecision).not.toHaveBeenCalled()
    expect(mocks.completeRouteIdempotency).not.toHaveBeenCalled()
  })

  it('replays completed idempotency response without recording the decision again', async () => {
    const handledResponse = makeJsonResponse(200, {
      ok: true,
      ...approvedResponseBody,
    })

    expectIdempotencyHandled(handledResponse)

    const result = await POST(
      makeIdempotentRequest({
        body: { action: 'APPROVED' },
      }),
      makeCtx('booking_1'),
    )

    expect(result).toBe(handledResponse)
    expect(mocks.recordInPersonConsultationDecision).not.toHaveBeenCalled()
    expect(mocks.completeRouteIdempotency).not.toHaveBeenCalled()
  })

  it('calls recordInPersonConsultationDecision for APPROVED, completes idempotency, and returns booking payload', async () => {
    expectIdempotencyStarted('idem_1')

    const result = await POST(
      makeIdempotentRequest({
        key: 'idem_1',
        body: { action: 'approved' },
        headers: {
          'x-request-id': 'req_1',
          'user-agent': 'iPad kiosk',
        },
      }),
      makeCtx('booking_1'),
    )

    expectRouteIdempotencyStartedWith(
      expectedIdempotencyRequestBody(ConsultationDecision.APPROVED),
    )

    expect(mocks.recordInPersonConsultationDecision).toHaveBeenCalledWith({
      bookingId: 'booking_1',
      professionalId: 'pro_1',
      recordedByUserId: 'user_1',
      decision: ConsultationDecision.APPROVED,
      requestId: 'req_1',
      idempotencyKey: 'idem_1',
      userAgent: 'iPad kiosk',
    })

    expect(mocks.completeRouteIdempotency).toHaveBeenCalledWith({
      idempotencyRecordId: 'idem_record_1',
      responseStatus: 200,
      responseBody: approvedResponseBody,
    })

    expect(mocks.jsonOk).toHaveBeenCalledWith(approvedResponseBody, 200)

    expect(result.status).toBe(200)
    await expect(result.json()).resolves.toEqual({
      ok: true,
      ...approvedResponseBody,
    })
  })

  it('calls recordInPersonConsultationDecision for REJECTED, completes idempotency, and returns rejection payload', async () => {
    expectIdempotencyStarted('idem_2')

    mocks.recordInPersonConsultationDecision.mockResolvedValueOnce({
      approval: {
        id: 'approval_1',
        status: ConsultationApprovalStatus.REJECTED,
        approvedAt: null,
        rejectedAt: new Date('2026-04-12T20:15:00.000Z'),
      },
      proof: {
        id: 'proof_2',
        decision: ConsultationDecision.REJECTED,
        method: 'IN_PERSON_PRO_DEVICE',
        actedAt: new Date('2026-04-12T20:15:00.000Z'),
        recordedByUserId: 'user_1',
        clientActionTokenId: null,
        contactMethod: null,
        destinationSnapshot: null,
      },
      meta: {
        mutated: true,
        noOp: false,
      },
    })

    const result = await POST(
      makeIdempotentRequest({
        key: 'idem_2',
        body: { action: 'REJECTED' },
        headers: {
          'request-id': 'req_2',
          'user-agent': 'iPad kiosk',
        },
      }),
      makeCtx('booking_1'),
    )

    expectRouteIdempotencyStartedWith(
      expectedIdempotencyRequestBody(ConsultationDecision.REJECTED),
    )

    expect(mocks.recordInPersonConsultationDecision).toHaveBeenCalledWith({
      bookingId: 'booking_1',
      professionalId: 'pro_1',
      recordedByUserId: 'user_1',
      decision: ConsultationDecision.REJECTED,
      requestId: 'req_2',
      idempotencyKey: 'idem_2',
      userAgent: 'iPad kiosk',
    })

    expect(mocks.completeRouteIdempotency).toHaveBeenCalledWith({
      idempotencyRecordId: 'idem_record_1',
      responseStatus: 200,
      responseBody: rejectedResponseBody,
    })

    expect(result.status).toBe(200)
    await expect(result.json()).resolves.toEqual({
      ok: true,
      ...rejectedResponseBody,
    })
  })

  it('maps BookingError through getBookingFailPayload and marks idempotency failed', async () => {
    expectIdempotencyStarted('idem_booking_error_1')

    const bookingError = {
      name: 'BookingError',
      code: 'FORBIDDEN',
      message: 'Consultation proposal is no longer pending.',
      userMessage: 'Consultation proposal is no longer pending.',
    }

    mocks.recordInPersonConsultationDecision.mockRejectedValueOnce(bookingError)
    mocks.isBookingError.mockReturnValueOnce(true)
    mocks.getBookingFailPayload.mockReturnValueOnce({
      httpStatus: 403,
      userMessage: 'Consultation proposal is no longer pending.',
      extra: {
        code: 'FORBIDDEN',
        message: 'Consultation proposal is no longer pending.',
      },
    })

    const result = await POST(
      makeIdempotentRequest({
        key: 'idem_booking_error_1',
        body: { action: 'APPROVED' },
      }),
      makeCtx('booking_1'),
    )

    expect(mocks.failStartedRouteIdempotency).toHaveBeenCalledWith({
      idempotencyRecordId: 'idem_record_1',
      operation: OPERATION,
    })

    expect(mocks.getBookingFailPayload).toHaveBeenCalledWith('FORBIDDEN', {
      message: 'Consultation proposal is no longer pending.',
      userMessage: 'Consultation proposal is no longer pending.',
    })

    expect(result.status).toBe(403)
    await expect(result.json()).resolves.toEqual({
      ok: false,
      error: 'Consultation proposal is no longer pending.',
      code: 'FORBIDDEN',
      message: 'Consultation proposal is no longer pending.',
    })
  })

  it('returns 500 for unknown errors, captures exception, and marks idempotency failed', async () => {
    expectIdempotencyStarted('idem_boom_1')

    mocks.recordInPersonConsultationDecision.mockRejectedValueOnce(
      new Error('boom'),
    )

    const result = await POST(
      makeIdempotentRequest({
        key: 'idem_boom_1',
        body: { action: 'APPROVED' },
      }),
      makeCtx('booking_1'),
    )

    expect(mocks.failStartedRouteIdempotency).toHaveBeenCalledWith({
      idempotencyRecordId: 'idem_record_1',
      operation: OPERATION,
    })

    expect(mocks.captureBookingException).toHaveBeenCalledWith({
      error: expect.any(Error),
      route: OPERATION,
    })

    expect(mocks.jsonFail).toHaveBeenCalledWith(500, 'Internal server error')

    expect(result.status).toBe(500)
    await expect(result.json()).resolves.toEqual({
      ok: false,
      error: 'Internal server error',
    })
  })
})