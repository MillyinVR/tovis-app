// app/api/client/bookings/[id]/review/route.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import {
  BookingCloseoutAuditAction,
  MediaType,
  MediaVisibility,
  Role,
} from '@prisma/client'

const mocks = vi.hoisted(() => ({
  prismaTransaction: vi.fn(),

  txReviewFindFirst: vi.fn(),
  txReviewFindUnique: vi.fn(),
  txReviewCreate: vi.fn(),

  txMediaAssetFindMany: vi.fn(),
  txMediaAssetUpdateMany: vi.fn(),
  txMediaAssetCreateMany: vi.fn(),

  requireClient: vi.fn(),
  pickString: vi.fn(),
  jsonFail: vi.fn(),
  jsonOk: vi.fn(),
  safeUrl: vi.fn(),
  resolveStoragePointers: vi.fn(),

  parseIdArray: vi.fn(),
  parseRating1to5: vi.fn(),

  assertClientBookingReviewEligibility: vi.fn(),

  createBookingCloseoutAuditLog: vi.fn(),
  normalizeIdempotencyKey: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    $transaction: mocks.prismaTransaction,
  },
}))

vi.mock('@/app/api/_utils', () => ({
  requireClient: mocks.requireClient,
  pickString: mocks.pickString,
  jsonFail: mocks.jsonFail,
  jsonOk: mocks.jsonOk,
  safeUrl: mocks.safeUrl,
  resolveStoragePointers: mocks.resolveStoragePointers,
}))

vi.mock('@/lib/media', () => ({
  parseIdArray: mocks.parseIdArray,
  parseRating1to5: mocks.parseRating1to5,
}))

vi.mock('@/lib/booking/writeBoundary', () => ({
  assertClientBookingReviewEligibility:
    mocks.assertClientBookingReviewEligibility,
}))

vi.mock('@/lib/booking/closeoutAudit', () => ({
  createBookingCloseoutAuditLog: mocks.createBookingCloseoutAuditLog,
  normalizeIdempotencyKey: mocks.normalizeIdempotencyKey,
}))

import { POST } from './route'

const tx = {
  review: {
    findFirst: mocks.txReviewFindFirst,
    findUnique: mocks.txReviewFindUnique,
    create: mocks.txReviewCreate,
  },
  mediaAsset: {
    findMany: mocks.txMediaAssetFindMany,
    updateMany: mocks.txMediaAssetUpdateMany,
    createMany: mocks.txMediaAssetCreateMany,
  },
}

function makeJsonResponse(status: number, payload: unknown) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function makeRequest(body: unknown, headers?: Record<string, string>) {
  return new NextRequest(
    'http://localhost/api/client/bookings/booking_1/review',
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(headers ?? {}),
      },
      body: JSON.stringify(body),
    },
  )
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
      status: 'COMPLETED',
      finishedAt: new Date('2026-03-25T15:30:00.000Z'),
      checkoutStatus: 'PAID',
      paymentCollectedAt: new Date('2026-03-25T15:40:00.000Z'),
      aftercareSentAt: new Date('2026-03-25T15:45:00.000Z'),
    },
    meta: {
      mutated: false,
      noOp: true,
    },
  }
}

type ReviewFixture = {
  id: string
  bookingId: string
  clientId: string
  professionalId: string
  rating: number
  headline: string
  body: string
  mediaAssets: Array<{
    id: string
    mediaType: MediaType
    createdAt: Date
    visibility: MediaVisibility
    uploadedByRole: Role
    isFeaturedInPortfolio: boolean
    isEligibleForLooks: boolean
    reviewLocked: boolean
    storageBucket: string | null
    storagePath: string | null
    thumbBucket: string | null
    thumbPath: string | null
    url: string | null
    thumbUrl: string | null
  }>
}

function makeReview(overrides?: Partial<ReviewFixture>): ReviewFixture {
  return {
    id: 'review_1',
    bookingId: 'booking_1',
    clientId: 'client_1',
    professionalId: 'pro_1',
    rating: 5,
    headline: 'Great service',
    body: 'Loved it',
    mediaAssets: [],
    ...(overrides ?? {}),
  }
}

describe('app/api/client/bookings/[id]/review/route.ts POST', () => {
  beforeEach(() => {
    vi.resetAllMocks()

    mocks.prismaTransaction.mockImplementation(
      async (run: (db: typeof tx) => Promise<unknown>) => run(tx),
    )

    mocks.requireClient.mockResolvedValue({
      ok: true,
      user: { id: 'user_1' },
      clientId: 'client_1',
    })

    mocks.pickString.mockImplementation((value: unknown) => {
      if (typeof value !== 'string') return null
      const trimmed = value.trim()
      return trimmed.length > 0 ? trimmed : null
    })

    mocks.jsonFail.mockImplementation((status: number, error: string) =>
      makeJsonResponse(status, { ok: false, error }),
    )

    mocks.jsonOk.mockImplementation((data: unknown, status = 200) =>
      makeJsonResponse(status, { ok: true, ...((data as object) ?? {}) }),
    )

    mocks.safeUrl.mockImplementation((value: unknown) => {
      if (typeof value !== 'string') return null
      const trimmed = value.trim()
      return /^https?:\/\//.test(trimmed) ? trimmed : null
    })

    mocks.resolveStoragePointers.mockImplementation(
      ({
        storageBucket,
        storagePath,
        thumbBucket,
        thumbPath,
      }: {
        storageBucket?: string | null
        storagePath?: string | null
        thumbBucket?: string | null
        thumbPath?: string | null
      }) => {
        if (!storageBucket || !storagePath) return null
        return {
          storageBucket,
          storagePath,
          thumbBucket: thumbBucket ?? null,
          thumbPath: thumbPath ?? null,
        }
      },
    )

    mocks.parseIdArray.mockImplementation((value: unknown, limit: number) => {
      if (!Array.isArray(value)) return []
      return value
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim())
        .filter(Boolean)
        .slice(0, limit)
    })

    mocks.parseRating1to5.mockImplementation((value: unknown) => {
      const n =
        typeof value === 'number'
          ? value
          : typeof value === 'string'
            ? Number(value)
            : NaN
      if (!Number.isInteger(n) || n < 1 || n > 5) return null
      return n
    })

    mocks.normalizeIdempotencyKey.mockImplementation((value?: string | null) => {
      if (typeof value !== 'string') return null
      const trimmed = value.trim()
      return trimmed.length > 0 ? trimmed : null
    })

    mocks.assertClientBookingReviewEligibility.mockResolvedValue(
      makeEligibility(),
    )
  })

  it('creates a review, attaches pro media, creates client media, and writes closeout audit', async () => {
    const fullReview = makeReview({
      mediaAssets: [
        {
          id: 'media_client_1',
          mediaType: MediaType.IMAGE,
          createdAt: new Date('2026-03-25T16:00:00.000Z'),
          visibility: MediaVisibility.PUBLIC,
          uploadedByRole: Role.CLIENT,
          isFeaturedInPortfolio: false,
          isEligibleForLooks: false,
          reviewLocked: true,
          storageBucket: 'reviews',
          storagePath: 'client/review-1.png',
          thumbBucket: 'reviews-thumbs',
          thumbPath: 'client/review-1-thumb.png',
          url: null,
          thumbUrl: null,
        },
      ],
    })

    mocks.txReviewFindFirst
      .mockResolvedValueOnce(null) // existingByKey
      .mockResolvedValueOnce(null) // existing duplicate
    mocks.txMediaAssetFindMany.mockResolvedValueOnce([{ id: 'media_pro_1' }])
    mocks.txReviewCreate.mockResolvedValueOnce({ id: 'review_1' })
    mocks.txMediaAssetUpdateMany.mockResolvedValueOnce({ count: 1 })
    mocks.txMediaAssetCreateMany.mockResolvedValueOnce({ count: 1 })
    mocks.txReviewFindUnique.mockResolvedValueOnce(fullReview)

    const req = makeRequest(
      {
        rating: 5,
        headline: 'Great service',
        body: 'Loved it',
        attachedMediaIds: ['media_pro_1'],
        idempotencyKey: 'idem_review_1',
        media: [
          {
            url: 'https://example.com/client/review-1.png',
            mediaType: MediaType.IMAGE,
            storageBucket: 'reviews',
            storagePath: 'client/review-1.png',
            thumbBucket: 'reviews-thumbs',
            thumbPath: 'client/review-1-thumb.png',
          },
        ],
      },
      {
        'x-request-id': 'req_review_1',
      },
    )

    const res = await POST(req, makeCtx())
    const json = await res.json()

    expect(res.status).toBe(201)

    expect(mocks.assertClientBookingReviewEligibility).toHaveBeenCalledWith({
      bookingId: 'booking_1',
      clientId: 'client_1',
    })

    expect(mocks.txReviewCreate).toHaveBeenCalledWith({
      data: {
        clientId: 'client_1',
        professionalId: 'pro_1',
        bookingId: 'booking_1',
        rating: 5,
        headline: 'Great service',
        body: 'Loved it',
        idempotencyKey: 'idem_review_1',
        requestId: 'req_review_1',
      },
      select: { id: true },
    })

    expect(mocks.txMediaAssetFindMany).toHaveBeenCalledWith({
      where: {
        id: { in: ['media_pro_1'] },
        bookingId: 'booking_1',
        professionalId: 'pro_1',
        uploadedByRole: Role.PRO,
        reviewId: null,
        reviewLocked: false,
        visibility: MediaVisibility.PRO_CLIENT,
        mediaType: { in: [MediaType.IMAGE, MediaType.VIDEO] },
      },
      select: { id: true },
    })

    expect(mocks.txMediaAssetUpdateMany).toHaveBeenCalledWith({
      where: {
        id: { in: ['media_pro_1'] },
      },
      data: {
        reviewId: 'review_1',
        visibility: MediaVisibility.PUBLIC,
        isEligibleForLooks: false,
        isFeaturedInPortfolio: false,
        reviewLocked: true,
      },
    })

    expect(mocks.txMediaAssetCreateMany).toHaveBeenCalledWith({
      data: [
        {
          professionalId: 'pro_1',
          bookingId: 'booking_1',
          reviewId: 'review_1',
          mediaType: MediaType.IMAGE,
          visibility: MediaVisibility.PUBLIC,
          uploadedByUserId: 'user_1',
          uploadedByRole: Role.CLIENT,
          isFeaturedInPortfolio: false,
          isEligibleForLooks: false,
          reviewLocked: true,
          storageBucket: 'reviews',
          storagePath: 'client/review-1.png',
          thumbBucket: 'reviews-thumbs',
          thumbPath: 'client/review-1-thumb.png',
          url: null,
          thumbUrl: null,
          caption: null,
        },
      ],
    })

    expect(mocks.createBookingCloseoutAuditLog).toHaveBeenCalledWith({
      tx,
      bookingId: 'booking_1',
      professionalId: 'pro_1',
      actorUserId: 'user_1',
      action: BookingCloseoutAuditAction.REVIEW_CREATED,
      route: 'app/api/client/bookings/[id]/review/route.ts:POST',
      requestId: 'req_review_1',
      idempotencyKey: 'idem_review_1',
      oldValue: null,
      newValue: {
        reviewId: 'review_1',
        rating: 5,
        headline: 'Great service',
        body: 'Loved it',
        attachedAppointmentMediaIds: ['media_pro_1'],
        clientUploadedMediaCount: 1,
      },
    })

expect(json).toEqual({
  ok: true,
  review: {
    ...fullReview,
    mediaAssets: [
      {
        id: 'media_client_1',
        mediaType: MediaType.IMAGE,
        createdAt: '2026-03-25T16:00:00.000Z',
        visibility: MediaVisibility.PUBLIC,
        uploadedByRole: Role.CLIENT,
        isFeaturedInPortfolio: false,
        isEligibleForLooks: false,
        reviewLocked: true,
        storageBucket: 'reviews',
        storagePath: 'client/review-1.png',
        thumbBucket: 'reviews-thumbs',
        thumbPath: 'client/review-1-thumb.png',
        url: null,
        thumbUrl: null,
      },
    ],
  },
})
  })

  it('returns the existing review on idempotency replay and does not create or audit again', async () => {
    const existingReview = makeReview({
      id: 'review_existing_1',
      mediaAssets: [],
    })

    mocks.txReviewFindFirst.mockResolvedValueOnce({ id: 'review_existing_1' })
    mocks.txReviewFindUnique.mockResolvedValueOnce(existingReview)

    const req = makeRequest(
      {
        rating: 5,
        headline: 'Still great',
        body: 'Retry request',
      },
      {
        'x-request-id': 'req_review_replay',
        'x-idempotency-key': 'idem_review_replay',
      },
    )

    const res = await POST(req, makeCtx())
    const json = await res.json()

    expect(res.status).toBe(200)

    expect(mocks.txReviewFindFirst).toHaveBeenCalledWith({
      where: {
        bookingId: 'booking_1',
        clientId: 'client_1',
        idempotencyKey: 'idem_review_replay',
      },
      select: { id: true },
    })

    expect(mocks.txReviewFindUnique).toHaveBeenCalledWith({
      where: { id: 'review_existing_1' },
      include: {
        mediaAssets: {
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            mediaType: true,
            createdAt: true,
            visibility: true,
            uploadedByRole: true,
            isFeaturedInPortfolio: true,
            isEligibleForLooks: true,
            reviewLocked: true,
            storageBucket: true,
            storagePath: true,
            thumbBucket: true,
            thumbPath: true,
            url: true,
            thumbUrl: true,
          },
        },
      },
    })

    expect(mocks.txReviewCreate).not.toHaveBeenCalled()
    expect(mocks.txMediaAssetUpdateMany).not.toHaveBeenCalled()
    expect(mocks.txMediaAssetCreateMany).not.toHaveBeenCalled()
    expect(mocks.createBookingCloseoutAuditLog).not.toHaveBeenCalled()

    expect(json).toEqual({
      ok: true,
      review: existingReview,
    })
  })

  it('returns 409 when a review already exists without an idempotent replay match', async () => {
    mocks.txReviewFindFirst
      .mockResolvedValueOnce(null) // existingByKey
      .mockResolvedValueOnce({ id: 'review_dupe_1' }) // existing duplicate

    const req = makeRequest({
      rating: 5,
      headline: 'Duplicate',
      body: 'Should fail',
      idempotencyKey: 'idem_new_but_duplicate',
    })

    const res = await POST(req, makeCtx())
    const json = await res.json()

    expect(res.status).toBe(409)
    expect(json).toEqual({
      ok: false,
      error: 'Review already exists for this booking.',
    })

    expect(mocks.txReviewCreate).not.toHaveBeenCalled()
    expect(mocks.createBookingCloseoutAuditLog).not.toHaveBeenCalled()
  })

  it('returns 400 when attached appointment media is invalid or unavailable', async () => {
    mocks.txReviewFindFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)

    mocks.txMediaAssetFindMany.mockResolvedValueOnce([])

    const req = makeRequest({
      rating: 5,
      headline: 'Attach invalid',
      body: 'Bad attach',
      attachedMediaIds: ['media_missing_1'],
    })

    const res = await POST(req, makeCtx())
    const json = await res.json()

    expect(res.status).toBe(400)
    expect(json).toEqual({
      ok: false,
      error:
        'One or more selected appointment media items are not available to attach.',
    })

    expect(mocks.txReviewCreate).not.toHaveBeenCalled()
    expect(mocks.createBookingCloseoutAuditLog).not.toHaveBeenCalled()
  })

  it('returns 400 when client-uploaded media is missing storage pointers', async () => {
    const req = makeRequest({
      rating: 5,
      headline: 'Bad media',
      body: 'Missing storage pointers',
      media: [
        {
          url: 'https://example.com/client/review-1.png',
          mediaType: MediaType.IMAGE,
        },
      ],
    })

    const res = await POST(req, makeCtx())
    const json = await res.json()

    expect(res.status).toBe(400)
    expect(json).toEqual({
      ok: false,
      error:
        'Media must include storageBucket/storagePath (or a Supabase Storage URL we can parse).',
    })

    expect(mocks.prismaTransaction).not.toHaveBeenCalled()
    expect(mocks.txReviewCreate).not.toHaveBeenCalled()
    expect(mocks.createBookingCloseoutAuditLog).not.toHaveBeenCalled()
  })

  it('returns 400 when client media exceeds upload caps', async () => {
    const req = makeRequest({
      rating: 5,
      headline: 'Too much media',
      body: 'Should cap',
      media: Array.from({ length: 8 }, (_, i) => ({
        url: `https://example.com/client/${i + 1}.png`,
        mediaType: MediaType.IMAGE,
        storageBucket: 'reviews',
        storagePath: `client/${i + 1}.png`,
      })),
    })

    const res = await POST(req, makeCtx())
    const json = await res.json()

    expect(res.status).toBe(400)
    expect(json).toEqual({
      ok: false,
      error: 'You can upload up to 6 images + 1 video (7 total).',
    })

    expect(mocks.prismaTransaction).not.toHaveBeenCalled()
    expect(mocks.txReviewCreate).not.toHaveBeenCalled()
  })
})