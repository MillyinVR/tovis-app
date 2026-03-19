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

import { PATCH } from './route'

function makeCtx(id: string): { params: Promise<{ id: string }> } {
  return {
    params: Promise.resolve({ id }),
  }
}

function makeRequest(body?: unknown): Request {
  return new Request('http://localhost/api/pro/bookings/booking_1/cancel', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? '{}' : JSON.stringify(body),
  })
}

describe('app/api/pro/bookings/[id]/cancel/route.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mocks.requirePro.mockResolvedValue({
      ok: true,
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
        headers: { 'Content-Type': 'application/json' },
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
  })
})