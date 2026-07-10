// app/api/v1/client/bookings/[id]/aftercare/route.test.ts

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  prismaBookingFindUnique: vi.fn(),
  prismaBookingFindFirst: vi.fn(),
  prismaAftercareFindFirst: vi.fn(),
  prismaReviewFindFirst: vi.fn(),
  loadBookingBeforeAfterThumbsFor: vi.fn(),

  jsonFail: vi.fn(),
  jsonOk: vi.fn(),
  pickString: vi.fn((value: unknown) =>
    typeof value === 'string' && value.trim() ? value.trim() : null,
  ),
  requireClient: vi.fn(),

  safeError: vi.fn((error: unknown) => ({
    name: error instanceof Error ? error.name : 'UnknownError',
    message: error instanceof Error ? error.message : 'Unknown error',
  })),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    booking: {
      findUnique: mocks.prismaBookingFindUnique,
      findFirst: mocks.prismaBookingFindFirst,
    },
    aftercareSummary: {
      findFirst: mocks.prismaAftercareFindFirst,
    },
    review: {
      findFirst: mocks.prismaReviewFindFirst,
    },
  },
}))

vi.mock('@/app/api/_utils', () => ({
  jsonFail: mocks.jsonFail,
  jsonOk: mocks.jsonOk,
  pickString: mocks.pickString,
  requireClient: mocks.requireClient,
}))

vi.mock('@/lib/media/bookingBeforeAfter', () => ({
  loadBookingBeforeAfterThumbsFor: mocks.loadBookingBeforeAfterThumbsFor,
}))

vi.mock('@/lib/security/logging', () => ({
  safeError: mocks.safeError,
}))

import { GET } from './route'

type TestCtx = { params: Promise<{ id: string }> }

function makeCtx(id = 'booking_1'): TestCtx {
  return { params: Promise.resolve({ id }) }
}

function makeRequest(): Request {
  return new Request(
    'http://localhost/api/v1/client/bookings/booking_1/aftercare',
    { method: 'GET' },
  )
}

const EMPTY_BEFORE_AFTER = {
  beforeUrl: null,
  afterUrl: null,
  beforeFullUrl: null,
  afterFullUrl: null,
}

// The default booking read: an in-progress, editable-eligible booking with no
// checkout selection yet. Individual tests override the fields they exercise.
function bookingRead(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: 'booking_1',
    clientId: 'client_1',
    status: 'COMPLETED',
    finishedAt: null,
    checkoutStatus: 'READY',
    paymentAuthorizedAt: null,
    paymentCollectedAt: null,
    checkoutProductItems: [],
    ...overrides,
  }
}

describe('app/api/v1/client/bookings/[id]/aftercare/route.ts', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.clearAllMocks()

    consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined)

    mocks.jsonFail.mockImplementation((status: number, error: string) => ({
      ok: false,
      status,
      error,
    }))
    mocks.jsonOk.mockImplementation((body: unknown, status = 200) => ({
      ok: true,
      status,
      body,
    }))
    mocks.requireClient.mockResolvedValue({ ok: true, clientId: 'client_1' })
    // Same mock drives both the ownership gate (reads id + clientId) and the
    // status/checkout read; return every field either call selects.
    mocks.prismaBookingFindUnique.mockResolvedValue(bookingRead())
    mocks.prismaAftercareFindFirst.mockResolvedValue(null)
    // No coupled AFTERCARE-sourced next booking by default.
    mocks.prismaBookingFindFirst.mockResolvedValue(null)
    // No existing client review by default.
    mocks.prismaReviewFindFirst.mockResolvedValue(null)
    mocks.loadBookingBeforeAfterThumbsFor.mockResolvedValue(EMPTY_BEFORE_AFTER)
  })

  afterEach(() => {
    consoleErrorSpy.mockRestore()
  })

  it('returns the auth response when requireClient fails', async () => {
    const authRes = { ok: false, status: 401, error: 'Unauthorized' }
    mocks.requireClient.mockResolvedValueOnce({ ok: false, res: authRes })

    const result = await GET(makeRequest(), makeCtx())

    expect(result).toBe(authRes)
    expect(mocks.prismaBookingFindUnique).not.toHaveBeenCalled()
  })

  it('returns 400 when the booking id is missing', async () => {
    const result = await GET(makeRequest(), makeCtx(''))

    expect(mocks.jsonFail).toHaveBeenCalledWith(400, 'Missing booking id.')
    expect(result).toEqual({ ok: false, status: 400, error: 'Missing booking id.' })
  })

  it('returns 404 when the booking belongs to another client (no existence leak)', async () => {
    mocks.prismaBookingFindUnique.mockResolvedValueOnce(
      bookingRead({ clientId: 'other_client' }),
    )

    const result = await GET(makeRequest(), makeCtx())

    expect(mocks.jsonFail).toHaveBeenCalledWith(404, 'Booking not found.')
    expect(result).toEqual({ ok: false, status: 404, error: 'Booking not found.' })
    // Never resolves aftercare content for a booking the client doesn't own.
    expect(mocks.loadBookingBeforeAfterThumbsFor).not.toHaveBeenCalled()
  })

  it('shows aftercare for a COMPLETED booking even without a sent summary', async () => {
    const beforeAfter = {
      beforeUrl: 'https://cdn/thumb-before.jpg',
      afterUrl: 'https://cdn/thumb-after.jpg',
      beforeFullUrl: 'https://cdn/full-before.jpg',
      afterFullUrl: 'https://cdn/full-after.jpg',
    }
    mocks.loadBookingBeforeAfterThumbsFor.mockResolvedValueOnce(beforeAfter)

    const result = await GET(makeRequest(), makeCtx())

    expect(mocks.loadBookingBeforeAfterThumbsFor).toHaveBeenCalledWith('booking_1')
    expect(result).toEqual({
      ok: true,
      status: 200,
      body: {
        canShowAftercare: true,
        aftercare: null,
        beforeAfter,
        recommendedProducts: [],
        checkoutProducts: [],
        // No sent summary ⇒ no rebook recommendation to surface.
        rebook: null,
        // No sent summary ⇒ review is gated off (null + not eligible).
        existingReview: null,
        reviewEligible: false,
        // COMPLETED locks product editing even though the surface shows.
        checkoutProductsEditable: false,
      },
    })
  })

  it('maps a sent aftercare summary (notes + ISO sentToClientAt + recommendations) and the current selection', async () => {
    mocks.prismaBookingFindUnique.mockResolvedValue(
      bookingRead({
        status: 'ACCEPTED',
        checkoutProductItems: [
          {
            recommendationId: 'rp_2',
            productId: 'prod_9',
            quantity: 2,
            unitPrice: '28.00',
          },
        ],
      }),
    )
    mocks.prismaAftercareFindFirst.mockResolvedValueOnce({
      id: 'ac_1',
      notes: 'Rinse with cool water for 48h.',
      sentToClientAt: new Date('2026-07-02T15:00:00.000Z'),
      rebookMode: 'NONE',
      rebookedFor: null,
      rebookWindowStart: null,
      rebookWindowEnd: null,
      rebookDeclinedAt: null,
      recommendedProducts: [
        {
          id: 'rp_1',
          productId: null,
          note: 'AM only',
          externalName: 'Olaplex No.7',
          externalUrl: 'https://example.com/olaplex-7',
          product: null,
        },
        {
          id: 'rp_2',
          productId: 'prod_9',
          note: null,
          externalName: null,
          externalUrl: null,
          product: {
            id: 'prod_9',
            name: 'Purple Toning Shampoo',
            brand: 'Tovis',
            retailPrice: '28.00',
          },
        },
      ],
    })

    const result = await GET(makeRequest(), makeCtx())

    expect(mocks.prismaAftercareFindFirst).toHaveBeenCalledWith({
      where: { bookingId: 'booking_1', sentToClientAt: { not: null } },
      select: {
        id: true,
        notes: true,
        sentToClientAt: true,
        rebookMode: true,
        rebookedFor: true,
        rebookWindowStart: true,
        rebookWindowEnd: true,
        rebookDeclinedAt: true,
        recommendedProducts: {
          take: 50,
          orderBy: { id: 'asc' },
          select: {
            id: true,
            productId: true,
            note: true,
            externalName: true,
            externalUrl: true,
            product: {
              select: { id: true, name: true, brand: true, retailPrice: true },
            },
          },
        },
      },
    })
    expect(result).toEqual({
      ok: true,
      status: 200,
      body: {
        canShowAftercare: true,
        aftercare: {
          id: 'ac_1',
          notes: 'Rinse with cool water for 48h.',
          sentToClientAt: '2026-07-02T15:00:00.000Z',
        },
        beforeAfter: EMPTY_BEFORE_AFTER,
        recommendedProducts: [
          {
            id: 'rp_1',
            productId: null,
            note: 'AM only',
            externalName: 'Olaplex No.7',
            externalUrl: 'https://example.com/olaplex-7',
            product: null,
          },
          {
            id: 'rp_2',
            productId: 'prod_9',
            note: null,
            externalName: null,
            externalUrl: null,
            product: {
              id: 'prod_9',
              name: 'Purple Toning Shampoo',
              brand: 'Tovis',
              retailPrice: '28',
            },
          },
        ],
        checkoutProducts: [
          {
            recommendationId: 'rp_2',
            productId: 'prod_9',
            quantity: 2,
            unitPrice: '28',
          },
        ],
        // Sent summary, no rebook recommendation set (mode NONE) + no coupled next.
        rebook: {
          mode: 'NONE',
          rebookedFor: null,
          windowStart: null,
          windowEnd: null,
          declinedAt: null,
          nextBooking: null,
        },
        // No review left yet; ACCEPTED (not completed/finished + unpaid) ⇒ not eligible.
        existingReview: null,
        reviewEligible: false,
        // ACCEPTED + sent aftercare + no payment yet ⇒ editable.
        checkoutProductsEditable: true,
      },
    })
  })

  it('locks product editing once payment is collected (but still shows recommendations)', async () => {
    mocks.prismaBookingFindUnique.mockResolvedValue(
      bookingRead({
        status: 'ACCEPTED',
        checkoutStatus: 'PAID',
        paymentCollectedAt: new Date('2026-07-03T10:00:00.000Z'),
      }),
    )
    mocks.prismaAftercareFindFirst.mockResolvedValueOnce({
      id: 'ac_1',
      notes: null,
      sentToClientAt: new Date('2026-07-02T15:00:00.000Z'),
      rebookMode: 'NONE',
      rebookedFor: null,
      rebookWindowStart: null,
      rebookWindowEnd: null,
      rebookDeclinedAt: null,
      recommendedProducts: [],
    })

    const result = await GET(makeRequest(), makeCtx())

    expect(result).toEqual({
      ok: true,
      status: 200,
      body: {
        canShowAftercare: true,
        aftercare: {
          id: 'ac_1',
          notes: null,
          sentToClientAt: '2026-07-02T15:00:00.000Z',
        },
        beforeAfter: EMPTY_BEFORE_AFTER,
        recommendedProducts: [],
        checkoutProducts: [],
        rebook: {
          mode: 'NONE',
          rebookedFor: null,
          windowStart: null,
          windowEnd: null,
          declinedAt: null,
          nextBooking: null,
        },
        // ACCEPTED (not COMPLETED) ⇒ review not eligible despite paid closeout.
        existingReview: null,
        reviewEligible: false,
        checkoutProductsEditable: false,
      },
    })
  })

  it('surfaces a RECOMMENDED_WINDOW rebook slice (ISO window) with no coupled next booking', async () => {
    mocks.prismaBookingFindUnique.mockResolvedValue(
      bookingRead({ status: 'COMPLETED' }),
    )
    mocks.prismaAftercareFindFirst.mockResolvedValueOnce({
      id: 'ac_1',
      notes: null,
      sentToClientAt: new Date('2026-07-02T15:00:00.000Z'),
      rebookMode: 'RECOMMENDED_WINDOW',
      rebookedFor: null,
      rebookWindowStart: new Date('2026-08-01T00:00:00.000Z'),
      rebookWindowEnd: new Date('2026-08-15T00:00:00.000Z'),
      rebookDeclinedAt: null,
      recommendedProducts: [],
    })

    const result = await GET(makeRequest(), makeCtx())

    // The coupled-next lookup is scoped to this booking + the authed client.
    expect(mocks.prismaBookingFindFirst).toHaveBeenCalledWith({
      where: { rebookOfBookingId: 'booking_1', clientId: 'client_1' },
      orderBy: { scheduledFor: 'desc' },
      select: { id: true, status: true, scheduledFor: true },
    })
    expect(result).toEqual({
      ok: true,
      status: 200,
      body: {
        canShowAftercare: true,
        aftercare: {
          id: 'ac_1',
          notes: null,
          sentToClientAt: '2026-07-02T15:00:00.000Z',
        },
        beforeAfter: EMPTY_BEFORE_AFTER,
        recommendedProducts: [],
        checkoutProducts: [],
        rebook: {
          mode: 'RECOMMENDED_WINDOW',
          rebookedFor: null,
          windowStart: '2026-08-01T00:00:00.000Z',
          windowEnd: '2026-08-15T00:00:00.000Z',
          declinedAt: null,
          nextBooking: null,
        },
        // COMPLETED but not finished + unpaid ⇒ review not eligible yet.
        existingReview: null,
        reviewEligible: false,
        checkoutProductsEditable: false,
      },
    })
  })

  it('surfaces a coupled next booking (confirmed BOOKED_NEXT_APPOINTMENT) as ISO', async () => {
    mocks.prismaBookingFindUnique.mockResolvedValue(
      bookingRead({ status: 'COMPLETED' }),
    )
    mocks.prismaAftercareFindFirst.mockResolvedValueOnce({
      id: 'ac_1',
      notes: null,
      sentToClientAt: new Date('2026-07-02T15:00:00.000Z'),
      rebookMode: 'BOOKED_NEXT_APPOINTMENT',
      rebookedFor: new Date('2026-08-05T17:00:00.000Z'),
      rebookWindowStart: null,
      rebookWindowEnd: null,
      rebookDeclinedAt: null,
      recommendedProducts: [],
    })
    mocks.prismaBookingFindFirst.mockResolvedValueOnce({
      id: 'booking_next',
      status: 'PENDING',
      scheduledFor: new Date('2026-08-05T17:00:00.000Z'),
    })

    const result = await GET(makeRequest(), makeCtx())

    expect(result).toEqual({
      ok: true,
      status: 200,
      body: {
        canShowAftercare: true,
        aftercare: {
          id: 'ac_1',
          notes: null,
          sentToClientAt: '2026-07-02T15:00:00.000Z',
        },
        beforeAfter: EMPTY_BEFORE_AFTER,
        recommendedProducts: [],
        checkoutProducts: [],
        rebook: {
          mode: 'BOOKED_NEXT_APPOINTMENT',
          rebookedFor: '2026-08-05T17:00:00.000Z',
          windowStart: null,
          windowEnd: null,
          declinedAt: null,
          nextBooking: {
            id: 'booking_next',
            status: 'PENDING',
            scheduledFor: '2026-08-05T17:00:00.000Z',
          },
        },
        existingReview: null,
        reviewEligible: false,
        checkoutProductsEditable: false,
      },
    })
  })

  it('hides aftercare when the booking is not completed and no summary is sent', async () => {
    mocks.prismaBookingFindUnique.mockResolvedValue(
      bookingRead({ status: 'ACCEPTED' }),
    )

    const result = await GET(makeRequest(), makeCtx())

    expect(result).toEqual({
      ok: true,
      status: 200,
      body: {
        canShowAftercare: false,
        aftercare: null,
        beforeAfter: EMPTY_BEFORE_AFTER,
        recommendedProducts: [],
        checkoutProducts: [],
        rebook: null,
        existingReview: null,
        reviewEligible: false,
        // No sent aftercare ⇒ not editable.
        checkoutProductsEditable: false,
      },
    })
  })

  it('surfaces reviewEligible + the existing review once closeout is complete', async () => {
    mocks.prismaBookingFindUnique.mockResolvedValue(
      bookingRead({
        status: 'COMPLETED',
        finishedAt: new Date('2026-07-02T14:00:00.000Z'),
        checkoutStatus: 'PAID',
        paymentCollectedAt: new Date('2026-07-02T16:00:00.000Z'),
      }),
    )
    mocks.prismaAftercareFindFirst.mockResolvedValueOnce({
      id: 'ac_1',
      notes: 'Rinse with cool water for 48h.',
      sentToClientAt: new Date('2026-07-02T15:00:00.000Z'),
      rebookMode: 'NONE',
      rebookedFor: null,
      rebookWindowStart: null,
      rebookWindowEnd: null,
      rebookDeclinedAt: null,
      recommendedProducts: [],
    })
    mocks.prismaReviewFindFirst.mockResolvedValueOnce({
      id: 'rev_1',
      rating: 5,
      headline: 'Loved it',
      body: 'Best color of my life.',
    })

    const result = await GET(makeRequest(), makeCtx())

    // The review lookup is scoped to this booking + the authed client (text slice
    // only — media is A3-rev 4b).
    expect(mocks.prismaReviewFindFirst).toHaveBeenCalledWith({
      where: { bookingId: 'booking_1', clientId: 'client_1' },
      orderBy: { createdAt: 'desc' },
      select: { id: true, rating: true, headline: true, body: true },
    })
    expect(result).toEqual({
      ok: true,
      status: 200,
      body: {
        canShowAftercare: true,
        aftercare: {
          id: 'ac_1',
          notes: 'Rinse with cool water for 48h.',
          sentToClientAt: '2026-07-02T15:00:00.000Z',
        },
        beforeAfter: EMPTY_BEFORE_AFTER,
        recommendedProducts: [],
        checkoutProducts: [],
        rebook: {
          mode: 'NONE',
          rebookedFor: null,
          windowStart: null,
          windowEnd: null,
          declinedAt: null,
          nextBooking: null,
        },
        existingReview: {
          id: 'rev_1',
          rating: 5,
          headline: 'Loved it',
          body: 'Best color of my life.',
        },
        // COMPLETED + finished + PAID + collected + sent summary ⇒ eligible.
        reviewEligible: true,
        // Payment collected ⇒ product editing locked.
        checkoutProductsEditable: false,
      },
    })
  })

  it('gates the existing review off until a summary is sent (no leak pre-aftercare)', async () => {
    // Closeout-complete booking, a review row exists, but NO sent summary — the
    // review* fields are gated exactly like `aftercare`, so both stay off.
    mocks.prismaBookingFindUnique.mockResolvedValue(
      bookingRead({
        status: 'COMPLETED',
        finishedAt: new Date('2026-07-02T14:00:00.000Z'),
        checkoutStatus: 'PAID',
        paymentCollectedAt: new Date('2026-07-02T16:00:00.000Z'),
      }),
    )
    mocks.prismaAftercareFindFirst.mockResolvedValueOnce(null)
    mocks.prismaReviewFindFirst.mockResolvedValueOnce({
      id: 'rev_1',
      rating: 4,
      headline: null,
      body: null,
    })

    const result = await GET(makeRequest(), makeCtx())

    expect(result).toMatchObject({
      ok: true,
      status: 200,
      body: {
        aftercare: null,
        existingReview: null,
        reviewEligible: false,
      },
    })
  })

  it('returns 500 and logs a safe error on an unexpected throw', async () => {
    const thrown = new Error('db blew up')
    mocks.loadBookingBeforeAfterThumbsFor.mockRejectedValueOnce(thrown)

    const result = await GET(makeRequest(), makeCtx())

    expect(mocks.safeError).toHaveBeenCalledWith(thrown)
    expect(mocks.jsonFail).toHaveBeenCalledWith(500, 'Internal server error')
    expect(result).toEqual({ ok: false, status: 500, error: 'Internal server error' })
  })
})
