// app/api/webhooks/stripe/route.wire.test.ts
//
// M13 (payment-booking-integrity-audit-plan.md §19) — pin the webhook route's
// field extraction against VERBATIM Stripe wire shapes, not hand-built objects.
//
// route.test.ts builds its events with makeStripeEvent/makePaymentIntent/… — small
// objects carrying only the handful of fields the route reads. A hand-built mock
// proves nothing about the real wire ([[wire-shape-vs-mock-drift]]): if Stripe
// nests a field differently, or the route reads one that only exists on the full
// payload, the trimmed mock hides it. This suite loads the complete Stripe event
// envelopes vendored in ./__fixtures__ (see that dir's README), SIGNS each one's
// exact bytes with a test webhook secret, and drives them through the route's REAL
// getStripe().webhooks.constructEvent — so signature-verify + parse + dispatch all
// run for real. Only the write-boundary appliers (the DB effects) are mocked, so
// each assertion is "given the true wire shape, the route extracted THESE fields
// and routed to THIS applier".
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Stripe from 'stripe'
import { StripeCheckoutSessionStatus } from '@prisma/client'

const WEBHOOK_SECRET = 'whsec_wire_test_secret'

// A real Stripe client purely for its webhook crypto (constructEvent +
// generateTestHeaderString are offline HMAC — no network, no real key needed).
const realStripe = new Stripe('sk_test_wire_dummy', {
  apiVersion: '2026-04-22.dahlia',
})

const mocks = vi.hoisted(() => ({
  jsonOk: vi.fn(),
  jsonFail: vi.fn(),
  getStripe: vi.fn(),
  getStripeWebhookSecret: vi.fn(),
  prismaTransaction: vi.fn(),
  stripeWebhookEventCreate: vi.fn(),
  stripeWebhookEventFindUnique: vi.fn(),
  stripeWebhookEventUpdate: vi.fn(),
  applyStripePaymentSucceededInTransaction: vi.fn(),
  applyStripePaymentFailedInTransaction: vi.fn(),
  applyStripeCheckoutSessionStatusInTransaction: vi.fn(),
  applyStripeDepositSucceededInTransaction: vi.fn(),
  applyStripeDisputeInTransaction: vi.fn(),
  applyStripeDepositDisputeInTransaction: vi.fn(),
  applyStripeNoShowFeeDisputeInTransaction: vi.fn(),
  reconcileDepositChargeRefundInTransaction: vi.fn(),
  reconcileNoShowFeeChargeRefundInTransaction: vi.fn(),
  reconcileChargeRefundInTransaction: vi.fn(),
  applyLateCaptureCancelRefund: vi.fn(),
  captureStripeDisputeAlert: vi.fn(),
  captureManualCloseoutStripeOverCollection: vi.fn(),
  safeError: vi.fn((error: unknown) => ({
    name: error instanceof Error ? error.name : 'NonErrorThrown',
    message: error instanceof Error ? error.message : String(error),
  })),
}))

vi.mock('@/app/api/_utils', () => ({
  jsonOk: mocks.jsonOk,
  jsonFail: mocks.jsonFail,
}))

vi.mock('@/lib/stripe/server', () => ({
  getStripe: mocks.getStripe,
  getStripeWebhookSecret: mocks.getStripeWebhookSecret,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    $transaction: mocks.prismaTransaction,
    stripeWebhookEvent: {
      create: mocks.stripeWebhookEventCreate,
      findUnique: mocks.stripeWebhookEventFindUnique,
      update: mocks.stripeWebhookEventUpdate,
    },
  },
}))

vi.mock('@/lib/booking/writeBoundary', () => ({
  applyStripePaymentSucceededInTransaction:
    mocks.applyStripePaymentSucceededInTransaction,
  applyStripePaymentFailedInTransaction:
    mocks.applyStripePaymentFailedInTransaction,
  applyStripeCheckoutSessionStatusInTransaction:
    mocks.applyStripeCheckoutSessionStatusInTransaction,
  applyStripeDepositSucceededInTransaction:
    mocks.applyStripeDepositSucceededInTransaction,
  applyStripeDisputeInTransaction: mocks.applyStripeDisputeInTransaction,
  applyStripeDepositDisputeInTransaction:
    mocks.applyStripeDepositDisputeInTransaction,
  applyStripeNoShowFeeDisputeInTransaction:
    mocks.applyStripeNoShowFeeDisputeInTransaction,
  reconcileDepositChargeRefundInTransaction:
    mocks.reconcileDepositChargeRefundInTransaction,
  reconcileNoShowFeeChargeRefundInTransaction:
    mocks.reconcileNoShowFeeChargeRefundInTransaction,
  DISCOVERY_DEPOSIT_CHECKOUT_KIND: 'DISCOVERY_DEPOSIT',
  NO_SHOW_FEE_CHARGE_KIND: 'NO_SHOW_FEE',
}))

// Keep the REAL mapStripeRefundToReconcileInput — the pure mapper that turns a
// verbatim Stripe.Refund into the reconcile input. Pinning it against the wire is
// the whole point of the charge.refunded case (it extracts metadata.bookingRefundId).
vi.mock('@/lib/booking/refunds', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/booking/refunds')>()
  return {
    mapStripeRefundToReconcileInput: actual.mapStripeRefundToReconcileInput,
    reconcileChargeRefundInTransaction: mocks.reconcileChargeRefundInTransaction,
  }
})

vi.mock('@/lib/booking/cancelRefund', () => ({
  applyLateCaptureCancelRefund: mocks.applyLateCaptureCancelRefund,
}))

// Keep every other observability export real; only stub the two the route/handler
// invoke on the tested paths so a dispute alert is assertable and never pages.
vi.mock('@/lib/observability/bookingEvents', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/lib/observability/bookingEvents')>()
  return {
    ...actual,
    captureStripeDisputeAlert: mocks.captureStripeDisputeAlert,
    captureManualCloseoutStripeOverCollection:
      mocks.captureManualCloseoutStripeOverCollection,
  }
})

vi.mock('@/lib/security/logging', () => ({
  safeError: mocks.safeError,
}))

import { POST } from './route'

const FIXTURE_DIR = join(
  process.cwd(),
  'app/api/webhooks/stripe/__fixtures__',
)

/** The exact bytes of a vendored fixture — signed AND sent verbatim. */
function loadFixtureBody(name: string): string {
  return readFileSync(join(FIXTURE_DIR, name), 'utf8')
}

/** Drive the route with a fixture body under a REAL Stripe signature. */
async function postFixture(name: string): Promise<Response> {
  const body = loadFixtureBody(name)
  const signature = realStripe.webhooks.generateTestHeaderString({
    payload: body,
    secret: WEBHOOK_SECRET,
  })
  const headers = new Headers({ 'stripe-signature': signature })
  return POST(
    new Request('http://localhost/api/webhooks/stripe', {
      method: 'POST',
      headers,
      body,
    }),
  )
}

type MockTx = {
  stripeWebhookEvent: { update: typeof mocks.stripeWebhookEventUpdate }
}

function makeJsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

beforeEach(() => {
  vi.clearAllMocks()

  mocks.jsonOk.mockImplementation((body: unknown, status = 200) =>
    makeJsonResponse(body, status),
  )
  mocks.jsonFail.mockImplementation(
    (status: number, message: string, extra?: Record<string, unknown>) =>
      makeJsonResponse({ error: message, ...(extra ?? {}) }, status),
  )

  mocks.getStripe.mockReturnValue({ webhooks: realStripe.webhooks })
  mocks.getStripeWebhookSecret.mockReturnValue(WEBHOOK_SECRET)

  mocks.stripeWebhookEventCreate.mockResolvedValue({
    id: 'webhook_event_1',
    processedAt: null,
  })
  mocks.stripeWebhookEventFindUnique.mockResolvedValue({
    id: 'webhook_event_1',
    processedAt: null,
  })
  mocks.stripeWebhookEventUpdate.mockResolvedValue({ id: 'webhook_event_1' })

  mocks.applyStripePaymentSucceededInTransaction.mockResolvedValue({
    bookingId: 'booking_wire_1',
    bookingCompleted: false,
    meta: { mutated: true, noOp: false },
  })
  mocks.applyStripeCheckoutSessionStatusInTransaction.mockResolvedValue({
    bookingId: 'booking_wire_1',
    bookingCompleted: false,
    meta: { mutated: true, noOp: false },
  })
  mocks.applyStripeDisputeInTransaction.mockResolvedValue({
    bookingId: 'booking_wire_1',
    bookingCompleted: false,
    meta: { mutated: true },
  })
  mocks.applyStripeDepositDisputeInTransaction.mockResolvedValue(null)
  mocks.applyStripeNoShowFeeDisputeInTransaction.mockResolvedValue(null)
  // charge.refunded tries the deposit + fee reconcilers first (disjoint PIs), then
  // the final-bill one. Default both misses so the service PI reaches the last.
  mocks.reconcileDepositChargeRefundInTransaction.mockResolvedValue({
    handled: false,
  })
  mocks.reconcileNoShowFeeChargeRefundInTransaction.mockResolvedValue({
    handled: false,
  })
  mocks.reconcileChargeRefundInTransaction.mockResolvedValue({ handled: true })

  mocks.prismaTransaction.mockImplementation(
    async (callback: (tx: MockTx) => Promise<unknown>) =>
      callback({
        stripeWebhookEvent: { update: mocks.stripeWebhookEventUpdate },
      }),
  )
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('POST /api/webhooks/stripe — verbatim wire shapes', () => {
  it('accepts a real signature over the verbatim payload (parse path runs for real)', async () => {
    const response = await postFixture('payment_intent.succeeded.json')
    // A wrong secret or a drifted payload would 400 at constructEvent — a 200 here
    // proves the real signature-verify + parse ran against the exact bytes.
    expect(response.status).toBe(200)
  })

  it('extracts payment_intent.succeeded fields from the full PaymentIntent shape', async () => {
    await postFixture('payment_intent.succeeded.json')

    expect(mocks.applyStripePaymentSucceededInTransaction).toHaveBeenCalledWith(
      expect.any(Object),
      {
        bookingIdHint: 'booking_wire_1',
        stripePaymentIntentId: 'pi_wire_service_1',
        stripeEventId: 'evt_1PwireSucceeded00000000000',
        amountReceivedCents: 13500,
        currency: 'usd',
      },
    )
  })

  it('extracts charge.refunded fields — incl. metadata.bookingRefundId — from the full Charge/Refund shape', async () => {
    await postFixture('charge.refunded.json')

    expect(mocks.reconcileChargeRefundInTransaction).toHaveBeenCalledWith(
      expect.anything(),
      {
        paymentIntentId: 'pi_wire_service_1',
        amountRefundedCents: 13500,
        chargeAmountCents: 13500,
        refunds: [
          {
            id: 're_wire_service_1',
            status: 'succeeded',
            amountCents: 13500,
            bookingRefundId: 'bref_wire_1',
          },
        ],
      },
    )
  })

  it('extracts charge.dispute.created → OPEN with the disputed PI, and alerts SERVICE', async () => {
    await postFixture('charge.dispute.created.json')

    expect(mocks.applyStripeDisputeInTransaction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        stripePaymentIntentId: 'pi_wire_service_1',
        stripeEventId: 'evt_1PwireDisputeCreated0000000',
        outcome: 'OPEN',
      }),
    )
    expect(mocks.captureStripeDisputeAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: 'OPEN',
        flavor: 'SERVICE',
        bookingId: 'booking_wire_1',
      }),
    )
  })

  it('extracts charge.dispute.closed (won) → WON and does NOT alert', async () => {
    await postFixture('charge.dispute.closed.won.json')

    expect(mocks.applyStripeDisputeInTransaction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        stripePaymentIntentId: 'pi_wire_service_1',
        outcome: 'WON',
      }),
    )
    expect(mocks.captureStripeDisputeAlert).not.toHaveBeenCalled()
  })

  it('extracts checkout.session.completed fields from the full Session shape', async () => {
    await postFixture('checkout.session.completed.json')

    expect(
      mocks.applyStripeCheckoutSessionStatusInTransaction,
    ).toHaveBeenCalledWith(expect.any(Object), {
      bookingIdHint: 'booking_wire_1',
      stripeCheckoutSessionId: 'cs_test_wire_completed_1',
      stripePaymentIntentId: 'pi_wire_service_1',
      stripeAmountSubtotal: 13500,
      stripeAmountTotal: 13500,
      stripeCurrency: 'usd',
      status: StripeCheckoutSessionStatus.COMPLETE,
    })
  })

  it('extracts checkout.session.expired (no payment_intent) from the full Session shape', async () => {
    await postFixture('checkout.session.expired.json')

    expect(
      mocks.applyStripeCheckoutSessionStatusInTransaction,
    ).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        bookingIdHint: 'booking_wire_2',
        stripeCheckoutSessionId: 'cs_test_wire_expired_1',
        stripePaymentIntentId: null,
        status: StripeCheckoutSessionStatus.EXPIRED,
      }),
    )
  })

  it('rejects a payload whose bytes were tampered after signing (signature no longer matches)', async () => {
    const body = loadFixtureBody('payment_intent.succeeded.json')
    const signature = realStripe.webhooks.generateTestHeaderString({
      payload: body,
      secret: WEBHOOK_SECRET,
    })
    // Flip one byte of the amount AFTER signing — constructEvent must reject it.
    const tampered = body.replace('"amount_received": 13500', '"amount_received": 99999')
    const response = await POST(
      new Request('http://localhost/api/webhooks/stripe', {
        method: 'POST',
        headers: new Headers({ 'stripe-signature': signature }),
        body: tampered,
      }),
    )

    expect(response.status).toBe(400)
    expect(mocks.applyStripePaymentSucceededInTransaction).not.toHaveBeenCalled()
  })
})
