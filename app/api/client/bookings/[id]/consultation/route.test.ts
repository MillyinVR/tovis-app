// app/api/client/bookings/[id]/consultation/route.test.ts

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  prismaBookingFindUnique: vi.fn(),
  prismaConsultationApprovalFindUnique: vi.fn(),

  jsonFail: vi.fn(),
  jsonOk: vi.fn(),
  pickString: vi.fn((value: unknown) =>
    typeof value === 'string' && value.trim() ? value.trim() : null,
  ),
  requireClient: vi.fn(),
  upper: vi.fn((value: unknown) =>
    typeof value === 'string' ? value.trim().toUpperCase() : '',
  ),

  handleConsultationDecision: vi.fn(),
  safeError: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    booking: {
      findUnique: mocks.prismaBookingFindUnique,
    },
    consultationApproval: {
      findUnique: mocks.prismaConsultationApprovalFindUnique,
    },
  },
}))

vi.mock('@/app/api/_utils', () => ({
  jsonFail: mocks.jsonFail,
  jsonOk: mocks.jsonOk,
  pickString: mocks.pickString,
  requireClient: mocks.requireClient,
  upper: mocks.upper,
}))

vi.mock('@/lib/security/logging', () => ({
  safeError: mocks.safeError,
}))

vi.mock('./_decision', () => ({
  handleConsultationDecision: mocks.handleConsultationDecision,
}))

import { GET, POST } from './route'

type TestCtx = {
  params: Promise<{ id: string }>
}

function makeCtx(id = 'booking_1'): TestCtx {
  return {
    params: Promise.resolve({ id }),
  }
}

function makeRequest(args?: {
  body?: unknown
  headers?: HeadersInit
}): Request {
  return new Request(
    'http://localhost/api/client/bookings/booking_1/consultation',
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(args?.headers ?? {}),
      },
      body:
        args && Object.prototype.hasOwnProperty.call(args, 'body')
          ? JSON.stringify(args.body)
          : undefined,
    },
  )
}

describe('app/api/client/bookings/[id]/consultation/route.ts', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.clearAllMocks()

    consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined)

    mocks.jsonFail.mockImplementation((status: number, error: string) => ({
      ok: false,
      status,
      error,
    }))

    mocks.jsonOk.mockImplementation((body: unknown, status = 200) => ({
      ok: true,
      status,
      body,
    }))

    mocks.requireClient.mockResolvedValue({
      ok: true,
      clientId: 'client_1',
    })

    mocks.prismaBookingFindUnique.mockResolvedValue({
      id: 'booking_1',
      clientId: 'client_1',
    })

    mocks.prismaConsultationApprovalFindUnique.mockResolvedValue({
      id: 'approval_1',
      status: 'PENDING',
      proposedServicesJson: {
        services: ['service_1'],
      },
      proposedTotal: '125.00',
      notes: 'Client-facing consultation notes.',
      createdAt: new Date('2026-04-20T10:00:00.000Z'),
      updatedAt: new Date('2026-04-20T10:05:00.000Z'),
      approvedAt: null,
      rejectedAt: null,
      clientId: 'client_1',
      proId: 'pro_1',
    })

    mocks.handleConsultationDecision.mockResolvedValue({
      ok: true,
      status: 200,
      body: {
        ok: true,
        action: 'APPROVE',
      },
    })

    mocks.safeError.mockImplementation((error: unknown) => ({
      name: error instanceof Error ? error.name : 'UnknownError',
      message: error instanceof Error ? error.message : 'Unknown error',
    }))
  })

  afterEach(() => {
    consoleErrorSpy.mockRestore()
  })

  describe('GET', () => {
    it('returns auth response when requireClient fails', async () => {
      const authRes = {
        ok: false,
        status: 401,
        error: 'Unauthorized',
      }

      mocks.requireClient.mockResolvedValueOnce({
        ok: false,
        res: authRes,
      })

      const result = await GET(new Request('http://localhost'), makeCtx())

      expect(result).toBe(authRes)

      expect(mocks.prismaBookingFindUnique).not.toHaveBeenCalled()
      expect(mocks.prismaConsultationApprovalFindUnique).not.toHaveBeenCalled()
      expect(mocks.jsonFail).not.toHaveBeenCalled()
      expect(mocks.jsonOk).not.toHaveBeenCalled()
    })

    it('returns 400 when booking id is missing', async () => {
      const result = await GET(new Request('http://localhost'), makeCtx(''))

      expect(mocks.jsonFail).toHaveBeenCalledWith(400, 'Missing booking id.')
      expect(result).toEqual({
        ok: false,
        status: 400,
        error: 'Missing booking id.',
      })

      expect(mocks.prismaBookingFindUnique).not.toHaveBeenCalled()
      expect(mocks.prismaConsultationApprovalFindUnique).not.toHaveBeenCalled()
    })

    it('returns 404 when booking is not found', async () => {
      mocks.prismaBookingFindUnique.mockResolvedValueOnce(null)

      const result = await GET(new Request('http://localhost'), makeCtx())

      expect(mocks.prismaBookingFindUnique).toHaveBeenCalledWith({
        where: { id: 'booking_1' },
        select: { id: true, clientId: true },
      })

      expect(mocks.jsonFail).toHaveBeenCalledWith(404, 'Booking not found.')
      expect(result).toEqual({
        ok: false,
        status: 404,
        error: 'Booking not found.',
      })

      expect(mocks.prismaConsultationApprovalFindUnique).not.toHaveBeenCalled()
    })

    it('returns 404 when booking belongs to another client (no existence leak)', async () => {
      mocks.prismaBookingFindUnique.mockResolvedValueOnce({
        id: 'booking_1',
        clientId: 'other_client',
      })

      const result = await GET(new Request('http://localhost'), makeCtx())

      expect(mocks.jsonFail).toHaveBeenCalledWith(404, 'Booking not found.')
      expect(result).toEqual({
        ok: false,
        status: 404,
        error: 'Booking not found.',
      })

      expect(mocks.prismaConsultationApprovalFindUnique).not.toHaveBeenCalled()
    })

    it('returns 404 when no consultation proposal exists', async () => {
      mocks.prismaConsultationApprovalFindUnique.mockResolvedValueOnce(null)

      const result = await GET(new Request('http://localhost'), makeCtx())

      expect(mocks.prismaConsultationApprovalFindUnique).toHaveBeenCalledWith({
        where: { bookingId: 'booking_1' },
        select: {
          id: true,
          status: true,
          proposedServicesJson: true,
          proposedTotal: true,
          notes: true,
          createdAt: true,
          updatedAt: true,
          approvedAt: true,
          rejectedAt: true,
          clientId: true,
          proId: true,
        },
      })

      expect(mocks.jsonFail).toHaveBeenCalledWith(
        404,
        'No consultation proposal found.',
      )
      expect(result).toEqual({
        ok: false,
        status: 404,
        error: 'No consultation proposal found.',
      })
    })

    it('returns the consultation approval for an owned booking', async () => {
      const result = await GET(new Request('http://localhost'), makeCtx())

      expect(mocks.prismaBookingFindUnique).toHaveBeenCalledWith({
        where: { id: 'booking_1' },
        select: { id: true, clientId: true },
      })

      expect(mocks.prismaConsultationApprovalFindUnique).toHaveBeenCalledWith({
        where: { bookingId: 'booking_1' },
        select: {
          id: true,
          status: true,
          proposedServicesJson: true,
          proposedTotal: true,
          notes: true,
          createdAt: true,
          updatedAt: true,
          approvedAt: true,
          rejectedAt: true,
          clientId: true,
          proId: true,
        },
      })

      expect(mocks.jsonOk).toHaveBeenCalledWith({
        bookingId: 'booking_1',
        approval: {
          id: 'approval_1',
          status: 'PENDING',
          proposedServicesJson: {
            services: ['service_1'],
          },
          proposedTotal: '125.00',
          notes: 'Client-facing consultation notes.',
          createdAt: new Date('2026-04-20T10:00:00.000Z'),
          updatedAt: new Date('2026-04-20T10:05:00.000Z'),
          approvedAt: null,
          rejectedAt: null,
          clientId: 'client_1',
          proId: 'pro_1',
        },
      })

      expect(result).toEqual({
        ok: true,
        status: 200,
        body: {
          bookingId: 'booking_1',
          approval: {
            id: 'approval_1',
            status: 'PENDING',
            proposedServicesJson: {
              services: ['service_1'],
            },
            proposedTotal: '125.00',
            notes: 'Client-facing consultation notes.',
            createdAt: new Date('2026-04-20T10:00:00.000Z'),
            updatedAt: new Date('2026-04-20T10:05:00.000Z'),
            approvedAt: null,
            rejectedAt: null,
            clientId: 'client_1',
            proId: 'pro_1',
          },
        },
      })
    })

    it('returns 500 and logs a safe error when GET throws', async () => {
      const thrown = new Error('db blew up')
      mocks.prismaBookingFindUnique.mockRejectedValueOnce(thrown)

      const result = await GET(new Request('http://localhost'), makeCtx())

      expect(mocks.safeError).toHaveBeenCalledWith(thrown)
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'GET /api/client/bookings/[id]/consultation error',
        {
          error: {
            name: 'Error',
            message: 'db blew up',
          },
        },
      )

      expect(mocks.jsonFail).toHaveBeenCalledWith(
        500,
        'Internal server error',
      )
      expect(result).toEqual({
        ok: false,
        status: 500,
        error: 'Internal server error',
      })
    })
  })

  describe('POST', () => {
    it('returns 400 when action is invalid', async () => {
      const result = await POST(
        makeRequest({
          body: {
            action: 'MAYBE',
          },
        }),
        makeCtx(),
      )

      expect(mocks.upper).toHaveBeenCalledWith('MAYBE')
      expect(mocks.jsonFail).toHaveBeenCalledWith(400, 'Invalid action.')
      expect(result).toEqual({
        ok: false,
        status: 400,
        error: 'Invalid action.',
      })

      expect(mocks.handleConsultationDecision).not.toHaveBeenCalled()
    })

    it('passes APPROVE with request metadata to handleConsultationDecision', async () => {
      const result = await POST(
        makeRequest({
          body: {
            action: 'approve',
          },
          headers: {
            'x-request-id': 'req_123',
            'idempotency-key': 'idem_123',
          },
        }),
        makeCtx(),
      )

      expect(mocks.handleConsultationDecision).toHaveBeenCalledWith(
        'APPROVE',
        {
          params: expect.any(Promise),
        },
        {
          requestId: 'req_123',
          idempotencyKey: 'idem_123',
        },
      )

      expect(result).toEqual({
        ok: true,
        status: 200,
        body: {
          ok: true,
          action: 'APPROVE',
        },
      })
    })

    it('passes REJECT with fallback request metadata header names', async () => {
      await POST(
        makeRequest({
          body: {
            action: 'reject',
          },
          headers: {
            'request-id': 'req_fallback',
            'x-idempotency-key': 'idem_fallback',
          },
        }),
        makeCtx(),
      )

      expect(mocks.handleConsultationDecision).toHaveBeenCalledWith(
        'REJECT',
        {
          params: expect.any(Promise),
        },
        {
          requestId: 'req_fallback',
          idempotencyKey: 'idem_fallback',
        },
      )
    })

    it('passes null request metadata when headers are missing', async () => {
      await POST(
        makeRequest({
          body: {
            action: 'APPROVE',
          },
        }),
        makeCtx(),
      )

      expect(mocks.handleConsultationDecision).toHaveBeenCalledWith(
        'APPROVE',
        {
          params: expect.any(Promise),
        },
        {
          requestId: null,
          idempotencyKey: null,
        },
      )
    })

    it('returns 500 and logs a safe error when POST throws', async () => {
      const thrown = new Error('decision blew up')
      mocks.handleConsultationDecision.mockRejectedValueOnce(thrown)

      const result = await POST(
        makeRequest({
          body: {
            action: 'APPROVE',
          },
        }),
        makeCtx(),
      )

      expect(mocks.safeError).toHaveBeenCalledWith(thrown)
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'POST /api/client/bookings/[id]/consultation error',
        {
          error: {
            name: 'Error',
            message: 'decision blew up',
          },
        },
      )

      expect(mocks.jsonFail).toHaveBeenCalledWith(
        500,
        'Internal server error',
      )
      expect(result).toEqual({
        ok: false,
        status: 500,
        error: 'Internal server error',
      })
    })
  })
})