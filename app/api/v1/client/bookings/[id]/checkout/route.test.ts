// app/api/v1/client/bookings/[id]/checkout/route.test.ts

import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  BookingCheckoutStatus,
  PaymentMethod,
  Prisma,
  Role,
} from '@prisma/client'

const IDEMPOTENCY_ROUTE = 'POST /api/v1/client/bookings/[id]/checkout'
const ROUTE_OPERATION = 'POST /api/v1/client/bookings/[id]/checkout'

const paidAt = new Date('2026-03-25T16:00:00.000Z')

const mocks = vi.hoisted(() => ({
  requireClient: vi.fn(),
  jsonOk: vi.fn(),
  jsonFail: vi.fn(),

  beginRouteIdempotency: vi.fn(),
  completeRouteIdempotency: vi.fn(),
  failStartedRouteIdempotency: vi.fn(),
  isRouteIdempotencyHandled: vi.fn(),

  getBookingFailPayload: vi.fn(),
  isBookingError: vi.fn(),

  updateClientBookingCheckout: vi.fn(),

  prismaBookingFindUnique: vi.fn(),
  prismaProfessionalPaymentSettingsFindUnique: vi.fn(),

  captureBookingException: vi.fn(),
}))

vi.mock('@/app/api/_utils', () => ({
  requireClient: mocks.requireClient,
  jsonOk: mocks.jsonOk,
  jsonFail: mocks.jsonFail,
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
  updateClientBookingCheckout: mocks.updateClientBookingCheckout,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    booking: {
      findUnique: mocks.prismaBookingFindUnique,
    },
    professionalPaymentSettings: {
      findUnique: mocks.prismaProfessionalPaymentSettingsFindUnique,
    },
  },
}))

vi.mock('@/lib/idempotency', () => ({
  IDEMPOTENCY_ROUTES: {
    CLIENT_CHECKOUT_CONFIRM: 'POST /api/v1/client/bookings/[id]/checkout',
  },
}))

vi.mock('@/lib/observability/bookingEvents', () => ({
  captureBookingException: mocks.captureBookingException,
}))

import { POST } from './route'

function makeJsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
    },
  })
}

function makeRequest(
  body: unknown,
  headers?: Record<string, string>,
): NextRequest {
  return new NextRequest(
    'http://localhost/api/v1/client/bookings/booking_1/checkout',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(headers ?? {}),
      },
      body: JSON.stringify(body),
    },
  )
}

function makeIdempotentRequest(
  body: unknown,
  key = 'idem_checkout_1',
  headers?: Record<string, string>,
): NextRequest {
  return makeRequest(body, {
    'idempotency-key': key,
    ...(headers ?? {}),
  })
}

function makeCtx(id = 'booking_1') {
  return {
    params: Promise.resolve({ id }),
  }
}

function hasStringCode(value: unknown): value is { code: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'code' in value &&
    typeof value.code === 'string'
  )
}

function makeStartedIdempotency() {
  return {
    kind: 'started',
    idempotencyRecordId: 'idem_record_1',
    idempotencyKey: 'idem_checkout_1',
    requestHash: 'hash_1',
  }
}

function makePaidResult(paymentMethod: PaymentMethod = PaymentMethod.CASH) {
  return {
    booking: {
      id: 'booking_1',
      checkoutStatus: BookingCheckoutStatus.PAID,
      selectedPaymentMethod: paymentMethod,
      serviceSubtotalSnapshot: new Prisma.Decimal(100),
      productSubtotalSnapshot: new Prisma.Decimal(20),
      subtotalSnapshot: new Prisma.Decimal(100),
      tipAmount: new Prisma.Decimal(15),
      taxAmount: new Prisma.Decimal(0),
      discountAmount: new Prisma.Decimal(0),
      totalAmount: new Prisma.Decimal(135),
      paymentAuthorizedAt: paidAt,
      paymentCollectedAt: paidAt,
    },
    meta: {
      mutated: true,
      noOp: false,
    },
  }
}

function makeStripeSelectionResult() {
  return {
    booking: {
      id: 'booking_1',
      checkoutStatus: BookingCheckoutStatus.READY,
      selectedPaymentMethod: PaymentMethod.STRIPE_CARD,
      serviceSubtotalSnapshot: new Prisma.Decimal(100),
      productSubtotalSnapshot: new Prisma.Decimal(20),
      subtotalSnapshot: new Prisma.Decimal(100),
      tipAmount: new Prisma.Decimal(15),
      taxAmount: new Prisma.Decimal(0),
      discountAmount: new Prisma.Decimal(0),
      totalAmount: new Prisma.Decimal(135),
      paymentAuthorizedAt: null,
      paymentCollectedAt: null,
    },
    meta: {
      mutated: true,
      noOp: false,
    },
  }
}

function expectedPaidResponseBody(
  paymentMethod: PaymentMethod = PaymentMethod.CASH,
) {
  return {
    booking: {
      id: 'booking_1',
      checkoutStatus: BookingCheckoutStatus.PAID,
      selectedPaymentMethod: paymentMethod,
      serviceSubtotalSnapshot: '100',
      productSubtotalSnapshot: '20',
      subtotalSnapshot: '100',
      tipAmount: '15',
      taxAmount: '0',
      discountAmount: '0',
      totalAmount: '135',
      paymentAuthorizedAt: '2026-03-25T16:00:00.000Z',
      paymentCollectedAt: '2026-03-25T16:00:00.000Z',
    },
    meta: {
      mutated: true,
      noOp: false,
    },
  }
}

function makeAwaitingConfirmationResult(
  paymentMethod: PaymentMethod = PaymentMethod.CASH,
) {
  return {
    booking: {
      id: 'booking_1',
      checkoutStatus: BookingCheckoutStatus.AWAITING_CONFIRMATION,
      selectedPaymentMethod: paymentMethod,
      serviceSubtotalSnapshot: new Prisma.Decimal(100),
      productSubtotalSnapshot: new Prisma.Decimal(20),
      subtotalSnapshot: new Prisma.Decimal(100),
      tipAmount: new Prisma.Decimal(15),
      taxAmount: new Prisma.Decimal(0),
      discountAmount: new Prisma.Decimal(0),
      totalAmount: new Prisma.Decimal(135),
      paymentAuthorizedAt: paidAt,
      paymentCollectedAt: null,
    },
    meta: {
      mutated: true,
      noOp: false,
    },
  }
}

function expectedAwaitingConfirmationResponseBody(
  paymentMethod: PaymentMethod = PaymentMethod.CASH,
) {
  return {
    booking: {
      id: 'booking_1',
      checkoutStatus: BookingCheckoutStatus.AWAITING_CONFIRMATION,
      selectedPaymentMethod: paymentMethod,
      serviceSubtotalSnapshot: '100',
      productSubtotalSnapshot: '20',
      subtotalSnapshot: '100',
      tipAmount: '15',
      taxAmount: '0',
      discountAmount: '0',
      totalAmount: '135',
      paymentAuthorizedAt: '2026-03-25T16:00:00.000Z',
      paymentCollectedAt: null,
    },
    meta: {
      mutated: true,
      noOp: false,
    },
  }
}

function expectedStripeSelectionResponseBody() {
  return {
    booking: {
      id: 'booking_1',
      checkoutStatus: BookingCheckoutStatus.READY,
      selectedPaymentMethod: PaymentMethod.STRIPE_CARD,
      serviceSubtotalSnapshot: '100',
      productSubtotalSnapshot: '20',
      subtotalSnapshot: '100',
      tipAmount: '15',
      taxAmount: '0',
      discountAmount: '0',
      totalAmount: '135',
      paymentAuthorizedAt: null,
      paymentCollectedAt: null,
    },
    meta: {
      mutated: true,
      noOp: false,
    },
  }
}

function expectedIdempotencyBody(overrides?: {
  tipAmountProvided?: boolean
  tipAmount?: string | null
  selectedPaymentMethodProvided?: boolean
  selectedPaymentMethod?: PaymentMethod | null
  confirmPayment?: boolean
}) {
  return {
    bookingId: 'booking_1',
    clientId: 'client_1',
    actorUserId: 'user_1',
    tipAmountProvided: overrides?.tipAmountProvided ?? true,
    tipAmount:
      overrides && 'tipAmount' in overrides ? overrides.tipAmount : '15.00',
    selectedPaymentMethodProvided:
      overrides?.selectedPaymentMethodProvided ?? true,
    selectedPaymentMethod:
      overrides && 'selectedPaymentMethod' in overrides
        ? overrides.selectedPaymentMethod
        : PaymentMethod.CASH,
    confirmPayment: overrides?.confirmPayment ?? true,
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
    requestLabel: 'client checkout',
    requestBody,
    messages: {
      missingKey: 'Missing idempotency key.',
      inProgress: 'A matching checkout request is already in progress.',
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

describe('POST /api/v1/client/bookings/[id]/checkout', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mocks.jsonOk.mockImplementation((body: unknown, status = 200) =>
      makeJsonResponse(body, status),
    )

    mocks.jsonFail.mockImplementation(
      (status: number, message: string, extra?: Record<string, unknown>) =>
        makeJsonResponse(
          {
            error: message,
            ...(extra ?? {}),
          },
          status,
        ),
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
          httpStatus: statusByCode[code] ?? 403,
          userMessage:
            overrides?.userMessage ??
            messageByCode[code] ??
            `booking error: ${code}`,
          extra: {
            code,
          },
        }
      },
    )

    mocks.beginRouteIdempotency.mockResolvedValue(makeStartedIdempotency())
    mocks.isRouteIdempotencyHandled.mockReturnValue(false)
    mocks.completeRouteIdempotency.mockResolvedValue(undefined)
    mocks.failStartedRouteIdempotency.mockResolvedValue(undefined)

    mocks.prismaBookingFindUnique.mockResolvedValue({
      id: 'booking_1',
      professionalId: 'pro_1',
      selectedPaymentMethod: null,
    })

    mocks.prismaProfessionalPaymentSettingsFindUnique.mockResolvedValue({
      acceptCash: true,
      acceptCardOnFile: true,
      acceptTapToPay: true,
      acceptVenmo: true,
      acceptZelle: true,
      acceptAppleCash: true,
      acceptStripeCard: true,
      tipsEnabled: true,
    })

    mocks.updateClientBookingCheckout.mockResolvedValue(makePaidResult())
  })

  it('returns auth response when requireClient fails', async () => {
    mocks.requireClient.mockResolvedValueOnce({
      ok: false,
      res: makeJsonResponse({ error: 'Unauthorized' }, 401),
    })

    const response = await POST(makeRequest({}), makeCtx())

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({
      error: 'Unauthorized',
    })

    expect(mocks.beginRouteIdempotency).not.toHaveBeenCalled()
    expect(mocks.updateClientBookingCheckout).not.toHaveBeenCalled()
  })

  it('returns 400 when booking id is missing', async () => {
    const response = await POST(makeRequest({}), makeCtx('   '))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: 'Missing booking id.',
      code: 'BOOKING_ID_REQUIRED',
    })

    expect(mocks.beginRouteIdempotency).not.toHaveBeenCalled()
    expect(mocks.updateClientBookingCheckout).not.toHaveBeenCalled()
  })

  it('returns 400 for an unsupported payment method before idempotency starts', async () => {
    const response = await POST(
      makeRequest({
        selectedPaymentMethod: 'paypal',
        confirmPayment: false,
      }),
      makeCtx(),
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error:
        'selectedPaymentMethod must be one of: cash, card on file, tap to pay, Venmo, Zelle, Apple Cash, Stripe card.',
    })

    expect(mocks.beginRouteIdempotency).not.toHaveBeenCalled()
    expect(mocks.updateClientBookingCheckout).not.toHaveBeenCalled()
  })

  it('returns handled missing-key idempotency response without loading booking or updating checkout', async () => {
    const handledResponse = makeJsonResponse(
      {
        error: 'Missing idempotency key.',
        code: 'IDEMPOTENCY_KEY_REQUIRED',
      },
      400,
    )

    mockHandledIdempotency(handledResponse)

    const response = await POST(
      makeRequest({
        tipAmount: '15.00',
        selectedPaymentMethod: 'cash',
        confirmPayment: true,
      }),
      makeCtx(),
    )

    expect(response).toBe(handledResponse)
    expectRouteIdempotencyStartedWith()

    expect(mocks.prismaBookingFindUnique).not.toHaveBeenCalled()
    expect(mocks.updateClientBookingCheckout).not.toHaveBeenCalled()
    expect(mocks.completeRouteIdempotency).not.toHaveBeenCalled()
  })

  it('returns handled in-progress idempotency response without loading booking or updating checkout', async () => {
    const handledResponse = makeJsonResponse(
      {
        error: 'A matching checkout request is already in progress.',
        code: 'IDEMPOTENCY_REQUEST_IN_PROGRESS',
      },
      409,
    )

    mockHandledIdempotency(handledResponse)

    const response = await POST(
      makeIdempotentRequest({
        tipAmount: '15.00',
        selectedPaymentMethod: 'cash',
        confirmPayment: true,
      }),
      makeCtx(),
    )

    expect(response).toBe(handledResponse)
    expectRouteIdempotencyStartedWith()

    expect(mocks.prismaBookingFindUnique).not.toHaveBeenCalled()
    expect(mocks.updateClientBookingCheckout).not.toHaveBeenCalled()
    expect(mocks.completeRouteIdempotency).not.toHaveBeenCalled()
  })

  it('returns handled conflict idempotency response without loading booking or updating checkout', async () => {
    const handledResponse = makeJsonResponse(
      {
        error:
          'This idempotency key was already used with a different request body.',
        code: 'IDEMPOTENCY_KEY_CONFLICT',
      },
      409,
    )

    mockHandledIdempotency(handledResponse)

    const response = await POST(
      makeIdempotentRequest({
        tipAmount: '15.00',
        selectedPaymentMethod: 'cash',
        confirmPayment: true,
      }),
      makeCtx(),
    )

    expect(response).toBe(handledResponse)
    expectRouteIdempotencyStartedWith()

    expect(mocks.prismaBookingFindUnique).not.toHaveBeenCalled()
    expect(mocks.updateClientBookingCheckout).not.toHaveBeenCalled()
    expect(mocks.completeRouteIdempotency).not.toHaveBeenCalled()
  })

  it('replays handled idempotency response without loading booking or updating checkout', async () => {
    const replayBody = expectedPaidResponseBody()
    const handledResponse = makeJsonResponse(replayBody, 200)

    mockHandledIdempotency(handledResponse)

    const response = await POST(
      makeIdempotentRequest({
        tipAmount: '15.00',
        selectedPaymentMethod: 'cash',
        confirmPayment: true,
      }),
      makeCtx(),
    )

    expect(response).toBe(handledResponse)
    expectRouteIdempotencyStartedWith()

    expect(mocks.prismaBookingFindUnique).not.toHaveBeenCalled()
    expect(mocks.updateClientBookingCheckout).not.toHaveBeenCalled()
    expect(mocks.completeRouteIdempotency).not.toHaveBeenCalled()
  })

  it('returns 404 when booking does not exist and marks idempotency failed', async () => {
    mocks.prismaBookingFindUnique.mockResolvedValueOnce(null)

    const response = await POST(
      makeIdempotentRequest(
        {
          tipAmount: '15.00',
          selectedPaymentMethod: 'cash',
          confirmPayment: true,
        },
        'idem_missing_booking_1',
      ),
      makeCtx(),
    )

    expect(mocks.failStartedRouteIdempotency).toHaveBeenCalledWith({
      idempotencyRecordId: 'idem_record_1',
      operation: ROUTE_OPERATION,
    })

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({
      error: 'Booking not found.',
      code: 'BOOKING_NOT_FOUND',
    })

    expect(mocks.updateClientBookingCheckout).not.toHaveBeenCalled()
  })

  it('returns 400 when confirming payment without any payment method and marks idempotency failed', async () => {
    mocks.prismaBookingFindUnique.mockResolvedValueOnce({
      id: 'booking_1',
      professionalId: 'pro_1',
      selectedPaymentMethod: null,
    })

    const response = await POST(
      makeIdempotentRequest(
        {
          tipAmount: '10.00',
          confirmPayment: true,
        },
        'idem_missing_method_1',
      ),
      makeCtx(),
    )

    expectRouteIdempotencyStartedWith(
      expectedIdempotencyBody({
        tipAmount: '10.00',
        selectedPaymentMethodProvided: false,
        selectedPaymentMethod: null,
        confirmPayment: true,
      }),
    )

    expect(mocks.failStartedRouteIdempotency).toHaveBeenCalledWith({
      idempotencyRecordId: 'idem_record_1',
      operation: ROUTE_OPERATION,
    })

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: 'Choose a payment method before confirming payment.',
    })

    expect(mocks.updateClientBookingCheckout).not.toHaveBeenCalled()
  })

  it('rejects STRIPE_CARD manual confirmation and marks idempotency failed', async () => {
    const response = await POST(
      makeIdempotentRequest(
        {
          tipAmount: '15.00',
          selectedPaymentMethod: 'stripe_card',
          confirmPayment: true,
        },
        'idem_stripe_manual_confirm_1',
      ),
      makeCtx(),
    )

    expectRouteIdempotencyStartedWith(
      expectedIdempotencyBody({
        tipAmount: '15.00',
        selectedPaymentMethodProvided: true,
        selectedPaymentMethod: PaymentMethod.STRIPE_CARD,
        confirmPayment: true,
      }),
    )

    expect(mocks.failStartedRouteIdempotency).toHaveBeenCalledWith({
      idempotencyRecordId: 'idem_record_1',
      operation: ROUTE_OPERATION,
    })

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: 'Card payments must be confirmed through Stripe checkout.',
      code: 'STRIPE_CHECKOUT_REQUIRED',
    })

    expect(mocks.updateClientBookingCheckout).not.toHaveBeenCalled()
    expect(mocks.completeRouteIdempotency).not.toHaveBeenCalled()
  })

  it('allows selecting STRIPE_CARD without marking payment collected', async () => {
    mocks.updateClientBookingCheckout.mockResolvedValueOnce(
      makeStripeSelectionResult(),
    )

    const response = await POST(
      makeIdempotentRequest(
        {
          tipAmount: '15.00',
          selectedPaymentMethod: 'stripe_card',
          confirmPayment: false,
        },
        'idem_stripe_select_1',
      ),
      makeCtx(),
    )

    expect(mocks.updateClientBookingCheckout).toHaveBeenCalledWith({
      bookingId: 'booking_1',
      clientId: 'client_1',
      tipAmount: '15.00',
      selectedPaymentMethod: PaymentMethod.STRIPE_CARD,
      checkoutStatus: undefined,
      markPaymentAuthorized: false,
      markPaymentCollected: false,
    })

    const responseBody = expectedStripeSelectionResponseBody()

    expect(mocks.completeRouteIdempotency).toHaveBeenCalledWith({
      idempotencyRecordId: 'idem_record_1',
      responseStatus: 200,
      responseBody,
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual(responseBody)
  })

  it('rejects STRIPE_CARD when the provider has not enabled Stripe card payments', async () => {
    mocks.prismaProfessionalPaymentSettingsFindUnique.mockResolvedValueOnce({
      acceptCash: true,
      acceptCardOnFile: true,
      acceptTapToPay: true,
      acceptVenmo: true,
      acceptZelle: true,
      acceptAppleCash: true,
      acceptStripeCard: false,
      tipsEnabled: true,
    })

    const response = await POST(
      makeIdempotentRequest(
        {
          tipAmount: '15.00',
          selectedPaymentMethod: 'stripe_card',
          confirmPayment: false,
        },
        'idem_stripe_disabled_1',
      ),
      makeCtx(),
    )

    expect(mocks.failStartedRouteIdempotency).toHaveBeenCalledWith({
      idempotencyRecordId: 'idem_record_1',
      operation: ROUTE_OPERATION,
    })

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: 'That payment method is not enabled by this provider.',
    })

    expect(mocks.updateClientBookingCheckout).not.toHaveBeenCalled()
  })

  it('rejects existing STRIPE_CARD manual confirmation and marks idempotency failed', async () => {
    mocks.prismaBookingFindUnique.mockResolvedValueOnce({
      id: 'booking_1',
      professionalId: 'pro_1',
      selectedPaymentMethod: PaymentMethod.STRIPE_CARD,
    })

    const response = await POST(
      makeIdempotentRequest(
        {
          tipAmount: '15.00',
          confirmPayment: true,
        },
        'idem_existing_stripe_manual_confirm_1',
      ),
      makeCtx(),
    )

    expect(mocks.failStartedRouteIdempotency).toHaveBeenCalledWith({
      idempotencyRecordId: 'idem_record_1',
      operation: ROUTE_OPERATION,
    })

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: 'Card payments must be confirmed through Stripe checkout.',
      code: 'STRIPE_CHECKOUT_REQUIRED',
    })

    expect(mocks.updateClientBookingCheckout).not.toHaveBeenCalled()
  })

  it('rejects a positive tip when tips are disabled for the provider and marks idempotency failed', async () => {
    mocks.prismaProfessionalPaymentSettingsFindUnique.mockResolvedValueOnce({
      acceptCash: true,
      acceptCardOnFile: true,
      acceptTapToPay: true,
      acceptVenmo: true,
      acceptZelle: true,
      acceptAppleCash: true,
      acceptStripeCard: true,
      tipsEnabled: false,
    })

    const response = await POST(
      makeIdempotentRequest(
        {
          tipAmount: '12.00',
          selectedPaymentMethod: 'cash',
          confirmPayment: false,
        },
        'idem_tips_disabled_1',
      ),
      makeCtx(),
    )

    expect(mocks.failStartedRouteIdempotency).toHaveBeenCalledWith({
      idempotencyRecordId: 'idem_record_1',
      operation: ROUTE_OPERATION,
    })

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: 'Tips are not enabled for this provider.',
    })

    expect(mocks.updateClientBookingCheckout).not.toHaveBeenCalled()
  })

  it('forwards a confirmed cash payment into AWAITING_CONFIRMATION (unverifiable — pro must confirm receipt)', async () => {
    // Cash is off-platform / unverifiable: the client attests, but the money
    // only "arrives" once the pro confirms. Checkout enters AWAITING_CONFIRMATION
    // with authorization stamped and collection held.
    mocks.updateClientBookingCheckout.mockResolvedValueOnce(
      makeAwaitingConfirmationResult(),
    )

    const response = await POST(
      makeIdempotentRequest(
        {
          tipAmount: '15.00',
          selectedPaymentMethod: 'cash',
          confirmPayment: true,
        },
        'idem_checkout_success_1',
      ),
      makeCtx(),
    )

    expectRouteIdempotencyStartedWith()

    expect(mocks.updateClientBookingCheckout).toHaveBeenCalledWith({
      bookingId: 'booking_1',
      clientId: 'client_1',
      tipAmount: '15.00',
      selectedPaymentMethod: PaymentMethod.CASH,
      checkoutStatus: BookingCheckoutStatus.AWAITING_CONFIRMATION,
      markPaymentAuthorized: true,
      markPaymentCollected: false,
    })

    const responseBody = expectedAwaitingConfirmationResponseBody()

    expect(mocks.completeRouteIdempotency).toHaveBeenCalledWith({
      idempotencyRecordId: 'idem_record_1',
      responseStatus: 200,
      responseBody,
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual(responseBody)
  })

  it('keeps a verifiable card-on-file confirmation on the immediate-PAID path', async () => {
    const response = await POST(
      makeIdempotentRequest(
        {
          tipAmount: '15.00',
          selectedPaymentMethod: 'card on file',
          confirmPayment: true,
        },
        'idem_checkout_cardonfile_1',
      ),
      makeCtx(),
    )

    expect(mocks.updateClientBookingCheckout).toHaveBeenCalledWith({
      bookingId: 'booking_1',
      clientId: 'client_1',
      tipAmount: '15.00',
      selectedPaymentMethod: PaymentMethod.CARD_ON_FILE,
      checkoutStatus: BookingCheckoutStatus.PAID,
      markPaymentAuthorized: true,
      markPaymentCollected: true,
    })

    expect(response.status).toBe(200)
  })

  it('uses existing manual selected payment method when confirming payment without selectedPaymentMethod', async () => {
    mocks.prismaBookingFindUnique.mockResolvedValueOnce({
      id: 'booking_1',
      professionalId: 'pro_1',
      selectedPaymentMethod: PaymentMethod.CASH,
    })
    mocks.updateClientBookingCheckout.mockResolvedValueOnce(
      makeAwaitingConfirmationResult(),
    )

    const response = await POST(
      makeIdempotentRequest(
        {
          tipAmount: '5.00',
          confirmPayment: true,
        },
        'idem_existing_method_1',
      ),
      makeCtx(),
    )

    expectRouteIdempotencyStartedWith(
      expectedIdempotencyBody({
        tipAmount: '5.00',
        selectedPaymentMethodProvided: false,
        selectedPaymentMethod: null,
        confirmPayment: true,
      }),
    )

    // Existing method is CASH (unverifiable), so confirming holds it in
    // AWAITING_CONFIRMATION rather than collecting immediately.
    expect(mocks.updateClientBookingCheckout).toHaveBeenCalledWith({
      bookingId: 'booking_1',
      clientId: 'client_1',
      tipAmount: '5.00',
      selectedPaymentMethod: undefined,
      checkoutStatus: BookingCheckoutStatus.AWAITING_CONFIRMATION,
      markPaymentAuthorized: true,
      markPaymentCollected: false,
    })

    expect(response.status).toBe(200)
  })

  it('maps booking errors through bookingJsonFail and marks idempotency failed', async () => {
    mocks.updateClientBookingCheckout.mockRejectedValueOnce({
      code: 'FORBIDDEN',
      message: 'Nope',
      userMessage: 'Blocked',
    })

    const response = await POST(
      makeIdempotentRequest(
        {
          tipAmount: '5.00',
          selectedPaymentMethod: 'cash',
          confirmPayment: false,
        },
        'idem_booking_error_1',
      ),
      makeCtx(),
    )

    expect(mocks.failStartedRouteIdempotency).toHaveBeenCalledWith({
      idempotencyRecordId: 'idem_record_1',
      operation: ROUTE_OPERATION,
    })

    expect(mocks.getBookingFailPayload).toHaveBeenCalledWith('FORBIDDEN', {
      message: 'Nope',
      userMessage: 'Blocked',
    })

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({
      error: 'Blocked',
      code: 'FORBIDDEN',
    })
  })

  it('returns 500 for unexpected errors, captures exception, and marks idempotency failed', async () => {
    mocks.updateClientBookingCheckout.mockRejectedValueOnce(new Error('boom'))

    const response = await POST(
      makeIdempotentRequest(
        {
          tipAmount: '5.00',
          selectedPaymentMethod: 'cash',
          confirmPayment: false,
        },
        'idem_checkout_boom_1',
      ),
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
      error: 'Internal server error.',
    })
  })
})