// app/api/internal/jobs/stripe-orphan-recovery/route.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BookingStatus } from '@prisma/client'

const mocks = vi.hoisted(() => ({
  bookingFindMany: vi.fn(),
  applyStripePaymentSucceeded: vi.fn(),
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
  jsonFail: (status: number, message: string) =>
    new Response(JSON.stringify({ ok: false, error: message }), {
      status,
      headers: { 'content-type': 'application/json' },
    }),
}))

import { GET } from './route'

const SECRET = 'cron-secret-1'
const OLD_ENV = process.env.INTERNAL_JOB_SECRET

beforeEach(() => {
  process.env.INTERNAL_JOB_SECRET = SECRET
  mocks.bookingFindMany.mockReset()
  mocks.applyStripePaymentSucceeded.mockReset()
  mocks.stripeRetrieve.mockReset()
  mocks.captureBookingException.mockReset()
})

afterEach(() => {
  if (OLD_ENV === undefined) {
    delete process.env.INTERNAL_JOB_SECRET
  } else {
    process.env.INTERNAL_JOB_SECRET = OLD_ENV
  }
})

function authedRequest() {
  return new Request(
    'http://localhost/api/internal/jobs/stripe-orphan-recovery',
    {
      headers: { authorization: `Bearer ${SECRET}` },
    },
  )
}

describe('GET /api/internal/jobs/stripe-orphan-recovery', () => {
  it('rejects unauthorized requests', async () => {
    const res = await GET(
      new Request('http://localhost/api/internal/jobs/stripe-orphan-recovery'),
    )
    expect(res.status).toBe(401)
    expect(mocks.bookingFindMany).not.toHaveBeenCalled()
  })

  it('returns zero tally when no candidates exist', async () => {
    mocks.bookingFindMany.mockResolvedValue([])

    const res = await GET(authedRequest())
    expect(res.status).toBe(200)
    const body = (await res.json()) as { candidatesScanned: number }
    expect(body.candidatesScanned).toBe(0)
    expect(mocks.stripeRetrieve).not.toHaveBeenCalled()
    expect(mocks.applyStripePaymentSucceeded).not.toHaveBeenCalled()
  })

  it('queries Prisma with the correct candidate filter', async () => {
    mocks.bookingFindMany.mockResolvedValue([])
    await GET(authedRequest())

    const call = mocks.bookingFindMany.mock.calls[0][0]
    expect(call.where.stripeCheckoutSessionId).toEqual({ not: null })
    expect(call.where.paymentCollectedAt).toBeNull()
    expect(call.where.status.notIn).toEqual([
      BookingStatus.CANCELLED,
      BookingStatus.COMPLETED,
    ])
    expect(call.where.createdAt.lte).toBeInstanceOf(Date)
    expect(call.where.createdAt.gte).toBeInstanceOf(Date)
    expect(call.take).toBe(200)
  })

  it('replays applyStripePaymentSucceeded for paid sessions', async () => {
    mocks.bookingFindMany.mockResolvedValue([
      { id: 'bk_1', stripeCheckoutSessionId: 'cs_1' },
    ])
    mocks.stripeRetrieve.mockResolvedValue({
      id: 'cs_1',
      payment_status: 'paid',
      payment_intent: {
        id: 'pi_1',
        amount_received: 5000,
        currency: 'usd',
      },
      amount_total: 5000,
      currency: 'usd',
    })
    mocks.applyStripePaymentSucceeded.mockResolvedValue({
      bookingId: 'bk_1',
      bookingCompleted: false,
      meta: { mutated: true },
    })

    const res = await GET(authedRequest())
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      tally: Record<string, number>
    }

    expect(body.tally.recovered).toBe(1)
    expect(mocks.applyStripePaymentSucceeded).toHaveBeenCalledWith(
      expect.objectContaining({
        bookingIdHint: 'bk_1',
        stripePaymentIntentId: 'pi_1',
        stripeEventId: 'orphan_recovery:cs_1',
        amountReceivedCents: 5000,
        currency: 'usd',
      }),
    )
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

    const res = await GET(authedRequest())
    const body = (await res.json()) as { tally: Record<string, number> }

    expect(body.tally.session_not_paid).toBe(1)
    expect(body.tally.recovered).toBe(0)
    expect(mocks.applyStripePaymentSucceeded).not.toHaveBeenCalled()
  })

  it('reports stripe_lookup_failed when retrieve throws', async () => {
    mocks.bookingFindMany.mockResolvedValue([
      { id: 'bk_3', stripeCheckoutSessionId: 'cs_3' },
    ])
    mocks.stripeRetrieve.mockRejectedValue(new Error('stripe boom'))

    const res = await GET(authedRequest())
    const body = (await res.json()) as { tally: Record<string, number> }

    expect(body.tally.stripe_lookup_failed).toBe(1)
    expect(mocks.captureBookingException).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'STRIPE_LOOKUP_FAILED' }),
    )
    expect(mocks.applyStripePaymentSucceeded).not.toHaveBeenCalled()
  })

  it('treats no-op apply results as already recovered', async () => {
    mocks.bookingFindMany.mockResolvedValue([
      { id: 'bk_4', stripeCheckoutSessionId: 'cs_4' },
    ])
    mocks.stripeRetrieve.mockResolvedValue({
      id: 'cs_4',
      payment_status: 'paid',
      payment_intent: { id: 'pi_4', amount_received: 1000, currency: 'usd' },
    })
    mocks.applyStripePaymentSucceeded.mockResolvedValue({
      bookingId: 'bk_4',
      bookingCompleted: false,
      meta: { mutated: false },
    })

    const res = await GET(authedRequest())
    const body = (await res.json()) as { tally: Record<string, number> }

    expect(body.tally.no_op_or_already_recovered).toBe(1)
  })
})
