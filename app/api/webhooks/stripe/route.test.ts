// app/api/webhooks/stripe/route.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  Prisma,
  StripeAccountStatus,
  StripeCheckoutSessionStatus,
} from '@prisma/client'

const mocks = vi.hoisted(() => ({
  jsonOk: vi.fn(),
  jsonFail: vi.fn(),

  getStripe: vi.fn(),
  getStripeWebhookSecret: vi.fn(),
  constructEvent: vi.fn(),

  prismaTransaction: vi.fn(),

  stripeWebhookEventCreate: vi.fn(),
  stripeWebhookEventFindUnique: vi.fn(),
  stripeWebhookEventUpdate: vi.fn(),

  professionalPaymentSettingsFindUnique: vi.fn(),
  professionalPaymentSettingsUpdate: vi.fn(),

  applyStripePaymentSucceededInTransaction: vi.fn(),
  applyStripePaymentFailedInTransaction: vi.fn(),
  applyStripeCheckoutSessionStatusInTransaction: vi.fn(),
  applyStripeDepositSucceededInTransaction: vi.fn(),
  reconcileDepositChargeRefundInTransaction: vi.fn(),
  reconcileChargeRefundInTransaction: vi.fn(),

  applyLateCaptureCancelRefund: vi.fn(),

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
    professionalPaymentSettings: {
      findUnique: mocks.professionalPaymentSettingsFindUnique,
      update: mocks.professionalPaymentSettingsUpdate,
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
  reconcileDepositChargeRefundInTransaction:
    mocks.reconcileDepositChargeRefundInTransaction,
  DISCOVERY_DEPOSIT_CHECKOUT_KIND: 'DISCOVERY_DEPOSIT',
}))

// Keep the REAL mapStripeRefundToReconcileInput (pure mapper handleChargeRefunded
// uses to build the reconcile input); only the reconcile transaction is stubbed.
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

vi.mock('@/lib/security/logging', () => ({
  safeError: mocks.safeError,
}))

import { POST } from './route'

type MockTransactionClient = {
  stripeWebhookEvent: {
    update: typeof mocks.stripeWebhookEventUpdate
  }
  professionalPaymentSettings: {
    findUnique: typeof mocks.professionalPaymentSettingsFindUnique
    update: typeof mocks.professionalPaymentSettingsUpdate
  }
}

function makeMockTx(): MockTransactionClient {
  return {
    stripeWebhookEvent: {
      update: mocks.stripeWebhookEventUpdate,
    },
    professionalPaymentSettings: {
      findUnique: mocks.professionalPaymentSettingsFindUnique,
      update: mocks.professionalPaymentSettingsUpdate,
    },
  }
}

function makeJsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function makeWebhookRequest(args?: {
  body?: string
  signature?: string | null
}): Request {
  const headers = new Headers()

  if (args?.signature !== null) {
    headers.set('stripe-signature', args?.signature ?? 'stripe_signature_1')
  }

  return new Request('http://localhost/api/webhooks/stripe', {
    method: 'POST',
    headers,
    body: args?.body ?? '{"id":"evt_test_1"}',
  })
}

function makeStripeEvent(args?: {
  id?: string
  type?: string
  object?: Record<string, unknown>
  livemode?: boolean
}) {
  return {
    id: args?.id ?? 'evt_test_1',
    object: 'event',
    api_version: '2026-04-22.dahlia',
    created: 1_800_000_000,
    livemode: args?.livemode ?? false,
    pending_webhooks: 1,
    request: { id: null, idempotency_key: null },
    type: args?.type ?? 'payment_intent.succeeded',
    data: { object: args?.object ?? makePaymentIntent() },
  }
}

function makePaymentIntent(args?: {
  id?: string
  amount?: number
  amountReceived?: number
  currency?: string
  bookingId?: string
}) {
  return {
    id: args?.id ?? 'pi_test_123',
    object: 'payment_intent',
    amount: args?.amount ?? 13500,
    amount_received: args?.amountReceived ?? 13500,
    currency: args?.currency ?? 'usd',
    metadata: {
      bookingId: args?.bookingId ?? 'booking_1',
      clientId: 'client_1',
      professionalId: 'pro_1',
    },
  }
}

function makeCheckoutSession(args?: {
  id?: string
  bookingId?: string
  paymentIntentId?: string | null
  amountSubtotal?: number
  amountTotal?: number
  currency?: string | null
}) {
  return {
    id: args?.id ?? 'cs_test_123',
    object: 'checkout.session',
    client_reference_id: args?.bookingId ?? 'booking_1',
    payment_intent:
      args && 'paymentIntentId' in args ? args.paymentIntentId : 'pi_test_123',
    amount_subtotal: args?.amountSubtotal ?? 13500,
    amount_total: args?.amountTotal ?? 13500,
    currency: args && 'currency' in args ? args.currency : 'usd',
    metadata: {
      bookingId: args?.bookingId ?? 'booking_1',
      clientId: 'client_1',
      professionalId: 'pro_1',
    },
  }
}

function makeStripeAccount(args?: {
  id?: string
  chargesEnabled?: boolean
  payoutsEnabled?: boolean
  detailsSubmitted?: boolean
  currentlyDue?: string[]
  eventuallyDue?: string[]
  disabledReason?: string | null
}) {
  return {
    id: args?.id ?? 'acct_test_123',
    object: 'account',
    charges_enabled: args?.chargesEnabled ?? true,
    payouts_enabled: args?.payoutsEnabled ?? true,
    details_submitted: args?.detailsSubmitted ?? true,
    requirements: {
      currently_due: args?.currentlyDue ?? [],
      eventually_due: args?.eventuallyDue ?? [],
      disabled_reason:
        args && 'disabledReason' in args ? args.disabledReason : null,
    },
  }
}

describe('POST /api/webhooks/stripe', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mocks.jsonOk.mockImplementation((body: unknown, status = 200) =>
      makeJsonResponse(body, status),
    )

    mocks.jsonFail.mockImplementation(
      (status: number, message: string, extra?: Record<string, unknown>) =>
        makeJsonResponse({ error: message, ...(extra ?? {}) }, status),
    )

    mocks.getStripeWebhookSecret.mockReturnValue('whsec_test_123')
    mocks.getStripe.mockReturnValue({
      webhooks: { constructEvent: mocks.constructEvent },
    })

    mocks.constructEvent.mockReturnValue(
      makeStripeEvent({
        id: 'evt_test_1',
        type: 'payment_intent.succeeded',
        object: makePaymentIntent(),
      }),
    )

    mocks.stripeWebhookEventCreate.mockResolvedValue({
      id: 'webhook_event_1',
      processedAt: null,
    })

    mocks.stripeWebhookEventFindUnique.mockResolvedValue({
      id: 'webhook_event_1',
      processedAt: null,
    })

    mocks.stripeWebhookEventUpdate.mockResolvedValue({
      id: 'webhook_event_1',
    })

    mocks.professionalPaymentSettingsFindUnique.mockResolvedValue({
      professionalId: 'pro_1',
      stripeOnboardingCompletedAt: null,
    })

    mocks.professionalPaymentSettingsUpdate.mockResolvedValue({
      professionalId: 'pro_1',
    })

    mocks.applyStripePaymentSucceededInTransaction.mockResolvedValue({
      bookingId: 'booking_1',
      bookingCompleted: false,
      meta: { mutated: true, noOp: false },
    })

    mocks.applyStripePaymentFailedInTransaction.mockResolvedValue({
      bookingId: 'booking_1',
      bookingCompleted: false,
      meta: { mutated: true, noOp: false },
    })

    mocks.applyStripeCheckoutSessionStatusInTransaction.mockResolvedValue({
      bookingId: 'booking_1',
      bookingCompleted: false,
      meta: { mutated: true, noOp: false },
    })

    mocks.applyStripeDepositSucceededInTransaction.mockResolvedValue({
      handled: true,
      alreadyPaid: false,
    })

    mocks.reconcileDepositChargeRefundInTransaction.mockResolvedValue({
      handled: false,
    })

    mocks.reconcileChargeRefundInTransaction.mockResolvedValue({ handled: true })

    mocks.prismaTransaction.mockImplementation(
      async (
        callback: (tx: MockTransactionClient) => Promise<unknown>,
        _options?: unknown,
      ) => callback(makeMockTx()),
    )
  })

  it('rejects requests without a Stripe signature', async () => {
    const response = await POST(makeWebhookRequest({ signature: null }))

    expect(response.status).toBe(400)
    expect(mocks.constructEvent).not.toHaveBeenCalled()
    expect(mocks.stripeWebhookEventCreate).not.toHaveBeenCalled()
    expect(mocks.prismaTransaction).not.toHaveBeenCalled()
  })

  it('rejects invalid Stripe signatures and logs safely', async () => {
    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined)

    const thrown = new Error('bad signature')
    mocks.constructEvent.mockImplementationOnce(() => {
      throw thrown
    })

    const response = await POST(makeWebhookRequest())

    expect(mocks.safeError).toHaveBeenCalledWith(thrown)
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'POST /api/webhooks/stripe signature verification failed',
      {
        error: {
          name: 'Error',
          message: 'bad signature',
        },
      },
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: 'Invalid Stripe webhook signature.',
      code: 'STRIPE_SIGNATURE_INVALID',
    })

    expect(mocks.stripeWebhookEventCreate).not.toHaveBeenCalled()
    expect(mocks.prismaTransaction).not.toHaveBeenCalled()

    consoleErrorSpy.mockRestore()
  })

  it('returns success for duplicate already-processed events without reprocessing', async () => {
    mocks.stripeWebhookEventCreate.mockResolvedValueOnce({
      id: 'webhook_event_1',
      processedAt: new Date('2026-05-05T10:00:00.000Z'),
    })

    const response = await POST(makeWebhookRequest())

    expect(response.status).toBe(200)
    expect(mocks.prismaTransaction).not.toHaveBeenCalled()
    expect(mocks.applyStripePaymentSucceededInTransaction).not.toHaveBeenCalled()
    expect(mocks.applyStripePaymentFailedInTransaction).not.toHaveBeenCalled()
    expect(
      mocks.applyStripeCheckoutSessionStatusInTransaction,
    ).not.toHaveBeenCalled()
  })

  it('falls back to findUnique on duplicate Stripe event insert and skips when already processed', async () => {
    mocks.stripeWebhookEventCreate.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: 'test',
        meta: { target: ['stripeEventId'] },
      }),
    )

    mocks.stripeWebhookEventFindUnique.mockResolvedValueOnce({
      id: 'webhook_event_1',
      processedAt: new Date('2026-05-05T10:00:00.000Z'),
    })

    const response = await POST(makeWebhookRequest())

    expect(response.status).toBe(200)
    expect(mocks.stripeWebhookEventFindUnique).toHaveBeenCalledWith({
      where: { stripeEventId: 'evt_test_1' },
      select: {
        id: true,
        processedAt: true,
      },
    })
    expect(mocks.prismaTransaction).not.toHaveBeenCalled()
  })

  it('stores unhandled events and marks them processed inside the transaction', async () => {
    mocks.constructEvent.mockReturnValueOnce(
      makeStripeEvent({
        id: 'evt_unhandled_1',
        type: 'customer.created',
        object: { id: 'cus_test_123', object: 'customer' },
      }),
    )

    const response = await POST(makeWebhookRequest())

    expect(mocks.prismaTransaction).toHaveBeenCalledTimes(1)
    expect(mocks.stripeWebhookEventUpdate).toHaveBeenCalledWith({
      where: { stripeEventId: 'evt_unhandled_1' },
      data: {
        processedAt: expect.any(Date),
        failedAt: null,
        lastError: null,
      },
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      ok: true,
      stripeEventId: 'evt_unhandled_1',
      eventType: 'customer.created',
      handled: false,
      message: 'Unhandled Stripe event type: customer.created',
    })
  })

  it('processes payment_intent.succeeded and processed marker inside one transaction', async () => {
    const response = await POST(makeWebhookRequest())

    expect(mocks.prismaTransaction).toHaveBeenCalledTimes(1)

    expect(mocks.applyStripePaymentSucceededInTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        stripeWebhookEvent: expect.any(Object),
        professionalPaymentSettings: expect.any(Object),
      }),
      expect.objectContaining({
        stripeEventId: 'evt_test_1',
        stripePaymentIntentId: 'pi_test_123',
      }),
    )

    expect(mocks.stripeWebhookEventUpdate).toHaveBeenCalledWith({
      where: { stripeEventId: 'evt_test_1' },
      data: {
        processedAt: expect.any(Date),
        failedAt: null,
        lastError: null,
      },
    })

    expect(response.status).toBe(200)
  })

  it('routes checkout.session.completed through applyStripeCheckoutSessionStatusInTransaction', async () => {
    mocks.constructEvent.mockReturnValueOnce(
      makeStripeEvent({
        id: 'evt_checkout_completed_1',
        type: 'checkout.session.completed',
        object: makeCheckoutSession(),
      }),
    )

    const response = await POST(makeWebhookRequest())

    expect(
      mocks.applyStripeCheckoutSessionStatusInTransaction,
    ).toHaveBeenCalledWith(expect.any(Object), {
      bookingIdHint: 'booking_1',
      stripeCheckoutSessionId: 'cs_test_123',
      stripePaymentIntentId: 'pi_test_123',
      stripeAmountSubtotal: 13500,
      stripeAmountTotal: 13500,
      stripeCurrency: 'usd',
      status: StripeCheckoutSessionStatus.COMPLETE,
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      ok: true,
      stripeEventId: 'evt_checkout_completed_1',
      eventType: 'checkout.session.completed',
      handled: true,
      message: 'checkout.session.completed synced.',
    })
  })

  it('routes checkout.session.expired through applyStripeCheckoutSessionStatusInTransaction', async () => {
    mocks.constructEvent.mockReturnValueOnce(
      makeStripeEvent({
        id: 'evt_checkout_expired_1',
        type: 'checkout.session.expired',
        object: makeCheckoutSession({ paymentIntentId: null, currency: 'usd' }),
      }),
    )

    const response = await POST(makeWebhookRequest())

    expect(
      mocks.applyStripeCheckoutSessionStatusInTransaction,
    ).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        status: StripeCheckoutSessionStatus.EXPIRED,
        stripePaymentIntentId: null,
      }),
    )

    expect(response.status).toBe(200)
  })

  it('routes payment_intent.succeeded through applyStripePaymentSucceededInTransaction with the event id', async () => {
    mocks.constructEvent.mockReturnValueOnce(
      makeStripeEvent({
        id: 'evt_payment_succeeded_1',
        type: 'payment_intent.succeeded',
        object: makePaymentIntent({
          id: 'pi_success_123',
          amount: 13500,
          amountReceived: 13500,
          currency: 'usd',
          bookingId: 'booking_1',
        }),
      }),
    )

    const response = await POST(makeWebhookRequest())

    expect(mocks.applyStripePaymentSucceededInTransaction).toHaveBeenCalledWith(
      expect.any(Object),
      {
        bookingIdHint: 'booking_1',
        stripePaymentIntentId: 'pi_success_123',
        stripeEventId: 'evt_payment_succeeded_1',
        amountReceivedCents: 13500,
        currency: 'usd',
      },
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      ok: true,
      stripeEventId: 'evt_payment_succeeded_1',
      eventType: 'payment_intent.succeeded',
      handled: true,
      message: 'payment_intent.succeeded marked booking paid.',
    })
  })

  // M1: money that applied onto an already-CANCELLED booking settles by the
  // cancel's refund policy AFTER the webhook transaction commits.
  it('runs the late-capture cancel refund post-commit when the payment landed on a cancelled booking', async () => {
    mocks.applyStripePaymentSucceededInTransaction.mockResolvedValueOnce({
      bookingId: 'booking_1',
      bookingCompleted: false,
      meta: { mutated: true, noOp: false },
      capturedOnCancelledBooking: true,
    })

    const response = await POST(makeWebhookRequest())

    expect(response.status).toBe(200)
    expect(mocks.applyLateCaptureCancelRefund).toHaveBeenCalledExactlyOnceWith({
      bookingId: 'booking_1',
      flavor: 'SERVICE',
    })
  })

  it('does not run the late-capture refund for a payment on a live booking', async () => {
    const response = await POST(makeWebhookRequest())

    expect(response.status).toBe(200)
    expect(mocks.applyLateCaptureCancelRefund).not.toHaveBeenCalled()
  })

  it('reports the completed-booking variant when applyStripePaymentSucceededInTransaction auto-completes the booking', async () => {
    mocks.applyStripePaymentSucceededInTransaction.mockResolvedValueOnce({
      bookingId: 'booking_1',
      bookingCompleted: true,
      meta: { mutated: true, noOp: false },
    })

    const response = await POST(makeWebhookRequest())

    await expect(response.json()).resolves.toEqual({
      ok: true,
      stripeEventId: 'evt_test_1',
      eventType: 'payment_intent.succeeded',
      handled: true,
      message: 'payment_intent.succeeded marked booking paid and completed.',
    })
  })

  it('returns handled=false when applyStripePaymentSucceededInTransaction cannot find the booking', async () => {
    mocks.applyStripePaymentSucceededInTransaction.mockResolvedValueOnce(null)

    const response = await POST(makeWebhookRequest())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      ok: true,
      stripeEventId: 'evt_test_1',
      eventType: 'payment_intent.succeeded',
      handled: false,
      message: 'payment_intent.succeeded booking not found.',
    })
  })

  it('routes payment_intent.payment_failed through applyStripePaymentFailedInTransaction', async () => {
    mocks.constructEvent.mockReturnValueOnce(
      makeStripeEvent({
        id: 'evt_payment_failed_1',
        type: 'payment_intent.payment_failed',
        object: makePaymentIntent({
          id: 'pi_failed_123',
          amount: 13500,
          amountReceived: 0,
          currency: 'usd',
          bookingId: 'booking_1',
        }),
      }),
    )

    const response = await POST(makeWebhookRequest())

    expect(mocks.applyStripePaymentFailedInTransaction).toHaveBeenCalledWith(
      expect.any(Object),
      {
        bookingIdHint: 'booking_1',
        stripePaymentIntentId: 'pi_failed_123',
        stripeEventId: 'evt_payment_failed_1',
      },
    )
    expect(mocks.applyStripePaymentSucceededInTransaction).not.toHaveBeenCalled()

    expect(response.status).toBe(200)
  })

  it('syncs account.updated and enables Stripe card only when charges and payouts are enabled', async () => {
    mocks.constructEvent.mockReturnValueOnce(
      makeStripeEvent({
        id: 'evt_account_updated_1',
        type: 'account.updated',
        object: makeStripeAccount({
          id: 'acct_test_123',
          chargesEnabled: true,
          payoutsEnabled: true,
          detailsSubmitted: true,
        }),
      }),
    )

    const response = await POST(makeWebhookRequest())

    expect(mocks.professionalPaymentSettingsFindUnique).toHaveBeenCalledWith({
      where: { stripeAccountId: 'acct_test_123' },
      select: {
        professionalId: true,
        stripeOnboardingCompletedAt: true,
      },
    })

    expect(mocks.professionalPaymentSettingsUpdate).toHaveBeenCalledWith({
      where: { professionalId: 'pro_1' },
      data: expect.objectContaining({
        stripeAccountStatus: StripeAccountStatus.ENABLED,
        acceptStripeCard: true,
      }),
    })
    expect(response.status).toBe(200)
  })

  it('syncs restricted account.updated and disables Stripe card', async () => {
    mocks.constructEvent.mockReturnValueOnce(
      makeStripeEvent({
        id: 'evt_account_restricted_1',
        type: 'account.updated',
        object: makeStripeAccount({
          id: 'acct_test_123',
          chargesEnabled: false,
          payoutsEnabled: false,
          detailsSubmitted: true,
          currentlyDue: ['external_account'],
          disabledReason: 'requirements.past_due',
        }),
      }),
    )

    const response = await POST(makeWebhookRequest())

    expect(mocks.professionalPaymentSettingsUpdate).toHaveBeenCalledWith({
      where: { professionalId: 'pro_1' },
      data: expect.objectContaining({
        stripeAccountStatus: StripeAccountStatus.RESTRICTED,
        acceptStripeCard: false,
      }),
    })
    expect(response.status).toBe(200)
  })

  it('returns handled=false when account.updated payment settings are not found', async () => {
    mocks.constructEvent.mockReturnValueOnce(
      makeStripeEvent({
        id: 'evt_account_missing_settings_1',
        type: 'account.updated',
        object: makeStripeAccount({
          id: 'acct_missing_123',
        }),
      }),
    )

    mocks.professionalPaymentSettingsFindUnique.mockResolvedValueOnce(null)

    const response = await POST(makeWebhookRequest())

    expect(response.status).toBe(200)
    expect(mocks.professionalPaymentSettingsUpdate).not.toHaveBeenCalled()

    await expect(response.json()).resolves.toEqual({
      ok: true,
      stripeEventId: 'evt_account_missing_settings_1',
      eventType: 'account.updated',
      handled: false,
      message: 'account.updated payment settings not found.',
    })
  })

  it('marks webhook event failed and returns generic 500 when applyStripePaymentSucceededInTransaction throws', async () => {
    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined)

    const thrown = new Error('db boom')
    mocks.applyStripePaymentSucceededInTransaction.mockRejectedValueOnce(thrown)

    const response = await POST(makeWebhookRequest())

    expect(mocks.safeError).toHaveBeenCalledWith(thrown)
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'POST /api/webhooks/stripe processing error',
      {
        error: {
          name: 'Error',
          message: 'db boom',
        },
      },
    )

    expect(mocks.stripeWebhookEventUpdate).toHaveBeenCalledWith({
      where: { stripeEventId: 'evt_test_1' },
      data: {
        failedAt: expect.any(Date),
        lastError: 'db boom',
      },
    })

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({
      error: 'Failed to process Stripe webhook.',
      code: 'STRIPE_WEBHOOK_PROCESSING_FAILED',
    })

    consoleErrorSpy.mockRestore()
  })

  it('marks webhook event failed and returns generic 500 when processed marker update throws', async () => {
    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined)

    const thrown = new Error('processed marker failed')

    mocks.stripeWebhookEventUpdate.mockImplementationOnce(async (args) => {
      if ('processedAt' in args.data) {
        throw thrown
      }

      return { id: 'webhook_event_1' }
    })

    const response = await POST(makeWebhookRequest())

    expect(mocks.applyStripePaymentSucceededInTransaction).toHaveBeenCalledTimes(1)

    expect(mocks.safeError).toHaveBeenCalledWith(thrown)
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'POST /api/webhooks/stripe processing error',
      {
        error: {
          name: 'Error',
          message: 'processed marker failed',
        },
      },
    )

    expect(mocks.stripeWebhookEventUpdate).toHaveBeenLastCalledWith({
      where: { stripeEventId: 'evt_test_1' },
      data: {
        failedAt: expect.any(Date),
        lastError: 'processed marker failed',
      },
    })

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({
      error: 'Failed to process Stripe webhook.',
      code: 'STRIPE_WEBHOOK_PROCESSING_FAILED',
    })

    consoleErrorSpy.mockRestore()
  })
    it('logs safely when marking a failed webhook event also fails', async () => {
    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined)

    const processingError = new Error('payment sync failed')
    const markError = new Error('mark failed')

    mocks.applyStripePaymentSucceededInTransaction.mockRejectedValueOnce(
      processingError,
    )

    mocks.stripeWebhookEventUpdate.mockRejectedValueOnce(markError)

    const response = await POST(makeWebhookRequest())

    expect(mocks.safeError).toHaveBeenCalledWith(processingError)
    expect(mocks.safeError).toHaveBeenCalledWith(markError)

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'POST /api/webhooks/stripe failed to mark event failed',
      {
        stripeEventId: 'evt_test_1',
        error: {
          name: 'Error',
          message: 'mark failed',
        },
      },
    )

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({
      error: 'Failed to process Stripe webhook.',
      code: 'STRIPE_WEBHOOK_PROCESSING_FAILED',
    })

    consoleErrorSpy.mockRestore()
  })

  it('reconciles a charge.refunded event through the refund service', async () => {
    mocks.constructEvent.mockReturnValueOnce(
      makeStripeEvent({
        id: 'evt_charge_refunded_1',
        type: 'charge.refunded',
        object: {
          id: 'ch_test_1',
          object: 'charge',
          payment_intent: 'pi_test_123',
          amount: 10000,
          amount_refunded: 10000,
          refunds: {
            object: 'list',
            data: [{ id: 're_1', status: 'succeeded', amount: 10000 }],
          },
        },
      }),
    )

    const response = await POST(makeWebhookRequest())

    expect(mocks.reconcileChargeRefundInTransaction).toHaveBeenCalledWith(
      expect.anything(),
      {
        paymentIntentId: 'pi_test_123',
        amountRefundedCents: 10000,
        chargeAmountCents: 10000,
        refunds: [
          {
            id: 're_1',
            status: 'succeeded',
            amountCents: 10000,
            bookingRefundId: null,
          },
        ],
      },
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      ok: true,
      stripeEventId: 'evt_charge_refunded_1',
      eventType: 'charge.refunded',
      handled: true,
      message: 'charge.refunded reconciled.',
    })
  })

  it('returns handled=false when the charge.refunded booking is not found', async () => {
    mocks.reconcileChargeRefundInTransaction.mockResolvedValueOnce({
      handled: false,
    })

    mocks.constructEvent.mockReturnValueOnce(
      makeStripeEvent({
        id: 'evt_charge_refunded_2',
        type: 'charge.refunded',
        object: {
          id: 'ch_test_2',
          object: 'charge',
          payment_intent: 'pi_unknown',
          amount: 5000,
          amount_refunded: 5000,
          refunds: { object: 'list', data: [] },
        },
      }),
    )

    const response = await POST(makeWebhookRequest())
    const body = await response.json()

    expect(body.handled).toBe(false)
    expect(body.message).toBe('charge.refunded booking not found.')
  })

  it('does not call the refund service when charge.refunded has no payment_intent', async () => {
    mocks.constructEvent.mockReturnValueOnce(
      makeStripeEvent({
        id: 'evt_charge_refunded_3',
        type: 'charge.refunded',
        object: {
          id: 'ch_test_3',
          object: 'charge',
          payment_intent: null,
          amount: 5000,
          amount_refunded: 5000,
          refunds: { object: 'list', data: [] },
        },
      }),
    )

    const response = await POST(makeWebhookRequest())
    const body = await response.json()

    expect(mocks.reconcileChargeRefundInTransaction).not.toHaveBeenCalled()
    expect(body.handled).toBe(false)
    expect(body.message).toBe('charge.refunded missing payment_intent.')
  })
})