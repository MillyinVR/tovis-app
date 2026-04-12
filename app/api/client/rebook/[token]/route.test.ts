import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'
import { AftercareRebookMode } from '@prisma/client'

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
  resolveAftercareAccessByToken: vi.fn(),
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
  return new Request(
    'http://localhost/api/client/rebook/token_1',
    {
      method: args?.method ?? 'POST',
      headers: {
        'content-type': 'application/json',
        ...(args?.headers ?? {}),
      },
      body:
        args?.method === 'GET'
          ? undefined
          : JSON.stringify(args?.body ?? {}),
    },
  ) as unknown as NextRequest
}

function makeResolvedAftercareAccess(overrides?: {
  accessSource?: 'clientActionToken' | 'legacyPublicToken'
  rebookMode?: AftercareRebookMode
  rebookWindowStart?: Date | null
  rebookWindowEnd?: Date | null
}) {
  return {
    accessSource: overrides?.accessSource ?? 'clientActionToken',
    token: {
      id: 'token_row_1',
      expiresAt: new Date('2026-04-20T18:00:00.000Z'),
      firstUsedAt: null,
      lastUsedAt: null,
      useCount: 0,
      singleUse: false,
    },
    aftercare: {
      id: 'aftercare_1',
      bookingId: 'booking_1',
      notes: 'Use a sulfate-free shampoo.',
      rebookMode: overrides?.rebookMode ?? AftercareRebookMode.BOOKED_NEXT_APPOINTMENT,
      rebookedFor: new Date('2026-05-01T18:00:00.000Z'),
      rebookWindowStart:
        overrides?.rebookWindowStart ??
        new Date('2026-04-20T18:00:00.000Z'),
      rebookWindowEnd:
        overrides?.rebookWindowEnd ??
        new Date('2026-04-30T18:00:00.000Z'),
      publicToken: 'legacy_public_token',
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
      (data: unknown, status = 200) =>
        makeJsonResponse(status, {
          ok: true,
          data,
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
        httpStatus: code === 'FORBIDDEN' ? 403 : 409,
        userMessage: overrides?.userMessage ?? code,
        extra: {
          code,
          ...(overrides?.message ? { message: overrides.message } : {}),
        },
      }),
    )
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('GET returns 400 when token is missing', async () => {
    const response = await GET(makeRequest({ method: 'GET' }), makeCtx('   '))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: 'Missing token.',
    })

    expect(mocks.resolveAftercareAccessByToken).not.toHaveBeenCalled()
  })

  it('GET resolves aftercare access by token and returns the public payload', async () => {
    mocks.resolveAftercareAccessByToken.mockResolvedValueOnce(
      makeResolvedAftercareAccess({
        accessSource: 'legacyPublicToken',
      }),
    )

    const response = await GET(makeRequest({ method: 'GET' }), makeCtx('token_1'))

    expect(mocks.resolveAftercareAccessByToken).toHaveBeenCalledWith({
      rawToken: 'token_1',
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      ok: true,
      data: {
        accessSource: 'legacyPublicToken',
        token: {
          id: 'token_row_1',
          expiresAt: '2026-04-20T18:00:00.000Z',
          firstUsedAt: null,
          lastUsedAt: null,
          useCount: 0,
          singleUse: false,
        },
        aftercare: {
          id: 'aftercare_1',
          bookingId: 'booking_1',
          notes: 'Use a sulfate-free shampoo.',
          rebookMode: AftercareRebookMode.BOOKED_NEXT_APPOINTMENT,
          rebookedFor: '2026-05-01T18:00:00.000Z',
          rebookWindowStart: '2026-04-20T18:00:00.000Z',
          rebookWindowEnd: '2026-04-30T18:00:00.000Z',
          publicToken: 'legacy_public_token',
          draftSavedAt: '2026-04-12T17:00:00.000Z',
          sentToClientAt: '2026-04-12T17:30:00.000Z',
          lastEditedAt: '2026-04-12T17:15:00.000Z',
          version: 2,
          isFinalized: true,
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
      },
    })
  })

  it('POST returns 400 when token is missing', async () => {
    const response = await POST(
      makeRequest({
        body: { scheduledFor: '2026-04-25T18:00:00.000Z' },
      }),
      makeCtx('   '),
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: 'Missing token.',
    })

    expect(mocks.resolveAftercareAccessByToken).not.toHaveBeenCalled()
    expect(mocks.createClientRebookedBookingFromAftercare).not.toHaveBeenCalled()
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
    expect(mocks.createClientRebookedBookingFromAftercare).not.toHaveBeenCalled()
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

    expect(mocks.createClientRebookedBookingFromAftercare).not.toHaveBeenCalled()
  })

  it('POST creates a rebooked booking using token-resolved ownership and request metadata', async () => {
    mocks.resolveAftercareAccessByToken.mockResolvedValueOnce(
      makeResolvedAftercareAccess({
        rebookMode: AftercareRebookMode.BOOKED_NEXT_APPOINTMENT,
      }),
    )

    mocks.createClientRebookedBookingFromAftercare.mockResolvedValueOnce({
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
    })

    const response = await POST(
      makeRequest({
        body: { scheduledFor: '2026-04-25T18:00:00.000Z' },
        headers: {
          'x-request-id': 'req_1',
          'idempotency-key': 'idem_1',
        },
      }),
      makeCtx('token_1'),
    )

    expect(mocks.resolveAftercareAccessByToken).toHaveBeenCalledWith({
      rawToken: 'token_1',
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

    expect(response.status).toBe(201)
    await expect(response.json()).resolves.toEqual({
      ok: true,
      data: {
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
      },
    })
  })

  it('maps BookingError through bookingJsonFail for GET', async () => {
    const bookingError = {
      code: 'FORBIDDEN',
      message: 'That aftercare link is invalid or expired.',
      userMessage: 'That aftercare link is invalid or expired.',
    }

    mocks.resolveAftercareAccessByToken.mockRejectedValueOnce(bookingError)
    mocks.isBookingError.mockReturnValueOnce(true)
    mocks.getBookingFailPayload.mockReturnValueOnce({
      httpStatus: 403,
      userMessage: 'That aftercare link is invalid or expired.',
      extra: {
        code: 'FORBIDDEN',
        message: 'That aftercare link is invalid or expired.',
      },
    })

    const response = await GET(makeRequest({ method: 'GET' }), makeCtx('token_1'))

    expect(mocks.getBookingFailPayload).toHaveBeenCalledWith('FORBIDDEN', {
      message: 'That aftercare link is invalid or expired.',
      userMessage: 'That aftercare link is invalid or expired.',
    })

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: 'That aftercare link is invalid or expired.',
      code: 'FORBIDDEN',
      message: 'That aftercare link is invalid or expired.',
    })
  })

  it('maps BookingError through bookingJsonFail for POST', async () => {
    mocks.resolveAftercareAccessByToken.mockResolvedValueOnce(
      makeResolvedAftercareAccess(),
    )

    const bookingError = {
      code: 'FORBIDDEN',
      message: 'Selected time is no longer available.',
      userMessage: 'Selected time is no longer available.',
    }

    mocks.createClientRebookedBookingFromAftercare.mockRejectedValueOnce(
      bookingError,
    )
    mocks.isBookingError.mockReturnValueOnce(true)
    mocks.getBookingFailPayload.mockReturnValueOnce({
      httpStatus: 403,
      userMessage: 'Selected time is no longer available.',
      extra: {
        code: 'FORBIDDEN',
        message: 'Selected time is no longer available.',
      },
    })

    const response = await POST(
      makeRequest({
        body: { scheduledFor: '2026-04-25T18:00:00.000Z' },
      }),
      makeCtx('token_1'),
    )

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: 'Selected time is no longer available.',
      code: 'FORBIDDEN',
      message: 'Selected time is no longer available.',
    })
  })

  it('returns 500 for unexpected GET errors', async () => {
    mocks.resolveAftercareAccessByToken.mockRejectedValueOnce(new Error('boom'))

    const response = await GET(makeRequest({ method: 'GET' }), makeCtx('token_1'))

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: 'Internal server error',
    })
  })

  it('returns 500 for unexpected POST errors', async () => {
    mocks.resolveAftercareAccessByToken.mockResolvedValueOnce(
      makeResolvedAftercareAccess(),
    )
    mocks.createClientRebookedBookingFromAftercare.mockRejectedValueOnce(
      new Error('boom'),
    )

    const response = await POST(
      makeRequest({
        body: { scheduledFor: '2026-04-25T18:00:00.000Z' },
      }),
      makeCtx('token_1'),
    )

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: 'Internal server error',
    })
  })
})