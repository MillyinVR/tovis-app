import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  jsonOk: vi.fn(),
  jsonFail: vi.fn(),
  pickString: vi.fn(),
  upper: vi.fn(),

  getBookingFailPayload: vi.fn(),
  isBookingError: vi.fn(),

  approveConsultationByClientActionToken: vi.fn(),
  rejectConsultationByClientActionToken: vi.fn(),
}))

vi.mock('@/app/api/_utils', () => ({
  jsonOk: mocks.jsonOk,
  jsonFail: mocks.jsonFail,
  pickString: mocks.pickString,
  upper: mocks.upper,
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
}) {
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

function makeCtx(token = 'token_1') {
  return {
    params: Promise.resolve({ token }),
  }
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

    mocks.upper.mockImplementation((value: unknown) => {
      return typeof value === 'string' ? value.trim().toUpperCase() : ''
    })

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
        httpStatus: 403,
        userMessage: overrides?.userMessage ?? `booking error: ${code}`,
        extra: { code },
      }),
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

    expect(mocks.approveConsultationByClientActionToken).not.toHaveBeenCalled()
    expect(mocks.rejectConsultationByClientActionToken).not.toHaveBeenCalled()
  })

  it('forwards APPROVE requests to approveConsultationByClientActionToken and returns the result payload', async () => {
    mocks.approveConsultationByClientActionToken.mockResolvedValueOnce({
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
    })

    const response = await POST(
      makeRequest({
        body: { action: 'APPROVE' },
        headers: {
          'x-request-id': 'req_approve_1',
          'idempotency-key': 'idem_approve_1',
          'x-forwarded-for': '203.0.113.5, 70.1.1.1',
          'user-agent': 'Mozilla/5.0 Test Browser',
        },
      }),
      makeCtx('token_1'),
    )

    expect(mocks.approveConsultationByClientActionToken).toHaveBeenCalledWith({
      rawToken: 'token_1',
      requestId: 'req_approve_1',
      idempotencyKey: 'idem_approve_1',
      ipAddress: '203.0.113.5',
      userAgent: 'Mozilla/5.0 Test Browser',
    })

    expect(mocks.rejectConsultationByClientActionToken).not.toHaveBeenCalled()

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      ok: true,
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
    })
  })

  it('forwards REJECT requests to rejectConsultationByClientActionToken and returns the result payload', async () => {
    mocks.rejectConsultationByClientActionToken.mockResolvedValueOnce({
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
    })

    const response = await POST(
      makeRequest({
        body: { action: 'REJECT' },
        headers: {
          'request-id': 'req_reject_1',
          'x-idempotency-key': 'idem_reject_1',
          'x-real-ip': '198.51.100.8',
          'user-agent': 'Mobile Safari',
        },
      }),
      makeCtx('token_2'),
    )

    expect(mocks.rejectConsultationByClientActionToken).toHaveBeenCalledWith({
      rawToken: 'token_2',
      requestId: 'req_reject_1',
      idempotencyKey: 'idem_reject_1',
      ipAddress: '198.51.100.8',
      userAgent: 'Mobile Safari',
    })

    expect(mocks.approveConsultationByClientActionToken).not.toHaveBeenCalled()

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      ok: true,
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
    })
  })

  it('maps booking errors through bookingJsonFail', async () => {
    mocks.approveConsultationByClientActionToken.mockRejectedValueOnce({
      code: 'FORBIDDEN',
      message: 'Nope',
      userMessage: 'Blocked',
    })

    const response = await POST(
      makeRequest({
        body: { action: 'APPROVE' },
      }),
      makeCtx('token_3'),
    )

    expect(mocks.getBookingFailPayload).toHaveBeenCalledWith('FORBIDDEN', {
      message: 'Nope',
      userMessage: 'Blocked',
    })

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: 'Blocked',
      code: 'FORBIDDEN',
    })
  })

  it('returns 500 for unexpected errors', async () => {
    mocks.rejectConsultationByClientActionToken.mockRejectedValueOnce(
      new Error('boom'),
    )

    const response = await POST(
      makeRequest({
        body: { action: 'REJECT' },
      }),
      makeCtx('token_4'),
    )

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: 'Internal server error',
    })
  })
})