// app/api/v1/client/rebook/[token]/checkout/route.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Prisma } from '@prisma/client'

const mocks = vi.hoisted(() => ({
  jsonOk: vi.fn((body: Record<string, unknown>, status = 200) => ({
    ok: true,
    status,
    ...body,
  })),
  jsonFail: vi.fn((status: number, error: string, extra?: Record<string, unknown>) => ({
    ok: false,
    status,
    error,
    ...extra,
  })),
  pickString: vi.fn(),
  bookingJsonFail: vi.fn((code: string, extra?: Record<string, unknown>) => ({
    ok: false,
    bookingErrorCode: code,
    ...extra,
  })),

  withRouteIdempotency: vi.fn(),

  resolveAftercareAccessTokenForMutation: vi.fn(),

  isBookingError: vi.fn(),
  prepareClientStripeCheckoutSession: vi.fn(),
  recordStripeCheckoutSessionAttached: vi.fn(),

  getStripe: vi.fn(),
  stripeSessionsCreate: vi.fn(),

  captureBookingException: vi.fn(),

  enforceRateLimit: vi.fn(),
  tokenActorRateLimitKey: vi.fn(() => 'rlkey'),
  rateLimitExceededResponse: vi.fn(() => ({ ok: false, status: 429 })),
}))

vi.mock('@/app/api/_utils', () => ({
  jsonOk: mocks.jsonOk,
  jsonFail: mocks.jsonFail,
  pickString: mocks.pickString,
}))

vi.mock('@/app/api/_utils/bookingResponses', () => ({
  bookingJsonFail: mocks.bookingJsonFail,
}))

vi.mock('@/app/api/_utils/idempotency', () => ({
  withRouteIdempotency: mocks.withRouteIdempotency,
}))

vi.mock('@/lib/aftercare/aftercareAccessTokens', () => ({
  resolveAftercareAccessTokenForMutation:
    mocks.resolveAftercareAccessTokenForMutation,
}))

vi.mock('@/lib/booking/errors', () => ({
  isBookingError: mocks.isBookingError,
}))

vi.mock('@/lib/booking/writeBoundary', () => ({
  prepareClientStripeCheckoutSession: mocks.prepareClientStripeCheckoutSession,
  recordStripeCheckoutSessionAttached: mocks.recordStripeCheckoutSessionAttached,
}))

vi.mock('@/lib/idempotency', () => ({
  IDEMPOTENCY_ROUTES: {
    PUBLIC_AFTERCARE_CHECKOUT_STRIPE_SESSION:
      'POST /api/v1/client/rebook/[token]/checkout',
  },
}))

vi.mock('@/lib/observability/bookingEvents', () => ({
  captureBookingException: mocks.captureBookingException,
}))

vi.mock('@/lib/stripe/server', () => ({
  getStripe: mocks.getStripe,
}))

vi.mock('@/lib/rateLimit/enforce', () => ({
  enforceRateLimit: mocks.enforceRateLimit,
}))

vi.mock('@/lib/rateLimit/identity', () => ({
  tokenActorRateLimitKey: mocks.tokenActorRateLimitKey,
}))

vi.mock('@/lib/rateLimit/response', () => ({
  rateLimitExceededResponse: mocks.rateLimitExceededResponse,
}))

import { POST } from './route'

function makeCtx(token = 'token_1') {
  return { params: Promise.resolve({ token }) }
}

function makeReq(body: unknown = {}) {
  return new Request('http://localhost/api/v1/client/rebook/token_1/checkout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function makeResolved() {
  return {
    idempotencyActorKey: 'actor_token_1',
    token: { id: 'cat_1' },
    booking: {
      id: 'booking_1',
      clientId: 'client_1',
      professionalId: 'pro_1',
    },
  }
}

function makePrepared() {
  return {
    booking: {
      id: 'booking_1',
      professionalId: 'pro_1',
      totalAmount: new Prisma.Decimal(45),
    },
    stripe: {
      amountCents: 4500,
      currency: 'USD',
      lineItemDescription: 'TOVIS booking: Haircut',
      connectedAccountId: 'acct_123',
    },
  }
}

function makeAttached() {
  return {
    booking: {
      id: 'booking_1',
      checkoutStatus: 'READY',
      stripeCheckoutSessionId: 'cs_1',
      stripePaymentIntentId: 'pi_1',
      stripePaymentStatus: 'NOT_STARTED',
      stripeAmountTotal: 4500,
      stripeCurrency: 'USD',
    },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.NEXT_PUBLIC_APP_URL = 'https://app.tovis.test'
  mocks.pickString.mockImplementation((v: unknown) =>
    typeof v === 'string' && v.trim() ? v : null,
  )
  mocks.enforceRateLimit.mockResolvedValue({ allowed: true })
  mocks.resolveAftercareAccessTokenForMutation.mockResolvedValue(makeResolved())
  mocks.prepareClientStripeCheckoutSession.mockResolvedValue(makePrepared())
  mocks.recordStripeCheckoutSessionAttached.mockResolvedValue(makeAttached())
  mocks.stripeSessionsCreate.mockResolvedValue({
    id: 'cs_1',
    url: 'https://checkout.stripe.test/s',
    payment_intent: 'pi_1',
    amount_subtotal: 4500,
    amount_total: 4500,
    currency: 'usd',
  })
  mocks.getStripe.mockReturnValue({
    checkout: { sessions: { create: mocks.stripeSessionsCreate } },
  })
  mocks.isBookingError.mockReturnValue(false)
  // Drive the idempotency wrapper: run the callback and return jsonOk(body).
  mocks.withRouteIdempotency.mockImplementation(
    async (
      _args: unknown,
      run: (ctx: { idempotencyKey: string }) => Promise<{
        status: number
        body: Record<string, unknown>
      }>,
    ) => {
      const { status, body } = await run({ idempotencyKey: 'idem_1' })
      return mocks.jsonOk(body, status)
    },
  )
})

describe('POST /api/v1/client/rebook/[token]/checkout', () => {
  it('fails when the token is missing', async () => {
    mocks.pickString.mockReturnValueOnce(null)

    const res = await POST(makeReq(), makeCtx())

    expect(res).toMatchObject({
      ok: false,
      bookingErrorCode: 'AFTERCARE_TOKEN_MISSING',
    })
    expect(mocks.resolveAftercareAccessTokenForMutation).not.toHaveBeenCalled()
  })

  it('rejects a non-numeric tip amount before doing any work', async () => {
    const res = await POST(makeReq({ tipAmount: 'abc' }), makeCtx())

    expect(res).toMatchObject({ ok: false, status: 400 })
    expect(mocks.enforceRateLimit).not.toHaveBeenCalled()
  })

  it('returns 429 when rate limited', async () => {
    mocks.enforceRateLimit.mockResolvedValueOnce({ allowed: false })

    const res = await POST(makeReq(), makeCtx())

    expect(res).toMatchObject({ ok: false, status: 429 })
    expect(mocks.resolveAftercareAccessTokenForMutation).not.toHaveBeenCalled()
  })

  it('creates a Stripe session and returns the checkout url', async () => {
    const res = await POST(makeReq(), makeCtx())

    expect(mocks.prepareClientStripeCheckoutSession).toHaveBeenCalledWith(
      expect.objectContaining({ bookingId: 'booking_1', clientId: 'client_1' }),
    )
    expect(mocks.stripeSessionsCreate).toHaveBeenCalledTimes(1)
    const sessionArgs = mocks.stripeSessionsCreate.mock.calls[0]?.[0]
    expect(sessionArgs.success_url).toContain('/client/rebook/token_1')
    expect(sessionArgs.success_url).toContain('checkout=success')
    expect(sessionArgs.payment_intent_data.transfer_data.destination).toBe(
      'acct_123',
    )
    expect(mocks.recordStripeCheckoutSessionAttached).toHaveBeenCalledTimes(1)
    expect(res).toMatchObject({
      ok: true,
      status: 200,
      stripeCheckout: { url: 'https://checkout.stripe.test/s' },
    })
  })

  it('surfaces a booking error from the prepare boundary', async () => {
    const bookingErr = { code: 'FORBIDDEN', message: 'no', userMessage: 'no' }
    mocks.prepareClientStripeCheckoutSession.mockRejectedValueOnce(bookingErr)
    mocks.isBookingError.mockReturnValue(true)

    const res = await POST(makeReq(), makeCtx())

    expect(res).toMatchObject({ ok: false, bookingErrorCode: 'FORBIDDEN' })
    expect(mocks.stripeSessionsCreate).not.toHaveBeenCalled()
  })
})
