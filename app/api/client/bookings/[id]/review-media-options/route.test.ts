// app/api/client/bookings/[id]/review-media-options/route.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  MediaPhase,
  MediaType,
  MediaVisibility,
  Role,
} from '@prisma/client'

const mocks = vi.hoisted(() => ({
  requireClient: vi.fn(),
  pickString: vi.fn(),
  jsonFail: vi.fn(),
  jsonOk: vi.fn(),

  mediaAssetFindMany: vi.fn(),

  assertClientBookingReviewEligibility: vi.fn(),

  getBookingFailPayload: vi.fn(),
  isBookingError: vi.fn(),
}))

const mockRenderMediaUrls = vi.hoisted(() => vi.fn())

vi.mock('@/app/api/_utils', () => ({
  requireClient: mocks.requireClient,
  pickString: mocks.pickString,
  jsonFail: mocks.jsonFail,
  jsonOk: mocks.jsonOk,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    mediaAsset: {
      findMany: mocks.mediaAssetFindMany,
    },
  },
}))

vi.mock('@/lib/booking/writeBoundary', () => ({
  assertClientBookingReviewEligibility:
    mocks.assertClientBookingReviewEligibility,
}))

vi.mock('@/lib/booking/errors', () => ({
  getBookingFailPayload: mocks.getBookingFailPayload,
  isBookingError: mocks.isBookingError,
}))

vi.mock('@/lib/media/renderUrls', () => ({
  renderMediaUrls: mockRenderMediaUrls,
}))

import { GET } from './route'

function makeJsonResponse(status: number, payload: unknown) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function makeCtx(id = 'booking_1') {
  return {
    params: Promise.resolve({ id }),
  }
}

function makeEligibility() {
  return {
    booking: {
      id: 'booking_1',
      professionalId: 'pro_1',
    },
    meta: {
      mutated: false,
      noOp: true,
    },
  }
}

function makeMedia(overrides?: {
  id?: string
  phase?: MediaPhase
  createdAt?: Date
  mediaType?: MediaType
}) {
  const id = overrides?.id ?? 'media_1'

  return {
    id,
    storageBucket: 'booking-media',
    storagePath: `${id}.jpg`,
    thumbBucket: 'booking-media-thumbs',
    thumbPath: `${id}-thumb.jpg`,
    url: null,
    thumbUrl: null,
    mediaType: overrides?.mediaType ?? MediaType.IMAGE,
    createdAt: overrides?.createdAt ?? new Date('2026-04-12T18:00:00.000Z'),
    phase: overrides?.phase ?? MediaPhase.BEFORE,
  }
}

describe('app/api/client/bookings/[id]/review-media-options/route.ts GET', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mockRenderMediaUrls.mockReset()

    mockRenderMediaUrls.mockImplementation(
      async (row: {
        storageBucket: string | null
        storagePath: string | null
        thumbBucket: string | null
        thumbPath: string | null
        url: string | null
        thumbUrl: string | null
      }) => ({
        renderUrl:
          row.url ??
          (row.storageBucket && row.storagePath
            ? `https://media.test/${row.storageBucket}/${row.storagePath}`
            : null),
        renderThumbUrl:
          row.thumbUrl ??
          (row.thumbBucket && row.thumbPath
            ? `https://media.test/${row.thumbBucket}/${row.thumbPath}`
            : null),
      }),
    )

    mocks.requireClient.mockResolvedValue({
      ok: true,
      clientId: 'client_1',
      user: {
        id: 'user_1',
      },
    })

    mocks.pickString.mockImplementation((value: unknown) =>
      typeof value === 'string' && value.trim() ? value.trim() : null,
    )

    mocks.jsonFail.mockImplementation(
      (status: number, error: string, extra?: Record<string, unknown>) =>
        makeJsonResponse(status, {
          ok: false,
          error,
          ...(extra ?? {}),
        }),
    )

    mocks.jsonOk.mockImplementation((body: unknown, status = 200) => {
      const payload =
        typeof body === 'object' && body !== null && !Array.isArray(body)
          ? body
          : {}

      return makeJsonResponse(status, {
        ok: true,
        ...payload,
      })
    })

    mocks.assertClientBookingReviewEligibility.mockResolvedValue(
      makeEligibility(),
    )

    mocks.mediaAssetFindMany.mockResolvedValue([])
    mocks.isBookingError.mockReturnValue(false)
  })

  it('returns auth response when requireClient fails', async () => {
    const authRes = makeJsonResponse(401, {
      ok: false,
      error: 'Unauthorized',
    })

    mocks.requireClient.mockResolvedValueOnce({
      ok: false,
      res: authRes,
    })

    const response = await GET(new Request('http://localhost'), makeCtx())

    expect(response).toBe(authRes)
    expect(mocks.assertClientBookingReviewEligibility).not.toHaveBeenCalled()
    expect(mocks.mediaAssetFindMany).not.toHaveBeenCalled()
    expect(mockRenderMediaUrls).not.toHaveBeenCalled()
  })

  it('returns 400 when booking id is missing', async () => {
    const response = await GET(new Request('http://localhost'), makeCtx('   '))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: 'Missing booking id.',
    })

    expect(mocks.assertClientBookingReviewEligibility).not.toHaveBeenCalled()
    expect(mocks.mediaAssetFindMany).not.toHaveBeenCalled()
    expect(mockRenderMediaUrls).not.toHaveBeenCalled()
  })

  it('maps booking eligibility errors through bookingJsonFail', async () => {
    const bookingError = {
      code: 'FORBIDDEN',
      message: 'Booking belongs to another client.',
      userMessage: 'You do not have access to that booking.',
    }

    mocks.assertClientBookingReviewEligibility.mockRejectedValueOnce(
      bookingError,
    )
    mocks.isBookingError.mockReturnValueOnce(true)
    mocks.getBookingFailPayload.mockReturnValueOnce({
      httpStatus: 403,
      userMessage: 'You do not have access to that booking.',
      extra: {
        code: 'FORBIDDEN',
        message: 'Booking belongs to another client.',
      },
    })

    const response = await GET(new Request('http://localhost'), makeCtx())

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: 'You do not have access to that booking.',
      code: 'FORBIDDEN',
      message: 'Booking belongs to another client.',
    })

    expect(mocks.getBookingFailPayload).toHaveBeenCalledWith('FORBIDDEN', {
      message: 'Booking belongs to another client.',
      userMessage: 'You do not have access to that booking.',
    })
    expect(mocks.mediaAssetFindMany).not.toHaveBeenCalled()
    expect(mockRenderMediaUrls).not.toHaveBeenCalled()
  })

  it('returns eligible review media sorted by phase and newest within each phase', async () => {
    const beforeOlder = makeMedia({
      id: 'before_older',
      phase: MediaPhase.BEFORE,
      createdAt: new Date('2026-04-12T18:00:00.000Z'),
    })
    const beforeNewer = makeMedia({
      id: 'before_newer',
      phase: MediaPhase.BEFORE,
      createdAt: new Date('2026-04-12T19:00:00.000Z'),
    })
    const after = makeMedia({
      id: 'after_1',
      phase: MediaPhase.AFTER,
      createdAt: new Date('2026-04-12T20:00:00.000Z'),
    })
    const other = makeMedia({
      id: 'other_1',
      phase: MediaPhase.OTHER,
      createdAt: new Date('2026-04-12T21:00:00.000Z'),
      mediaType: MediaType.VIDEO,
    })

    mocks.mediaAssetFindMany.mockResolvedValueOnce([
      other,
      after,
      beforeOlder,
      beforeNewer,
    ])

    const response = await GET(new Request('http://localhost'), makeCtx())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      ok: true,
      items: [beforeNewer, beforeOlder, after, other].map((item) => ({
        id: item.id,
        url: `https://media.test/${item.storageBucket}/${item.storagePath}`,
        thumbUrl: `https://media.test/${item.thumbBucket}/${item.thumbPath}`,
        mediaType: item.mediaType,
        createdAt: item.createdAt.toISOString(),
        phase: item.phase,
      })),
    })

    expect(mocks.assertClientBookingReviewEligibility).toHaveBeenCalledWith({
      bookingId: 'booking_1',
      clientId: 'client_1',
    })

    expect(mocks.mediaAssetFindMany).toHaveBeenCalledWith({
      where: {
        bookingId: 'booking_1',
        professionalId: 'pro_1',
        reviewId: null,
        reviewLocked: false,
        visibility: MediaVisibility.PRO_CLIENT,
        mediaType: { in: [MediaType.IMAGE, MediaType.VIDEO] },
        uploadedByRole: Role.PRO,
      },
      select: {
        id: true,
        storageBucket: true,
        storagePath: true,
        thumbBucket: true,
        thumbPath: true,
        url: true,
        thumbUrl: true,
        mediaType: true,
        createdAt: true,
        phase: true,
      },
      take: 80,
    })

    expect(mockRenderMediaUrls).toHaveBeenCalledTimes(4)

    expect(mockRenderMediaUrls).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'before_newer',
        storageBucket: 'booking-media',
        storagePath: 'before_newer.jpg',
        thumbBucket: 'booking-media-thumbs',
        thumbPath: 'before_newer-thumb.jpg',
      }),
    )

    expect(mockRenderMediaUrls).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'before_older',
        storageBucket: 'booking-media',
        storagePath: 'before_older.jpg',
        thumbBucket: 'booking-media-thumbs',
        thumbPath: 'before_older-thumb.jpg',
      }),
    )

    expect(mockRenderMediaUrls).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'after_1',
        storageBucket: 'booking-media',
        storagePath: 'after_1.jpg',
        thumbBucket: 'booking-media-thumbs',
        thumbPath: 'after_1-thumb.jpg',
      }),
    )

    expect(mockRenderMediaUrls).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'other_1',
        storageBucket: 'booking-media',
        storagePath: 'other_1.jpg',
        thumbBucket: 'booking-media-thumbs',
        thumbPath: 'other_1-thumb.jpg',
      }),
    )
  })

  it('returns 500 for unexpected errors', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    mocks.assertClientBookingReviewEligibility.mockRejectedValueOnce(
      new Error('boom'),
    )
    mocks.isBookingError.mockReturnValueOnce(false)

    try {
      const response = await GET(new Request('http://localhost'), makeCtx())

      expect(response.status).toBe(500)
      await expect(response.json()).resolves.toEqual({
        ok: false,
        error: 'Internal server error.',
      })

      expect(mocks.mediaAssetFindMany).not.toHaveBeenCalled()
      expect(mockRenderMediaUrls).not.toHaveBeenCalled()
      expect(spy).toHaveBeenCalledWith(
        'GET /api/client/bookings/[id]/review-media-options error',
        expect.any(Error),
      )
    } finally {
      spy.mockRestore()
    }
  })
})