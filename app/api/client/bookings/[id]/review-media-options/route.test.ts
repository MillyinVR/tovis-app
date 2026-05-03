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
  return {
    id: overrides?.id ?? 'media_1',
    url: `https://example.com/${overrides?.id ?? 'media_1'}.jpg`,
    thumbUrl: null,
    mediaType: overrides?.mediaType ?? MediaType.IMAGE,
    createdAt: overrides?.createdAt ?? new Date('2026-04-12T18:00:00.000Z'),
    phase: overrides?.phase ?? MediaPhase.BEFORE,
  }
}

describe('app/api/client/bookings/[id]/review-media-options/route.ts GET', () => {
  beforeEach(() => {
    vi.clearAllMocks()

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

    mocks.jsonOk.mockImplementation((body: unknown, status = 200) =>
      makeJsonResponse(status, {
        ok: true,
        ...(body as Record<string, unknown>),
      }),
    )

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
        ...item,
        createdAt: item.createdAt.toISOString(),
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
        url: true,
        thumbUrl: true,
        mediaType: true,
        createdAt: true,
        phase: true,
      },
      take: 80,
    })
  })

  it('returns 500 for unexpected errors', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})

    mocks.assertClientBookingReviewEligibility.mockRejectedValueOnce(
      new Error('boom'),
    )
    mocks.isBookingError.mockReturnValueOnce(false)

    const response = await GET(new Request('http://localhost'), makeCtx())

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: 'Internal server error.',
    })

    expect(mocks.mediaAssetFindMany).not.toHaveBeenCalled()
    expect(spy).toHaveBeenCalledWith(
      'GET /api/client/bookings/[id]/review-media-options error',
      expect.any(Error),
    )

    spy.mockRestore()
  })
})