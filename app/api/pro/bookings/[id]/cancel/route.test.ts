// app/api/pro/bookings/[id]/cancel/route.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BookingStatus, Role, SessionStep } from '@prisma/client'

const mocks = vi.hoisted(() => ({
  requirePro: vi.fn(),
  jsonFail: vi.fn(),
  jsonOk: vi.fn(),
  cancelBooking: vi.fn(),
  applyAutoCancelRefund: vi.fn(),
  applyDiscoveryDepositCancelRefund: vi.fn(),
  getBookingFailPayload: vi.fn(),
  isBookingError: vi.fn(),

  beginRouteIdempotency: vi.fn(),
  completeRouteIdempotency: vi.fn(),
  failStartedRouteIdempotency: vi.fn(),
  isRouteIdempotencyHandled: vi.fn(),

  safeError: vi.fn(),
  safeLogMeta: vi.fn(),
}))

vi.mock('@/app/api/_utils', () => ({
  requirePro: mocks.requirePro,
  jsonFail: mocks.jsonFail,
  jsonOk: mocks.jsonOk,
}))

vi.mock('@/app/api/_utils/idempotency', () => ({
  beginRouteIdempotency: mocks.beginRouteIdempotency,
  completeRouteIdempotency: mocks.completeRouteIdempotency,
  failStartedRouteIdempotency: mocks.failStartedRouteIdempotency,
  isRouteIdempotencyHandled: mocks.isRouteIdempotencyHandled,
}))

vi.mock('@/lib/booking/writeBoundary', () => ({
  cancelBooking: mocks.cancelBooking,
}))

vi.mock('@/lib/booking/cancelRefund', () => ({
  applyAutoCancelRefund: mocks.applyAutoCancelRefund,
  applyDiscoveryDepositCancelRefund: mocks.applyDiscoveryDepositCancelRefund,
}))

vi.mock('@/lib/booking/errors', () => ({
  getBookingFailPayload: mocks.getBookingFailPayload,
  isBookingError: mocks.isBookingError,
}))

vi.mock('@/lib/idempotency', () => ({
  IDEMPOTENCY_ROUTES: {
    PRO_BOOKING_CANCEL: 'PATCH /api/pro/bookings/[id]/cancel',
  },
}))

vi.mock('@/lib/security/logging', () => ({
  safeError: mocks.safeError,
  safeLogMeta: mocks.safeLogMeta,
}))

import { IDEMPOTENCY_ROUTES } from '@/lib/idempotency'
import { PATCH } from './route'

type TestCtx = { params: Promise<{ id: string }> }

const IDEMPOTENCY_ROUTE = 'PATCH /api/pro/bookings/[id]/cancel'

function makeCtx(id: string): TestCtx {
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

function expectIdempotencyStarted(key = 'idem_cancel_1'): void {
  mocks.beginRouteIdempotency.mockResolvedValue({
    kind: 'started',
    idempotencyRecordId: 'idem_record_1',
    idempotencyKey: key,
    requestHash: 'hash_1',
  })

  mocks.isRouteIdempotencyHandled.mockReturnValue(false)
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

    mocks.completeRouteIdempotency.mockResolvedValue(undefined)
    mocks.failStartedRouteIdempotency.mockResolvedValue(undefined)
    mocks.safeError.mockImplementation((error: unknown) => ({
      name: error instanceof Error ? error.name : 'UnknownError',
      message: error instanceof Error ? error.message : String(error),
    }))

    mocks.safeLogMeta.mockImplementation((meta: unknown) => meta)
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
    mocks.applyAutoCancelRefund.mockResolvedValue({ outcome: 'NOT_ATTEMPTED' })
    mocks.applyDiscoveryDepositCancelRefund.mockResolvedValue({
      outcome: 'NOT_ATTEMPTED',
    })

    expectIdempotencyStarted()
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
    expect(mocks.beginRouteIdempotency).not.toHaveBeenCalled()
    expect(mocks.failStartedRouteIdempotency).not.toHaveBeenCalled()
  })

  it('returns FORBIDDEN when actor user id is missing', async () => {
    mocks.requirePro.mockResolvedValueOnce({
      ok: true,
      userId: '',
      professionalId: 'pro_1',
    })

    const result = await PATCH(makeRequest(), makeCtx('booking_1'))

    expect(mocks.getBookingFailPayload).toHaveBeenCalledWith('FORBIDDEN', {
      message: 'Authenticated actor user id is required.',
      userMessage: 'You are not allowed to cancel this booking.',
    })

    expect(mocks.jsonFail).toHaveBeenCalledWith(
      403,
      'You are not allowed to cancel this booking.',
      {
        code: 'FORBIDDEN',
        message: 'Authenticated actor user id is required.',
      },
    )

    expect(result).toEqual({
      ok: false,
      status: 403,
      error: 'You are not allowed to cancel this booking.',
      code: 'FORBIDDEN',
      message: 'Authenticated actor user id is required.',
    })

    expect(mocks.beginRouteIdempotency).not.toHaveBeenCalled()
    expect(mocks.cancelBooking).not.toHaveBeenCalled()
    expect(mocks.failStartedRouteIdempotency).not.toHaveBeenCalled()
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
    expect(mocks.beginRouteIdempotency).not.toHaveBeenCalled()
    expect(mocks.failStartedRouteIdempotency).not.toHaveBeenCalled()
  })

  it('returns handled idempotency response before cancelling', async () => {
    const handledResponse = {
      ok: false,
      status: 400,
      error: 'Missing idempotency key.',
      code: 'IDEMPOTENCY_KEY_REQUIRED',
    }

    mocks.beginRouteIdempotency.mockResolvedValueOnce({
      kind: 'handled',
      response: handledResponse,
    })

    mocks.isRouteIdempotencyHandled.mockReturnValueOnce(true)

    const result = await PATCH(
      makeRequest({ reason: 'Running behind' }, { idempotencyKey: null }),
      makeCtx('booking_1'),
    )

    expect(result).toBe(handledResponse)
    expect(mocks.cancelBooking).not.toHaveBeenCalled()
    expect(mocks.completeRouteIdempotency).not.toHaveBeenCalled()
    expect(mocks.failStartedRouteIdempotency).not.toHaveBeenCalled()
  })

  it('starts idempotency with pro actor, route, request body, and messages', async () => {
    await PATCH(
      makeRequest({ reason: 'Running behind' }),
      makeCtx('booking_1'),
    )

    expect(mocks.beginRouteIdempotency).toHaveBeenCalledWith({
      request: expect.any(Request),
      actor: {
        actorUserId: 'user_1',
        actorRole: Role.PRO,
      },
      route: IDEMPOTENCY_ROUTES.PRO_BOOKING_CANCEL,
      requestLabel: 'pro booking cancellation',
      requestBody: {
        bookingId: 'booking_1',
        professionalId: 'pro_1',
        actorUserId: 'user_1',
        reason: 'Running behind',
      },
      messages: {
        missingKey: 'Missing idempotency key.',
        inProgress: 'A matching cancel request is already in progress.',
        conflict:
          'This idempotency key was already used with a different request body.',
      },
    })
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

    // Pro cancellation fires the auto-refund hook (always eligible).
    expect(mocks.applyAutoCancelRefund).toHaveBeenCalledWith({
      bookingId: 'booking_1',
      actorKind: 'pro',
      actorUserId: 'user_1',
      cancelMutated: true,
      reason: 'Running behind',
    })

    expect(mocks.completeRouteIdempotency).toHaveBeenCalledWith({
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

  it('does not call cancelBooking when idempotency helper handles conflict', async () => {
    const handledResponse = {
      ok: false,
      status: 409,
      error: 'This idempotency key was already used with a different request body.',
      code: 'IDEMPOTENCY_KEY_CONFLICT',
    }

    mocks.beginRouteIdempotency.mockResolvedValueOnce({
      kind: 'handled',
      response: handledResponse,
    })

    mocks.isRouteIdempotencyHandled.mockReturnValueOnce(true)

    const result = await PATCH(makeRequest(), makeCtx('booking_1'))

    expect(result).toBe(handledResponse)
    expect(mocks.cancelBooking).not.toHaveBeenCalled()
    expect(mocks.completeRouteIdempotency).not.toHaveBeenCalled()
    expect(mocks.failStartedRouteIdempotency).not.toHaveBeenCalled()
  })

  it('does not call cancelBooking when idempotency helper handles in-progress request', async () => {
    const handledResponse = {
      ok: false,
      status: 409,
      error: 'A matching cancel request is already in progress.',
      code: 'IDEMPOTENCY_REQUEST_IN_PROGRESS',
    }

    mocks.beginRouteIdempotency.mockResolvedValueOnce({
      kind: 'handled',
      response: handledResponse,
    })

    mocks.isRouteIdempotencyHandled.mockReturnValueOnce(true)

    const result = await PATCH(makeRequest(), makeCtx('booking_1'))

    expect(result).toBe(handledResponse)
    expect(mocks.cancelBooking).not.toHaveBeenCalled()
    expect(mocks.completeRouteIdempotency).not.toHaveBeenCalled()
    expect(mocks.failStartedRouteIdempotency).not.toHaveBeenCalled()
  })

  it('does not call cancelBooking when idempotency helper handles replay', async () => {
    const replayResponse = {
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
    }

    mocks.beginRouteIdempotency.mockResolvedValueOnce({
      kind: 'handled',
      response: replayResponse,
    })

    mocks.isRouteIdempotencyHandled.mockReturnValueOnce(true)

    const result = await PATCH(makeRequest(), makeCtx('booking_1'))

    expect(result).toBe(replayResponse)
    expect(mocks.cancelBooking).not.toHaveBeenCalled()
    expect(mocks.completeRouteIdempotency).not.toHaveBeenCalled()
    expect(mocks.failStartedRouteIdempotency).not.toHaveBeenCalled()
  })

  it('maps BookingError through getBookingFailPayload and marks idempotency failed', async () => {
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

    expect(mocks.failStartedRouteIdempotency).toHaveBeenCalledWith({
      idempotencyRecordId: 'idem_record_1',
      operation: IDEMPOTENCY_ROUTE,
    })

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

  it('logs unknown errors safely, returns 500, and marks idempotency failed', async () => {
    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined)

    const error = new Error('boom')
    mocks.cancelBooking.mockRejectedValueOnce(error)

    const result = await PATCH(makeRequest(), makeCtx('booking_1'))

    expect(mocks.failStartedRouteIdempotency).toHaveBeenCalledWith({
      idempotencyRecordId: 'idem_record_1',
      operation: IDEMPOTENCY_ROUTE,
    })

    expect(mocks.safeError).toHaveBeenCalledWith(error)
    expect(mocks.safeLogMeta).toHaveBeenCalledWith({
      route: IDEMPOTENCY_ROUTE,
      idempotencyRecordId: 'idem_record_1',
    })

    expect(consoleErrorSpy).toHaveBeenCalledWith(`${IDEMPOTENCY_ROUTE} error`, {
      error: {
        name: 'Error',
        message: 'boom',
      },
      meta: {
        route: IDEMPOTENCY_ROUTE,
        idempotencyRecordId: 'idem_record_1',
      },
    })

    expect(mocks.jsonFail).toHaveBeenCalledWith(500, 'Internal server error')

    expect(result).toEqual({
      ok: false,
      status: 500,
      error: 'Internal server error',
    })

    consoleErrorSpy.mockRestore()
  })

  it('logs idempotency failure-update errors safely without masking the original error', async () => {
    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined)

    const cancelError = new Error('cancel exploded')
    const failError = new Error('idempotency cleanup exploded')

    mocks.cancelBooking.mockRejectedValueOnce(cancelError)
    mocks.failStartedRouteIdempotency.mockRejectedValueOnce(failError)

    const result = await PATCH(makeRequest(), makeCtx('booking_1'))

    expect(mocks.safeError).toHaveBeenCalledWith(failError)
    expect(mocks.safeLogMeta).toHaveBeenCalledWith({
      route: IDEMPOTENCY_ROUTE,
      idempotencyRecordId: 'idem_record_1',
    })

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      `${IDEMPOTENCY_ROUTE} idempotency failure update error`,
      {
        error: {
          name: 'Error',
          message: 'idempotency cleanup exploded',
        },
        meta: {
          route: IDEMPOTENCY_ROUTE,
          idempotencyRecordId: 'idem_record_1',
        },
      },
    )

    expect(mocks.jsonFail).toHaveBeenCalledWith(500, 'Internal server error')

    expect(result).toEqual({
      ok: false,
      status: 500,
      error: 'Internal server error',
    })

    consoleErrorSpy.mockRestore()
  })

  it('does not mark idempotency failed when error happens before ledger starts', async () => {
    await PATCH(makeRequest(), makeCtx(''))

    expect(mocks.beginRouteIdempotency).not.toHaveBeenCalled()
    expect(mocks.cancelBooking).not.toHaveBeenCalled()
    expect(mocks.failStartedRouteIdempotency).not.toHaveBeenCalled()
  })
})