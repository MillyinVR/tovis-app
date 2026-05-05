// app/api/client/bookings/[id]/checkout/stripe-session/route.test.ts

import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  BookingCheckoutStatus,
  BookingStatus,
  PaymentMethod,
  PaymentProvider,
  Prisma,
  Role,
  ServiceLocationType,
  StripeCheckoutSessionStatus,
  StripePaymentStatus,
} from '@prisma/client'

const STRIPE_SESSION_ROUTE =
  'POST /api/client/bookings/[id]/checkout/stripe-session'

const mocks = vi.hoisted(() => ({
  requireClient: vi.fn(),
  jsonOk: vi.fn(),
  jsonFail: vi.fn(),

  prismaBookingFindUnique: vi.fn(),
  prismaBookingUpdate: vi.fn(),

  getStripe: vi.fn(),
  stripeCheckoutSessionsCreate: vi.fn(),

  beginIdempotency: vi.fn(),
  completeIdempotency: vi.fn(),
  failIdempotency: vi.fn(),
}))

vi.mock('@/app/api/_utils', () => ({
  requireClient: mocks.requireClient,
  jsonOk: mocks.jsonOk,
  jsonFail: mocks.jsonFail,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    booking: {
      findUnique: mocks.prismaBookingFindUnique,
      update: mocks.prismaBookingUpdate,
    },
  },
}))

vi.mock('@/lib/stripe/server', () => ({
  getStripe: mocks.getStripe,
}))

vi.mock('@/lib/idempotency', () => ({
  beginIdempotency: mocks.beginIdempotency,
  completeIdempotency: mocks.completeIdempotency,
  failIdempotency: mocks.failIdempotency,
  IDEMPOTENCY_ROUTES: {
    CLIENT_CHECKOUT_CONFIRM:
      'POST /api/client/bookings/[id]/checkout/stripe-session',
  },
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
  headers?: Record<string, string>,
): NextRequest {
  return new NextRequest(
    'http://localhost/api/client/bookings/booking_1/checkout/stripe-session',
    {
      method: 'POST',
      headers: {
        ...(headers ?? {}),
      },
    },
  )
}

function makeIdempotentRequest(
  key = 'idem_stripe_session_1',
  headers?: Record<string, string>,
): NextRequest {
  return makeRequest({
    'idempotency-key': key,
    ...(headers ?? {}),
  })
}

function makeCtx(id = 'booking_1') {
  return {
    params: Promise.resolve({ id }),
  }
}

function makeBooking(overrides?: {
  id?: string
  clientId?: string
  checkoutStatus?: BookingCheckoutStatus
  selectedPaymentMethod?: PaymentMethod | null
  totalAmount?: Prisma.Decimal | null
  subtotalSnapshot?: Prisma.Decimal
  acceptStripeCard?: boolean
  stripeAccountId?: string | null
  stripeChargesEnabled?: boolean
  stripePayoutsEnabled?: boolean
}) {
  return {
    id: overrides?.id ?? 'booking_1',
    clientId: overrides?.clientId ?? 'client_1',
    professionalId: 'pro_1',
    status: BookingStatus.ACCEPTED,
    checkoutStatus: overrides?.checkoutStatus ?? BookingCheckoutStatus.READY,
    selectedPaymentMethod: overrides?.selectedPaymentMethod ?? null,
    totalAmount:
      overrides && 'totalAmount' in overrides
        ? overrides.totalAmount
        : new Prisma.Decimal(135),
    subtotalSnapshot: overrides?.subtotalSnapshot ?? new Prisma.Decimal(100),
    tipAmount: new Prisma.Decimal(15),
    stripeCheckoutSessionId: null,
    stripePaymentIntentId: null,
    professional: {
      paymentSettings: {
        acceptStripeCard: overrides?.acceptStripeCard ?? true,
        stripeAccountId:
          overrides && 'stripeAccountId' in overrides
            ? overrides.stripeAccountId
            : 'acct_test_123',
        stripeChargesEnabled: overrides?.stripeChargesEnabled ?? true,
        stripePayoutsEnabled: overrides?.stripePayoutsEnabled ?? true,
      },
    },
    service: {
      name: 'Haircut',
    },
  }
}

function makeStripeSession(overrides?: {
  id?: string
  url?: string | null
  paymentIntent?: string | null
  amountSubtotal?: number | null
  amountTotal?: number | null
  currency?: string | null
}) {
  return {
    id: overrides?.id ?? 'cs_test_123',
    url: overrides && 'url' in overrides ? overrides.url : 'https://checkout.stripe.test/session',
    payment_intent:
      overrides && 'paymentIntent' in overrides
        ? overrides.paymentIntent
        : 'pi_test_123',
    amount_subtotal:
      overrides && 'amountSubtotal' in overrides
        ? overrides.amountSubtotal
        : 13500,
    amount_total:
      overrides && 'amountTotal' in overrides ? overrides.amountTotal : 13500,
    currency:
      overrides && 'currency' in overrides ? overrides.currency : 'usd',
  }
}

function makeUpdatedBooking() {
  return {
    id: 'booking_1',
    checkoutStatus: BookingCheckoutStatus.READY,
    selectedPaymentMethod: PaymentMethod.STRIPE_CARD,
    paymentProvider: PaymentProvider.STRIPE,
    stripeCheckoutSessionId: 'cs_test_123',
    stripePaymentIntentId: 'pi_test_123',
    stripeCheckoutSessionStatus: StripeCheckoutSessionStatus.OPEN,
    stripePaymentStatus: StripePaymentStatus.NOT_STARTED,
    stripeAmountTotal: 13500,
    stripeCurrency: 'USD',
  }
}

function expectedIdempotencyBody() {
  return {
    bookingId: 'booking_1',
    clientId: 'client_1',
    actorUserId: 'user_1',
    provider: PaymentProvider.STRIPE,
    method: PaymentMethod.STRIPE_CARD,
  }
}

function expectedResponseBody() {
  return {
    booking: {
      id: 'booking_1',
      checkoutStatus: BookingCheckoutStatus.READY,
      selectedPaymentMethod: PaymentMethod.STRIPE_CARD,
      paymentProvider: PaymentProvider.STRIPE,
      stripeCheckoutSessionId: 'cs_test_123',
      stripePaymentIntentId: 'pi_test_123',
      stripeCheckoutSessionStatus: StripeCheckoutSessionStatus.OPEN,
      stripePaymentStatus: StripePaymentStatus.NOT_STARTED,
      stripeAmountTotal: 13500,
      stripeCurrency: 'USD',
    },
    stripeCheckout: {
      sessionId: 'cs_test_123',
      url: 'https://checkout.stripe.test/session',
    },
  }
}

describe('POST /api/client/bookings/[id]/checkout/stripe-session', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000'

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

    mocks.prismaBookingFindUnique.mockResolvedValue(makeBooking())
    mocks.prismaBookingUpdate.mockResolvedValue(makeUpdatedBooking())

    mocks.stripeCheckoutSessionsCreate.mockResolvedValue(makeStripeSession())
    mocks.getStripe.mockReturnValue({
      checkout: {
        sessions: {
          create: mocks.stripeCheckoutSessionsCreate,
        },
      },
    })
  })

  it('returns auth response when requireClient fails', async () => {
    mocks.requireClient.mockResolvedValueOnce({
      ok: false,
      res: makeJsonResponse({ error: 'Unauthorized' }, 401),
    })

    const response = await POST(makeRequest(), makeCtx())

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({
      error: 'Unauthorized',
    })

    expect(mocks.beginIdempotency).not.toHaveBeenCalled()
    expect(mocks.prismaBookingFindUnique).not.toHaveBeenCalled()
    expect(mocks.stripeCheckoutSessionsCreate).not.toHaveBeenCalled()
  })

  it('returns 400 when booking id is missing', async () => {
    const response = await POST(makeIdempotentRequest(), makeCtx('   '))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: 'Booking id is required.',
      code: 'BOOKING_ID_REQUIRED',
    })

    expect(mocks.beginIdempotency).not.toHaveBeenCalled()
    expect(mocks.prismaBookingFindUnique).not.toHaveBeenCalled()
  })

  it('requires an idempotency key', async () => {
    const response = await POST(makeRequest(), makeCtx())

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: 'Missing idempotency key.',
      code: 'IDEMPOTENCY_KEY_REQUIRED',
    })

    expect(mocks.beginIdempotency).toHaveBeenCalledWith({
      actor: {
        actorUserId: 'user_1',
        actorRole: Role.CLIENT,
      },
      route: STRIPE_SESSION_ROUTE,
      key: null,
      requestBody: expectedIdempotencyBody(),
    })

    expect(mocks.prismaBookingFindUnique).not.toHaveBeenCalled()
    expect(mocks.stripeCheckoutSessionsCreate).not.toHaveBeenCalled()
  })

  it('returns in-progress when idempotency has an active matching request', async () => {
    mocks.beginIdempotency.mockResolvedValueOnce({
      kind: 'in_progress',
    })

    const response = await POST(
      makeIdempotentRequest('idem_in_progress_1'),
      makeCtx(),
    )

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({
      error: 'A matching Stripe checkout request is already in progress.',
      code: 'IDEMPOTENCY_REQUEST_IN_PROGRESS',
    })

    expect(mocks.prismaBookingFindUnique).not.toHaveBeenCalled()
    expect(mocks.stripeCheckoutSessionsCreate).not.toHaveBeenCalled()
  })

  it('returns conflict when idempotency key was reused with a different body', async () => {
    mocks.beginIdempotency.mockResolvedValueOnce({
      kind: 'conflict',
    })

    const response = await POST(
      makeIdempotentRequest('idem_conflict_1'),
      makeCtx(),
    )

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({
      error:
        'This idempotency key was already used with a different request body.',
      code: 'IDEMPOTENCY_KEY_CONFLICT',
    })

    expect(mocks.prismaBookingFindUnique).not.toHaveBeenCalled()
    expect(mocks.stripeCheckoutSessionsCreate).not.toHaveBeenCalled()
  })

  it('replays completed idempotency response', async () => {
    const replayBody = expectedResponseBody()

    mocks.beginIdempotency.mockResolvedValueOnce({
      kind: 'replay',
      responseStatus: 200,
      responseBody: replayBody,
    })

    const response = await POST(
      makeIdempotentRequest('idem_replay_1'),
      makeCtx(),
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual(replayBody)

    expect(mocks.prismaBookingFindUnique).not.toHaveBeenCalled()
    expect(mocks.stripeCheckoutSessionsCreate).not.toHaveBeenCalled()
    expect(mocks.completeIdempotency).not.toHaveBeenCalled()
  })

  it('returns 404 when booking does not exist and marks idempotency failed', async () => {
    mocks.prismaBookingFindUnique.mockResolvedValueOnce(null)

    const response = await POST(
      makeIdempotentRequest('idem_missing_booking_1'),
      makeCtx(),
    )

    expect(mocks.failIdempotency).toHaveBeenCalledWith({
      idempotencyRecordId: 'idem_record_1',
    })

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({
      error: 'Booking not found.',
      code: 'BOOKING_NOT_FOUND',
    })

    expect(mocks.stripeCheckoutSessionsCreate).not.toHaveBeenCalled()
  })

  it('returns 403 when booking belongs to another client and marks idempotency failed', async () => {
    mocks.prismaBookingFindUnique.mockResolvedValueOnce(
      makeBooking({
        clientId: 'other_client',
      }),
    )

    const response = await POST(
      makeIdempotentRequest('idem_forbidden_1'),
      makeCtx(),
    )

    expect(mocks.failIdempotency).toHaveBeenCalledWith({
      idempotencyRecordId: 'idem_record_1',
    })

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({
      error: 'You are not allowed to check out this booking.',
      code: 'FORBIDDEN',
    })

    expect(mocks.stripeCheckoutSessionsCreate).not.toHaveBeenCalled()
  })

  it('rejects bookings that are already paid and marks idempotency failed', async () => {
    mocks.prismaBookingFindUnique.mockResolvedValueOnce(
      makeBooking({
        checkoutStatus: BookingCheckoutStatus.PAID,
      }),
    )

    const response = await POST(
      makeIdempotentRequest('idem_already_paid_1'),
      makeCtx(),
    )

    expect(mocks.failIdempotency).toHaveBeenCalledWith({
      idempotencyRecordId: 'idem_record_1',
    })

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({
      error: 'This booking is already paid.',
      code: 'BOOKING_ALREADY_PAID',
    })

    expect(mocks.stripeCheckoutSessionsCreate).not.toHaveBeenCalled()
  })

  it('rejects waived checkout and marks idempotency failed', async () => {
    mocks.prismaBookingFindUnique.mockResolvedValueOnce(
      makeBooking({
        checkoutStatus: BookingCheckoutStatus.WAIVED,
      }),
    )

    const response = await POST(
      makeIdempotentRequest('idem_waived_1'),
      makeCtx(),
    )

    expect(mocks.failIdempotency).toHaveBeenCalledWith({
      idempotencyRecordId: 'idem_record_1',
    })

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({
      error: 'This booking checkout has been waived.',
      code: 'BOOKING_CHECKOUT_WAIVED',
    })

    expect(mocks.stripeCheckoutSessionsCreate).not.toHaveBeenCalled()
  })

  it('rejects when provider has no Stripe account and marks idempotency failed', async () => {
    mocks.prismaBookingFindUnique.mockResolvedValueOnce(
      makeBooking({
        stripeAccountId: null,
      }),
    )

    const response = await POST(
      makeIdempotentRequest('idem_no_stripe_account_1'),
      makeCtx(),
    )

    expect(mocks.failIdempotency).toHaveBeenCalledWith({
      idempotencyRecordId: 'idem_record_1',
    })

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: 'This provider has not connected Stripe yet.',
      code: 'STRIPE_ACCOUNT_REQUIRED',
    })

    expect(mocks.stripeCheckoutSessionsCreate).not.toHaveBeenCalled()
  })

  it('rejects when Stripe card is not enabled and marks idempotency failed', async () => {
    mocks.prismaBookingFindUnique.mockResolvedValueOnce(
      makeBooking({
        acceptStripeCard: false,
      }),
    )

    const response = await POST(
      makeIdempotentRequest('idem_stripe_disabled_1'),
      makeCtx(),
    )

    expect(mocks.failIdempotency).toHaveBeenCalledWith({
      idempotencyRecordId: 'idem_record_1',
    })

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: 'This provider is not ready to accept card payments.',
      code: 'STRIPE_ACCOUNT_NOT_READY',
    })

    expect(mocks.stripeCheckoutSessionsCreate).not.toHaveBeenCalled()
  })

  it('rejects when Stripe charges are not enabled and marks idempotency failed', async () => {
    mocks.prismaBookingFindUnique.mockResolvedValueOnce(
      makeBooking({
        stripeChargesEnabled: false,
      }),
    )

    const response = await POST(
      makeIdempotentRequest('idem_charges_disabled_1'),
      makeCtx(),
    )

    expect(mocks.failIdempotency).toHaveBeenCalledWith({
      idempotencyRecordId: 'idem_record_1',
    })

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: 'This provider is not ready to accept card payments.',
      code: 'STRIPE_ACCOUNT_NOT_READY',
    })

    expect(mocks.stripeCheckoutSessionsCreate).not.toHaveBeenCalled()
  })

  it('rejects when Stripe payouts are not enabled and marks idempotency failed', async () => {
    mocks.prismaBookingFindUnique.mockResolvedValueOnce(
      makeBooking({
        stripePayoutsEnabled: false,
      }),
    )

    const response = await POST(
      makeIdempotentRequest('idem_payouts_disabled_1'),
      makeCtx(),
    )

    expect(mocks.failIdempotency).toHaveBeenCalledWith({
      idempotencyRecordId: 'idem_record_1',
    })

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: 'This provider is not ready to accept card payments.',
      code: 'STRIPE_ACCOUNT_NOT_READY',
    })

    expect(mocks.stripeCheckoutSessionsCreate).not.toHaveBeenCalled()
  })

  it('rejects zero amount bookings and marks idempotency failed', async () => {
    mocks.prismaBookingFindUnique.mockResolvedValueOnce(
      makeBooking({
        totalAmount: new Prisma.Decimal(0),
        subtotalSnapshot: new Prisma.Decimal(0),
      }),
    )

    const response = await POST(
      makeIdempotentRequest('idem_zero_amount_1'),
      makeCtx(),
    )

    expect(mocks.failIdempotency).toHaveBeenCalledWith({
      idempotencyRecordId: 'idem_record_1',
    })

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: 'Booking total must be greater than zero.',
      code: 'INVALID_PAYMENT_AMOUNT',
    })

    expect(mocks.stripeCheckoutSessionsCreate).not.toHaveBeenCalled()
  })

  it('creates Stripe Checkout Session, stores Stripe fields, completes idempotency, and returns checkout URL', async () => {
    const response = await POST(
      makeIdempotentRequest('idem_stripe_success_1'),
      makeCtx(),
    )

    expect(mocks.beginIdempotency).toHaveBeenCalledWith({
      actor: {
        actorUserId: 'user_1',
        actorRole: Role.CLIENT,
      },
      route: STRIPE_SESSION_ROUTE,
      key: 'idem_stripe_success_1',
      requestBody: expectedIdempotencyBody(),
    })

    expect(mocks.stripeCheckoutSessionsCreate).toHaveBeenCalledWith({
      mode: 'payment',
      payment_method_types: ['card'],
      client_reference_id: 'booking_1',
      success_url:
        'http://localhost:3000/client/bookings/booking_1/checkout/success',
      cancel_url: 'http://localhost:3000/client/bookings/booking_1/checkout',
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: 'usd',
            unit_amount: 13500,
            product_data: {
              name: 'TOVIS booking: Haircut',
            },
          },
        },
      ],
      metadata: {
        bookingId: 'booking_1',
        clientId: 'client_1',
        professionalId: 'pro_1',
      },
      payment_intent_data: {
        metadata: {
          bookingId: 'booking_1',
          clientId: 'client_1',
          professionalId: 'pro_1',
        },
        transfer_data: {
          destination: 'acct_test_123',
        },
      },
    })

    expect(mocks.prismaBookingUpdate).toHaveBeenCalledWith({
      where: { id: 'booking_1' },
      data: {
        paymentProvider: PaymentProvider.STRIPE,
        selectedPaymentMethod: PaymentMethod.STRIPE_CARD,
        checkoutStatus: BookingCheckoutStatus.READY,
        stripeCheckoutSessionId: 'cs_test_123',
        stripePaymentIntentId: 'pi_test_123',
        stripeConnectedAccountId: 'acct_test_123',
        stripeCheckoutSessionStatus: StripeCheckoutSessionStatus.OPEN,
        stripePaymentStatus: StripePaymentStatus.NOT_STARTED,
        stripeAmountSubtotal: 13500,
        stripeAmountTotal: 13500,
        stripeApplicationFeeAmount: null,
        stripeCurrency: 'USD',
        stripeLastEventId: null,
      },
      select: {
        id: true,
        checkoutStatus: true,
        selectedPaymentMethod: true,
        paymentProvider: true,
        stripeCheckoutSessionId: true,
        stripePaymentIntentId: true,
        stripeCheckoutSessionStatus: true,
        stripePaymentStatus: true,
        stripeAmountTotal: true,
        stripeCurrency: true,
      },
    })

    const responseBody = expectedResponseBody()

    expect(mocks.completeIdempotency).toHaveBeenCalledWith({
      idempotencyRecordId: 'idem_record_1',
      responseStatus: 200,
      responseBody,
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual(responseBody)
  })

  it('uses subtotalSnapshot when totalAmount is null', async () => {
    mocks.prismaBookingFindUnique.mockResolvedValueOnce(
      makeBooking({
        totalAmount: null,
        subtotalSnapshot: new Prisma.Decimal(100),
      }),
    )

    await POST(
      makeIdempotentRequest('idem_uses_subtotal_1'),
      makeCtx(),
    )

    expect(mocks.stripeCheckoutSessionsCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        line_items: [
          expect.objectContaining({
            price_data: expect.objectContaining({
              unit_amount: 10000,
            }),
          }),
        ],
      }),
    )
  })

  it('uses explicit checkout URLs from env when provided', async () => {
    process.env.STRIPE_CHECKOUT_SUCCESS_URL =
      'https://app.test/success/{BOOKING_ID}'
    process.env.STRIPE_CHECKOUT_CANCEL_URL =
      'https://app.test/cancel/{BOOKING_ID}'

    await POST(
      makeIdempotentRequest('idem_explicit_urls_1'),
      makeCtx(),
    )

    expect(mocks.stripeCheckoutSessionsCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        success_url: 'https://app.test/success/booking_1',
        cancel_url: 'https://app.test/cancel/booking_1',
      }),
    )
  })

  it('marks idempotency failed and returns 500 for unexpected Stripe errors', async () => {
    mocks.stripeCheckoutSessionsCreate.mockRejectedValueOnce(
      new Error('stripe boom'),
    )

    const response = await POST(
      makeIdempotentRequest('idem_stripe_error_1'),
      makeCtx(),
    )

    expect(mocks.failIdempotency).toHaveBeenCalledWith({
      idempotencyRecordId: 'idem_record_1',
    })

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({
      error: 'Failed to create Stripe checkout session.',
      message: 'stripe boom',
    })
  })

  it('returns database validation errors as 400 and marks idempotency failed', async () => {
    mocks.prismaBookingUpdate.mockRejectedValueOnce(
      new Prisma.PrismaClientValidationError('bad update', {
        clientVersion: 'test',
      }),
    )

    const response = await POST(
      makeIdempotentRequest('idem_db_validation_1'),
      makeCtx(),
    )

    expect(mocks.failIdempotency).toHaveBeenCalledWith({
      idempotencyRecordId: 'idem_record_1',
    })

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: 'Invalid Stripe checkout update.',
      detail: expect.stringContaining('bad update'),
    })
  })
})