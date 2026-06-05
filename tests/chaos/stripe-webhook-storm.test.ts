// tests/chaos/stripe-webhook-storm.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Prisma } from '@prisma/client'

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
}))

vi.mock('@/lib/security/logging', () => ({
  safeError: mocks.safeError,
}))

import { POST } from '@/app/api/webhooks/stripe/route'

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
    body: args?.body ?? '{"id":"evt_storm_duplicate_1"}',
  })
}

function makePaymentIntent(args?: {
  id?: string
  amount?: number
  amountReceived?: number
  currency?: string
  bookingId?: string
}) {
  return {
    id: args?.id ?? 'pi_storm_123',
    object: 'payment_intent',
    amount: args?.amount ?? 13500,
    amount_received: args?.amountReceived ?? 13500,
    currency: args?.currency ?? 'usd',
    metadata: {
      bookingId: args?.bookingId ?? 'booking_storm_1',
      clientId: 'client_storm_1',
      professionalId: 'pro_storm_1',
    },
  }
}

function makeStripeEvent(args?: {
  id?: string
  type?: string
  object?: Record<string, unknown>
  livemode?: boolean
}) {
  return {
    id: args?.id ?? 'evt_storm_duplicate_1',
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

function makeP2002DuplicateError(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError(
    'Unique constraint failed on the fields: (`stripeEventId`)',
    {
      code: 'P2002',
      clientVersion: 'chaos-test',
      meta: { target: ['stripeEventId'] },
    },
  )
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>
}

describe('chaos: Stripe webhook storm', () => {
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
        id: 'evt_storm_duplicate_1',
        type: 'payment_intent.succeeded',
        object: makePaymentIntent({
          id: 'pi_storm_123',
          bookingId: 'booking_storm_1',
        }),
      }),
    )

    mocks.stripeWebhookEventUpdate.mockResolvedValue({
      id: 'webhook_event_storm_1',
    })

    mocks.prismaTransaction.mockImplementation(
      async (
        callback: (tx: MockTransactionClient) => Promise<unknown>,
      ): Promise<unknown> => callback(makeMockTx()),
    )

    mocks.applyStripePaymentSucceededInTransaction.mockResolvedValue({
      bookingCompleted: false,
    })

    mocks.applyStripePaymentFailedInTransaction.mockResolvedValue({
      bookingCompleted: false,
    })

    mocks.applyStripeCheckoutSessionStatusInTransaction.mockResolvedValue({
      bookingCompleted: false,
    })
  })

  it('deduplicates a replay storm for the same Stripe event id without double-applying payment writes', async () => {
    const replayCount = 25
    let createAttempts = 0

    mocks.stripeWebhookEventCreate.mockImplementation(async () => {
      createAttempts += 1

      if (createAttempts === 1) {
        return {
          id: 'webhook_event_storm_1',
          processedAt: null,
        }
      }

      throw makeP2002DuplicateError()
    })

    mocks.stripeWebhookEventFindUnique.mockResolvedValue({
      id: 'webhook_event_storm_1',
      processedAt: new Date('2026-06-05T00:00:00.000Z'),
    })

    const responses = await Promise.all(
      Array.from({ length: replayCount }, () => POST(makeWebhookRequest())),
    )

    const bodies = await Promise.all(responses.map((response) => readJson(response)))

    expect(responses).toHaveLength(replayCount)
    expect(responses.every((response) => response.status === 200)).toBe(true)

    const duplicateBodies = bodies.filter((body) => body.duplicate === true)
    const processedBodies = bodies.filter((body) => body.duplicate !== true)

    expect(processedBodies).toHaveLength(1)
    expect(duplicateBodies).toHaveLength(replayCount - 1)

    expect(mocks.constructEvent).toHaveBeenCalledTimes(replayCount)
    expect(mocks.stripeWebhookEventCreate).toHaveBeenCalledTimes(replayCount)
    expect(mocks.stripeWebhookEventFindUnique).toHaveBeenCalledTimes(
      replayCount - 1,
    )

    expect(mocks.prismaTransaction).toHaveBeenCalledTimes(1)
    expect(mocks.applyStripePaymentSucceededInTransaction).toHaveBeenCalledTimes(
      1,
    )
    expect(mocks.stripeWebhookEventUpdate).toHaveBeenCalledTimes(1)

    expect(mocks.jsonFail).not.toHaveBeenCalled()
  })

  it('does not treat malformed storm requests as successful webhook processing', async () => {
    const replayCount = 10

    const responses = await Promise.all(
      Array.from({ length: replayCount }, () =>
        POST(makeWebhookRequest({ signature: null })),
      ),
    )

    const bodies = await Promise.all(responses.map((response) => readJson(response)))

    expect(responses.every((response) => response.status === 400)).toBe(true)
    expect(
      bodies.every((body) => body.code === 'STRIPE_SIGNATURE_REQUIRED'),
    ).toBe(true)

    expect(mocks.constructEvent).not.toHaveBeenCalled()
    expect(mocks.stripeWebhookEventCreate).not.toHaveBeenCalled()
    expect(mocks.prismaTransaction).not.toHaveBeenCalled()
    expect(mocks.applyStripePaymentSucceededInTransaction).not.toHaveBeenCalled()
  })
})