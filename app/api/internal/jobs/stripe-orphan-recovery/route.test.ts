// app/api/internal/jobs/stripe-orphan-recovery/route.test.ts

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  BookingStatus,
  PaymentProvider,
  StripePaymentStatus,
} from '@prisma/client'

const mocks = vi.hoisted(() => ({
  bookingFindMany: vi.fn(),
  applyStripePaymentSucceeded: vi.fn(),
  applyLateCaptureCancelRefund: vi.fn(),
  stripeRetrieve: vi.fn(),
  captureBookingException: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    booking: {
      findMany: mocks.bookingFindMany,
    },
  },
}))

vi.mock('@/lib/booking/writeBoundary', () => ({
  applyStripePaymentSucceeded: mocks.applyStripePaymentSucceeded,
}))

vi.mock('@/lib/booking/cancelRefund', () => ({
  applyLateCaptureCancelRefund: mocks.applyLateCaptureCancelRefund,
}))

vi.mock('@/lib/stripe/server', () => ({
  getStripe: () => ({
    checkout: {
      sessions: {
        retrieve: mocks.stripeRetrieve,
      },
    },
  }),
}))

vi.mock('@/lib/observability/bookingEvents', () => ({
  captureBookingException: mocks.captureBookingException,
}))

vi.mock('@/app/api/_utils', () => ({
  jsonOk: (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    }),
  jsonFail: (
    status: number,
    message: string,
    extra?: Record<string, unknown>,
  ) =>
    new Response(
      JSON.stringify({
        ok: false,
        error: message,
        ...(extra ?? {}),
      }),
      {
        status,
        headers: { 'content-type': 'application/json' },
      },
    ),
}))

import { GET, POST } from './route'

const SECRET = 'cron-secret-1'
const ORIGINAL_INTERNAL_JOB_SECRET = process.env.INTERNAL_JOB_SECRET
const ORIGINAL_CRON_SECRET = process.env.CRON_SECRET

beforeEach(() => {
  process.env.INTERNAL_JOB_SECRET = SECRET
  delete process.env.CRON_SECRET

  mocks.bookingFindMany.mockReset()
  mocks.applyStripePaymentSucceeded.mockReset()
  mocks.applyLateCaptureCancelRefund.mockReset()
  mocks.stripeRetrieve.mockReset()
  mocks.captureBookingException.mockReset()
})

afterEach(() => {
  if (ORIGINAL_INTERNAL_JOB_SECRET === undefined) {
    delete process.env.INTERNAL_JOB_SECRET
  } else {
    process.env.INTERNAL_JOB_SECRET = ORIGINAL_INTERNAL_JOB_SECRET
  }

  if (ORIGINAL_CRON_SECRET === undefined) {
    delete process.env.CRON_SECRET
  } else {
    process.env.CRON_SECRET = ORIGINAL_CRON_SECRET
  }
})

function makeJobRequest(args?: {
  authorization?: string
  internalSecret?: string
}): Request {
  const headers = new Headers()

  if (args?.authorization) {
    headers.set('authorization', args.authorization)
  }

  if (args?.internalSecret) {
    headers.set('x-internal-job-secret', args.internalSecret)
  }

  return new Request(
    'http://localhost/api/internal/jobs/stripe-orphan-recovery',
    {
      method: 'GET',
      headers,
    },
  )
}

function authedRequest(): Request {
  return makeJobRequest({
    authorization: `Bearer ${SECRET}`,
  })
}

describe('GET /api/internal/jobs/stripe-orphan-recovery', () => {
  it('returns 500 when no job secret is configured', async () => {
    delete process.env.INTERNAL_JOB_SECRET
    delete process.env.CRON_SECRET

    const response = await GET(makeJobRequest())

    expect(response.status).toBe(500)
    expect(mocks.bookingFindMany).not.toHaveBeenCalled()

    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: 'Missing INTERNAL_JOB_SECRET or CRON_SECRET configuration.',
      code: 'STRIPE_ORPHAN_RECOVERY_SECRET_REQUIRED',
    })
  })

  it('rejects unauthorized requests', async () => {
    const response = await GET(makeJobRequest())

    expect(response.status).toBe(401)
    expect(mocks.bookingFindMany).not.toHaveBeenCalled()

    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: 'Unauthorized',
      code: 'UNAUTHORIZED',
    })
  })

  it('accepts x-internal-job-secret authorization', async () => {
    mocks.bookingFindMany.mockResolvedValue([])

    const response = await GET(
      makeJobRequest({
        internalSecret: SECRET,
      }),
    )

    expect(response.status).toBe(200)
    expect(mocks.bookingFindMany).toHaveBeenCalledTimes(1)
  })

  it('returns zero tally when no candidates exist', async () => {
    mocks.bookingFindMany.mockResolvedValue([])

    const response = await GET(authedRequest())

    expect(response.status).toBe(200)

    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      candidatesScanned: 0,
      tally: {
        recovered: 0,
        session_not_paid: 0,
        session_missing_payment_intent: 0,
        stripe_lookup_failed: 0,
        apply_failed: 0,
        no_op_or_already_recovered: 0,
      },
      sample: [],
    })

    expect(mocks.stripeRetrieve).not.toHaveBeenCalled()
    expect(mocks.applyStripePaymentSucceeded).not.toHaveBeenCalled()
  })

  it('queries Prisma with the correct candidate filter', async () => {
    mocks.bookingFindMany.mockResolvedValue([])

    await GET(authedRequest())

    expect(mocks.bookingFindMany).toHaveBeenCalledTimes(1)

    const call = mocks.bookingFindMany.mock.calls[0]?.[0]

    expect(call).toMatchObject({
      where: {
        paymentProvider: PaymentProvider.STRIPE,
        stripeCheckoutSessionId: { not: null },
        stripePaymentStatus: {
          not: StripePaymentStatus.SUCCEEDED,
        },
        paymentCollectedAt: null,
        // M1: CANCELLED bookings ARE candidates — money paid at Stripe for a
        // cancelled booking must be recorded, then settled by the cancel's
        // refund policy (applyLateCaptureCancelRefund).
        status: {
          notIn: [BookingStatus.COMPLETED],
        },
      },
      select: {
        id: true,
        stripeCheckoutSessionId: true,
      },
      orderBy: { createdAt: 'asc' },
      take: 200,
    })

    expect(call.where.createdAt.lte).toBeInstanceOf(Date)
    expect(call.where.createdAt.gte).toBeInstanceOf(Date)
  })

  it('retrieves Stripe sessions with payment_intent expanded', async () => {
    mocks.bookingFindMany.mockResolvedValue([
      { id: 'bk_1', stripeCheckoutSessionId: 'cs_1' },
    ])

    mocks.stripeRetrieve.mockResolvedValue({
      id: 'cs_1',
      payment_status: 'unpaid',
      payment_intent: null,
    })

    await GET(authedRequest())

    expect(mocks.stripeRetrieve).toHaveBeenCalledWith('cs_1', {
      expand: ['payment_intent'],
    })
  })

  it('replays applyStripePaymentSucceeded for paid sessions with expanded payment intent', async () => {
    mocks.bookingFindMany.mockResolvedValue([
      { id: 'bk_1', stripeCheckoutSessionId: 'cs_1' },
    ])

    mocks.stripeRetrieve.mockResolvedValue({
      id: 'cs_1',
      payment_status: 'paid',
      payment_intent: {
        id: 'pi_1',
        object: 'payment_intent',
        amount_received: 5000,
        currency: 'usd',
      },
      amount_total: 5000,
      currency: 'usd',
    })

    mocks.applyStripePaymentSucceeded.mockResolvedValue({
      bookingId: 'bk_1',
      bookingCompleted: false,
      meta: { mutated: true, noOp: false },
    })

    const response = await GET(authedRequest())

    expect(response.status).toBe(200)

    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      candidatesScanned: 1,
      tally: {
        recovered: 1,
        session_not_paid: 0,
        session_missing_payment_intent: 0,
        stripe_lookup_failed: 0,
        apply_failed: 0,
        no_op_or_already_recovered: 0,
      },
      sample: [
        {
          bookingId: 'bk_1',
          stripeCheckoutSessionId: 'cs_1',
          outcome: 'recovered',
        },
      ],
    })

    expect(mocks.applyStripePaymentSucceeded).toHaveBeenCalledWith({
      bookingIdHint: 'bk_1',
      stripePaymentIntentId: 'pi_1',
      stripeEventId: 'stripe:pi_succeeded:pi_1',
      amountReceivedCents: 5000,
      currency: 'usd',
    })
  })

  // M1: a recovered payment that applied onto an already-CANCELLED booking
  // settles by the cancel's refund policy after the apply.
  it('runs the late-capture cancel refund when the recovered booking is cancelled', async () => {
    mocks.bookingFindMany.mockResolvedValue([
      { id: 'bk_cancelled', stripeCheckoutSessionId: 'cs_cancelled' },
    ])

    mocks.stripeRetrieve.mockResolvedValue({
      id: 'cs_cancelled',
      payment_status: 'paid',
      payment_intent: {
        id: 'pi_cancelled',
        object: 'payment_intent',
        amount_received: 5000,
        currency: 'usd',
      },
      amount_total: 5000,
      currency: 'usd',
    })

    mocks.applyStripePaymentSucceeded.mockResolvedValue({
      bookingId: 'bk_cancelled',
      bookingCompleted: false,
      meta: { mutated: true, noOp: false },
      capturedOnCancelledBooking: true,
    })

    const response = await GET(authedRequest())

    expect(response.status).toBe(200)
    expect(mocks.applyLateCaptureCancelRefund).toHaveBeenCalledExactlyOnceWith({
      bookingId: 'bk_cancelled',
      flavor: 'SERVICE',
    })
  })

  it('does not run the late-capture refund when the recovered booking is live', async () => {
    mocks.bookingFindMany.mockResolvedValue([
      { id: 'bk_1', stripeCheckoutSessionId: 'cs_1' },
    ])

    mocks.stripeRetrieve.mockResolvedValue({
      id: 'cs_1',
      payment_status: 'paid',
      payment_intent: {
        id: 'pi_1',
        object: 'payment_intent',
        amount_received: 5000,
        currency: 'usd',
      },
      amount_total: 5000,
      currency: 'usd',
    })

    mocks.applyStripePaymentSucceeded.mockResolvedValue({
      bookingId: 'bk_1',
      bookingCompleted: false,
      meta: { mutated: true, noOp: false },
      capturedOnCancelledBooking: false,
    })

    const response = await GET(authedRequest())

    expect(response.status).toBe(200)
    expect(mocks.applyLateCaptureCancelRefund).not.toHaveBeenCalled()
  })

  it('replays applyStripePaymentSucceeded for paid sessions when payment_intent is only a string', async () => {
    mocks.bookingFindMany.mockResolvedValue([
      { id: 'bk_string_pi', stripeCheckoutSessionId: 'cs_string_pi' },
    ])

    mocks.stripeRetrieve.mockResolvedValue({
      id: 'cs_string_pi',
      payment_status: 'paid',
      payment_intent: 'pi_string_1',
      amount_total: 7500,
      currency: 'usd',
    })

    mocks.applyStripePaymentSucceeded.mockResolvedValue({
      bookingId: 'bk_string_pi',
      bookingCompleted: false,
      meta: { mutated: true, noOp: false },
    })

    const response = await GET(authedRequest())

    expect(response.status).toBe(200)

    await expect(response.json()).resolves.toMatchObject({
      tally: {
        recovered: 1,
      },
    })

    expect(mocks.applyStripePaymentSucceeded).toHaveBeenCalledWith({
      bookingIdHint: 'bk_string_pi',
      stripePaymentIntentId: 'pi_string_1',
      stripeEventId: 'stripe:pi_succeeded:pi_string_1',
      amountReceivedCents: 7500,
      currency: 'usd',
    })
  })

  it('skips unpaid sessions without calling apply', async () => {
    mocks.bookingFindMany.mockResolvedValue([
      { id: 'bk_2', stripeCheckoutSessionId: 'cs_2' },
    ])

    mocks.stripeRetrieve.mockResolvedValue({
      id: 'cs_2',
      payment_status: 'unpaid',
      payment_intent: null,
    })

    const response = await GET(authedRequest())

    expect(response.status).toBe(200)

    await expect(response.json()).resolves.toMatchObject({
      tally: {
        recovered: 0,
        session_not_paid: 1,
      },
    })

    expect(mocks.applyStripePaymentSucceeded).not.toHaveBeenCalled()
  })

  it('reports session_missing_payment_intent when a paid session has no payment intent id', async () => {
    mocks.bookingFindMany.mockResolvedValue([
      { id: 'bk_missing_pi', stripeCheckoutSessionId: 'cs_missing_pi' },
    ])

    mocks.stripeRetrieve.mockResolvedValue({
      id: 'cs_missing_pi',
      payment_status: 'paid',
      payment_intent: null,
      amount_total: 5000,
      currency: 'usd',
    })

    const response = await GET(authedRequest())

    expect(response.status).toBe(200)

    await expect(response.json()).resolves.toMatchObject({
      tally: {
        session_missing_payment_intent: 1,
      },
    })

    expect(mocks.applyStripePaymentSucceeded).not.toHaveBeenCalled()
  })

  it('reports stripe_lookup_failed when retrieve throws', async () => {
    mocks.bookingFindMany.mockResolvedValue([
      { id: 'bk_3', stripeCheckoutSessionId: 'cs_3' },
    ])

    mocks.stripeRetrieve.mockRejectedValue(new Error('stripe boom'))

    const response = await GET(authedRequest())

    expect(response.status).toBe(200)

    await expect(response.json()).resolves.toMatchObject({
      tally: {
        stripe_lookup_failed: 1,
      },
    })

    expect(mocks.captureBookingException).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'STRIPE_LOOKUP_FAILED',
        bookingId: 'bk_3',
      }),
    )

    expect(mocks.applyStripePaymentSucceeded).not.toHaveBeenCalled()
  })

  it('reports apply_failed when applyStripePaymentSucceeded throws', async () => {
    mocks.bookingFindMany.mockResolvedValue([
      { id: 'bk_apply_failed', stripeCheckoutSessionId: 'cs_apply_failed' },
    ])

    mocks.stripeRetrieve.mockResolvedValue({
      id: 'cs_apply_failed',
      payment_status: 'paid',
      payment_intent: {
        id: 'pi_apply_failed',
        object: 'payment_intent',
        amount_received: 5000,
        currency: 'usd',
      },
      amount_total: 5000,
      currency: 'usd',
    })

    mocks.applyStripePaymentSucceeded.mockRejectedValue(new Error('db boom'))

    const response = await GET(authedRequest())

    expect(response.status).toBe(200)

    await expect(response.json()).resolves.toMatchObject({
      tally: {
        apply_failed: 1,
      },
    })

    expect(mocks.captureBookingException).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'APPLY_PAYMENT_FAILED',
        bookingId: 'bk_apply_failed',
      }),
    )
  })

  it('treats null apply results as already recovered/no-op', async () => {
    mocks.bookingFindMany.mockResolvedValue([
      { id: 'bk_null_apply', stripeCheckoutSessionId: 'cs_null_apply' },
    ])

    mocks.stripeRetrieve.mockResolvedValue({
      id: 'cs_null_apply',
      payment_status: 'paid',
      payment_intent: {
        id: 'pi_null_apply',
        object: 'payment_intent',
        amount_received: 1000,
        currency: 'usd',
      },
    })

    mocks.applyStripePaymentSucceeded.mockResolvedValue(null)

    const response = await GET(authedRequest())

    expect(response.status).toBe(200)

    await expect(response.json()).resolves.toMatchObject({
      tally: {
        no_op_or_already_recovered: 1,
      },
    })
  })

  it('treats non-mutating apply results as already recovered/no-op', async () => {
    mocks.bookingFindMany.mockResolvedValue([
      { id: 'bk_4', stripeCheckoutSessionId: 'cs_4' },
    ])

    mocks.stripeRetrieve.mockResolvedValue({
      id: 'cs_4',
      payment_status: 'paid',
      payment_intent: {
        id: 'pi_4',
        object: 'payment_intent',
        amount_received: 1000,
        currency: 'usd',
      },
    })

    mocks.applyStripePaymentSucceeded.mockResolvedValue({
      bookingId: 'bk_4',
      bookingCompleted: false,
      meta: { mutated: false, noOp: true },
    })

    const response = await GET(authedRequest())

    expect(response.status).toBe(200)

    await expect(response.json()).resolves.toMatchObject({
      tally: {
        no_op_or_already_recovered: 1,
      },
    })
  })

  it('continues processing later candidates after one candidate fails', async () => {
    mocks.bookingFindMany.mockResolvedValue([
      { id: 'bk_bad', stripeCheckoutSessionId: 'cs_bad' },
      { id: 'bk_good', stripeCheckoutSessionId: 'cs_good' },
    ])

    mocks.stripeRetrieve
      .mockRejectedValueOnce(new Error('stripe boom'))
      .mockResolvedValueOnce({
        id: 'cs_good',
        payment_status: 'paid',
        payment_intent: {
          id: 'pi_good',
          object: 'payment_intent',
          amount_received: 2500,
          currency: 'usd',
        },
      })

    mocks.applyStripePaymentSucceeded.mockResolvedValue({
      bookingId: 'bk_good',
      bookingCompleted: false,
      meta: { mutated: true, noOp: false },
    })

    const response = await GET(authedRequest())

    expect(response.status).toBe(200)

    await expect(response.json()).resolves.toMatchObject({
      candidatesScanned: 2,
      tally: {
        recovered: 1,
        stripe_lookup_failed: 1,
      },
    })

    expect(mocks.applyStripePaymentSucceeded).toHaveBeenCalledTimes(1)
  })
})

describe('POST /api/internal/jobs/stripe-orphan-recovery', () => {
  it('runs the same job as GET', async () => {
    mocks.bookingFindMany.mockResolvedValue([])

    const response = await POST(
      new Request(
        'http://localhost/api/internal/jobs/stripe-orphan-recovery',
        {
          method: 'POST',
          headers: { authorization: `Bearer ${SECRET}` },
        },
      ),
    )

    expect(response.status).toBe(200)
    expect(mocks.bookingFindMany).toHaveBeenCalledTimes(1)
  })
})