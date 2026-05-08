// app/api/client/bookings/[id]/checkout/stripe-session/route.test.ts

import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  BookingCheckoutStatus,
  PaymentMethod,
  PaymentProvider,
  Prisma,
  Role,
  StripeCheckoutSessionStatus,
  StripePaymentStatus,
} from '@prisma/client'
import { bookingError } from '@/lib/booking/errors'

const STRIPE_SESSION_ROUTE =
  'POST /api/client/bookings/[id]/checkout/stripe-session'

const mocks = vi.hoisted(() => ({
  requireClient: vi.fn(),
  jsonOk: vi.fn(),
  jsonFail: vi.fn(),

  prepareClientStripeCheckoutSession: vi.fn(),
  recordStripeCheckoutSessionAttached: vi.fn(),

  getStripe: vi.fn(),
  stripeCheckoutSessionsCreate: vi.fn(),

  beginIdempotency: vi.fn(),
  completeIdempotency: vi.fn(),
  failIdempotency: vi.fn(),

  captureBookingException: vi.fn(),
}))

vi.mock('@/app/api/_utils', () => ({
  requireClient: mocks.requireClient,
  jsonOk: mocks.jsonOk,
  jsonFail: mocks.jsonFail,
}))

vi.mock('@/lib/booking/writeBoundary', () => ({
  prepareClientStripeCheckoutSession: mocks.prepareClientStripeCheckoutSession,
  recordStripeCheckoutSessionAttached: mocks.recordStripeCheckoutSessionAttached,
}))

vi.mock('@/lib/stripe/server', () => ({
  getStripe: mocks.getStripe,
}))

vi.mock('@/lib/idempotency', () => ({
  beginIdempotency: mocks.beginIdempotency,
  completeIdempotency: mocks.completeIdempotency,
  failIdempotency: mocks.failIdempotency,
  IDEMPOTENCY_ROUTES: {
    CLIENT_CHECKOUT_STRIPE_SESSION:
      'POST /api/client/bookings/[id]/checkout/stripe-session',
  },
}))

vi.mock('@/lib/observability/bookingEvents', () => ({
  captureBookingException: mocks.captureBookingException,
}))

import { POST } from './route'

function makeJsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function makeRequest(opts?: {
  headers?: Record<string, string>
  body?: unknown
}): NextRequest {
  return new NextRequest(
    'http://localhost/api/client/bookings/booking_1/checkout/stripe-session',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(opts?.headers ?? {}) },
      body:
        opts?.body !== undefined ? JSON.stringify(opts.body) : JSON.stringify({}),
    },
  )
}

function makeIdempotentRequest(
  key = 'idem_stripe_session_1',
  opts?: { body?: unknown },
): NextRequest {
  return makeRequest({
    headers: { 'idempotency-key': key },
    body: opts?.body,
  })
}

function makeCtx(id = 'booking_1') {
  return { params: Promise.resolve({ id }) }
}

function makePrepared(overrides?: {
  amountCents?: number
  tipAmount?: Prisma.Decimal
  totalAmount?: Prisma.Decimal
}) {
  return {
    booking: {
      id: 'booking_1',
      professionalId: 'pro_1',
      serviceSubtotalSnapshot: new Prisma.Decimal(100),
      productSubtotalSnapshot: new Prisma.Decimal(0),
      subtotalSnapshot: new Prisma.Decimal(100),
      tipAmount: overrides?.tipAmount ?? new Prisma.Decimal(15),
      taxAmount: new Prisma.Decimal(0),
      discountAmount: new Prisma.Decimal(0),
      totalAmount: overrides?.totalAmount ?? new Prisma.Decimal(115),
      checkoutStatus: BookingCheckoutStatus.READY,
      selectedPaymentMethod: PaymentMethod.STRIPE_CARD,
      paymentProvider: PaymentProvider.STRIPE,
    },
    stripe: {
      amountCents: overrides?.amountCents ?? 11500,
      currency: 'USD',
      lineItemDescription: 'TOVIS booking: Haircut',
      connectedAccountId: 'acct_test_123',
    },
    meta: { mutated: true, noOp: false },
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
    url:
      overrides && 'url' in overrides
        ? overrides.url
        : 'https://checkout.stripe.test/session',
    payment_intent:
      overrides && 'paymentIntent' in overrides
        ? overrides.paymentIntent
        : 'pi_test_123',
    amount_subtotal:
      overrides && 'amountSubtotal' in overrides
        ? overrides.amountSubtotal
        : 11500,
    amount_total:
      overrides && 'amountTotal' in overrides ? overrides.amountTotal : 11500,
    currency:
      overrides && 'currency' in overrides ? overrides.currency : 'usd',
  }
}

function makeAttached(overrides?: {
  stripeCheckoutSessionId?: string | null
  stripePaymentIntentId?: string | null
  amountTotal?: number | null
  currency?: string | null
}) {
  return {
    booking: {
      id: 'booking_1',
      checkoutStatus: BookingCheckoutStatus.READY,
      selectedPaymentMethod: PaymentMethod.STRIPE_CARD,
      paymentProvider: PaymentProvider.STRIPE,
      stripeCheckoutSessionId:
        overrides?.stripeCheckoutSessionId ?? 'cs_test_123',
      stripePaymentIntentId:
        overrides?.stripePaymentIntentId ?? 'pi_test_123',
      stripeCheckoutSessionStatus: StripeCheckoutSessionStatus.OPEN,
      stripePaymentStatus: StripePaymentStatus.NOT_STARTED,
      stripeAmountSubtotal: 11500,
      stripeAmountTotal: overrides?.amountTotal ?? 11500,
      stripeCurrency: overrides?.currency ?? 'USD',
    },
    meta: { mutated: true, noOp: false },
  }
}

describe('POST /api/client/bookings/[id]/checkout/stripe-session', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000'
    delete process.env.STRIPE_CHECKOUT_SUCCESS_URL
    delete process.env.STRIPE_CHECKOUT_CANCEL_URL

    mocks.jsonOk.mockImplementation((body: unknown, status = 200) =>
      makeJsonResponse(body, status),
    )

    mocks.jsonFail.mockImplementation(
      (status: number, message: string, extra?: Record<string, unknown>) =>
        makeJsonResponse({ error: message, ...(extra ?? {}) }, status),
    )

    mocks.requireClient.mockResolvedValue({
      ok: true,
      clientId: 'client_1',
      user: { id: 'user_1' },
    })

    mocks.beginIdempotency.mockImplementation(
      async (args: { key: string | null }) => {
        const key = args.key?.trim()
        if (!key) return { kind: 'missing_key' }
        return {
          kind: 'started',
          idempotencyRecordId: 'idem_record_1',
          requestHash: 'hash_1',
        }
      },
    )

    mocks.completeIdempotency.mockResolvedValue(undefined)
    mocks.failIdempotency.mockResolvedValue(undefined)

    mocks.prepareClientStripeCheckoutSession.mockResolvedValue(makePrepared())
    mocks.recordStripeCheckoutSessionAttached.mockResolvedValue(makeAttached())

    mocks.stripeCheckoutSessionsCreate.mockResolvedValue(makeStripeSession())
    mocks.getStripe.mockReturnValue({
      checkout: {
        sessions: { create: mocks.stripeCheckoutSessionsCreate },
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
    expect(mocks.beginIdempotency).not.toHaveBeenCalled()
    expect(mocks.prepareClientStripeCheckoutSession).not.toHaveBeenCalled()
    expect(mocks.stripeCheckoutSessionsCreate).not.toHaveBeenCalled()
  })

  it('returns 400 when booking id is missing', async () => {
    const response = await POST(makeIdempotentRequest(), makeCtx('   '))

    expect(response.status).toBe(400)
    expect(mocks.beginIdempotency).not.toHaveBeenCalled()
    expect(mocks.prepareClientStripeCheckoutSession).not.toHaveBeenCalled()
  })

  it('rejects malformed tipAmount before idempotency starts', async () => {
    const response = await POST(
      makeIdempotentRequest('idem_bad_tip', { body: { tipAmount: 'abc' } }),
      makeCtx(),
    )

    expect(response.status).toBe(400)
    expect(mocks.beginIdempotency).not.toHaveBeenCalled()
  })

  it('requires an idempotency key', async () => {
    const response = await POST(makeRequest(), makeCtx())

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: 'Missing idempotency key.',
      code: 'IDEMPOTENCY_KEY_REQUIRED',
    })

    expect(mocks.beginIdempotency).toHaveBeenCalledWith({
      actor: { actorUserId: 'user_1', actorRole: Role.CLIENT },
      route: STRIPE_SESSION_ROUTE,
      key: null,
      requestBody: {
        bookingId: 'booking_1',
        clientId: 'client_1',
        actorUserId: 'user_1',
        provider: PaymentProvider.STRIPE,
        method: PaymentMethod.STRIPE_CARD,
        tipAmountProvided: false,
        tipAmount: null,
      },
    })

    expect(mocks.prepareClientStripeCheckoutSession).not.toHaveBeenCalled()
    expect(mocks.stripeCheckoutSessionsCreate).not.toHaveBeenCalled()
  })

  it('returns in-progress when idempotency has an active matching request', async () => {
    mocks.beginIdempotency.mockResolvedValueOnce({ kind: 'in_progress' })

    const response = await POST(
      makeIdempotentRequest('idem_in_progress_1'),
      makeCtx(),
    )

    expect(response.status).toBe(409)
    expect(mocks.prepareClientStripeCheckoutSession).not.toHaveBeenCalled()
    expect(mocks.stripeCheckoutSessionsCreate).not.toHaveBeenCalled()
  })

  it('returns conflict when idempotency key was reused with a different body', async () => {
    mocks.beginIdempotency.mockResolvedValueOnce({ kind: 'conflict' })

    const response = await POST(
      makeIdempotentRequest('idem_conflict_1'),
      makeCtx(),
    )

    expect(response.status).toBe(409)
    expect(mocks.prepareClientStripeCheckoutSession).not.toHaveBeenCalled()
  })

  it('replays completed idempotency response', async () => {
    const replayBody = { booking: { id: 'booking_1' }, replayed: true }

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
    expect(mocks.prepareClientStripeCheckoutSession).not.toHaveBeenCalled()
    expect(mocks.stripeCheckoutSessionsCreate).not.toHaveBeenCalled()
  })

  it('forwards the parsed tip amount to the write boundary, calls Stripe, and records the session', async () => {
    const response = await POST(
      makeIdempotentRequest('idem_full_1', { body: { tipAmount: '20' } }),
      makeCtx(),
    )

    expect(response.status).toBe(200)
    const body = (await response.json()) as Record<string, unknown>
    expect(body.stripeCheckout).toEqual({
      sessionId: 'cs_test_123',
      url: 'https://checkout.stripe.test/session',
    })

    expect(mocks.prepareClientStripeCheckoutSession).toHaveBeenCalledWith({
      bookingId: 'booking_1',
      clientId: 'client_1',
      tipAmount: '20.00',
      requestId: null,
      idempotencyKey: 'idem_full_1',
    })

    const stripeArgs = mocks.stripeCheckoutSessionsCreate.mock.calls[0]
    expect(stripeArgs?.[0]).toMatchObject({
      mode: 'payment',
      payment_method_types: ['card'],
      client_reference_id: 'booking_1',
      success_url:
        'http://localhost:3000/client/bookings/booking_1?step=aftercare&checkout=success',
      cancel_url:
        'http://localhost:3000/client/bookings/booking_1?step=aftercare&checkout=cancelled',
    })
    expect(stripeArgs?.[0].line_items[0]).toMatchObject({
      quantity: 1,
      price_data: {
        currency: 'usd',
        unit_amount: 11500,
        product_data: { name: 'TOVIS booking: Haircut' },
      },
    })
    expect(stripeArgs?.[0].metadata).toEqual({
      bookingId: 'booking_1',
      clientId: 'client_1',
      professionalId: 'pro_1',
    })
    expect(stripeArgs?.[0].payment_intent_data?.transfer_data).toEqual({
      destination: 'acct_test_123',
    })

    // Stripe-side idempotency key threaded through.
    expect(stripeArgs?.[1]).toEqual({
      idempotencyKey: 'tovis:stripe-session:booking_1:idem_full_1',
    })

    expect(mocks.recordStripeCheckoutSessionAttached).toHaveBeenCalledWith({
      bookingId: 'booking_1',
      clientId: 'client_1',
      stripeCheckoutSessionId: 'cs_test_123',
      stripePaymentIntentId: 'pi_test_123',
      stripeConnectedAccountId: 'acct_test_123',
      stripeAmountSubtotal: 11500,
      stripeAmountTotal: 11500,
      stripeCurrency: 'usd',
      requestId: null,
      idempotencyKey: 'idem_full_1',
    })

    expect(mocks.completeIdempotency).toHaveBeenCalledWith({
      idempotencyRecordId: 'idem_record_1',
      responseStatus: 200,
      responseBody: expect.objectContaining({
        stripeCheckout: expect.objectContaining({
          sessionId: 'cs_test_123',
          url: 'https://checkout.stripe.test/session',
        }),
      }),
    })
  })

  it('always uses the deterministic aftercare return URLs (env overrides removed)', async () => {
    process.env.STRIPE_CHECKOUT_SUCCESS_URL = 'https://app.test/success'
    process.env.STRIPE_CHECKOUT_CANCEL_URL = 'https://app.test/cancel'

    await POST(makeIdempotentRequest('idem_env_1'), makeCtx())

    const stripeArgs = mocks.stripeCheckoutSessionsCreate.mock.calls[0]
    expect(stripeArgs?.[0].success_url).toBe(
      'http://localhost:3000/client/bookings/booking_1?step=aftercare&checkout=success',
    )
    expect(stripeArgs?.[0].cancel_url).toBe(
      'http://localhost:3000/client/bookings/booking_1?step=aftercare&checkout=cancelled',
    )
  })

  it('maps booking errors from prepare through bookingJsonFail and marks idempotency failed', async () => {
    mocks.prepareClientStripeCheckoutSession.mockRejectedValueOnce(
      bookingError('FORBIDDEN', {
        message: 'Stripe checkout requires a positive total.',
        userMessage: 'Booking total must be greater than zero.',
      }),
    )

    const response = await POST(
      makeIdempotentRequest('idem_zero_total'),
      makeCtx(),
    )

    expect(response.status).toBe(403)
    expect(mocks.failIdempotency).toHaveBeenCalledWith({
      idempotencyRecordId: 'idem_record_1',
    })
    expect(mocks.stripeCheckoutSessionsCreate).not.toHaveBeenCalled()
  })

  it('returns 500 and marks idempotency failed when Stripe throws', async () => {
    mocks.stripeCheckoutSessionsCreate.mockRejectedValueOnce(
      new Error('stripe boom'),
    )

    const response = await POST(makeIdempotentRequest('idem_stripe_boom'), makeCtx())

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({
      error: 'Failed to create Stripe checkout session.',
      message: 'stripe boom',
    })

    expect(mocks.failIdempotency).toHaveBeenCalledWith({
      idempotencyRecordId: 'idem_record_1',
    })
    expect(mocks.recordStripeCheckoutSessionAttached).not.toHaveBeenCalled()
  })
})
