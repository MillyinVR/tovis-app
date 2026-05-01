// app/api/client/bookings/[id]/checkout/products/route.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'
import {
  BookingCheckoutStatus,
  Prisma,
  Role,
} from '@prisma/client'

const IDEMPOTENCY_ROUTE =
  'POST /api/client/bookings/[id]/checkout/products'

const mocks = vi.hoisted(() => ({
  jsonFail: vi.fn(),
  jsonOk: vi.fn(),
  pickString: vi.fn(),
  requireClient: vi.fn(),

  getBookingFailPayload: vi.fn(),
  isBookingError: vi.fn(),

  upsertClientBookingCheckoutProducts: vi.fn(),

  beginIdempotency: vi.fn(),
  completeIdempotency: vi.fn(),
  failIdempotency: vi.fn(),

  captureBookingException: vi.fn(),
}))

vi.mock('@/app/api/_utils', () => ({
  jsonFail: mocks.jsonFail,
  jsonOk: mocks.jsonOk,
  pickString: mocks.pickString,
  requireClient: mocks.requireClient,
}))

vi.mock('@/lib/booking/errors', () => ({
  getBookingFailPayload: mocks.getBookingFailPayload,
  isBookingError: mocks.isBookingError,
}))

vi.mock('@/lib/booking/writeBoundary', () => ({
  upsertClientBookingCheckoutProducts:
    mocks.upsertClientBookingCheckoutProducts,
}))

vi.mock('@/lib/idempotency', () => ({
  beginIdempotency: mocks.beginIdempotency,
  completeIdempotency: mocks.completeIdempotency,
  failIdempotency: mocks.failIdempotency,
  IDEMPOTENCY_ROUTES: {
    CLIENT_CHECKOUT_PRODUCTS:
      'POST /api/client/bookings/[id]/checkout/products',
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
}): NextRequest {
  return new Request(
    'http://localhost/api/client/bookings/booking_1/checkout/products',
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(args?.headers ?? {}),
      },
      body: JSON.stringify(args?.body ?? {}),
    },
  ) as unknown as NextRequest
}

function makeIdempotentRequest(args?: {
  body?: unknown
  key?: string
  headers?: Record<string, string>
}): NextRequest {
  return makeRequest({
    body: args?.body ?? makeValidBody(),
    headers: {
      'idempotency-key': args?.key ?? 'idem_checkout_products_1',
      ...(args?.headers ?? {}),
    },
  })
}

function makeValidBody(overrides?: Record<string, unknown>) {
  return {
    items: [
      {
        recommendationId: 'rec_1',
        productId: 'product_1',
        quantity: 2,
      },
      {
        recommendationId: 'rec_2',
        productId: 'product_2',
        quantity: '1',
      },
    ],
    ...(overrides ?? {}),
  }
}

function expectedParsedItems() {
  return [
    {
      recommendationId: 'rec_1',
      productId: 'product_1',
      quantity: 2,
    },
    {
      recommendationId: 'rec_2',
      productId: 'product_2',
      quantity: 1,
    },
  ]
}

function makeUpsertResult(overrides?: {
  paymentAuthorizedAt?: Date | null
  paymentCollectedAt?: Date | null
  meta?: { mutated: boolean; noOp: boolean }
}) {
  return {
    booking: {
      id: 'booking_1',
      checkoutStatus: BookingCheckoutStatus.READY,
      serviceSubtotalSnapshot: new Prisma.Decimal('125.00'),
      productSubtotalSnapshot: new Prisma.Decimal('55.00'),
      subtotalSnapshot: new Prisma.Decimal('125.00'),
      tipAmount: new Prisma.Decimal('20.00'),
      taxAmount: new Prisma.Decimal('10.00'),
      discountAmount: new Prisma.Decimal('5.00'),
      totalAmount: new Prisma.Decimal('205.00'),
      paymentAuthorizedAt:
        overrides && 'paymentAuthorizedAt' in overrides
          ? overrides.paymentAuthorizedAt
          : null,
      paymentCollectedAt:
        overrides && 'paymentCollectedAt' in overrides
          ? overrides.paymentCollectedAt
          : null,
    },
    selectedProducts: [
      {
        recommendationId: 'rec_1',
        productId: 'product_1',
        quantity: 2,
        unitPrice: new Prisma.Decimal('15.00'),
        lineTotal: new Prisma.Decimal('30.00'),
      },
      {
        recommendationId: 'rec_2',
        productId: 'product_2',
        quantity: 1,
        unitPrice: new Prisma.Decimal('25.00'),
        lineTotal: new Prisma.Decimal('25.00'),
      },
    ],
    meta: overrides?.meta ?? {
      mutated: true,
      noOp: false,
    },
  }
}

function expectedResponseBody(overrides?: {
  paymentAuthorizedAt?: string | null
  paymentCollectedAt?: string | null
  meta?: { mutated: boolean; noOp: boolean }
}) {
  return {
    booking: {
      id: 'booking_1',
      checkoutStatus: BookingCheckoutStatus.READY,
      serviceSubtotalSnapshot: '125',
      productSubtotalSnapshot: '55',
      subtotalSnapshot: '125',
      tipAmount: '20',
      taxAmount: '10',
      discountAmount: '5',
      totalAmount: '205',
      paymentAuthorizedAt:
        overrides && 'paymentAuthorizedAt' in overrides
          ? overrides.paymentAuthorizedAt
          : null,
      paymentCollectedAt:
        overrides && 'paymentCollectedAt' in overrides
          ? overrides.paymentCollectedAt
          : null,
    },
    selectedProducts: [
      {
        recommendationId: 'rec_1',
        productId: 'product_1',
        quantity: 2,
        unitPrice: '15',
        lineTotal: '30',
      },
      {
        recommendationId: 'rec_2',
        productId: 'product_2',
        quantity: 1,
        unitPrice: '25',
        lineTotal: '25',
      },
    ],
    meta: overrides?.meta ?? {
      mutated: true,
      noOp: false,
    },
  }
}

describe('app/api/client/bookings/[id]/checkout/products/route.ts POST', () => {
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

    mocks.requireClient.mockResolvedValue({
      ok: true,
      clientId: 'client_1',
      user: {
        id: 'user_1',
      },
    })

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
    mocks.upsertClientBookingCheckoutProducts.mockResolvedValue(
      makeUpsertResult(),
    )
  })

  it('returns auth response when requireClient fails', async () => {
    const authRes = makeJsonResponse(401, {
      ok: false,
      error: 'Unauthorized',
    })

    mocks.requireClient.mockResolvedValueOnce({
      ok: false,
      res: authRes,
    })

    const response = await POST(
      makeRequest({
        body: makeValidBody(),
      }),
      makeCtx(),
    )

    expect(response).toBe(authRes)
    expect(mocks.beginIdempotency).not.toHaveBeenCalled()
    expect(mocks.upsertClientBookingCheckoutProducts).not.toHaveBeenCalled()
  })

  it('returns FORBIDDEN when authenticated actor user id is missing', async () => {
    mocks.requireClient.mockResolvedValueOnce({
      ok: true,
      clientId: 'client_1',
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
      userMessage: 'You are not allowed to update this checkout.',
    })

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: 'You are not allowed to update this checkout.',
      code: 'FORBIDDEN',
      message: 'Authenticated actor user id is required.',
    })

    expect(mocks.beginIdempotency).not.toHaveBeenCalled()
    expect(mocks.upsertClientBookingCheckoutProducts).not.toHaveBeenCalled()
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
    expect(mocks.upsertClientBookingCheckoutProducts).not.toHaveBeenCalled()
  })

  it('returns 400 when items is not an array', async () => {
    const response = await POST(
      makeIdempotentRequest({
        body: {
          items: 'nope',
        },
      }),
      makeCtx(),
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: 'items must be an array.',
    })

    expect(mocks.beginIdempotency).not.toHaveBeenCalled()
    expect(mocks.upsertClientBookingCheckoutProducts).not.toHaveBeenCalled()
  })

  it('returns 400 when an item is missing recommendationId', async () => {
    const response = await POST(
      makeIdempotentRequest({
        body: {
          items: [
            {
              productId: 'product_1',
              quantity: 1,
            },
          ],
        },
      }),
      makeCtx(),
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: 'Each selected product needs a recommendationId.',
    })

    expect(mocks.beginIdempotency).not.toHaveBeenCalled()
    expect(mocks.upsertClientBookingCheckoutProducts).not.toHaveBeenCalled()
  })

  it('returns 400 when quantity is invalid', async () => {
    const response = await POST(
      makeIdempotentRequest({
        body: {
          items: [
            {
              recommendationId: 'rec_1',
              productId: 'product_1',
              quantity: 100,
            },
          ],
        },
      }),
      makeCtx(),
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: 'Each selected product needs a quantity between 1 and 99.',
    })

    expect(mocks.beginIdempotency).not.toHaveBeenCalled()
    expect(mocks.upsertClientBookingCheckoutProducts).not.toHaveBeenCalled()
  })

  it('returns 400 when duplicate recommendationId values are submitted', async () => {
    const response = await POST(
      makeIdempotentRequest({
        body: {
          items: [
            {
              recommendationId: 'rec_1',
              productId: 'product_1',
              quantity: 1,
            },
            {
              recommendationId: 'rec_1',
              productId: 'product_2',
              quantity: 1,
            },
          ],
        },
      }),
      makeCtx(),
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: 'Duplicate recommendationId values are not allowed.',
    })

    expect(mocks.beginIdempotency).not.toHaveBeenCalled()
    expect(mocks.upsertClientBookingCheckoutProducts).not.toHaveBeenCalled()
  })

  it('returns missing idempotency key for valid checkout products request without idempotency header or body key', async () => {
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
        actorRole: Role.CLIENT,
      },
      route: IDEMPOTENCY_ROUTE,
      key: null,
      requestBody: {
        actorUserId: 'user_1',
        clientId: 'client_1',
        bookingId: 'booking_1',
        items: expectedParsedItems(),
      },
    })

    expect(mocks.upsertClientBookingCheckoutProducts).not.toHaveBeenCalled()
    expect(mocks.completeIdempotency).not.toHaveBeenCalled()
  })

  it('accepts body idempotencyKey fallback when header is absent', async () => {
    const response = await POST(
      makeRequest({
        body: makeValidBody({
          idempotencyKey: 'idem_from_body_1',
        }),
        headers: {
          'x-request-id': 'req_products_1',
        },
      }),
      makeCtx(),
    )

    expect(mocks.beginIdempotency).toHaveBeenCalledWith({
      actor: {
        actorUserId: 'user_1',
        actorRole: Role.CLIENT,
      },
      route: IDEMPOTENCY_ROUTE,
      key: 'idem_from_body_1',
      requestBody: {
        actorUserId: 'user_1',
        clientId: 'client_1',
        bookingId: 'booking_1',
        items: expectedParsedItems(),
      },
    })

    expect(mocks.upsertClientBookingCheckoutProducts).toHaveBeenCalledWith({
      bookingId: 'booking_1',
      clientId: 'client_1',
      items: expectedParsedItems(),
      requestId: 'req_products_1',
      idempotencyKey: 'idem_from_body_1',
    })

    expect(response.status).toBe(200)
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
      error: 'A matching checkout products request is already in progress.',
      code: 'IDEMPOTENCY_REQUEST_IN_PROGRESS',
    })

    expect(mocks.upsertClientBookingCheckoutProducts).not.toHaveBeenCalled()
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

    expect(mocks.upsertClientBookingCheckoutProducts).not.toHaveBeenCalled()
    expect(mocks.completeIdempotency).not.toHaveBeenCalled()
  })

  it('replays completed idempotency response without updating checkout products again', async () => {
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

    expect(mocks.upsertClientBookingCheckoutProducts).not.toHaveBeenCalled()
    expect(mocks.completeIdempotency).not.toHaveBeenCalled()
  })

  it('updates checkout products, completes idempotency, and returns normalized payload', async () => {
    const response = await POST(
      makeIdempotentRequest({
        key: 'idem_products_1',
        body: makeValidBody(),
        headers: {
          'x-request-id': 'req_products_1',
        },
      }),
      makeCtx(),
    )

    expect(mocks.beginIdempotency).toHaveBeenCalledWith({
      actor: {
        actorUserId: 'user_1',
        actorRole: Role.CLIENT,
      },
      route: IDEMPOTENCY_ROUTE,
      key: 'idem_products_1',
      requestBody: {
        actorUserId: 'user_1',
        clientId: 'client_1',
        bookingId: 'booking_1',
        items: expectedParsedItems(),
      },
    })

    expect(mocks.upsertClientBookingCheckoutProducts).toHaveBeenCalledWith({
      bookingId: 'booking_1',
      clientId: 'client_1',
      items: expectedParsedItems(),
      requestId: 'req_products_1',
      idempotencyKey: 'idem_products_1',
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

  it('normalizes payment timestamps in the response body', async () => {
    mocks.upsertClientBookingCheckoutProducts.mockResolvedValueOnce(
      makeUpsertResult({
        paymentAuthorizedAt: new Date('2026-04-12T18:00:00.000Z'),
        paymentCollectedAt: new Date('2026-04-12T18:15:00.000Z'),
        meta: {
          mutated: false,
          noOp: true,
        },
      }),
    )

    const response = await POST(
      makeIdempotentRequest({
        key: 'idem_products_timestamps_1',
        body: makeValidBody(),
      }),
      makeCtx(),
    )

    const responseBody = expectedResponseBody({
      paymentAuthorizedAt: '2026-04-12T18:00:00.000Z',
      paymentCollectedAt: '2026-04-12T18:15:00.000Z',
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
      code: 'FORBIDDEN',
      message: 'Products can only be selected after aftercare is finalized.',
      userMessage: 'Products can only be selected after aftercare is finalized.',
    }

    mocks.upsertClientBookingCheckoutProducts.mockRejectedValueOnce(
      bookingError,
    )
    mocks.isBookingError.mockReturnValueOnce(true)
    mocks.getBookingFailPayload.mockReturnValueOnce({
      httpStatus: 403,
      userMessage:
        'Products can only be selected after aftercare is finalized.',
      extra: {
        code: 'FORBIDDEN',
        message:
          'Products can only be selected after aftercare is finalized.',
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

    expect(mocks.getBookingFailPayload).toHaveBeenCalledWith('FORBIDDEN', {
      message:
        'Products can only be selected after aftercare is finalized.',
      userMessage:
        'Products can only be selected after aftercare is finalized.',
    })

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error:
        'Products can only be selected after aftercare is finalized.',
      code: 'FORBIDDEN',
      message:
        'Products can only be selected after aftercare is finalized.',
    })
  })

  it('returns 500 for unexpected errors, captures exception, and marks idempotency failed', async () => {
    mocks.upsertClientBookingCheckoutProducts.mockRejectedValueOnce(
      new Error('boom'),
    )

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
      route: 'POST /api/client/bookings/[id]/checkout/products',
    })

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: 'Internal server error.',
    })
  })
})