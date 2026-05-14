// app/api/pro/bookings/[id]/cancel/route.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BookingStatus, SessionStep } from '@prisma/client'

const mocks = vi.hoisted(() => ({
  requirePro: vi.fn(),
  jsonFail: vi.fn(),
  jsonOk: vi.fn(),
  cancelBooking: vi.fn(),
  getBookingFailPayload: vi.fn(),
  isBookingError: vi.fn(),
  beginIdempotency: vi.fn(),
  completeIdempotency: vi.fn(),
  failIdempotency: vi.fn(),
}))

vi.mock('@/app/api/_utils', () => ({
  requirePro: mocks.requirePro,
  jsonFail: mocks.jsonFail,
  jsonOk: mocks.jsonOk,
}))

vi.mock('@/lib/booking/writeBoundary', () => ({
  cancelBooking: mocks.cancelBooking,
}))

vi.mock('@/lib/booking/errors', () => ({
  getBookingFailPayload: mocks.getBookingFailPayload,
  isBookingError: mocks.isBookingError,
}))

vi.mock('@/lib/idempotency', () => ({
  beginIdempotency: mocks.beginIdempotency,
  completeIdempotency: mocks.completeIdempotency,
  failIdempotency: mocks.failIdempotency,
  IDEMPOTENCY_ROUTES: {
    PRO_BOOKING_CANCEL: 'PATCH /api/pro/bookings/[id]/cancel',
  },
}))

import { PATCH } from './route'

const IDEMPOTENCY_ROUTE = 'PATCH /api/pro/bookings/[id]/cancel'

function makeCtx(id: string): { params: Promise<{ id: string }> } {
  return {
    params: Promise.resolve({ id }),
  }
}

function makeRequest(
  body?: unknown,
  opts?: {
    idempotencyKey?: string | null
  },
): Request {
  const headers = new Headers({ 'Content-Type': 'application/json' })
  if (opts?.idempotencyKey !== null) {
    headers.set('idempotency-key', opts?.idempotencyKey ?? 'idem_cancel_1')
  }

  return new Request('http://localhost/api/pro/bookings/booking_1/cancel', {
    method: 'PATCH',
    headers,
    body: body === undefined ? '{}' : JSON.stringify(body),
  })
}

describe('app/api/pro/bookings/[id]/cancel/route.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mocks.requirePro.mockResolvedValue({
      ok: true,
      userId: 'user_1',
      professionalId: 'pro_1',
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

    mocks.getBookingFailPayload.mockImplementation(
      (
        code: string,
        overrides?: { message?: string; userMessage?: string },
      ) => ({
        httpStatus:
          code === 'BOOKING_ID_REQUIRED'
            ? 400
            : code === 'FORBIDDEN'
              ? 403
              : code === 'BOOKING_CANNOT_EDIT_COMPLETED'
                ? 409
                : 400,
        userMessage: overrides?.userMessage ?? overrides?.message ?? code,
        extra: {
          code,
          ...(overrides?.message ? { message: overrides.message } : {}),
        },
      }),
    )

    mocks.isBookingError.mockReturnValue(false)
    mocks.beginIdempotency.mockResolvedValue({
      kind: 'started',
      idempotencyRecordId: 'idem_record_1',
    })
    mocks.completeIdempotency.mockResolvedValue(undefined)
    mocks.failIdempotency.mockResolvedValue(undefined)

    mocks.cancelBooking.mockResolvedValue({
      booking: {
        id: 'booking_1',
        status: BookingStatus.CANCELLED,
        sessionStep: SessionStep.NONE,
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

    const result = await PATCH(makeRequest(), makeCtx('booking_1'))

    expect(result).toBe(authRes)
    expect(mocks.cancelBooking).not.toHaveBeenCalled()
    expect(mocks.beginIdempotency).not.toHaveBeenCalled()
  })

  it('returns BOOKING_ID_REQUIRED when booking id is missing after trim', async () => {
    const result = await PATCH(makeRequest(), makeCtx('   '))

    expect(mocks.getBookingFailPayload).toHaveBeenCalledWith(
      'BOOKING_ID_REQUIRED',
    )
    expect(mocks.jsonFail).toHaveBeenCalledWith(
      400,
      'BOOKING_ID_REQUIRED',
      { code: 'BOOKING_ID_REQUIRED' },
    )

    expect(result).toEqual({
      ok: false,
      status: 400,
      error: 'BOOKING_ID_REQUIRED',
      code: 'BOOKING_ID_REQUIRED',
    })

    expect(mocks.cancelBooking).not.toHaveBeenCalled()
    expect(mocks.beginIdempotency).not.toHaveBeenCalled()
  })

  it('returns missing idempotency key before cancelling', async () => {
    mocks.beginIdempotency.mockResolvedValueOnce({ kind: 'missing_key' })

    const result = await PATCH(
      makeRequest({ reason: 'Running behind' }, { idempotencyKey: null }),
      makeCtx('booking_1'),
    )

    expect(mocks.beginIdempotency).toHaveBeenCalledWith({
      actor: {
        actorUserId: 'user_1',
        actorRole: 'PRO',
      },
      route: IDEMPOTENCY_ROUTE,
      key: null,
      requestBody: {
        bookingId: 'booking_1',
        professionalId: 'pro_1',
        actorUserId: 'user_1',
        reason: 'Running behind',
      },
    })
    expect(mocks.jsonFail).toHaveBeenCalledWith(
      400,
      'Missing idempotency key.',
      {
        code: 'IDEMPOTENCY_KEY_REQUIRED',
      },
    )
    expect(result).toEqual({
      ok: false,
      status: 400,
      error: 'Missing idempotency key.',
      code: 'IDEMPOTENCY_KEY_REQUIRED',
    })
    expect(mocks.cancelBooking).not.toHaveBeenCalled()
  })

  it('calls cancelBooking with pro actor, notifyClient=true, allowed statuses, and provided reason', async () => {
    const result = await PATCH(
      makeRequest({ reason: 'Running behind' }),
      makeCtx('booking_1'),
    )

    expect(mocks.cancelBooking).toHaveBeenCalledWith({
      bookingId: 'booking_1',
      actor: {
        kind: 'pro',
        professionalId: 'pro_1',
      },
      notifyClient: true,
      reason: 'Running behind',
      allowedStatuses: [BookingStatus.PENDING, BookingStatus.ACCEPTED],
    })

    expect(mocks.beginIdempotency).toHaveBeenCalledWith({
      actor: {
        actorUserId: 'user_1',
        actorRole: 'PRO',
      },
      route: IDEMPOTENCY_ROUTE,
      key: 'idem_cancel_1',
      requestBody: {
        bookingId: 'booking_1',
        professionalId: 'pro_1',
        actorUserId: 'user_1',
        reason: 'Running behind',
      },
    })

    expect(mocks.completeIdempotency).toHaveBeenCalledWith({
      idempotencyRecordId: 'idem_record_1',
      responseStatus: 200,
      responseBody: {
        booking: {
          id: 'booking_1',
          status: BookingStatus.CANCELLED,
          sessionStep: SessionStep.NONE,
        },
        meta: {
          mutated: true,
          noOp: false,
        },
      },
    })

    expect(mocks.jsonOk).toHaveBeenCalledWith(
      {
        booking: {
          id: 'booking_1',
          status: BookingStatus.CANCELLED,
          sessionStep: SessionStep.NONE,
        },
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
        booking: {
          id: 'booking_1',
          status: BookingStatus.CANCELLED,
          sessionStep: SessionStep.NONE,
        },
        meta: {
          mutated: true,
          noOp: false,
        },
      },
    })
  })

  it('uses default reason when request body has no reason', async () => {
    await PATCH(makeRequest({}), makeCtx('booking_1'))

    expect(mocks.cancelBooking).toHaveBeenCalledWith({
      bookingId: 'booking_1',
      actor: {
        kind: 'pro',
        professionalId: 'pro_1',
      },
      notifyClient: true,
      reason: 'Cancelled by professional',
      allowedStatuses: [BookingStatus.PENDING, BookingStatus.ACCEPTED],
    })
  })

  it('uses default reason when reason is blank', async () => {
    await PATCH(makeRequest({ reason: '   ' }), makeCtx('booking_1'))

    expect(mocks.cancelBooking).toHaveBeenCalledWith({
      bookingId: 'booking_1',
      actor: {
        kind: 'pro',
        professionalId: 'pro_1',
      },
      notifyClient: true,
      reason: 'Cancelled by professional',
      allowedStatuses: [BookingStatus.PENDING, BookingStatus.ACCEPTED],
    })
  })

  it('uses default reason when body is not an object', async () => {
    const req = new Request(
      'http://localhost/api/pro/bookings/booking_1/cancel',
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'idempotency-key': 'idem_cancel_1',
        },
        body: JSON.stringify(['not-an-object']),
      },
    )

    await PATCH(req, makeCtx('booking_1'))

    expect(mocks.cancelBooking).toHaveBeenCalledWith({
      bookingId: 'booking_1',
      actor: {
        kind: 'pro',
        professionalId: 'pro_1',
      },
      notifyClient: true,
      reason: 'Cancelled by professional',
      allowedStatuses: [BookingStatus.PENDING, BookingStatus.ACCEPTED],
    })
  })

  it('returns conflict when idempotency key was reused with a different body', async () => {
    mocks.beginIdempotency.mockResolvedValueOnce({ kind: 'conflict' })

    const result = await PATCH(makeRequest(), makeCtx('booking_1'))

    expect(mocks.jsonFail).toHaveBeenCalledWith(
      409,
      'This idempotency key was already used with a different request body.',
      {
        code: 'IDEMPOTENCY_KEY_CONFLICT',
      },
    )
    expect(result).toEqual({
      ok: false,
      status: 409,
      error: 'This idempotency key was already used with a different request body.',
      code: 'IDEMPOTENCY_KEY_CONFLICT',
    })
    expect(mocks.cancelBooking).not.toHaveBeenCalled()
  })

  it('returns in-progress when a matching cancel request is already active', async () => {
    mocks.beginIdempotency.mockResolvedValueOnce({ kind: 'in_progress' })

    const result = await PATCH(makeRequest(), makeCtx('booking_1'))

    expect(mocks.jsonFail).toHaveBeenCalledWith(
      409,
      'A matching cancel request is already in progress.',
      {
        code: 'IDEMPOTENCY_REQUEST_IN_PROGRESS',
      },
    )
    expect(result).toEqual({
      ok: false,
      status: 409,
      error: 'A matching cancel request is already in progress.',
      code: 'IDEMPOTENCY_REQUEST_IN_PROGRESS',
    })
    expect(mocks.cancelBooking).not.toHaveBeenCalled()
  })

  it('replays a completed idempotency response without cancelling again', async () => {
    const replayBody = {
      booking: {
        id: 'booking_1',
        status: BookingStatus.CANCELLED,
        sessionStep: SessionStep.NONE,
      },
      meta: {
        mutated: true,
        noOp: false,
      },
    }

    mocks.beginIdempotency.mockResolvedValueOnce({
      kind: 'replay',
      responseStatus: 200,
      responseBody: replayBody,
    })

    const result = await PATCH(makeRequest(), makeCtx('booking_1'))

    expect(mocks.jsonOk).toHaveBeenCalledWith(replayBody, 200)
    expect(result).toEqual({
      ok: true,
      status: 200,
      data: replayBody,
    })
    expect(mocks.cancelBooking).not.toHaveBeenCalled()
    expect(mocks.completeIdempotency).not.toHaveBeenCalled()
  })

  it('maps BookingError through getBookingFailPayload', async () => {
    const bookingError = {
      name: 'BookingError',
      code: 'FORBIDDEN',
      message: 'Booking status REJECTED cannot be cancelled in this flow.',
      userMessage: 'Only pending or accepted bookings can be cancelled.',
    }

    mocks.cancelBooking.mockRejectedValueOnce(bookingError)
    mocks.isBookingError.mockReturnValueOnce(true)
    mocks.getBookingFailPayload.mockReturnValueOnce({
      httpStatus: 403,
      userMessage: 'Only pending or accepted bookings can be cancelled.',
      extra: {
        code: 'FORBIDDEN',
        message: 'Booking status REJECTED cannot be cancelled in this flow.',
      },
    })

    const result = await PATCH(makeRequest(), makeCtx('booking_1'))

    expect(mocks.getBookingFailPayload).toHaveBeenCalledWith('FORBIDDEN', {
      message: 'Booking status REJECTED cannot be cancelled in this flow.',
      userMessage: 'Only pending or accepted bookings can be cancelled.',
    })

    expect(mocks.jsonFail).toHaveBeenCalledWith(
      403,
      'Only pending or accepted bookings can be cancelled.',
      {
        code: 'FORBIDDEN',
        message: 'Booking status REJECTED cannot be cancelled in this flow.',
      },
    )

    expect(result).toEqual({
      ok: false,
      status: 403,
      error: 'Only pending or accepted bookings can be cancelled.',
      code: 'FORBIDDEN',
      message: 'Booking status REJECTED cannot be cancelled in this flow.',
    })
    expect(mocks.failIdempotency).toHaveBeenCalledWith({
      idempotencyRecordId: 'idem_record_1',
    })
  })

  it('returns 500 for unknown errors', async () => {
    mocks.cancelBooking.mockRejectedValueOnce(new Error('boom'))

    const result = await PATCH(makeRequest(), makeCtx('booking_1'))

    expect(mocks.jsonFail).toHaveBeenCalledWith(500, 'Internal server error')
    expect(result).toEqual({
      ok: false,
      status: 500,
      error: 'Internal server error',
    })
    expect(mocks.failIdempotency).toHaveBeenCalledWith({
      idempotencyRecordId: 'idem_record_1',
    })
  })
})
