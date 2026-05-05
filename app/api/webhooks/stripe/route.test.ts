// app/api/webhooks/stripe/route.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  BookingCheckoutStatus,
  PaymentMethod,
  PaymentProvider,
  StripeAccountStatus,
  StripePaymentStatus,
} from '@prisma/client'

const mocks = vi.hoisted(() => ({
  jsonOk: vi.fn(),
  jsonFail: vi.fn(),

  getStripe: vi.fn(),
  getStripeWebhookSecret: vi.fn(),
  constructEvent: vi.fn(),

  stripeWebhookEventCreate: vi.fn(),
  stripeWebhookEventFindUnique: vi.fn(),
  stripeWebhookEventUpdate: vi.fn(),

  bookingFindUnique: vi.fn(),
  bookingFindFirst: vi.fn(),
  bookingUpdate: vi.fn(),

  bookingCloseoutAuditLogCreate: vi.fn(),

  professionalPaymentSettingsFindUnique: vi.fn(),
  professionalPaymentSettingsUpdate: vi.fn(),

  prismaTransaction: vi.fn(),
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
    stripeWebhookEvent: {
      create: mocks.stripeWebhookEventCreate,
      findUnique: mocks.stripeWebhookEventFindUnique,
      update: mocks.stripeWebhookEventUpdate,
    },
    booking: {
      findUnique: mocks.bookingFindUnique,
      findFirst: mocks.bookingFindFirst,
      update: mocks.bookingUpdate,
    },
    bookingCloseoutAuditLog: {
      create: mocks.bookingCloseoutAuditLogCreate,
    },
    professionalPaymentSettings: {
      findUnique: mocks.professionalPaymentSettingsFindUnique,
      update: mocks.professionalPaymentSettingsUpdate,
    },
    $transaction: mocks.prismaTransaction,
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
    request: {
      id: null,
      idempotency_key: null,
    },
    type: args?.type ?? 'payment_intent.succeeded',
    data: {
      object: args?.object ?? makePaymentIntent(),
    },
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
        makeJsonResponse(
          {
            error: message,
            ...(extra ?? {}),
          },
          status,
        ),
    )

    mocks.getStripeWebhookSecret.mockReturnValue('whsec_test_123')

    mocks.getStripe.mockReturnValue({
      webhooks: {
        constructEvent: mocks.constructEvent,
      },
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

    mocks.bookingFindUnique.mockResolvedValue({
      id: 'booking_1',
      professionalId: 'pro_1',
      checkoutStatus: BookingCheckoutStatus.READY,
    })

    mocks.bookingFindFirst.mockResolvedValue({
      id: 'booking_1',
      professionalId: 'pro_1',
      checkoutStatus: BookingCheckoutStatus.READY,
    })

    mocks.bookingUpdate.mockResolvedValue({
      id: 'booking_1',
    })

    mocks.bookingCloseoutAuditLogCreate.mockResolvedValue({
      id: 'audit_1',
    })

    mocks.professionalPaymentSettingsFindUnique.mockResolvedValue({
      professionalId: 'pro_1',
      stripeOnboardingCompletedAt: null,
    })

    mocks.professionalPaymentSettingsUpdate.mockResolvedValue({
      professionalId: 'pro_1',
    })

    mocks.prismaTransaction.mockImplementation(
      async (
        callback: (tx: {
          booking: {
            update: typeof mocks.bookingUpdate
          }
          bookingCloseoutAuditLog: {
            create: typeof mocks.bookingCloseoutAuditLogCreate
          }
        }) => Promise<unknown>,
      ) =>
        callback({
          booking: {
            update: mocks.bookingUpdate,
          },
          bookingCloseoutAuditLog: {
            create: mocks.bookingCloseoutAuditLogCreate,
          },
        }),
    )
  })

  it('rejects requests without a Stripe signature', async () => {
    const response = await POST(
      makeWebhookRequest({
        signature: null,
      }),
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: 'Missing Stripe signature.',
      code: 'STRIPE_SIGNATURE_REQUIRED',
    })

    expect(mocks.constructEvent).not.toHaveBeenCalled()
    expect(mocks.stripeWebhookEventCreate).not.toHaveBeenCalled()
  })

  it('rejects invalid Stripe signatures', async () => {
    mocks.constructEvent.mockImplementationOnce(() => {
      throw new Error('bad signature')
    })

    const response = await POST(makeWebhookRequest())

    expect(mocks.constructEvent).toHaveBeenCalledWith(
      '{"id":"evt_test_1"}',
      'stripe_signature_1',
      'whsec_test_123',
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: 'Invalid Stripe webhook signature.',
      code: 'STRIPE_SIGNATURE_INVALID',
    })

    expect(mocks.stripeWebhookEventCreate).not.toHaveBeenCalled()
  })

  it('returns success for duplicate already-processed events without reprocessing', async () => {
    mocks.stripeWebhookEventCreate.mockResolvedValueOnce({
      id: 'webhook_event_1',
      processedAt: new Date('2026-05-05T10:00:00.000Z'),
    })

    const response = await POST(makeWebhookRequest())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      ok: true,
      duplicate: true,
      stripeEventId: 'evt_test_1',
      eventType: 'payment_intent.succeeded',
    })

    expect(mocks.bookingUpdate).not.toHaveBeenCalled()
    expect(mocks.prismaTransaction).not.toHaveBeenCalled()
  })

  it('stores unhandled events and marks them processed', async () => {
    mocks.constructEvent.mockReturnValueOnce(
      makeStripeEvent({
        id: 'evt_unhandled_1',
        type: 'customer.created',
        object: {
          id: 'cus_test_123',
          object: 'customer',
        },
      }),
    )

    const response = await POST(makeWebhookRequest())

    expect(mocks.stripeWebhookEventCreate).toHaveBeenCalledWith({
      data: {
        stripeEventId: 'evt_unhandled_1',
        eventType: 'customer.created',
        livemode: false,
        payload: expect.objectContaining({
          id: 'evt_unhandled_1',
          type: 'customer.created',
        }),
      },
      select: {
        id: true,
        processedAt: true,
      },
    })

    expect(mocks.stripeWebhookEventUpdate).toHaveBeenCalledWith({
      where: {
        stripeEventId: 'evt_unhandled_1',
      },
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

  it('syncs checkout.session.completed without marking payment collected', async () => {
    mocks.constructEvent.mockReturnValueOnce(
      makeStripeEvent({
        id: 'evt_checkout_completed_1',
        type: 'checkout.session.completed',
        object: makeCheckoutSession(),
      }),
    )

    const response = await POST(makeWebhookRequest())

    expect(mocks.bookingUpdate).toHaveBeenCalledWith({
      where: {
        id: 'booking_1',
      },
      data: {
        paymentProvider: PaymentProvider.STRIPE,
        selectedPaymentMethod: PaymentMethod.STRIPE_CARD,
        stripeCheckoutSessionId: 'cs_test_123',
        stripePaymentIntentId: 'pi_test_123',
        stripeCheckoutSessionStatus: 'COMPLETE',
        stripeAmountSubtotal: 13500,
        stripeAmountTotal: 13500,
        stripeCurrency: 'USD',
      },
    })

    expect(mocks.prismaTransaction).not.toHaveBeenCalled()

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      ok: true,
      stripeEventId: 'evt_checkout_completed_1',
      eventType: 'checkout.session.completed',
      handled: true,
      message: 'checkout.session.completed synced.',
    })
  })

  it('marks payment_intent.succeeded bookings paid and creates an audit log', async () => {
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

    expect(mocks.bookingFindUnique).toHaveBeenCalledWith({
      where: {
        id: 'booking_1',
      },
      select: {
        id: true,
        professionalId: true,
        checkoutStatus: true,
      },
    })

    expect(mocks.prismaTransaction).toHaveBeenCalledTimes(1)

    expect(mocks.bookingUpdate).toHaveBeenCalledWith({
      where: {
        id: 'booking_1',
      },
      data: {
        paymentProvider: PaymentProvider.STRIPE,
        selectedPaymentMethod: PaymentMethod.STRIPE_CARD,
        checkoutStatus: BookingCheckoutStatus.PAID,
        paymentAuthorizedAt: expect.any(Date),
        paymentCollectedAt: expect.any(Date),
        stripePaymentIntentId: 'pi_success_123',
        stripePaymentStatus: StripePaymentStatus.SUCCEEDED,
        stripeAmountTotal: 13500,
        stripeCurrency: 'USD',
        stripePaidAt: expect.any(Date),
        stripeLastEventId: 'evt_payment_succeeded_1',
      },
    })

    expect(mocks.bookingCloseoutAuditLogCreate).toHaveBeenCalledWith({
      data: {
        bookingId: 'booking_1',
        professionalId: 'pro_1',
        actorUserId: null,
        action: 'PAYMENT_COLLECTED',
        route: 'POST /api/webhooks/stripe',
        requestId: 'evt_payment_succeeded_1',
        idempotencyKey: 'evt_payment_succeeded_1',
        oldValue: {
          checkoutStatus: BookingCheckoutStatus.READY,
        },
        newValue: {
          checkoutStatus: BookingCheckoutStatus.PAID,
          paymentProvider: PaymentProvider.STRIPE,
          stripePaymentIntentId: 'pi_success_123',
        },
        metadata: {
          source: 'stripe_webhook',
          stripeEventId: 'evt_payment_succeeded_1',
          stripePaymentIntentId: 'pi_success_123',
          amountReceived: 13500,
          amount: 13500,
          currency: 'USD',
        },
      },
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      ok: true,
      stripeEventId: 'evt_payment_succeeded_1',
      eventType: 'payment_intent.succeeded',
      handled: true,
      message: 'payment_intent.succeeded marked booking paid.',
    })
  })

  it('does not mark paid when payment_intent.payment_failed is received', async () => {
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

    expect(mocks.bookingUpdate).toHaveBeenCalledWith({
      where: {
        id: 'booking_1',
      },
      data: {
        paymentProvider: PaymentProvider.STRIPE,
        selectedPaymentMethod: PaymentMethod.STRIPE_CARD,
        stripePaymentIntentId: 'pi_failed_123',
        stripePaymentStatus: StripePaymentStatus.FAILED,
        stripeLastEventId: 'evt_payment_failed_1',
      },
    })

    expect(mocks.bookingUpdate).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          checkoutStatus: BookingCheckoutStatus.PAID,
        }),
      }),
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      ok: true,
      stripeEventId: 'evt_payment_failed_1',
      eventType: 'payment_intent.payment_failed',
      handled: true,
      message: 'payment_intent.payment_failed synced.',
    })
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
      where: {
        stripeAccountId: 'acct_test_123',
      },
      select: {
        professionalId: true,
        stripeOnboardingCompletedAt: true,
      },
    })

    expect(mocks.professionalPaymentSettingsUpdate).toHaveBeenCalledWith({
      where: {
        professionalId: 'pro_1',
      },
      data: {
        stripeAccountStatus: StripeAccountStatus.ENABLED,
        stripeChargesEnabled: true,
        stripePayoutsEnabled: true,
        stripeDetailsSubmitted: true,
        stripeRequirementsCurrentlyDue: [],
        stripeRequirementsEventuallyDue: [],
        stripeOnboardingCompletedAt: expect.any(Date),
        stripeAccountUpdatedAt: expect.any(Date),
        acceptStripeCard: true,
      },
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      ok: true,
      stripeEventId: 'evt_account_updated_1',
      eventType: 'account.updated',
      handled: true,
      message: 'account.updated synced.',
    })
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
          eventuallyDue: ['representative.verification.document'],
          disabledReason: 'requirements.past_due',
        }),
      }),
    )

    const response = await POST(makeWebhookRequest())

    expect(mocks.professionalPaymentSettingsUpdate).toHaveBeenCalledWith({
      where: {
        professionalId: 'pro_1',
      },
      data: {
        stripeAccountStatus: StripeAccountStatus.RESTRICTED,
        stripeChargesEnabled: false,
        stripePayoutsEnabled: false,
        stripeDetailsSubmitted: true,
        stripeRequirementsCurrentlyDue: ['external_account'],
        stripeRequirementsEventuallyDue: [
          'representative.verification.document',
        ],
        stripeOnboardingCompletedAt: null,
        stripeAccountUpdatedAt: expect.any(Date),
        acceptStripeCard: false,
      },
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      ok: true,
      stripeEventId: 'evt_account_restricted_1',
      eventType: 'account.updated',
      handled: true,
      message: 'account.updated synced.',
    })
  })

  it('marks webhook event failed and returns 500 when processing throws', async () => {
    mocks.constructEvent.mockReturnValueOnce(
      makeStripeEvent({
        id: 'evt_processing_error_1',
        type: 'payment_intent.succeeded',
        object: makePaymentIntent({
          bookingId: 'booking_1',
        }),
      }),
    )

    mocks.prismaTransaction.mockRejectedValueOnce(new Error('db boom'))

    const response = await POST(makeWebhookRequest())

    expect(mocks.stripeWebhookEventUpdate).toHaveBeenCalledWith({
      where: {
        stripeEventId: 'evt_processing_error_1',
      },
      data: {
        failedAt: expect.any(Date),
        lastError: 'db boom',
      },
    })

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({
      error: 'Failed to process Stripe webhook.',
      code: 'STRIPE_WEBHOOK_PROCESSING_FAILED',
      message: 'db boom',
    })
  })
})