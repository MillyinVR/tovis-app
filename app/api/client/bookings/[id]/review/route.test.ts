// app/api/client/bookings/[id]/review/route.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import {
  BookingCloseoutAuditAction,
  MediaType,
  MediaVisibility,
  NotificationEventKey,
  NotificationPriority,
  Role,
} from '@prisma/client'

const IDEMPOTENCY_ROUTE = 'POST /api/client/bookings/[id]/review'

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
  createProNotification: vi.fn(),

  beginIdempotency: vi.fn(),
  completeIdempotency: vi.fn(),
  failIdempotency: vi.fn(),

  captureBookingException: vi.fn(),
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
}))

vi.mock('@/lib/notifications/proNotifications', () => ({
  createProNotification: mocks.createProNotification,
}))

vi.mock('@/lib/idempotency', () => ({
  beginIdempotency: mocks.beginIdempotency,
  completeIdempotency: mocks.completeIdempotency,
  failIdempotency: mocks.failIdempotency,
  IDEMPOTENCY_ROUTES: {
    CLIENT_REVIEW_CREATE: 'POST /api/client/bookings/[id]/review',
  },
}))

vi.mock('@/lib/observability/bookingEvents', () => ({
  captureBookingException: mocks.captureBookingException,
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

function makeIdempotentRequest(args?: {
  body?: unknown
  key?: string
  headers?: Record<string, string>
}) {
  return makeRequest(args?.body ?? makeValidBody(), {
    'idempotency-key': args?.key ?? 'idem_review_1',
    ...(args?.headers ?? {}),
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

function makeFullReview() {
  return makeReview({
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
}

function expectedFullReviewJson() {
  return {
    id: 'review_1',
    bookingId: 'booking_1',
    clientId: 'client_1',
    professionalId: 'pro_1',
    rating: 5,
    headline: 'Great service',
    body: 'Loved it',
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
  }
}

function makeValidBody(overrides?: Record<string, unknown>) {
  return {
    rating: 5,
    headline: 'Great service',
    body: 'Loved it',
    attachedMediaIds: ['media_pro_1'],
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
    ...(overrides ?? {}),
  }
}

function expectedResolvedClientMedia() {
  return [
    {
      mediaType: MediaType.IMAGE,
      caption: null,
      storageBucket: 'reviews',
      storagePath: 'client/review-1.png',
      thumbBucket: 'reviews-thumbs',
      thumbPath: 'client/review-1-thumb.png',
      url: null,
      thumbUrl: null,
    },
  ]
}

function expectedIdempotencyRequestBody() {
  return {
    bookingId: 'booking_1',
    clientId: 'client_1',
    actorUserId: 'user_1',
    rating: 5,
    headline: 'Great service',
    body: 'Loved it',
    attachedMediaIds: ['media_pro_1'],
    clientMedia: expectedResolvedClientMedia(),
  }
}

function expectedResponseBody() {
  return {
    review: expectedFullReviewJson(),
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

    mocks.jsonFail.mockImplementation(
      (status: number, error: string, extra?: Record<string, unknown>) =>
        makeJsonResponse(status, {
          ok: false,
          error,
          ...(extra ?? {}),
        }),
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

    mocks.assertClientBookingReviewEligibility.mockResolvedValue(
      makeEligibility(),
    )

    mocks.beginIdempotency.mockImplementation(
      async (args: { key: string | null }) => {
        const key = args.key?.trim()

        if (!key) {
          return { kind: 'missing_key' }
        }

        return {
          kind: 'started',
          idempotencyRecordId: 'idem_record_1',
          requestHash: 'hash_1',
        }
      },
    )

    mocks.completeIdempotency.mockResolvedValue(undefined)
    mocks.failIdempotency.mockResolvedValue(undefined)
    mocks.createProNotification.mockResolvedValue(undefined)
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

    const res = await POST(makeRequest({ rating: 5 }), makeCtx())

    expect(res).toBe(authRes)
    expect(mocks.beginIdempotency).not.toHaveBeenCalled()
    expect(mocks.prismaTransaction).not.toHaveBeenCalled()
  })

  it('returns 400 when booking id is missing', async () => {
    const res = await POST(makeRequest({ rating: 5 }), makeCtx('   '))
    const json = await res.json()

    expect(res.status).toBe(400)
    expect(json).toEqual({
      ok: false,
      error: 'Missing booking id.',
    })

    expect(mocks.beginIdempotency).not.toHaveBeenCalled()
    expect(mocks.prismaTransaction).not.toHaveBeenCalled()
  })

  it('returns 400 when rating is invalid before idempotency starts', async () => {
    const res = await POST(makeRequest({ rating: 6 }), makeCtx())
    const json = await res.json()

    expect(res.status).toBe(400)
    expect(json).toEqual({
      ok: false,
      error: 'Rating must be an integer from 1–5.',
    })

    expect(mocks.assertClientBookingReviewEligibility).not.toHaveBeenCalled()
    expect(mocks.beginIdempotency).not.toHaveBeenCalled()
    expect(mocks.prismaTransaction).not.toHaveBeenCalled()
  })

  it('returns 400 when client-uploaded media is missing storage pointers before idempotency starts', async () => {
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

    expect(mocks.beginIdempotency).not.toHaveBeenCalled()
    expect(mocks.prismaTransaction).not.toHaveBeenCalled()
    expect(mocks.txReviewCreate).not.toHaveBeenCalled()
    expect(mocks.createBookingCloseoutAuditLog).not.toHaveBeenCalled()
  })

  it('returns 400 when client media exceeds upload caps before idempotency starts', async () => {
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

    expect(mocks.beginIdempotency).not.toHaveBeenCalled()
    expect(mocks.prismaTransaction).not.toHaveBeenCalled()
    expect(mocks.txReviewCreate).not.toHaveBeenCalled()
  })

  it('returns missing idempotency key for valid review request without idempotency header/body key', async () => {
    const res = await POST(makeRequest(makeValidBody()), makeCtx())
    const json = await res.json()

    expect(res.status).toBe(400)
    expect(json).toEqual({
      ok: false,
      error: 'Missing idempotency key.',
      code: 'IDEMPOTENCY_KEY_REQUIRED',
    })

    expect(mocks.beginIdempotency).toHaveBeenCalledWith({
      actor: {
        actorUserId: 'user_1',
        actorRole: Role.CLIENT,
      },
      route: IDEMPOTENCY_ROUTE,
      key: null,
      requestBody: expectedIdempotencyRequestBody(),
    })

    expect(mocks.prismaTransaction).not.toHaveBeenCalled()
    expect(mocks.completeIdempotency).not.toHaveBeenCalled()
  })

  it('accepts body idempotencyKey fallback when header is absent', async () => {
    const fullReview = makeFullReview()

    mocks.txReviewFindFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
    mocks.txMediaAssetFindMany.mockResolvedValueOnce([{ id: 'media_pro_1' }])
    mocks.txReviewCreate.mockResolvedValueOnce({ id: 'review_1' })
    mocks.txMediaAssetUpdateMany.mockResolvedValueOnce({ count: 1 })
    mocks.txMediaAssetCreateMany.mockResolvedValueOnce({ count: 1 })
    mocks.txReviewFindUnique.mockResolvedValueOnce(fullReview)

    const res = await POST(
      makeRequest(
        makeValidBody({
          idempotencyKey: 'idem_from_body_1',
        }),
        {
          'x-request-id': 'req_review_1',
        },
      ),
      makeCtx(),
    )

    expect(mocks.beginIdempotency).toHaveBeenCalledWith({
      actor: {
        actorUserId: 'user_1',
        actorRole: Role.CLIENT,
      },
      route: IDEMPOTENCY_ROUTE,
      key: 'idem_from_body_1',
      requestBody: expectedIdempotencyRequestBody(),
    })

    expect(res.status).toBe(201)
  })

  it('returns in-progress when idempotency ledger has an active matching request', async () => {
    mocks.beginIdempotency.mockResolvedValueOnce({
      kind: 'in_progress',
    })

    const res = await POST(
      makeIdempotentRequest({
        body: makeValidBody(),
      }),
      makeCtx(),
    )
    const json = await res.json()

    expect(res.status).toBe(409)
    expect(json).toEqual({
      ok: false,
      error: 'A matching review request is already in progress.',
      code: 'IDEMPOTENCY_REQUEST_IN_PROGRESS',
    })

    expect(mocks.prismaTransaction).not.toHaveBeenCalled()
    expect(mocks.txReviewCreate).not.toHaveBeenCalled()
    expect(mocks.completeIdempotency).not.toHaveBeenCalled()
  })

  it('returns conflict when idempotency key was reused with a different body', async () => {
    mocks.beginIdempotency.mockResolvedValueOnce({
      kind: 'conflict',
    })

    const res = await POST(
      makeIdempotentRequest({
        body: makeValidBody(),
      }),
      makeCtx(),
    )
    const json = await res.json()

    expect(res.status).toBe(409)
    expect(json).toEqual({
      ok: false,
      error:
        'This idempotency key was already used with a different request body.',
      code: 'IDEMPOTENCY_KEY_CONFLICT',
    })

    expect(mocks.prismaTransaction).not.toHaveBeenCalled()
    expect(mocks.txReviewCreate).not.toHaveBeenCalled()
    expect(mocks.completeIdempotency).not.toHaveBeenCalled()
  })

  it('replays completed idempotency response without creating or auditing again', async () => {
    mocks.beginIdempotency.mockResolvedValueOnce({
      kind: 'replay',
      responseStatus: 201,
      responseBody: expectedResponseBody(),
    })

    const res = await POST(
      makeIdempotentRequest({
        body: makeValidBody(),
      }),
      makeCtx(),
    )
    const json = await res.json()

    expect(res.status).toBe(201)
    expect(json).toEqual({
      ok: true,
      ...expectedResponseBody(),
    })

    expect(mocks.prismaTransaction).not.toHaveBeenCalled()
    expect(mocks.txReviewCreate).not.toHaveBeenCalled()
    expect(mocks.txMediaAssetUpdateMany).not.toHaveBeenCalled()
    expect(mocks.txMediaAssetCreateMany).not.toHaveBeenCalled()
    expect(mocks.createBookingCloseoutAuditLog).not.toHaveBeenCalled()
    expect(mocks.createProNotification).not.toHaveBeenCalled()
    expect(mocks.completeIdempotency).not.toHaveBeenCalled()
  })

  it('creates a review, attaches pro media, creates client media, writes closeout audit, notifies pro, and completes idempotency', async () => {
    const fullReview = makeFullReview()

    mocks.txReviewFindFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
    mocks.txMediaAssetFindMany.mockResolvedValueOnce([{ id: 'media_pro_1' }])
    mocks.txReviewCreate.mockResolvedValueOnce({ id: 'review_1' })
    mocks.txMediaAssetUpdateMany.mockResolvedValueOnce({ count: 1 })
    mocks.txMediaAssetCreateMany.mockResolvedValueOnce({ count: 1 })
    mocks.txReviewFindUnique.mockResolvedValueOnce(fullReview)

    const req = makeIdempotentRequest({
      key: 'idem_review_1',
      body: makeValidBody(),
      headers: {
        'x-request-id': 'req_review_1',
      },
    })

    const res = await POST(req, makeCtx())
    const json = await res.json()

    expect(res.status).toBe(201)

    expect(mocks.assertClientBookingReviewEligibility).toHaveBeenCalledWith({
      bookingId: 'booking_1',
      clientId: 'client_1',
    })

    expect(mocks.beginIdempotency).toHaveBeenCalledWith({
      actor: {
        actorUserId: 'user_1',
        actorRole: Role.CLIENT,
      },
      route: IDEMPOTENCY_ROUTE,
      key: 'idem_review_1',
      requestBody: expectedIdempotencyRequestBody(),
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

    expect(mocks.completeIdempotency).toHaveBeenCalledWith({
      idempotencyRecordId: 'idem_record_1',
      responseStatus: 201,
      responseBody: expectedResponseBody(),
    })

    expect(mocks.createProNotification).toHaveBeenCalledWith({
      professionalId: 'pro_1',
      eventKey: NotificationEventKey.REVIEW_RECEIVED,
      priority: NotificationPriority.NORMAL,
      title: 'New review received',
      body: 'A client left a 5-star review.',
      href: '/pro/bookings/booking_1',
      actorUserId: 'user_1',
      bookingId: 'booking_1',
      reviewId: 'review_1',
      dedupeKey: `PRO_NOTIF:${NotificationEventKey.REVIEW_RECEIVED}:review_1`,
      data: {
        bookingId: 'booking_1',
        reviewId: 'review_1',
        rating: 5,
        headline: 'Great service',
        attachedAppointmentMediaCount: 1,
        clientUploadedMediaCount: 1,
        hasMedia: true,
      },
    })

    expect(json).toEqual({
      ok: true,
      ...expectedResponseBody(),
    })
  })

  it('returns the existing review inside transaction, completes idempotency as 200, and does not create or audit again', async () => {
    const existingReview = makeReview({
      id: 'review_existing_1',
      mediaAssets: [],
    })

    mocks.txReviewFindFirst.mockResolvedValueOnce({ id: 'review_existing_1' })
    mocks.txReviewFindUnique.mockResolvedValueOnce(existingReview)

    const req = makeIdempotentRequest({
      key: 'idem_review_replay',
      body: makeValidBody({
        headline: 'Still great',
        body: 'Retry request',
        attachedMediaIds: [],
        media: [],
      }),
      headers: {
        'x-request-id': 'req_review_replay',
      },
    })

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
    expect(mocks.createProNotification).not.toHaveBeenCalled()

    expect(mocks.completeIdempotency).toHaveBeenCalledWith({
      idempotencyRecordId: 'idem_record_1',
      responseStatus: 200,
      responseBody: {
        review: {
          ...existingReview,
          mediaAssets: [],
        },
      },
    })

    expect(json).toEqual({
      ok: true,
      review: existingReview,
    })
  })

  it('returns 409 when a review already exists without an idempotent replay match and marks idempotency failed', async () => {
    mocks.txReviewFindFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'review_dupe_1' })

    const req = makeIdempotentRequest({
      key: 'idem_new_but_duplicate',
      body: makeValidBody({
        headline: 'Duplicate',
        body: 'Should fail',
        attachedMediaIds: [],
        media: [],
      }),
    })

    const res = await POST(req, makeCtx())
    const json = await res.json()

    expect(res.status).toBe(409)
    expect(json).toEqual({
      ok: false,
      error: 'Review already exists for this booking.',
    })

    expect(mocks.failIdempotency).toHaveBeenCalledWith({
      idempotencyRecordId: 'idem_record_1',
    })

    expect(mocks.txReviewCreate).not.toHaveBeenCalled()
    expect(mocks.createBookingCloseoutAuditLog).not.toHaveBeenCalled()
  })

  it('returns 400 when attached appointment media is invalid or unavailable and marks idempotency failed', async () => {
    mocks.txReviewFindFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)

    mocks.txMediaAssetFindMany.mockResolvedValueOnce([])

    const req = makeIdempotentRequest({
      key: 'idem_attach_invalid_1',
      body: makeValidBody({
        headline: 'Attach invalid',
        body: 'Bad attach',
        attachedMediaIds: ['media_missing_1'],
        media: [],
      }),
    })

    const res = await POST(req, makeCtx())
    const json = await res.json()

    expect(res.status).toBe(400)
    expect(json).toEqual({
      ok: false,
      error:
        'One or more selected appointment media items are not available to attach.',
    })

    expect(mocks.failIdempotency).toHaveBeenCalledWith({
      idempotencyRecordId: 'idem_record_1',
    })

    expect(mocks.txReviewCreate).not.toHaveBeenCalled()
    expect(mocks.createBookingCloseoutAuditLog).not.toHaveBeenCalled()
  })

  it('returns 500 and marks idempotency failed when transaction returns null review', async () => {
    mocks.txReviewFindFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
    mocks.txReviewCreate.mockResolvedValueOnce({ id: 'review_1' })
    mocks.txReviewFindUnique.mockResolvedValueOnce(null)

    const req = makeIdempotentRequest({
      key: 'idem_null_review_1',
      body: makeValidBody({
        attachedMediaIds: [],
        media: [],
      }),
    })

    const res = await POST(req, makeCtx())
    const json = await res.json()

    expect(res.status).toBe(500)
    expect(json).toEqual({
      ok: false,
      error: 'Internal server error.',
    })

    expect(mocks.failIdempotency).toHaveBeenCalledWith({
      idempotencyRecordId: 'idem_record_1',
    })

    expect(mocks.completeIdempotency).not.toHaveBeenCalled()
  })

  it('logs notification failure but still returns success after completing idempotency', async () => {
    const fullReview = makeFullReview()

    mocks.txReviewFindFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
    mocks.txMediaAssetFindMany.mockResolvedValueOnce([{ id: 'media_pro_1' }])
    mocks.txReviewCreate.mockResolvedValueOnce({ id: 'review_1' })
    mocks.txMediaAssetUpdateMany.mockResolvedValueOnce({ count: 1 })
    mocks.txMediaAssetCreateMany.mockResolvedValueOnce({ count: 1 })
    mocks.txReviewFindUnique.mockResolvedValueOnce(fullReview)
    mocks.createProNotification.mockRejectedValueOnce(new Error('notify boom'))

    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined)

    try {
      const res = await POST(
        makeIdempotentRequest({
          key: 'idem_notify_fail_1',
          body: makeValidBody(),
        }),
        makeCtx(),
      )
      const json = await res.json()

      expect(res.status).toBe(201)
      expect(json).toEqual({
        ok: true,
        ...expectedResponseBody(),
      })

      expect(mocks.completeIdempotency).toHaveBeenCalledWith({
        idempotencyRecordId: 'idem_record_1',
        responseStatus: 201,
        responseBody: expectedResponseBody(),
      })

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'POST /api/client/bookings/[id]/review pro notification error',
        expect.any(Error),
      )
    } finally {
      consoleErrorSpy.mockRestore()
    }
  })

  it('returns 500 for unexpected errors, captures exception, and marks idempotency failed', async () => {
    mocks.prismaTransaction.mockRejectedValueOnce(new Error('boom'))

    const req = makeIdempotentRequest({
      key: 'idem_boom_1',
      body: makeValidBody({
        attachedMediaIds: [],
        media: [],
      }),
    })

    const res = await POST(req, makeCtx())
    const json = await res.json()

    expect(res.status).toBe(500)
    expect(json).toEqual({
      ok: false,
      error: 'Internal server error.',
    })

    expect(mocks.failIdempotency).toHaveBeenCalledWith({
      idempotencyRecordId: 'idem_record_1',
    })

    expect(mocks.captureBookingException).toHaveBeenCalledWith({
      error: expect.any(Error),
      route: 'POST /api/client/bookings/[id]/review',
    })
  })
})