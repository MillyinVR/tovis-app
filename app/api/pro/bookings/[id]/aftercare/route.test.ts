import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AftercareRebookMode, BookingStatus } from '@prisma/client'

const mocks = vi.hoisted(() => ({
  requirePro: vi.fn(),
  jsonFail: vi.fn(),
  jsonOk: vi.fn(),
  pickString: vi.fn(),

  isRecord: vi.fn(),
  isValidIanaTimeZone: vi.fn(),

  getBookingFailPayload: vi.fn(),
  isBookingError: vi.fn(),

  bookingFindUnique: vi.fn(),
  upsertBookingAftercare: vi.fn(),
}))

vi.mock('@/app/api/_utils', () => ({
  jsonFail: mocks.jsonFail,
  jsonOk: mocks.jsonOk,
  pickString: mocks.pickString,
  requirePro: mocks.requirePro,
}))

vi.mock('@/lib/guards', () => ({
  isRecord: mocks.isRecord,
}))

vi.mock('@/lib/timeZone', () => ({
  isValidIanaTimeZone: mocks.isValidIanaTimeZone,
}))

vi.mock('@/lib/booking/errors', () => ({
  getBookingFailPayload: mocks.getBookingFailPayload,
  isBookingError: mocks.isBookingError,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    booking: {
      findUnique: mocks.bookingFindUnique,
    },
  },
}))

vi.mock('@/lib/booking/writeBoundary', () => ({
  upsertBookingAftercare: mocks.upsertBookingAftercare,
}))

import { GET, POST } from './route'

function makeCtx(id = 'booking_1') {
  return {
    params: Promise.resolve({ id }),
  }
}

function makeRequest(body?: unknown): Request {
  return new Request('http://localhost/api/pro/bookings/booking_1/aftercare', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

function makeGetBooking(overrides?: {
  professionalId?: string
  aftercareSummary?: Record<string, unknown> | null
}) {
  return {
    id: 'booking_1',
    professionalId: overrides?.professionalId ?? 'pro_1',
    status: BookingStatus.COMPLETED,
    sessionStep: 'AFTER_PHOTOS',
    scheduledFor: new Date('2026-04-12T18:00:00.000Z'),
    finishedAt: new Date('2026-04-12T20:00:00.000Z'),
    locationTimeZone: 'America/Los_Angeles',
    aftercareSummary:
      overrides && 'aftercareSummary' in overrides
        ? overrides.aftercareSummary
        : {
            id: 'aftercare_1',
            notes: 'Use a sulfate-free shampoo.',
            rebookMode: AftercareRebookMode.RECOMMENDED_WINDOW,
            rebookedFor: null,
            rebookWindowStart: new Date('2026-05-01T18:00:00.000Z'),
            rebookWindowEnd: new Date('2026-05-15T18:00:00.000Z'),
            publicToken: 'public_1',
            draftSavedAt: new Date('2026-04-12T20:05:00.000Z'),
            sentToClientAt: new Date('2026-04-12T20:10:00.000Z'),
            lastEditedAt: new Date('2026-04-12T20:08:00.000Z'),
            version: 3,
            recommendedProducts: [
              {
                id: 'rp_1',
                note: 'Use twice weekly',
                productId: 'prod_1',
                externalName: null,
                externalUrl: null,
                product: {
                  id: 'prod_1',
                  name: 'Repair Mask',
                  brand: 'TOVIS',
                  retailPrice: {
                    toString: () => '19.99',
                  },
                },
              },
              {
                id: 'rp_2',
                note: 'Nightly',
                productId: null,
                externalName: 'Silk Pillowcase',
                externalUrl: 'https://example.com/pillowcase',
                product: null,
              },
            ],
          },
  }
}

function makeUpsertResult(overrides?: {
  publicToken?: string | null
  rebookMode?: AftercareRebookMode
  rebookedFor?: Date | null
  rebookWindowStart?: Date | null
  rebookWindowEnd?: Date | null
  sentToClientAt?: Date | null
  bookingFinished?: boolean
}) {
  return {
    aftercare: {
      id: 'aftercare_1',
      publicToken:
        overrides && 'publicToken' in overrides ? overrides.publicToken : 'public_1',
      rebookMode:
        overrides?.rebookMode ?? AftercareRebookMode.RECOMMENDED_WINDOW,
      rebookedFor: overrides?.rebookedFor ?? null,
      rebookWindowStart:
        overrides?.rebookWindowStart ?? new Date('2026-05-01T18:00:00.000Z'),
      rebookWindowEnd:
        overrides?.rebookWindowEnd ?? new Date('2026-05-15T18:00:00.000Z'),
      draftSavedAt: new Date('2026-04-12T20:05:00.000Z'),
      sentToClientAt:
        overrides && 'sentToClientAt' in overrides
          ? overrides.sentToClientAt
          : new Date('2026-04-12T20:10:00.000Z'),
      lastEditedAt: new Date('2026-04-12T20:08:00.000Z'),
      version: 4,
    },
    remindersTouched: true,
    clientNotified: true,
    timeZoneUsed: 'America/Los_Angeles',
    bookingFinished: overrides?.bookingFinished ?? true,
    booking: {
      status: BookingStatus.COMPLETED,
      sessionStep: 'DONE',
      finishedAt: new Date('2026-04-12T20:00:00.000Z'),
    },
    meta: {
      mutated: true,
      noOp: false,
    },
  }
}

describe('app/api/pro/bookings/[id]/aftercare/route.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mocks.requirePro.mockResolvedValue({
      ok: true,
      professionalId: 'pro_1',
      user: { id: 'user_1' },
    })

    mocks.jsonFail.mockImplementation(
      (status: number, error: string, extra?: Record<string, unknown>) => ({
        ok: false,
        status,
        error,
        ...(extra ?? {}),
      }),
    )

    mocks.jsonOk.mockImplementation((data: unknown, status = 200) => ({
      ok: true,
      status,
      data,
    }))

    mocks.pickString.mockImplementation((value: unknown) => {
      if (typeof value !== 'string') return null
      const trimmed = value.trim()
      return trimmed.length > 0 ? trimmed : null
    })

    mocks.isRecord.mockImplementation(
      (value: unknown) =>
        typeof value === 'object' && value !== null && !Array.isArray(value),
    )

    mocks.isValidIanaTimeZone.mockImplementation(
      (value: string) => value === 'America/Los_Angeles' || value === 'UTC',
    )

    mocks.isBookingError.mockReturnValue(false)

    mocks.getBookingFailPayload.mockImplementation(
      (
        code: string,
        overrides?: { message?: string; userMessage?: string },
      ) => ({
        httpStatus: code === 'FORBIDDEN' ? 403 : 409,
        userMessage: overrides?.userMessage ?? overrides?.message ?? code,
        extra: {
          code,
          ...(overrides?.message ? { message: overrides.message } : {}),
        },
      }),
    )

    mocks.bookingFindUnique.mockResolvedValue(makeGetBooking())
    mocks.upsertBookingAftercare.mockResolvedValue(makeUpsertResult())
  })

  it('GET returns auth response when requirePro fails', async () => {
    const authRes = { ok: false, status: 401, error: 'Unauthorized' }
    mocks.requirePro.mockResolvedValueOnce({
      ok: false,
      res: authRes,
    })

    const result = await GET(new Request('http://localhost/test'), makeCtx())

    expect(result).toBe(authRes)
    expect(mocks.bookingFindUnique).not.toHaveBeenCalled()
  })

  it('GET returns 400 when booking id is missing', async () => {
    const result = await GET(new Request('http://localhost/test'), makeCtx('   '))

    expect(mocks.jsonFail).toHaveBeenCalledWith(400, 'Missing booking id.')
    expect(result).toEqual({
      ok: false,
      status: 400,
      error: 'Missing booking id.',
    })
  })

  it('GET returns 404 when booking is not found', async () => {
    mocks.bookingFindUnique.mockResolvedValueOnce(null)

    const result = await GET(new Request('http://localhost/test'), makeCtx())

    expect(mocks.jsonFail).toHaveBeenCalledWith(404, 'Booking not found.')
    expect(result).toEqual({
      ok: false,
      status: 404,
      error: 'Booking not found.',
    })
  })

  it('GET returns 403 when booking belongs to another professional', async () => {
    mocks.bookingFindUnique.mockResolvedValueOnce(
      makeGetBooking({ professionalId: 'pro_other' }),
    )

    const result = await GET(new Request('http://localhost/test'), makeCtx())

    expect(mocks.jsonFail).toHaveBeenCalledWith(403, 'Forbidden.')
    expect(result).toEqual({
      ok: false,
      status: 403,
      error: 'Forbidden.',
    })
  })

  it('GET returns normalized aftercare payload with publicAccess and without publicToken leakage', async () => {
    const result = await GET(new Request('http://localhost/test'), makeCtx())

    expect(mocks.bookingFindUnique).toHaveBeenCalledWith({
      where: { id: 'booking_1' },
      select: expect.any(Object),
    })

    expect(result).toEqual({
      ok: true,
      status: 200,
      data: {
        booking: {
          id: 'booking_1',
          status: BookingStatus.COMPLETED,
          sessionStep: 'AFTER_PHOTOS',
          scheduledFor: '2026-04-12T18:00:00.000Z',
          finishedAt: '2026-04-12T20:00:00.000Z',
          locationTimeZone: 'America/Los_Angeles',
          aftercareSummary: {
            id: 'aftercare_1',
            notes: 'Use a sulfate-free shampoo.',
            rebookMode: AftercareRebookMode.RECOMMENDED_WINDOW,
            rebookedFor: null,
            rebookWindowStart: '2026-05-01T18:00:00.000Z',
            rebookWindowEnd: '2026-05-15T18:00:00.000Z',
            draftSavedAt: '2026-04-12T20:05:00.000Z',
            sentToClientAt: '2026-04-12T20:10:00.000Z',
            lastEditedAt: '2026-04-12T20:08:00.000Z',
            version: 3,
            isFinalized: true,
            publicAccess: {
              accessMode: 'LEGACY_PUBLIC_TOKEN',
              hasPublicAccess: true,
              clientAftercareHref: '/client/rebook/public_1',
            },
            recommendedProducts: [
              {
                id: 'rp_1',
                note: 'Use twice weekly',
                productId: 'prod_1',
                externalName: null,
                externalUrl: null,
                product: {
                  id: 'prod_1',
                  name: 'Repair Mask',
                  brand: 'TOVIS',
                  retailPrice: '19.99',
                },
              },
              {
                id: 'rp_2',
                note: 'Nightly',
                productId: null,
                externalName: 'Silk Pillowcase',
                externalUrl: 'https://example.com/pillowcase',
                product: null,
              },
            ],
          },
        },
      },
    })

  })

  it('POST returns 400 for invalid request body', async () => {
    const result = await POST(makeRequest([]), makeCtx())

    expect(mocks.jsonFail).toHaveBeenCalledWith(400, 'Invalid request body.')
    expect(result).toEqual({
      ok: false,
      status: 400,
      error: 'Invalid request body.',
    })

    expect(mocks.upsertBookingAftercare).not.toHaveBeenCalled()
  })

  it('POST returns 400 for invalid recommendedProducts payload', async () => {
    const result = await POST(
      makeRequest({
        notes: 'hello',
        recommendedProducts: [
          {
            productId: 'prod_1',
            externalName: 'Also external',
          },
        ],
      }),
      makeCtx(),
    )

    expect(mocks.jsonFail).toHaveBeenCalledWith(
      400,
      'Each recommended product must be either an internal product or an external link, not both.',
    )
    expect(result).toEqual({
      ok: false,
      status: 400,
      error:
        'Each recommended product must be either an internal product or an external link, not both.',
    })

    expect(mocks.upsertBookingAftercare).not.toHaveBeenCalled()
  })

  it('POST returns 400 for invalid rebook mode', async () => {
    const result = await POST(
      makeRequest({
        rebookMode: 'SOMETHING_WILD',
      }),
      makeCtx(),
    )

    expect(mocks.jsonFail).toHaveBeenCalledWith(400, 'Invalid rebookMode.')
    expect(result).toEqual({
      ok: false,
      status: 400,
      error: 'Invalid rebookMode.',
    })

    expect(mocks.upsertBookingAftercare).not.toHaveBeenCalled()
  })

  it('POST returns 400 for invalid rebook date combination', async () => {
    const result = await POST(
      makeRequest({
        rebookMode: AftercareRebookMode.RECOMMENDED_WINDOW,
        rebookWindowStart: '2026-05-15T18:00:00.000Z',
        rebookWindowEnd: '2026-05-01T18:00:00.000Z',
      }),
      makeCtx(),
    )

    expect(mocks.jsonFail).toHaveBeenCalledWith(
      400,
      'rebookWindowEnd must be after rebookWindowStart.',
    )
    expect(result).toEqual({
      ok: false,
      status: 400,
      error: 'rebookWindowEnd must be after rebookWindowStart.',
    })

    expect(mocks.upsertBookingAftercare).not.toHaveBeenCalled()
  })

  it('POST calls upsertBookingAftercare with normalized values and returns publicAccess payload', async () => {
    const result = await POST(
      makeRequest({
        notes: '  Use cool water.  ',
        sendToClient: true,
        rebookMode: AftercareRebookMode.RECOMMENDED_WINDOW,
        rebookWindowStart: '2026-05-01T18:00:00.000Z',
        rebookWindowEnd: '2026-05-15T18:00:00.000Z',
        createRebookReminder: true,
        rebookReminderDaysBefore: 99,
        createProductReminder: 'true',
        productReminderDaysAfter: 0,
        recommendedProducts: [
          {
            productId: 'prod_1',
            note: '  Use twice weekly  ',
          },
          {
            externalName: 'Silk Pillowcase',
            externalUrl: 'https://example.com/pillowcase',
            note: '  Nightly  ',
          },
        ],
        timeZone: 'America/Los_Angeles',
        version: 2,
      }),
      makeCtx(),
    )

    expect(mocks.upsertBookingAftercare).toHaveBeenCalledWith({
      bookingId: 'booking_1',
      professionalId: 'pro_1',
      notes: 'Use cool water.',
      rebookMode: AftercareRebookMode.RECOMMENDED_WINDOW,
      rebookedFor: null,
      rebookWindowStart: new Date('2026-05-01T18:00:00.000Z'),
      rebookWindowEnd: new Date('2026-05-15T18:00:00.000Z'),
      createRebookReminder: true,
      rebookReminderDaysBefore: 30,
      createProductReminder: true,
      productReminderDaysAfter: 1,
      recommendedProducts: [
        {
          productId: 'prod_1',
          externalName: null,
          externalUrl: null,
          note: 'Use twice weekly',
        },
        {
          productId: null,
          externalName: 'Silk Pillowcase',
          externalUrl: 'https://example.com/pillowcase',
          note: 'Nightly',
        },
      ],
      sendToClient: true,
      version: 2,
    })

    expect(result).toEqual({
      ok: true,
      status: 200,
      data: {
        aftercare: {
          id: 'aftercare_1',
          rebookMode: AftercareRebookMode.RECOMMENDED_WINDOW,
          rebookedFor: null,
          rebookWindowStart: '2026-05-01T18:00:00.000Z',
          rebookWindowEnd: '2026-05-15T18:00:00.000Z',
          draftSavedAt: '2026-04-12T20:05:00.000Z',
          sentToClientAt: '2026-04-12T20:10:00.000Z',
          lastEditedAt: '2026-04-12T20:08:00.000Z',
          version: 4,
          isFinalized: true,
          publicAccess: {
            accessMode: 'LEGACY_PUBLIC_TOKEN',
            hasPublicAccess: true,
            clientAftercareHref: '/client/rebook/public_1',
          },
        },
        remindersTouched: true,
        clientNotified: true,
        timeZoneUsed: 'America/Los_Angeles',
        clientTimeZoneReceived: 'America/Los_Angeles',
        bookingFinished: true,
        booking: {
          status: BookingStatus.COMPLETED,
          sessionStep: 'DONE',
          finishedAt: '2026-04-12T20:00:00.000Z',
        },
        redirectTo: '/pro/calendar',
        meta: {
          mutated: true,
          noOp: false,
        },
      },
    })

  })

  it('POST maps BookingError through bookingJsonFail', async () => {
    mocks.upsertBookingAftercare.mockRejectedValueOnce({
      code: 'FORBIDDEN',
      message: 'Not allowed.',
      userMessage: 'Not allowed.',
    })
    mocks.isBookingError.mockReturnValueOnce(true)
    mocks.getBookingFailPayload.mockReturnValueOnce({
      httpStatus: 403,
      userMessage: 'Not allowed.',
      extra: {
        code: 'FORBIDDEN',
        message: 'Not allowed.',
      },
    })

    const result = await POST(
      makeRequest({
        rebookMode: AftercareRebookMode.NONE,
      }),
      makeCtx(),
    )

    expect(mocks.getBookingFailPayload).toHaveBeenCalledWith('FORBIDDEN', {
      message: 'Not allowed.',
      userMessage: 'Not allowed.',
    })

    expect(result).toEqual({
      ok: false,
      status: 403,
      error: 'Not allowed.',
      code: 'FORBIDDEN',
      message: 'Not allowed.',
    })
  })

  it('POST returns 500 for unexpected errors', async () => {
    mocks.upsertBookingAftercare.mockRejectedValueOnce(new Error('boom'))

    const result = await POST(
      makeRequest({
        rebookMode: AftercareRebookMode.NONE,
      }),
      makeCtx(),
    )

    expect(mocks.jsonFail).toHaveBeenCalledWith(500, 'Internal server error.')
    expect(result).toEqual({
      ok: false,
      status: 500,
      error: 'Internal server error.',
    })
  })
})