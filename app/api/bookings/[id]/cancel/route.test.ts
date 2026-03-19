import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Role, SessionStep, BookingStatus } from '@prisma/client'
import { BookingError, getBookingErrorDescriptor } from '@/lib/booking/errors'

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  pickString: vi.fn((value: unknown) =>
    typeof value === 'string' && value.trim() ? value.trim() : null,
  ),
  jsonFail: vi.fn(),
  jsonOk: vi.fn(),
  cancelBooking: vi.fn(),
}))

vi.mock('@/app/api/_utils/responses', () => ({
  jsonFail: mocks.jsonFail,
  jsonOk: mocks.jsonOk,
}))

vi.mock('@/app/api/_utils/pick', () => ({
  pickString: mocks.pickString,
}))

vi.mock('@/app/api/_utils/auth/requireUser', () => ({
  requireUser: mocks.requireUser,
}))

vi.mock('@/lib/booking/writeBoundary', () => ({
  cancelBooking: mocks.cancelBooking,
}))

import { POST } from './route'

function makeCtx(id: string): { params: Promise<{ id: string }> } {
  return {
    params: Promise.resolve({ id }),
  }
}

describe('app/api/bookings/[id]/cancel/route.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks()

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

    mocks.requireUser.mockResolvedValue({
      ok: true,
      user: {
        role: Role.CLIENT,
        clientProfile: { id: 'client_1' },
        professionalProfile: null,
      },
    })

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

  it('returns auth response when auth fails', async () => {
    const authRes = { ok: false, status: 401, error: 'Unauthorized' }

    mocks.requireUser.mockResolvedValueOnce({
      ok: false,
      res: authRes,
    })

    const result = await POST(
      new Request('http://localhost/api/bookings/booking_1/cancel', {
        method: 'POST',
      }),
      makeCtx('booking_1'),
    )

    expect(result).toBe(authRes)
    expect(mocks.cancelBooking).not.toHaveBeenCalled()
  })

  it('returns BOOKING_ID_REQUIRED when booking id is missing', async () => {
    const descriptor = getBookingErrorDescriptor('BOOKING_ID_REQUIRED')

    const result = await POST(
      new Request('http://localhost/api/bookings//cancel', {
        method: 'POST',
      }),
      makeCtx(''),
    )

    expect(mocks.jsonFail).toHaveBeenCalledWith(
      descriptor.httpStatus,
      descriptor.userMessage,
      {
        code: descriptor.code,
        retryable: descriptor.retryable,
        uiAction: descriptor.uiAction,
        message: descriptor.message,
      },
    )

    expect(result).toEqual({
      ok: false,
      status: descriptor.httpStatus,
      error: descriptor.userMessage,
      code: descriptor.code,
      retryable: descriptor.retryable,
      uiAction: descriptor.uiAction,
      message: descriptor.message,
    })

    expect(mocks.cancelBooking).not.toHaveBeenCalled()
  })

  it('calls cancelBooking with a client actor for client users', async () => {
    const result = await POST(
      new Request('http://localhost/api/bookings/booking_1/cancel', {
        method: 'POST',
      }),
      makeCtx('booking_1'),
    )

    expect(mocks.requireUser).toHaveBeenCalledWith({
      roles: [Role.CLIENT, Role.PRO, Role.ADMIN],
    })

    expect(mocks.cancelBooking).toHaveBeenCalledWith({
      bookingId: 'booking_1',
      actor: {
        kind: 'client',
        clientId: 'client_1',
      },
    })

    expect(mocks.jsonOk).toHaveBeenCalledWith(
      {
        id: 'booking_1',
        status: BookingStatus.CANCELLED,
        sessionStep: SessionStep.NONE,
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
        id: 'booking_1',
        status: BookingStatus.CANCELLED,
        sessionStep: SessionStep.NONE,
        meta: {
          mutated: true,
          noOp: false,
        },
      },
    })
  })

  it('calls cancelBooking with a pro actor for pro users', async () => {
    mocks.requireUser.mockResolvedValueOnce({
      ok: true,
      user: {
        role: Role.PRO,
        clientProfile: null,
        professionalProfile: { id: 'pro_1' },
      },
    })

    await POST(
      new Request('http://localhost/api/bookings/booking_1/cancel', {
        method: 'POST',
      }),
      makeCtx('booking_1'),
    )

    expect(mocks.cancelBooking).toHaveBeenCalledWith({
      bookingId: 'booking_1',
      actor: {
        kind: 'pro',
        professionalId: 'pro_1',
      },
    })
  })

  it('calls cancelBooking with an admin actor for admin users', async () => {
    mocks.requireUser.mockResolvedValueOnce({
      ok: true,
      user: {
        role: Role.ADMIN,
        clientProfile: null,
        professionalProfile: null,
      },
    })

    await POST(
      new Request('http://localhost/api/bookings/booking_1/cancel', {
        method: 'POST',
      }),
      makeCtx('booking_1'),
    )

    expect(mocks.cancelBooking).toHaveBeenCalledWith({
      bookingId: 'booking_1',
      actor: {
        kind: 'admin',
        professionalId: null,
      },
    })
  })

  it('maps BookingError from cancelBooking', async () => {
    const descriptor = getBookingErrorDescriptor('FORBIDDEN')

    mocks.cancelBooking.mockRejectedValueOnce(new BookingError('FORBIDDEN'))

    const result = await POST(
      new Request('http://localhost/api/bookings/booking_1/cancel', {
        method: 'POST',
      }),
      makeCtx('booking_1'),
    )

    expect(mocks.jsonFail).toHaveBeenCalledWith(
      descriptor.httpStatus,
      descriptor.userMessage,
      {
        code: descriptor.code,
        retryable: descriptor.retryable,
        uiAction: descriptor.uiAction,
        message: descriptor.message,
      },
    )

    expect(result).toEqual({
      ok: false,
      status: descriptor.httpStatus,
      error: descriptor.userMessage,
      code: descriptor.code,
      retryable: descriptor.retryable,
      uiAction: descriptor.uiAction,
      message: descriptor.message,
    })
  })

  it('returns 500 when cancelBooking throws a non-booking error', async () => {
    mocks.cancelBooking.mockRejectedValueOnce(new Error('boom'))

    const result = await POST(
      new Request('http://localhost/api/bookings/booking_1/cancel', {
        method: 'POST',
      }),
      makeCtx('booking_1'),
    )

    expect(mocks.jsonFail).toHaveBeenCalledWith(
      500,
      'Failed to cancel booking.',
    )

    expect(result).toEqual({
      ok: false,
      status: 500,
      error: 'Failed to cancel booking.',
    })
  })
})