// app/api/client/bookings/[id]/checkout/products/route.test.ts

import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BookingCheckoutStatus, Prisma, Role } from '@prisma/client'

const IDEMPOTENCY_ROUTE =
  'POST /api/client/bookings/[id]/checkout/products'

const ROUTE_OPERATION =
  'POST /api/client/bookings/[id]/checkout/products'

const mocks = vi.hoisted(() => ({
  jsonFail: vi.fn(),
  jsonOk: vi.fn(),
  requireClient: vi.fn(),

  beginRouteIdempotency: vi.fn(),
  completeRouteIdempotency: vi.fn(),
  failStartedRouteIdempotency: vi.fn(),
  isRouteIdempotencyHandled: vi.fn(),

  getBookingFailPayload: vi.fn(),
  isBookingError: vi.fn(),

  upsertClientBookingCheckoutProducts: vi.fn(),

  captureBookingException: vi.fn(),
}))

vi.mock('@/app/api/_utils', () => ({
  jsonFail: mocks.jsonFail,
  jsonOk: mocks.jsonOk,
  requireClient: mocks.requireClient,
}))

vi.mock('@/app/api/_utils/idempotency', () => ({
  beginRouteIdempotency: mocks.beginRouteIdempotency,
  completeRouteIdempotency: mocks.completeRouteIdempotency,
  failStartedRouteIdempotency: mocks.failStartedRouteIdempotency,
  isRouteIdempotencyHandled: mocks.isRouteIdempotencyHandled,
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
  return new NextRequest(
    'http://localhost/api/client/bookings/booking_1/checkout/products',
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

function makeStartedIdempotency(key = 'idem_checkout_products_1') {
  return {
    kind: 'started',
    idempotencyRecordId: 'idem_record_1',
    idempotencyKey: key,
    requestHash: 'hash_1',
  }
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

function expectedIdempotencyBody() {
  return {
    actorUserId: 'user_1',
    clientId: 'client_1',
    bookingId: 'booking_1',
    items: expectedParsedItems(),
  }
}

function expectRouteIdempotencyStartedWith(
  requestBody = expectedIdempotencyBody(),
): void {
  expect(mocks.beginRouteIdempotency).toHaveBeenCalledWith({
    request: expect.any(NextRequest),
    actor: {
      actorUserId: 'user_1',
      actorRole: Role.CLIENT,
    },
    route: IDEMPOTENCY_ROUTE,
    requestLabel: 'client checkout products',
    requestBody,
    messages: {
      missingKey: 'Missing idempotency key.',
      inProgress:
        'A matching checkout products request is already in progress.',
      conflict:
        'This idempotency key was already used with a different request body.',
    },
  })
}

function mockHandledIdempotency(response: Response): void {
  mocks.beginRouteIdempotency.mockResolvedValueOnce({
    kind: 'handled',
    response,
  })
  mocks.isRouteIdempotencyHandled.mockReturnValueOnce(true)
}

function hasStringCode(value: unknown): value is { code: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'code' in value &&
    typeof value.code === 'string'
  )
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

    mocks.requireClient.mockResolvedValue({
      ok: true,
      clientId: 'client_1',
      user: {
        id: 'user_1',
      },
    })

    mocks.isBookingError.mockImplementation((error: unknown) =>
      hasStringCode(error),
    )

    mocks.getBookingFailPayload.mockImplementation(
      (
        code: string,
        overrides?: {
          message?: string
          userMessage?: string
        },
      ) => {
        const statusByCode: Record<string, number> = {
          BOOKING_ID_REQUIRED: 400,
          BOOKING_NOT_FOUND: 404,
          FORBIDDEN: 403,
        }

        const messageByCode: Record<string, string> = {
          BOOKING_ID_REQUIRED: 'Missing booking id.',
          BOOKING_NOT_FOUND: 'Booking not found.',
          FORBIDDEN: 'Forbidden.',
        }

        return {
          httpStatus: statusByCode[code] ?? 409,
          userMessage:
            overrides?.userMessage ??
            overrides?.message ??
            messageByCode[code] ??
            code,
          extra: {
            code,
            ...(overrides?.message ? { message: overrides.message } : {}),
          },
        }
      },
    )

    mocks.beginRouteIdempotency.mockResolvedValue(makeStartedIdempotency())
    mocks.isRouteIdempotencyHandled.mockReturnValue(false)
    mocks.completeRouteIdempotency.mockResolvedValue(undefined)
    mocks.failStartedRouteIdempotency.mockResolvedValue(undefined)

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
    expect(mocks.beginRouteIdempotency).not.toHaveBeenCalled()
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

    expect(mocks.beginRouteIdempotency).not.toHaveBeenCalled()
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
      code: 'BOOKING_ID_REQUIRED',
    })

    expect(mocks.beginRouteIdempotency).not.toHaveBeenCalled()
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

    expect(mocks.beginRouteIdempotency).not.toHaveBeenCalled()
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

    expect(mocks.beginRouteIdempotency).not.toHaveBeenCalled()
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

    expect(mocks.beginRouteIdempotency).not.toHaveBeenCalled()
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

    expect(mocks.beginRouteIdempotency).not.toHaveBeenCalled()
    expect(mocks.upsertClientBookingCheckoutProducts).not.toHaveBeenCalled()
  })

  it('returns handled missing-key idempotency response without updating checkout products', async () => {
    const handledResponse = makeJsonResponse(400, {
      ok: false,
      error: 'Missing idempotency key.',
      code: 'IDEMPOTENCY_KEY_REQUIRED',
    })

    mockHandledIdempotency(handledResponse)

    const response = await POST(
      makeRequest({
        body: makeValidBody(),
      }),
      makeCtx(),
    )

    expect(response).toBe(handledResponse)
    expectRouteIdempotencyStartedWith()

    expect(mocks.upsertClientBookingCheckoutProducts).not.toHaveBeenCalled()
    expect(mocks.completeRouteIdempotency).not.toHaveBeenCalled()
  })

  it('returns handled in-progress idempotency response without updating checkout products', async () => {
    const handledResponse = makeJsonResponse(409, {
      ok: false,
      error: 'A matching checkout products request is already in progress.',
      code: 'IDEMPOTENCY_REQUEST_IN_PROGRESS',
    })

    mockHandledIdempotency(handledResponse)

    const response = await POST(
      makeIdempotentRequest({
        body: makeValidBody(),
      }),
      makeCtx(),
    )

    expect(response).toBe(handledResponse)
    expectRouteIdempotencyStartedWith()

    expect(mocks.upsertClientBookingCheckoutProducts).not.toHaveBeenCalled()
    expect(mocks.completeRouteIdempotency).not.toHaveBeenCalled()
  })

  it('returns handled conflict idempotency response without updating checkout products', async () => {
    const handledResponse = makeJsonResponse(409, {
      ok: false,
      error:
        'This idempotency key was already used with a different request body.',
      code: 'IDEMPOTENCY_KEY_CONFLICT',
    })

    mockHandledIdempotency(handledResponse)

    const response = await POST(
      makeIdempotentRequest({
        body: makeValidBody(),
      }),
      makeCtx(),
    )

    expect(response).toBe(handledResponse)
    expectRouteIdempotencyStartedWith()

    expect(mocks.upsertClientBookingCheckoutProducts).not.toHaveBeenCalled()
    expect(mocks.completeRouteIdempotency).not.toHaveBeenCalled()
  })

  it('replays handled idempotency response without updating checkout products again', async () => {
    const replayBody = expectedResponseBody()
    const handledResponse = makeJsonResponse(200, {
      ok: true,
      ...replayBody,
    })

    mockHandledIdempotency(handledResponse)

    const response = await POST(
      makeIdempotentRequest({
        body: makeValidBody(),
      }),
      makeCtx(),
    )

    expect(response).toBe(handledResponse)
    expectRouteIdempotencyStartedWith()

    expect(mocks.upsertClientBookingCheckoutProducts).not.toHaveBeenCalled()
    expect(mocks.completeRouteIdempotency).not.toHaveBeenCalled()
  })

  it('updates checkout products, completes idempotency, and returns normalized payload', async () => {
    mocks.beginRouteIdempotency.mockResolvedValueOnce(
      makeStartedIdempotency('idem_products_1'),
    )

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

    expectRouteIdempotencyStartedWith()

    expect(mocks.upsertClientBookingCheckoutProducts).toHaveBeenCalledWith({
      bookingId: 'booking_1',
      clientId: 'client_1',
      items: expectedParsedItems(),
      requestId: 'req_products_1',
      idempotencyKey: 'idem_products_1',
    })

    const responseBody = expectedResponseBody()

    expect(mocks.completeRouteIdempotency).toHaveBeenCalledWith({
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

  it('normalizes payment timestamps in the response body', async () => {
    mocks.beginRouteIdempotency.mockResolvedValueOnce(
      makeStartedIdempotency('idem_products_timestamps_1'),
    )

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

    expect(mocks.completeRouteIdempotency).toHaveBeenCalledWith({
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
      userMessage:
        'Products can only be selected after aftercare is finalized.',
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

    expect(mocks.failStartedRouteIdempotency).toHaveBeenCalledWith({
      idempotencyRecordId: 'idem_record_1',
      operation: ROUTE_OPERATION,
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

    expect(mocks.failStartedRouteIdempotency).toHaveBeenCalledWith({
      idempotencyRecordId: 'idem_record_1',
      operation: ROUTE_OPERATION,
    })

    expect(mocks.captureBookingException).toHaveBeenCalledWith({
      error: expect.any(Error),
      route: ROUTE_OPERATION,
    })

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: 'Internal server error.',
    })
  })
})