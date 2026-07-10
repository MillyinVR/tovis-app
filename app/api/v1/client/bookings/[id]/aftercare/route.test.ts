// app/api/v1/client/bookings/[id]/aftercare/route.test.ts

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  prismaBookingFindUnique: vi.fn(),
  prismaAftercareFindFirst: vi.fn(),
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
    },
    aftercareSummary: {
      findFirst: mocks.prismaAftercareFindFirst,
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
        // No sent aftercare ⇒ not editable.
        checkoutProductsEditable: false,
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
