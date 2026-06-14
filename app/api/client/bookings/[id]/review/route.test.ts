// app/api/client/bookings/[id]/review/route.test.ts

import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  BookingCloseoutAuditAction,
  MediaPhase,
  MediaType,
  MediaVisibility,
  NotificationEventKey,
  NotificationPriority,
  Role,
} from '@prisma/client'

const IDEMPOTENCY_ROUTE = 'POST /api/client/bookings/[id]/review'
const ROUTE_OPERATION = 'POST /api/client/bookings/[id]/review'

const mockRenderMediaUrls = vi.hoisted(() => vi.fn())

const mocks = vi.hoisted(() => ({
  prismaTransaction: vi.fn(),

  txReviewFindFirst: vi.fn(),
  txReviewFindUnique: vi.fn(),
  txReviewCreate: vi.fn(),

  txMediaAssetFindMany: vi.fn(),
  txMediaAssetUpdateMany: vi.fn(),
  txMediaAssetCreateMany: vi.fn(),

  txProfessionalProfileFindUnique: vi.fn(),

  requireClient: vi.fn(),
  pickString: vi.fn(),
  jsonFail: vi.fn(),
  jsonOk: vi.fn(),
  safeUrl: vi.fn(),
  resolveStoragePointers: vi.fn(),

  beginRouteIdempotency: vi.fn(),
  completeRouteIdempotency: vi.fn(),
  failStartedRouteIdempotency: vi.fn(),
  isRouteIdempotencyHandled: vi.fn(),

  parseIdArray: vi.fn(),
  parseRating1to5: vi.fn(),

  validateUploadSession: vi.fn(),
  consumeUploadSession: vi.fn(),

  assertClientBookingReviewEligibility: vi.fn(),

  createBookingCloseoutAuditLog: vi.fn(),
  createProNotification: vi.fn(),

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

vi.mock('@/app/api/_utils/idempotency', () => ({
  beginRouteIdempotency: mocks.beginRouteIdempotency,
  completeRouteIdempotency: mocks.completeRouteIdempotency,
  failStartedRouteIdempotency: mocks.failStartedRouteIdempotency,
  isRouteIdempotencyHandled: mocks.isRouteIdempotencyHandled,
}))

vi.mock('@/lib/media', () => ({
  parseIdArray: mocks.parseIdArray,
  parseRating1to5: mocks.parseRating1to5,
}))

vi.mock('@/lib/booking/writeBoundary', () => ({
  assertClientBookingReviewEligibility:
    mocks.assertClientBookingReviewEligibility,
}))

vi.mock('@/lib/media/uploadSession', () => {
  class UploadSessionError extends Error {
    code: string
    httpStatus: number
    constructor(code: string, message: string) {
      super(message)
      this.name = 'UploadSessionError'
      this.code = code
      this.httpStatus = code === 'FORBIDDEN' ? 403 : code === 'NOT_FOUND' ? 404 : 400
    }
  }
  return {
    validateUploadSession: mocks.validateUploadSession,
    consumeUploadSession: mocks.consumeUploadSession,
    UploadSessionError,
  }
})

vi.mock('@/lib/booking/closeoutAudit', () => ({
  createBookingCloseoutAuditLog: mocks.createBookingCloseoutAuditLog,
}))

vi.mock('@/lib/notifications/proNotifications', () => ({
  createProNotification: mocks.createProNotification,
}))

vi.mock('@/lib/idempotency', () => ({
  IDEMPOTENCY_ROUTES: {
    CLIENT_REVIEW_CREATE: 'POST /api/client/bookings/[id]/review',
  },
}))

vi.mock('@/lib/observability/bookingEvents', () => ({
  captureBookingException: mocks.captureBookingException,
}))

vi.mock('@/lib/media/renderUrls', () => ({
  renderMediaUrls: mockRenderMediaUrls,
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
  professionalProfile: {
    findUnique: mocks.txProfessionalProfileFindUnique,
  },
}

function makeJsonResponse(status: number, payload: unknown): Response {
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
        url: 'https://media.test/reviews/client/review-1.png',
        thumbUrl: 'https://media.test/reviews-thumbs/client/review-1-thumb.png',
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
    media: [{ uploadSessionId: 'us_1' }],
    ...(overrides ?? {}),
  }
}

// The authoritative session validateUploadSession returns for the client review
// upload. The route reads the pointer back from here.
function clientReviewSession(overrides: Record<string, unknown> = {}) {
  return {
    id: 'us_1',
    surface: 'CLIENT_REVIEW',
    status: 'PENDING',
    tenantId: null,
    professionalId: null,
    clientId: 'client_1',
    bookingId: null,
    phase: null,
    storageBucket: 'reviews',
    storagePath: 'client/review-1.png',
    contentType: 'image/jpeg',
    maxBytes: 30 * 1024 * 1024,
    checksumSha256: null,
    expiresAt: new Date('2026-03-25T17:00:00.000Z'),
    consumedAt: null,
    mediaAssetId: null,
    ...overrides,
  }
}

function expectedIdempotencyRequestBody(overrides?: {
  attachedMediaIds?: string[]
  uploadSessionIds?: string[]
  headline?: string | null
  body?: string | null
}) {
  return {
    bookingId: 'booking_1',
    clientId: 'client_1',
    actorUserId: 'user_1',
    rating: 5,
    headline: overrides && 'headline' in overrides ? overrides.headline : 'Great service',
    body: overrides && 'body' in overrides ? overrides.body : 'Loved it',
    attachedMediaIds: overrides?.attachedMediaIds ?? ['media_pro_1'],
    uploadSessionIds: overrides?.uploadSessionIds ?? ['us_1'],
  }
}

function expectedResponseBody() {
  return {
    review: expectedFullReviewJson(),
  }
}

function makeStartedIdempotency(key = 'idem_review_1') {
  return {
    kind: 'started',
    idempotencyRecordId: 'idem_record_1',
    idempotencyKey: key,
    requestHash: 'hash_1',
  }
}

function mockHandledIdempotency(response: Response): void {
  mocks.beginRouteIdempotency.mockResolvedValueOnce({
    kind: 'handled',
    response,
  })
  mocks.isRouteIdempotencyHandled.mockReturnValueOnce(true)
}

function expectRouteIdempotencyStartedWith(
  requestBody = expectedIdempotencyRequestBody(),
): void {
  expect(mocks.beginRouteIdempotency).toHaveBeenCalledWith({
    request: expect.any(NextRequest),
    actor: {
      actorUserId: 'user_1',
      actorRole: Role.CLIENT,
    },
    route: IDEMPOTENCY_ROUTE,
    requestLabel: 'client review',
    requestBody,
    messages: {
      missingKey: 'Missing idempotency key.',
      inProgress: 'A matching review request is already in progress.',
      conflict:
        'This idempotency key was already used with a different request body.',
    },
  })
}

describe('app/api/client/bookings/[id]/review/route.ts POST', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockRenderMediaUrls.mockReset()

    mocks.txProfessionalProfileFindUnique.mockResolvedValue({
      homeTenantId: 'tenant_root',
    })

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

    mocks.jsonOk.mockImplementation((data: unknown, status = 200) => {
      const payload =
        typeof data === 'object' && data !== null && !Array.isArray(data)
          ? data
          : { value: data }

      return makeJsonResponse(status, {
        ok: true,
        ...payload,
      })
    })

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

    mocks.validateUploadSession.mockResolvedValue(clientReviewSession())
    mocks.consumeUploadSession.mockResolvedValue(undefined)

    mocks.beginRouteIdempotency.mockResolvedValue(makeStartedIdempotency())
    mocks.isRouteIdempotencyHandled.mockReturnValue(false)
    mocks.completeRouteIdempotency.mockResolvedValue(undefined)
    mocks.failStartedRouteIdempotency.mockResolvedValue(undefined)

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
    expect(mocks.beginRouteIdempotency).not.toHaveBeenCalled()
    expect(mocks.prismaTransaction).not.toHaveBeenCalled()
  })

  it('returns 400 when booking id is missing', async () => {
    const res = await POST(makeRequest({ rating: 5 }), makeCtx('   '))
    const json = await res.json()

    expect(res.status).toBe(400)
    expect(json).toEqual({
      ok: false,
      error: 'Missing booking id.',
      code: 'BOOKING_ID_REQUIRED',
      message: 'Booking id is required.',
      retryable: false,
      uiAction: 'NONE',
    })

    expect(mocks.beginRouteIdempotency).not.toHaveBeenCalled()
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
    expect(mocks.beginRouteIdempotency).not.toHaveBeenCalled()
    expect(mocks.prismaTransaction).not.toHaveBeenCalled()
  })

  it('returns 400 when client media exceeds the total cap before idempotency starts', async () => {
    const req = makeRequest({
      rating: 5,
      headline: 'Too much media',
      body: 'Should cap',
      media: Array.from({ length: 8 }, (_, i) => ({
        uploadSessionId: `us_${i + 1}`,
      })),
    })

    const res = await POST(req, makeCtx())
    const json = await res.json()

    expect(res.status).toBe(400)
    expect(json).toEqual({
      ok: false,
      error: 'You can upload up to 6 images + 1 video (7 total).',
    })

    expect(mocks.beginRouteIdempotency).not.toHaveBeenCalled()
    expect(mocks.prismaTransaction).not.toHaveBeenCalled()
    expect(mocks.txReviewCreate).not.toHaveBeenCalled()
  })

  it('returns handled missing-key idempotency response without eligibility or transaction work', async () => {
    const handledResponse = makeJsonResponse(400, {
      ok: false,
      error: 'Missing idempotency key.',
      code: 'IDEMPOTENCY_KEY_REQUIRED',
    })

    mockHandledIdempotency(handledResponse)

    const res = await POST(makeRequest(makeValidBody()), makeCtx())

    expect(res).toBe(handledResponse)
    expectRouteIdempotencyStartedWith()

    expect(mocks.assertClientBookingReviewEligibility).not.toHaveBeenCalled()
    expect(mocks.prismaTransaction).not.toHaveBeenCalled()
    expect(mocks.completeRouteIdempotency).not.toHaveBeenCalled()
  })

  it('returns handled in-progress idempotency response without eligibility or transaction work', async () => {
    const handledResponse = makeJsonResponse(409, {
      ok: false,
      error: 'A matching review request is already in progress.',
      code: 'IDEMPOTENCY_REQUEST_IN_PROGRESS',
    })

    mockHandledIdempotency(handledResponse)

    const res = await POST(
      makeIdempotentRequest({
        body: makeValidBody(),
      }),
      makeCtx(),
    )

    expect(res).toBe(handledResponse)
    expectRouteIdempotencyStartedWith()

    expect(mocks.assertClientBookingReviewEligibility).not.toHaveBeenCalled()
    expect(mocks.prismaTransaction).not.toHaveBeenCalled()
    expect(mocks.completeRouteIdempotency).not.toHaveBeenCalled()
  })

  it('returns handled conflict idempotency response without eligibility or transaction work', async () => {
    const handledResponse = makeJsonResponse(409, {
      ok: false,
      error:
        'This idempotency key was already used with a different request body.',
      code: 'IDEMPOTENCY_KEY_CONFLICT',
    })

    mockHandledIdempotency(handledResponse)

    const res = await POST(
      makeIdempotentRequest({
        body: makeValidBody(),
      }),
      makeCtx(),
    )

    expect(res).toBe(handledResponse)
    expectRouteIdempotencyStartedWith()

    expect(mocks.assertClientBookingReviewEligibility).not.toHaveBeenCalled()
    expect(mocks.prismaTransaction).not.toHaveBeenCalled()
    expect(mocks.completeRouteIdempotency).not.toHaveBeenCalled()
  })

  it('replays handled idempotency response without creating or auditing again', async () => {
    const handledResponse = makeJsonResponse(201, {
      ok: true,
      ...expectedResponseBody(),
    })

    mockHandledIdempotency(handledResponse)

    const res = await POST(
      makeIdempotentRequest({
        body: makeValidBody(),
      }),
      makeCtx(),
    )

    expect(res).toBe(handledResponse)
    expect(mocks.assertClientBookingReviewEligibility).not.toHaveBeenCalled()
    expect(mocks.prismaTransaction).not.toHaveBeenCalled()
    expect(mocks.txReviewCreate).not.toHaveBeenCalled()
    expect(mocks.txMediaAssetUpdateMany).not.toHaveBeenCalled()
    expect(mocks.txMediaAssetCreateMany).not.toHaveBeenCalled()
    expect(mocks.createBookingCloseoutAuditLog).not.toHaveBeenCalled()
    expect(mocks.createProNotification).not.toHaveBeenCalled()
    expect(mocks.completeRouteIdempotency).not.toHaveBeenCalled()
  })

  it('creates a review, attaches pro media, creates client media, writes closeout audit, notifies pro, and completes idempotency', async () => {
    mocks.beginRouteIdempotency.mockResolvedValueOnce(
      makeStartedIdempotency('idem_review_1'),
    )

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

    expect(mockRenderMediaUrls).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'media_client_1',
        storageBucket: 'reviews',
        storagePath: 'client/review-1.png',
        thumbBucket: 'reviews-thumbs',
        thumbPath: 'client/review-1-thumb.png',
      }),
    )

    expectRouteIdempotencyStartedWith()

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
          proTenantId: 'tenant_root',
          bookingId: 'booking_1',
          reviewId: 'review_1',
          mediaType: MediaType.IMAGE,
          phase: MediaPhase.OTHER,
          visibility: MediaVisibility.PUBLIC,
          uploadedByUserId: 'user_1',
          uploadedByRole: Role.CLIENT,
          isFeaturedInPortfolio: false,
          isEligibleForLooks: false,
          reviewLocked: true,
          storageBucket: 'reviews',
          storagePath: 'client/review-1.png',
          thumbBucket: null,
          thumbPath: null,
          url: null,
          thumbUrl: null,
          caption: null,
        },
      ],
    })

    expect(mocks.validateUploadSession).toHaveBeenCalledWith(expect.anything(), {
      uploadSessionId: 'us_1',
      surface: 'CLIENT_REVIEW',
      clientId: 'client_1',
      now: expect.any(Date),
    })

    expect(mocks.consumeUploadSession).toHaveBeenCalledWith(expect.anything(), {
      uploadSessionId: 'us_1',
      now: expect.any(Date),
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

    expect(mocks.completeRouteIdempotency).toHaveBeenCalledWith({
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
    mocks.beginRouteIdempotency.mockResolvedValueOnce(
      makeStartedIdempotency('idem_review_replay'),
    )

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

    expect(mocks.completeRouteIdempotency).toHaveBeenCalledWith({
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
    mocks.beginRouteIdempotency.mockResolvedValueOnce(
      makeStartedIdempotency('idem_new_but_duplicate'),
    )

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

    expect(mocks.failStartedRouteIdempotency).toHaveBeenCalledWith({
      idempotencyRecordId: 'idem_record_1',
      operation: ROUTE_OPERATION,
    })

    expect(mocks.txReviewCreate).not.toHaveBeenCalled()
    expect(mocks.createBookingCloseoutAuditLog).not.toHaveBeenCalled()
  })

  it('returns 400 when attached appointment media is invalid or unavailable and marks idempotency failed', async () => {
    mocks.beginRouteIdempotency.mockResolvedValueOnce(
      makeStartedIdempotency('idem_attach_invalid_1'),
    )

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

    expect(mocks.failStartedRouteIdempotency).toHaveBeenCalledWith({
      idempotencyRecordId: 'idem_record_1',
      operation: ROUTE_OPERATION,
    })

    expect(mocks.txReviewCreate).not.toHaveBeenCalled()
    expect(mocks.createBookingCloseoutAuditLog).not.toHaveBeenCalled()
  })

  it('returns 500 and marks idempotency failed when transaction returns null review', async () => {
    mocks.beginRouteIdempotency.mockResolvedValueOnce(
      makeStartedIdempotency('idem_null_review_1'),
    )

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

    expect(mocks.failStartedRouteIdempotency).toHaveBeenCalledWith({
      idempotencyRecordId: 'idem_record_1',
      operation: ROUTE_OPERATION,
    })

    expect(mocks.completeRouteIdempotency).not.toHaveBeenCalled()
  })

  it('logs notification failure but still returns success after completing idempotency', async () => {
    mocks.beginRouteIdempotency.mockResolvedValueOnce(
      makeStartedIdempotency('idem_notify_fail_1'),
    )

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

      expect(mocks.completeRouteIdempotency).toHaveBeenCalledWith({
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
    mocks.beginRouteIdempotency.mockResolvedValueOnce(
      makeStartedIdempotency('idem_boom_1'),
    )

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

    expect(mocks.failStartedRouteIdempotency).toHaveBeenCalledWith({
      idempotencyRecordId: 'idem_record_1',
      operation: ROUTE_OPERATION,
    })

    expect(mocks.captureBookingException).toHaveBeenCalledWith({
      error: expect.any(Error),
      route: ROUTE_OPERATION,
    })
  })
})