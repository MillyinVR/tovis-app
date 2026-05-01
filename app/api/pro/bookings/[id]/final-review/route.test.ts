// app/api/pro/bookings/[id]/final-review/route.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  AftercareRebookMode,
  BookingServiceItemType,
  BookingStatus,
  Prisma,
  Role,
  SessionStep,
} from '@prisma/client'

const IDEMPOTENCY_ROUTE = 'POST /api/pro/bookings/[id]/final-review'

const mocks = vi.hoisted(() => ({
  jsonFail: vi.fn(),
  jsonOk: vi.fn(),
  pickString: vi.fn(),
  requirePro: vi.fn(),

  isRecord: vi.fn(),

  getBookingFailPayload: vi.fn(),
  isBookingError: vi.fn(),

  confirmBookingFinalReview: vi.fn(),

  beginIdempotency: vi.fn(),
  completeIdempotency: vi.fn(),
  failIdempotency: vi.fn(),

  captureBookingException: vi.fn(),
}))

vi.mock('@/app/api/_utils', () => ({
  jsonFail: mocks.jsonFail,
  jsonOk: mocks.jsonOk,
  pickString: mocks.pickString,
  requirePro: mocks.requirePro,
}))

vi.mock('@/lib/guards', () => ({
  isRecord: mocks.isRecord,
}))

vi.mock('@/lib/booking/errors', () => ({
  getBookingFailPayload: mocks.getBookingFailPayload,
  isBookingError: mocks.isBookingError,
}))

vi.mock('@/lib/booking/writeBoundary', () => ({
  confirmBookingFinalReview: mocks.confirmBookingFinalReview,
}))

vi.mock('@/lib/idempotency', () => ({
  beginIdempotency: mocks.beginIdempotency,
  completeIdempotency: mocks.completeIdempotency,
  failIdempotency: mocks.failIdempotency,
  IDEMPOTENCY_ROUTES: {
    PRO_BOOKING_FINAL_REVIEW:
      'POST /api/pro/bookings/[id]/final-review',
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

function makeCtx(id = 'booking_1') {
  return {
    params: Promise.resolve({ id }),
  }
}

function makeRequest(args?: {
  body?: unknown
  headers?: Record<string, string>
}): Request {
  return new Request(
    'http://localhost/api/pro/bookings/booking_1/final-review',
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
    body: args?.body ?? makeValidBody(),
    headers: {
      'idempotency-key': args?.key ?? 'idem_final_review_1',
      ...(args?.headers ?? {}),
    },
  })
}

function makeValidBody(overrides?: Record<string, unknown>) {
  return {
    finalLineItems: [
      {
        bookingServiceItemId: 'item_existing_1',
        serviceId: 'service_1',
        offeringId: 'offering_1',
        itemType: BookingServiceItemType.BASE,
        price: '125.00',
        durationMinutes: 75,
        notes: 'Trim and style',
        sortOrder: 0,
      },
      {
        serviceId: 'service_addon_1',
        offeringId: 'offering_addon_1',
        itemType: BookingServiceItemType.ADD_ON,
        price: 25,
        durationMinutes: 15,
        notes: 'Gloss',
        sortOrder: 1,
      },
    ],
    expectedSubtotal: '150.00',
    recommendedProducts: [
      {
        name: 'Curl cream',
        url: 'https://example.com/curl-cream',
        note: 'Use after washing.',
      },
    ],
    rebookMode: AftercareRebookMode.RECOMMENDED_WINDOW,
    rebookedFor: null,
    rebookWindowStart: '2026-05-01T18:00:00.000Z',
    rebookWindowEnd: '2026-05-15T18:00:00.000Z',
    ...(overrides ?? {}),
  }
}

function expectedFinalLineItems() {
  return [
    {
      bookingServiceItemId: 'item_existing_1',
      serviceId: 'service_1',
      offeringId: 'offering_1',
      itemType: BookingServiceItemType.BASE,
      price: '125.00',
      durationMinutes: 75,
      notes: 'Trim and style',
      sortOrder: 0,
    },
    {
      bookingServiceItemId: null,
      serviceId: 'service_addon_1',
      offeringId: 'offering_addon_1',
      itemType: BookingServiceItemType.ADD_ON,
      price: 25,
      durationMinutes: 15,
      notes: 'Gloss',
      sortOrder: 1,
    },
  ]
}

function expectedRecommendedProducts() {
  return [
    {
      productId: null,
      externalName: 'Curl cream',
      externalUrl: 'https://example.com/curl-cream',
      note: 'Use after washing.',
    },
  ]
}

function expectedIdempotencyRequestBody() {
  return {
    actorUserId: 'user_1',
    professionalId: 'pro_1',
    bookingId: 'booking_1',
    finalLineItems: expectedFinalLineItems(),
    expectedSubtotal: '150.00',
    recommendedProducts: expectedRecommendedProducts(),
    rebookMode: AftercareRebookMode.RECOMMENDED_WINDOW,
    rebookedFor: null,
    rebookWindowStart: new Date('2026-05-01T18:00:00.000Z'),
    rebookWindowEnd: new Date('2026-05-15T18:00:00.000Z'),
  }
}

function makeConfirmResult(overrides?: {
  subtotalSnapshot?: Prisma.Decimal | null
  meta?: { mutated: boolean; noOp: boolean }
}) {
  return {
    booking: {
      id: 'booking_1',
      status: BookingStatus.IN_PROGRESS,
      sessionStep: SessionStep.AFTER_PHOTOS,
      serviceId: 'service_1',
      offeringId: 'offering_1',
      subtotalSnapshot:
        overrides && 'subtotalSnapshot' in overrides
          ? overrides.subtotalSnapshot
          : new Prisma.Decimal('150.00'),
      totalDurationMinutes: 90,
    },
    meta: overrides?.meta ?? {
      mutated: true,
      noOp: false,
    },
  }
}

function expectedResponseBody(overrides?: {
  subtotalSnapshot?: string | null
  meta?: { mutated: boolean; noOp: boolean }
}) {
  return {
    booking: {
      id: 'booking_1',
      status: BookingStatus.IN_PROGRESS,
      sessionStep: SessionStep.AFTER_PHOTOS,
      serviceId: 'service_1',
      offeringId: 'offering_1',
      subtotalSnapshot:
        overrides && 'subtotalSnapshot' in overrides
          ? overrides.subtotalSnapshot
          : '150',
      totalDurationMinutes: 90,
    },
    meta: overrides?.meta ?? {
      mutated: true,
      noOp: false,
    },
  }
}

describe('app/api/pro/bookings/[id]/final-review/route.ts POST', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mocks.jsonFail.mockImplementation(
      (status: number, error: string, extra?: Record<string, unknown>) =>
        makeJsonResponse(status, {
          ok: false,
          error,
          ...(extra ?? {}),
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

    mocks.requirePro.mockResolvedValue({
      ok: true,
      professionalId: 'pro_1',
      user: {
        id: 'user_1',
      },
    })

    mocks.isRecord.mockImplementation(
      (value: unknown) =>
        typeof value === 'object' && value !== null && !Array.isArray(value),
    )

    mocks.isBookingError.mockReturnValue(false)

    mocks.getBookingFailPayload.mockImplementation(
      (
        code: string,
        overrides?: {
          message?: string
          userMessage?: string
        },
      ) => ({
        httpStatus: code === 'FORBIDDEN' ? 403 : 409,
        userMessage: overrides?.userMessage ?? overrides?.message ?? code,
        extra: {
          code,
          ...(overrides?.message ? { message: overrides.message } : {}),
        },
      }),
    )

    mocks.beginIdempotency.mockImplementation(
      async (args: { key: string | null }) => {
        const key = args.key?.trim()

        if (!key) {
          return { kind: 'missing_key' }
        }

        return {
          kind: 'started',
          idempotencyRecordId: 'idem_record_1',
          requestHash: 'hash_1',
        }
      },
    )

    mocks.completeIdempotency.mockResolvedValue(undefined)
    mocks.failIdempotency.mockResolvedValue(undefined)
    mocks.confirmBookingFinalReview.mockResolvedValue(makeConfirmResult())
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

    const response = await POST(makeRequest({ body: makeValidBody() }), makeCtx())

    expect(response).toBe(authRes)
    expect(mocks.beginIdempotency).not.toHaveBeenCalled()
    expect(mocks.confirmBookingFinalReview).not.toHaveBeenCalled()
  })

  it('returns FORBIDDEN when authenticated actor user id is missing', async () => {
    mocks.requirePro.mockResolvedValueOnce({
      ok: true,
      professionalId: 'pro_1',
      user: {
        id: '   ',
      },
    })

    const response = await POST(
      makeIdempotentRequest({
        body: makeValidBody(),
      }),
      makeCtx(),
    )

    expect(mocks.getBookingFailPayload).toHaveBeenCalledWith('FORBIDDEN', {
      message: 'Authenticated actor user id is required.',
      userMessage: 'You are not allowed to confirm this final review.',
    })

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: 'You are not allowed to confirm this final review.',
      code: 'FORBIDDEN',
      message: 'Authenticated actor user id is required.',
    })

    expect(mocks.beginIdempotency).not.toHaveBeenCalled()
    expect(mocks.confirmBookingFinalReview).not.toHaveBeenCalled()
  })

  it('returns 400 when booking id is missing', async () => {
    const response = await POST(
      makeIdempotentRequest({
        body: makeValidBody(),
      }),
      makeCtx('   '),
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: 'Missing booking id.',
    })

    expect(mocks.beginIdempotency).not.toHaveBeenCalled()
    expect(mocks.confirmBookingFinalReview).not.toHaveBeenCalled()
  })

  it('returns 400 when request body is invalid', async () => {
    mocks.isRecord.mockReturnValueOnce(false)

    const response = await POST(
      makeIdempotentRequest({
        body: null,
      }),
      makeCtx(),
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: 'Invalid request body.',
    })

    expect(mocks.beginIdempotency).not.toHaveBeenCalled()
    expect(mocks.confirmBookingFinalReview).not.toHaveBeenCalled()
  })

  it('returns 400 when finalLineItems are invalid', async () => {
    const response = await POST(
      makeIdempotentRequest({
        body: makeValidBody({
          finalLineItems: [],
        }),
      }),
      makeCtx(),
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error:
        'Invalid finalLineItems. Each item needs serviceId, itemType, price, and durationMinutes.',
    })

    expect(mocks.beginIdempotency).not.toHaveBeenCalled()
    expect(mocks.confirmBookingFinalReview).not.toHaveBeenCalled()
  })

  it('returns 400 when rebookMode is invalid', async () => {
    const response = await POST(
      makeIdempotentRequest({
        body: makeValidBody({
          rebookMode: 'MAYBE_LATER_BUT_MAKE_IT_FANCY',
        }),
      }),
      makeCtx(),
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: 'Invalid rebookMode.',
    })

    expect(mocks.beginIdempotency).not.toHaveBeenCalled()
    expect(mocks.confirmBookingFinalReview).not.toHaveBeenCalled()
  })

  it('returns 400 when rebookWindowStart is invalid', async () => {
    const response = await POST(
      makeIdempotentRequest({
        body: makeValidBody({
          rebookWindowStart: 'not-a-real-date',
        }),
      }),
      makeCtx(),
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: 'Invalid rebookWindowStart date.',
    })

    expect(mocks.beginIdempotency).not.toHaveBeenCalled()
    expect(mocks.confirmBookingFinalReview).not.toHaveBeenCalled()
  })

  it('returns missing idempotency key for a valid final review request without idempotency header', async () => {
    const response = await POST(
      makeRequest({
        body: makeValidBody(),
      }),
      makeCtx(),
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: 'Missing idempotency key.',
      code: 'IDEMPOTENCY_KEY_REQUIRED',
    })

    expect(mocks.beginIdempotency).toHaveBeenCalledWith({
      actor: {
        actorUserId: 'user_1',
        actorRole: Role.PRO,
      },
      route: IDEMPOTENCY_ROUTE,
      key: null,
      requestBody: expectedIdempotencyRequestBody(),
    })

    expect(mocks.confirmBookingFinalReview).not.toHaveBeenCalled()
    expect(mocks.completeIdempotency).not.toHaveBeenCalled()
  })

  it('returns in-progress when matching idempotency request is already active', async () => {
    mocks.beginIdempotency.mockResolvedValueOnce({
      kind: 'in_progress',
    })

    const response = await POST(
      makeIdempotentRequest({
        body: makeValidBody(),
      }),
      makeCtx(),
    )

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: 'A matching final review request is already in progress.',
      code: 'IDEMPOTENCY_REQUEST_IN_PROGRESS',
    })

    expect(mocks.confirmBookingFinalReview).not.toHaveBeenCalled()
    expect(mocks.completeIdempotency).not.toHaveBeenCalled()
  })

  it('returns conflict when idempotency key is reused with a different body', async () => {
    mocks.beginIdempotency.mockResolvedValueOnce({
      kind: 'conflict',
    })

    const response = await POST(
      makeIdempotentRequest({
        body: makeValidBody(),
      }),
      makeCtx(),
    )

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error:
        'This idempotency key was already used with a different request body.',
      code: 'IDEMPOTENCY_KEY_CONFLICT',
    })

    expect(mocks.confirmBookingFinalReview).not.toHaveBeenCalled()
    expect(mocks.completeIdempotency).not.toHaveBeenCalled()
  })

  it('replays completed idempotency response without confirming final review again', async () => {
    const replayBody = expectedResponseBody()

    mocks.beginIdempotency.mockResolvedValueOnce({
      kind: 'replay',
      responseStatus: 200,
      responseBody: replayBody,
    })

    const response = await POST(
      makeIdempotentRequest({
        body: makeValidBody(),
      }),
      makeCtx(),
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      ok: true,
      ...replayBody,
    })

    expect(mocks.confirmBookingFinalReview).not.toHaveBeenCalled()
    expect(mocks.completeIdempotency).not.toHaveBeenCalled()
  })

  it('confirms final review, completes idempotency, and returns normalized booking payload', async () => {
    const response = await POST(
      makeIdempotentRequest({
        key: 'idem_final_review_1',
        body: makeValidBody(),
        headers: {
          'x-request-id': 'req_final_review_1',
        },
      }),
      makeCtx(),
    )

    expect(mocks.beginIdempotency).toHaveBeenCalledWith({
      actor: {
        actorUserId: 'user_1',
        actorRole: Role.PRO,
      },
      route: IDEMPOTENCY_ROUTE,
      key: 'idem_final_review_1',
      requestBody: expectedIdempotencyRequestBody(),
    })

    expect(mocks.confirmBookingFinalReview).toHaveBeenCalledWith({
      bookingId: 'booking_1',
      professionalId: 'pro_1',
      finalLineItems: expectedFinalLineItems(),
      expectedSubtotal: '150.00',
      recommendedProducts: expectedRecommendedProducts(),
      rebookMode: AftercareRebookMode.RECOMMENDED_WINDOW,
      rebookedFor: null,
      rebookWindowStart: new Date('2026-05-01T18:00:00.000Z'),
      rebookWindowEnd: new Date('2026-05-15T18:00:00.000Z'),
      requestId: 'req_final_review_1',
      idempotencyKey: 'idem_final_review_1',
    })

    expect(mocks.completeIdempotency).toHaveBeenCalledWith({
      idempotencyRecordId: 'idem_record_1',
      responseStatus: 200,
      responseBody: expectedResponseBody(),
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      ok: true,
      ...expectedResponseBody(),
    })
  })

  it('normalizes nullable subtotalSnapshot in the response body', async () => {
    mocks.confirmBookingFinalReview.mockResolvedValueOnce(
      makeConfirmResult({
        subtotalSnapshot: null,
        meta: {
          mutated: false,
          noOp: true,
        },
      }),
    )

    const response = await POST(
      makeIdempotentRequest({
        key: 'idem_null_subtotal_1',
        body: makeValidBody(),
      }),
      makeCtx(),
    )

    const responseBody = expectedResponseBody({
      subtotalSnapshot: null,
      meta: {
        mutated: false,
        noOp: true,
      },
    })

    expect(mocks.completeIdempotency).toHaveBeenCalledWith({
      idempotencyRecordId: 'idem_record_1',
      responseStatus: 200,
      responseBody,
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      ok: true,
      ...responseBody,
    })
  })

  it('maps BookingError through bookingJsonFail and marks idempotency failed', async () => {
    const bookingError = {
      code: 'STEP_MISMATCH',
      message: 'Final review is only allowed in FINISH_REVIEW.',
      userMessage:
        'You can only confirm final review from the Finish Review step.',
    }

    mocks.confirmBookingFinalReview.mockRejectedValueOnce(bookingError)
    mocks.isBookingError.mockReturnValueOnce(true)
    mocks.getBookingFailPayload.mockReturnValueOnce({
      httpStatus: 409,
      userMessage:
        'You can only confirm final review from the Finish Review step.',
      extra: {
        code: 'STEP_MISMATCH',
        message: 'Final review is only allowed in FINISH_REVIEW.',
      },
    })

    const response = await POST(
      makeIdempotentRequest({
        key: 'idem_booking_error_1',
        body: makeValidBody(),
      }),
      makeCtx(),
    )

    expect(mocks.failIdempotency).toHaveBeenCalledWith({
      idempotencyRecordId: 'idem_record_1',
    })

    expect(mocks.getBookingFailPayload).toHaveBeenCalledWith(
      'STEP_MISMATCH',
      {
        message: 'Final review is only allowed in FINISH_REVIEW.',
        userMessage:
          'You can only confirm final review from the Finish Review step.',
      },
    )

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error:
        'You can only confirm final review from the Finish Review step.',
      code: 'STEP_MISMATCH',
      message: 'Final review is only allowed in FINISH_REVIEW.',
    })
  })

  it('returns 500 for unexpected errors, captures exception, and marks idempotency failed', async () => {
    mocks.confirmBookingFinalReview.mockRejectedValueOnce(new Error('boom'))

    const response = await POST(
      makeIdempotentRequest({
        key: 'idem_boom_1',
        body: makeValidBody(),
      }),
      makeCtx(),
    )

    expect(mocks.failIdempotency).toHaveBeenCalledWith({
      idempotencyRecordId: 'idem_record_1',
    })

    expect(mocks.captureBookingException).toHaveBeenCalledWith({
      error: expect.any(Error),
      route: 'POST /api/pro/bookings/[id]/final-review',
    })

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: 'Internal server error',
    })
  })
})