// app/api/pro/bookings/[id]/session/step/route.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BookingStatus, Role, SessionStep } from '@prisma/client'
import { bookingError } from '@/lib/booking/errors'

const IDEMPOTENCY_ROUTE = 'POST /api/pro/bookings/[id]/session/step'

const defaultStepResponse = {
  booking: {
    id: 'booking_1',
    status: BookingStatus.IN_PROGRESS,
    sessionStep: SessionStep.BEFORE_PHOTOS,
  },
}

const mocks = vi.hoisted(() => ({
  requirePro: vi.fn(),
  jsonFail: vi.fn(),
  jsonOk: vi.fn(),
  pickString: vi.fn(),

  transitionSessionStep: vi.fn(),
  captureBookingException: vi.fn(),

  beginRouteIdempotency: vi.fn(),
  completeRouteIdempotency: vi.fn(),
  failStartedRouteIdempotency: vi.fn(),
  isRouteIdempotencyHandled: vi.fn(),

  safeError: vi.fn(),
}))

vi.mock('@/app/api/_utils', () => ({
  requirePro: mocks.requirePro,
  jsonFail: mocks.jsonFail,
  jsonOk: mocks.jsonOk,
  pickString: mocks.pickString,
}))

vi.mock('@/app/api/_utils/idempotency', () => ({
  beginRouteIdempotency: mocks.beginRouteIdempotency,
  completeRouteIdempotency: mocks.completeRouteIdempotency,
  failStartedRouteIdempotency: mocks.failStartedRouteIdempotency,
  isRouteIdempotencyHandled: mocks.isRouteIdempotencyHandled,
}))

vi.mock('@/lib/booking/writeBoundary', () => ({
  transitionSessionStep: mocks.transitionSessionStep,
}))

vi.mock('@/lib/observability/bookingEvents', () => ({
  captureBookingException: mocks.captureBookingException,
}))

vi.mock('@/lib/security/logging', () => ({
  safeError: mocks.safeError,
}))

vi.mock('@/lib/idempotency', () => ({
  IDEMPOTENCY_ROUTES: {
    BOOKING_SESSION_STEP: 'POST /api/pro/bookings/[id]/session/step',
  },
}))

vi.mock('@/lib/booking/lifecycleContract', () => ({
  SESSION_STEP_TRANSITIONS: [
    [
      'CONSULTATION',
      new Map([
        ['CONSULTATION_PENDING_CLIENT', ['PRO']],
        ['BEFORE_PHOTOS', ['PRO']],
      ]),
    ],
    [
      'BEFORE_PHOTOS',
      new Map([
        ['SERVICE_IN_PROGRESS', ['PRO']],
        ['FINISH_REVIEW', ['PRO']],
      ]),
    ],
    [
      'FINISH_REVIEW',
      new Map([['AFTER_PHOTOS', ['PRO']]]),
    ],
  ],
}))

import { IDEMPOTENCY_ROUTES } from '@/lib/idempotency'
import { POST } from './route'

function makeRequest(
  body: unknown,
  headers?: Record<string, string>,
): Request {
  return new Request(
    'http://localhost/api/pro/bookings/booking_1/session/step',
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(headers ?? {}),
      },
      body: JSON.stringify(body),
    },
  )
}

function makeIdempotentRequest(
  body: unknown,
  key = 'idem_session_step_1',
): Request {
  return makeRequest(body, {
    'idempotency-key': key,
  })
}

function makeCtx(id = 'booking_1') {
  return {
    params: Promise.resolve({ id }),
  }
}

function expectIdempotencyStarted(key = 'idem_session_step_1'): void {
  mocks.beginRouteIdempotency.mockResolvedValue({
    kind: 'started',
    idempotencyRecordId: 'idem_record_1',
    idempotencyKey: key,
    requestHash: 'hash_1',
  })

  mocks.isRouteIdempotencyHandled.mockReturnValue(false)
}

describe('POST /api/pro/bookings/[id]/session/step', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mocks.requirePro.mockResolvedValue({
      ok: true,
      professionalId: 'pro_123',
      proId: 'pro_123',
      user: {
        id: 'user_123',
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

    mocks.pickString.mockImplementation((value: unknown) =>
      typeof value === 'string' && value.trim() ? value.trim() : null,
    )

    mocks.safeError.mockImplementation((error: unknown) => ({
      name: error instanceof Error ? error.name : 'UnknownError',
      message: error instanceof Error ? error.message : 'Unknown error',
    }))

    expectIdempotencyStarted()

    mocks.completeRouteIdempotency.mockResolvedValue(undefined)
    mocks.failStartedRouteIdempotency.mockResolvedValue(undefined)

    mocks.transitionSessionStep.mockResolvedValue({
      ok: true,
      booking: {
        id: 'booking_1',
        status: BookingStatus.IN_PROGRESS,
        sessionStep: SessionStep.BEFORE_PHOTOS,
      },
    })
  })

  it('returns auth response when requirePro fails', async () => {
    const authRes = { ok: false, status: 401, error: 'Unauthorized' }

    mocks.requirePro.mockResolvedValueOnce({
      ok: false,
      res: authRes,
    })

    const result = await POST(
      makeRequest({ step: 'BEFORE_PHOTOS' }),
      makeCtx(),
    )

    expect(result).toBe(authRes)
    expect(mocks.beginRouteIdempotency).not.toHaveBeenCalled()
    expect(mocks.transitionSessionStep).not.toHaveBeenCalled()
  })

  it('returns BOOKING_ID_REQUIRED when route param id is missing', async () => {
    const result = await POST(
      makeRequest({ step: 'BEFORE_PHOTOS' }),
      makeCtx(''),
    )

    expect(mocks.jsonFail).toHaveBeenCalledWith(
      400,
      expect.any(String),
      expect.objectContaining({
        code: 'BOOKING_ID_REQUIRED',
      }),
    )

    expect(mocks.beginRouteIdempotency).not.toHaveBeenCalled()
    expect(mocks.transitionSessionStep).not.toHaveBeenCalled()
    expect(result).toEqual(
      expect.objectContaining({
        ok: false,
        status: 400,
        code: 'BOOKING_ID_REQUIRED',
      }),
    )
  })

  it('returns INVALID_SESSION_STEP when step is missing', async () => {
    const result = await POST(makeRequest({}), makeCtx())

    expect(mocks.jsonFail).toHaveBeenCalledWith(
      400,
      'Missing or invalid step.',
      {
        code: 'INVALID_SESSION_STEP',
      },
    )

    expect(mocks.beginRouteIdempotency).not.toHaveBeenCalled()
    expect(mocks.transitionSessionStep).not.toHaveBeenCalled()
    expect(result).toEqual({
      ok: false,
      status: 400,
      error: 'Missing or invalid step.',
      code: 'INVALID_SESSION_STEP',
    })
  })

  it('returns INVALID_SESSION_STEP when step is invalid', async () => {
    const result = await POST(
      makeRequest({
        step: 'BANANA_STEP',
      }),
      makeCtx(),
    )

    expect(mocks.jsonFail).toHaveBeenCalledWith(
      400,
      'Missing or invalid step.',
      {
        code: 'INVALID_SESSION_STEP',
      },
    )

    expect(mocks.beginRouteIdempotency).not.toHaveBeenCalled()
    expect(mocks.transitionSessionStep).not.toHaveBeenCalled()
    expect(result).toEqual({
      ok: false,
      status: 400,
      error: 'Missing or invalid step.',
      code: 'INVALID_SESSION_STEP',
    })
  })

  it('rejects NONE before hitting idempotency or the write boundary', async () => {
    const result = await POST(
      makeRequest({
        step: 'NONE',
      }),
      makeCtx(),
    )

    expect(mocks.jsonFail).toHaveBeenCalledWith(
      422,
      'Step "NONE" cannot be set directly by this route.',
      {
        code: 'SESSION_STEP_NOT_REACHABLE_BY_PRO',
      },
    )

    expect(mocks.beginRouteIdempotency).not.toHaveBeenCalled()
    expect(mocks.transitionSessionStep).not.toHaveBeenCalled()
    expect(result).toEqual({
      ok: false,
      status: 422,
      error: 'Step "NONE" cannot be set directly by this route.',
      code: 'SESSION_STEP_NOT_REACHABLE_BY_PRO',
    })
  })

  it('rejects DONE before hitting idempotency or the write boundary', async () => {
    const result = await POST(
      makeRequest({
        step: 'DONE',
      }),
      makeCtx(),
    )

    expect(mocks.jsonFail).toHaveBeenCalledWith(
      422,
      'Step "DONE" cannot be set directly by this route.',
      {
        code: 'SESSION_STEP_NOT_REACHABLE_BY_PRO',
      },
    )

    expect(mocks.beginRouteIdempotency).not.toHaveBeenCalled()
    expect(mocks.transitionSessionStep).not.toHaveBeenCalled()
    expect(result).toEqual({
      ok: false,
      status: 422,
      error: 'Step "DONE" cannot be set directly by this route.',
      code: 'SESSION_STEP_NOT_REACHABLE_BY_PRO',
    })
  })

  it('returns handled idempotency response when idempotency key is missing', async () => {
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

    mocks.isRouteIdempotencyHandled.mockReturnValue(true)

    const result = await POST(
      makeRequest({
        step: 'BEFORE_PHOTOS',
      }),
      makeCtx(),
    )

    expect(result).toBe(handledResponse)

    expect(mocks.beginRouteIdempotency).toHaveBeenCalledWith({
      request: expect.any(Request),
      actor: {
        actorUserId: 'user_123',
        actorRole: Role.PRO,
      },
      route: IDEMPOTENCY_ROUTES.BOOKING_SESSION_STEP,
      requestLabel: 'session step',
      requestBody: {
        professionalId: 'pro_123',
        actorUserId: 'user_123',
        bookingId: 'booking_1',
        nextStep: SessionStep.BEFORE_PHOTOS,
      },
      messages: {
        missingKey: 'Missing idempotency key.',
        inProgress: 'A matching session step request is already in progress.',
        conflict:
          'This idempotency key was already used with a different request body.',
      },
    })

    expect(mocks.transitionSessionStep).not.toHaveBeenCalled()
    expect(mocks.completeRouteIdempotency).not.toHaveBeenCalled()
  })

  it('returns handled idempotency response when matching request is already in progress', async () => {
    const handledResponse = {
      ok: false,
      status: 409,
      error: 'A matching session step request is already in progress.',
      code: 'IDEMPOTENCY_REQUEST_IN_PROGRESS',
    }

    mocks.beginRouteIdempotency.mockResolvedValueOnce({
      kind: 'handled',
      response: handledResponse,
    })

    mocks.isRouteIdempotencyHandled.mockReturnValue(true)

    const result = await POST(
      makeIdempotentRequest({
        step: 'BEFORE_PHOTOS',
      }),
      makeCtx(),
    )

    expect(result).toBe(handledResponse)
    expect(mocks.transitionSessionStep).not.toHaveBeenCalled()
    expect(mocks.completeRouteIdempotency).not.toHaveBeenCalled()
  })

  it('returns handled idempotency response when key conflicts with another body', async () => {
    const handledResponse = {
      ok: false,
      status: 409,
      error:
        'This idempotency key was already used with a different request body.',
      code: 'IDEMPOTENCY_KEY_CONFLICT',
    }

    mocks.beginRouteIdempotency.mockResolvedValueOnce({
      kind: 'handled',
      response: handledResponse,
    })

    mocks.isRouteIdempotencyHandled.mockReturnValue(true)

    const result = await POST(
      makeIdempotentRequest({
        step: 'BEFORE_PHOTOS',
      }),
      makeCtx(),
    )

    expect(result).toBe(handledResponse)
    expect(mocks.transitionSessionStep).not.toHaveBeenCalled()
    expect(mocks.completeRouteIdempotency).not.toHaveBeenCalled()
  })

  it('replays completed idempotency response without transitioning again', async () => {
    const handledResponse = {
      ok: true,
      status: 200,
      data: defaultStepResponse,
    }

    mocks.beginRouteIdempotency.mockResolvedValueOnce({
      kind: 'handled',
      response: handledResponse,
    })

    mocks.isRouteIdempotencyHandled.mockReturnValue(true)

    const result = await POST(
      makeIdempotentRequest({
        step: 'BEFORE_PHOTOS',
      }),
      makeCtx(),
    )

    expect(result).toBe(handledResponse)
    expect(mocks.transitionSessionStep).not.toHaveBeenCalled()
    expect(mocks.completeRouteIdempotency).not.toHaveBeenCalled()
  })

  it('transitions the session step, completes idempotency, and returns booking', async () => {
    expectIdempotencyStarted('idem_step_success_1')

    const result = await POST(
      makeIdempotentRequest(
        {
          step: 'BEFORE_PHOTOS',
        },
        'idem_step_success_1',
      ),
      makeCtx(),
    )

    expect(mocks.beginRouteIdempotency).toHaveBeenCalledWith({
      request: expect.any(Request),
      actor: {
        actorUserId: 'user_123',
        actorRole: Role.PRO,
      },
      route: IDEMPOTENCY_ROUTES.BOOKING_SESSION_STEP,
      requestLabel: 'session step',
      requestBody: {
        professionalId: 'pro_123',
        actorUserId: 'user_123',
        bookingId: 'booking_1',
        nextStep: SessionStep.BEFORE_PHOTOS,
      },
      messages: {
        missingKey: 'Missing idempotency key.',
        inProgress: 'A matching session step request is already in progress.',
        conflict:
          'This idempotency key was already used with a different request body.',
      },
    })

    expect(mocks.transitionSessionStep).toHaveBeenCalledWith({
      bookingId: 'booking_1',
      professionalId: 'pro_123',
      nextStep: SessionStep.BEFORE_PHOTOS,
      requestId: null,
      idempotencyKey: 'idem_step_success_1',
    })

    expect(mocks.completeRouteIdempotency).toHaveBeenCalledWith({
      idempotencyRecordId: 'idem_record_1',
      responseStatus: 200,
      responseBody: defaultStepResponse,
    })

    expect(mocks.jsonOk).toHaveBeenCalledWith(defaultStepResponse, 200)

    expect(result).toEqual({
      ok: true,
      status: 200,
      data: defaultStepResponse,
    })
  })

  it('passes request id header through to transitionSessionStep', async () => {
    expectIdempotencyStarted('idem_step_with_request_id_1')

    await POST(
      makeRequest(
        {
          step: 'SERVICE_IN_PROGRESS',
        },
        {
          'idempotency-key': 'idem_step_with_request_id_1',
          'x-request-id': 'request_123',
        },
      ),
      makeCtx(),
    )

    expect(mocks.transitionSessionStep).toHaveBeenCalledWith({
      bookingId: 'booking_1',
      professionalId: 'pro_123',
      nextStep: SessionStep.SERVICE_IN_PROGRESS,
      requestId: 'request_123',
      idempotencyKey: 'idem_step_with_request_id_1',
    })
  })

  it('returns write-boundary failure and marks idempotency failed', async () => {
    expectIdempotencyStarted('idem_step_boundary_fail_1')

    mocks.transitionSessionStep.mockResolvedValueOnce({
      ok: false,
      status: 409,
      error: 'Before photos are required before starting the service.',
      forcedStep: SessionStep.BEFORE_PHOTOS,
    })

    const result = await POST(
      makeIdempotentRequest(
        {
          step: 'SERVICE_IN_PROGRESS',
        },
        'idem_step_boundary_fail_1',
      ),
      makeCtx(),
    )

    expect(mocks.failStartedRouteIdempotency).toHaveBeenCalledWith({
      idempotencyRecordId: 'idem_record_1',
      operation: 'POST /api/pro/bookings/[id]/session/step',
    })

    expect(mocks.jsonFail).toHaveBeenCalledWith(
      409,
      'Before photos are required before starting the service.',
      {
        forcedStep: SessionStep.BEFORE_PHOTOS,
      },
    )

    expect(mocks.completeRouteIdempotency).not.toHaveBeenCalled()
    expect(result).toEqual({
      ok: false,
      status: 409,
      error: 'Before photos are required before starting the service.',
      forcedStep: SessionStep.BEFORE_PHOTOS,
    })
  })

  it('maps booking errors to jsonFail and marks idempotency failed', async () => {
    expectIdempotencyStarted('idem_step_not_found_1')

    mocks.transitionSessionStep.mockRejectedValueOnce(
      bookingError('BOOKING_NOT_FOUND', {
        message: 'Booking was not found for this professional.',
        userMessage: 'Booking not found.',
      }),
    )

    const result = await POST(
      makeIdempotentRequest(
        {
          step: 'BEFORE_PHOTOS',
        },
        'idem_step_not_found_1',
      ),
      makeCtx(),
    )

    expect(mocks.failStartedRouteIdempotency).toHaveBeenCalledWith({
      idempotencyRecordId: 'idem_record_1',
      operation: 'POST /api/pro/bookings/[id]/session/step',
    })

    expect(mocks.jsonFail).toHaveBeenCalledWith(
      404,
      'Booking not found.',
      expect.objectContaining({
        code: 'BOOKING_NOT_FOUND',
        message: 'Booking was not found for this professional.',
      }),
    )

    expect(mocks.safeError).not.toHaveBeenCalled()
    expect(mocks.captureBookingException).not.toHaveBeenCalled()

    expect(result).toEqual(
      expect.objectContaining({
        ok: false,
        status: 404,
        code: 'BOOKING_NOT_FOUND',
      }),
    )
  })

  it('returns internal error, logs safely, captures exception, and marks idempotency failed for unexpected errors', async () => {
    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined)

    expectIdempotencyStarted('idem_step_boom_1')

    const thrown = new Error('boom')
    mocks.transitionSessionStep.mockRejectedValueOnce(thrown)

    const result = await POST(
      makeIdempotentRequest(
        {
          step: 'BEFORE_PHOTOS',
        },
        'idem_step_boom_1',
      ),
      makeCtx(),
    )

    expect(mocks.failStartedRouteIdempotency).toHaveBeenCalledWith({
      idempotencyRecordId: 'idem_record_1',
      operation: 'POST /api/pro/bookings/[id]/session/step',
    })

    expect(mocks.safeError).toHaveBeenCalledWith(thrown)

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'POST /api/pro/bookings/[id]/session/step error',
      {
        requestId: null,
        error: {
          name: 'Error',
          message: 'boom',
        },
      },
    )

    expect(mocks.captureBookingException).toHaveBeenCalledWith({
      error: thrown,
      route: 'POST /api/pro/bookings/[id]/session/step',
    })

    expect(mocks.jsonFail).toHaveBeenCalledWith(500, 'Internal server error')

    expect(result).toEqual({
      ok: false,
      status: 500,
      error: 'Internal server error',
    })

    consoleErrorSpy.mockRestore()
  })

  it('includes request id in safe unexpected-error logs', async () => {
    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined)

    expectIdempotencyStarted('idem_step_boom_request_id_1')

    const thrown = new Error('boom with request id')
    mocks.transitionSessionStep.mockRejectedValueOnce(thrown)

    const result = await POST(
      makeRequest(
        {
          step: 'BEFORE_PHOTOS',
        },
        {
          'idempotency-key': 'idem_step_boom_request_id_1',
          'x-request-id': 'request_123',
        },
      ),
      makeCtx(),
    )

    expect(mocks.failStartedRouteIdempotency).toHaveBeenCalledWith({
      idempotencyRecordId: 'idem_record_1',
      operation: 'POST /api/pro/bookings/[id]/session/step',
    })

    expect(mocks.safeError).toHaveBeenCalledWith(thrown)

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'POST /api/pro/bookings/[id]/session/step error',
      {
        requestId: 'request_123',
        error: {
          name: 'Error',
          message: 'boom with request id',
        },
      },
    )

    expect(mocks.captureBookingException).toHaveBeenCalledWith({
      error: thrown,
      route: 'POST /api/pro/bookings/[id]/session/step',
    })

    expect(mocks.jsonFail).toHaveBeenCalledWith(500, 'Internal server error')

    expect(result).toEqual({
      ok: false,
      status: 500,
      error: 'Internal server error',
    })

    consoleErrorSpy.mockRestore()
  })
})