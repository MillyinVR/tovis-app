// app/api/v1/client/rebook/[token]/checkout/manual/route.test.ts
//
// The public, token-authenticated off-platform checkout. This route exists
// because the public aftercare page used to offer Stripe or nothing at all: a
// pro who takes Venmo/Zelle/cash and has never connected Stripe left an
// unclaimed client with no way to pay.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BookingCheckoutStatus, PaymentMethod } from '@prisma/client'

const mocks = vi.hoisted(() => ({
  jsonOk: vi.fn((body: Record<string, unknown>, status = 200) => ({
    ok: true,
    status,
    ...body,
  })),
  jsonFail: vi.fn(
    (status: number, error: string, extra?: Record<string, unknown>) => ({
      ok: false,
      status,
      error,
      ...extra,
    }),
  ),
  pickString: vi.fn((value: unknown) =>
    typeof value === 'string' && value.trim() ? value.trim() : null,
  ),
  bookingErrorJsonFail: vi.fn(() => ({ ok: false, bookingError: true })),
  bookingJsonFail: vi.fn((code: string) => ({ ok: false, bookingErrorCode: code })),

  withRouteIdempotency: vi.fn(),
  resolveAftercareAccessTokenForMutation: vi.fn(),
  isBookingError: vi.fn(() => false),
  updateClientBookingCheckout: vi.fn(),

  bookingFindUnique: vi.fn(),
  paymentSettingsFindUnique: vi.fn(),

  kickNotificationDrain: vi.fn(),
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
  bookingErrorJsonFail: mocks.bookingErrorJsonFail,
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
  updateClientBookingCheckout: mocks.updateClientBookingCheckout,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    booking: { findUnique: mocks.bookingFindUnique },
    professionalPaymentSettings: {
      findUnique: mocks.paymentSettingsFindUnique,
    },
  },
}))

vi.mock('@/lib/idempotency', () => ({
  IDEMPOTENCY_ROUTES: {
    PUBLIC_AFTERCARE_CHECKOUT_MANUAL:
      'POST /api/v1/client/rebook/[token]/checkout/manual',
  },
}))

vi.mock('@/lib/notifications/delivery/kickNotificationDrain', () => ({
  kickNotificationDrain: mocks.kickNotificationDrain,
}))

vi.mock('@/lib/observability/bookingEvents', () => ({
  captureBookingException: mocks.captureBookingException,
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

function makeRequest(body: Record<string, unknown>) {
  return new Request('http://localhost/api', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function paymentSettings(overrides?: Record<string, unknown>) {
  return {
    acceptCash: true,
    acceptCardOnFile: true,
    acceptTapToPay: true,
    acceptVenmo: true,
    acceptZelle: true,
    acceptAppleCash: true,
    acceptPaypal: true,
    acceptApplePay: true,
    acceptStripeCard: true,
    tipsEnabled: true,
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()

  mocks.enforceRateLimit.mockResolvedValue({ allowed: true })
  mocks.resolveAftercareAccessTokenForMutation.mockResolvedValue({
    token: { id: 'tok_1' },
    booking: { id: 'booking_1', clientId: 'client_1' },
    idempotencyActorKey: 'actor_1',
  })
  mocks.bookingFindUnique.mockResolvedValue({
    professionalId: 'pro_1',
    selectedPaymentMethod: null,
  })
  mocks.paymentSettingsFindUnique.mockResolvedValue(paymentSettings())
  mocks.updateClientBookingCheckout.mockResolvedValue({
    booking: {
      id: 'booking_1',
      checkoutStatus: BookingCheckoutStatus.AWAITING_CONFIRMATION,
      selectedPaymentMethod: PaymentMethod.VENMO,
      tipAmount: null,
      totalAmount: null,
      paymentAuthorizedAt: null,
      paymentCollectedAt: null,
    },
  })

  // Run the wrapped work and hand back its result, as the real wrapper does on
  // the happy path.
  mocks.withRouteIdempotency.mockImplementation(
    async (_opts: unknown, run: (ctx: unknown) => Promise<unknown>) =>
      run({ idempotencyKey: 'idem_1' }),
  )
})

describe('POST /api/v1/client/rebook/[token]/checkout/manual', () => {
  it('confirms an off-platform payment into AWAITING_CONFIRMATION', async () => {
    await POST(
      makeRequest({ selectedPaymentMethod: 'venmo', confirmPayment: true }),
      makeCtx(),
    )

    expect(mocks.updateClientBookingCheckout).toHaveBeenCalledWith(
      expect.objectContaining({
        bookingId: 'booking_1',
        clientId: 'client_1',
        selectedPaymentMethod: PaymentMethod.VENMO,
        checkoutStatus: BookingCheckoutStatus.AWAITING_CONFIRMATION,
        markPaymentAuthorized: true,
        // Held: only the pro can confirm the money actually arrived.
        markPaymentCollected: false,
      }),
    )
  })

  it('saves a tip without confirming payment', async () => {
    await POST(
      makeRequest({ tipAmount: '10.00', confirmPayment: false }),
      makeCtx(),
    )

    expect(mocks.updateClientBookingCheckout).toHaveBeenCalledWith(
      expect.objectContaining({
        tipAmount: '10.00',
        checkoutStatus: undefined,
        markPaymentAuthorized: false,
        markPaymentCollected: false,
      }),
    )
  })

  // Card must go through hosted Stripe checkout (the sibling route) — this route
  // can never mark a card payment collected.
  it('refuses to confirm STRIPE_CARD here', async () => {
    const res = await POST(
      makeRequest({ selectedPaymentMethod: 'stripe_card', confirmPayment: true }),
      makeCtx(),
    )

    expect(res).toMatchObject({ status: 400, code: 'STRIPE_CHECKOUT_REQUIRED' })
    expect(mocks.updateClientBookingCheckout).not.toHaveBeenCalled()
  })

  it.each(['card_on_file', 'tap_to_pay', 'apple_pay'])(
    'refuses the pro-run rail %s',
    async (method) => {
      const res = await POST(
        makeRequest({ selectedPaymentMethod: method, confirmPayment: true }),
        makeCtx(),
      )

      expect(res).toMatchObject({ status: 400 })
      expect(mocks.updateClientBookingCheckout).not.toHaveBeenCalled()
    },
  )

  it('refuses a method the pro does not accept', async () => {
    mocks.paymentSettingsFindUnique.mockResolvedValueOnce(
      paymentSettings({ acceptVenmo: false }),
    )

    const res = await POST(
      makeRequest({ selectedPaymentMethod: 'venmo', confirmPayment: true }),
      makeCtx(),
    )

    expect(res).toMatchObject({ status: 400 })
    expect(mocks.updateClientBookingCheckout).not.toHaveBeenCalled()
  })

  // A refusal must not open the idempotency wrapper: that wrapper records
  // whatever it runs as the key's committed result, so a validation failure
  // inside it would be replayed forever on a retryable mistake.
  it('rejects before starting idempotency', async () => {
    await POST(
      makeRequest({ selectedPaymentMethod: 'bitcoin', confirmPayment: true }),
      makeCtx(),
    )

    expect(mocks.withRouteIdempotency).not.toHaveBeenCalled()
    expect(mocks.updateClientBookingCheckout).not.toHaveBeenCalled()
  })

  it('refuses a tip when the pro has tips disabled', async () => {
    mocks.paymentSettingsFindUnique.mockResolvedValueOnce(
      paymentSettings({ tipsEnabled: false }),
    )

    const res = await POST(
      makeRequest({ tipAmount: '5.00', confirmPayment: false }),
      makeCtx(),
    )

    expect(res).toMatchObject({ status: 400 })
    expect(mocks.updateClientBookingCheckout).not.toHaveBeenCalled()
  })

  it('honours the rate limiter', async () => {
    mocks.enforceRateLimit.mockResolvedValueOnce({ allowed: false })

    const res = await POST(
      makeRequest({ selectedPaymentMethod: 'cash', confirmPayment: true }),
      makeCtx(),
    )

    expect(res).toMatchObject({ status: 429 })
    expect(mocks.updateClientBookingCheckout).not.toHaveBeenCalled()
  })

  it('refuses a confirm with no method chosen anywhere', async () => {
    const res = await POST(makeRequest({ confirmPayment: true }), makeCtx())

    expect(res).toMatchObject({ status: 400 })
    expect(mocks.updateClientBookingCheckout).not.toHaveBeenCalled()
  })
})
