import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ConsultationDecision, ConsultationApprovalStatus } from '@prisma/client'

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

import { POST } from './route'

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
        'Content-Type': 'application/json',
        ...(args?.headers ?? {}),
      },
      body: JSON.stringify(args?.body ?? {}),
    },
  )
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
              : 400,
        userMessage: overrides?.userMessage ?? overrides?.message ?? code,
        extra: {
          code,
          ...(overrides?.message ? { message: overrides.message } : {}),
        },
      }),
    )

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
    const authRes = { ok: false, status: 401, error: 'Unauthorized' }

    mocks.requirePro.mockResolvedValueOnce({
      ok: false,
      res: authRes,
    })

    const result = await POST(makeRequest(), makeCtx('booking_1'))

    expect(result).toBe(authRes)
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

    expect(mocks.jsonFail).toHaveBeenCalledWith(
      403,
      'You are not allowed to record this consultation decision.',
      {
        code: 'FORBIDDEN',
        message: 'Authenticated actor user id is required.',
      },
    )

    expect(result).toEqual({
      ok: false,
      status: 403,
      error: 'You are not allowed to record this consultation decision.',
      code: 'FORBIDDEN',
      message: 'Authenticated actor user id is required.',
    })

    expect(mocks.recordInPersonConsultationDecision).not.toHaveBeenCalled()
  })

  it('returns 400 when booking id is missing after trim', async () => {
    const result = await POST(
      makeRequest({ body: { action: 'APPROVED' } }),
      makeCtx('   '),
    )

    expect(mocks.jsonFail).toHaveBeenCalledWith(400, 'Missing booking id.')
    expect(result).toEqual({
      ok: false,
      status: 400,
      error: 'Missing booking id.',
    })

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
    expect(result).toEqual({
      ok: false,
      status: 400,
      error: 'Invalid action. Use APPROVED or REJECTED.',
    })

    expect(mocks.recordInPersonConsultationDecision).not.toHaveBeenCalled()
  })

  it('calls recordInPersonConsultationDecision for APPROVED and returns booking payload', async () => {
    const result = await POST(
      makeRequest({
        body: { action: 'approved' },
        headers: {
          'x-request-id': 'req_1',
          'idempotency-key': 'idem_1',
          'user-agent': 'iPad kiosk',
        },
      }),
      makeCtx('booking_1'),
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

    expect(mocks.jsonOk).toHaveBeenCalledWith(
      {
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
      },
      200,
    )

    expect(result).toEqual({
      ok: true,
      status: 200,
      data: {
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
      },
    })
  })

  it('calls recordInPersonConsultationDecision for REJECTED and returns rejection payload', async () => {
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
      makeRequest({
        body: { action: 'REJECTED' },
        headers: {
          'request-id': 'req_2',
          'x-idempotency-key': 'idem_2',
          'user-agent': 'iPad kiosk',
        },
      }),
      makeCtx('booking_1'),
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

    expect(result).toEqual({
      ok: true,
      status: 200,
      data: {
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
      },
    })
  })

  it('maps BookingError through getBookingFailPayload', async () => {
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
      makeRequest({ body: { action: 'APPROVED' } }),
      makeCtx('booking_1'),
    )

    expect(mocks.getBookingFailPayload).toHaveBeenCalledWith('FORBIDDEN', {
      message: 'Consultation proposal is no longer pending.',
      userMessage: 'Consultation proposal is no longer pending.',
    })

    expect(mocks.jsonFail).toHaveBeenCalledWith(
      403,
      'Consultation proposal is no longer pending.',
      {
        code: 'FORBIDDEN',
        message: 'Consultation proposal is no longer pending.',
      },
    )

    expect(result).toEqual({
      ok: false,
      status: 403,
      error: 'Consultation proposal is no longer pending.',
      code: 'FORBIDDEN',
      message: 'Consultation proposal is no longer pending.',
    })
  })

  it('returns 500 for unknown errors', async () => {
    mocks.recordInPersonConsultationDecision.mockRejectedValueOnce(
      new Error('boom'),
    )

    const result = await POST(
      makeRequest({ body: { action: 'APPROVED' } }),
      makeCtx('booking_1'),
    )

    expect(mocks.jsonFail).toHaveBeenCalledWith(500, 'Internal server error')
    expect(result).toEqual({
      ok: false,
      status: 500,
      error: 'Internal server error',
    })
  })
})