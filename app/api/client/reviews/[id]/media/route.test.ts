// app/api/client/reviews/[id]/media/route.test.ts

import { MediaPhase, MediaType, MediaVisibility, Role } from '@prisma/client'
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { BUCKETS } from '@/lib/storageBuckets'

const createdAtIso = '2026-04-13T18:30:00.000Z'
const createdAt = new Date(createdAtIso)

const review = {
  id: 'review_1',
  clientId: 'client_1',
  professionalId: 'pro_1',
  bookingId: 'booking_1',
  booking: { serviceId: 'service_1' },
}

const createdMedia = {
  id: 'media_1',
  mediaType: MediaType.IMAGE,
  visibility: MediaVisibility.PUBLIC,
  createdAt,
  storageBucket: BUCKETS.mediaPublic,
  storagePath: 'reviews/review_1/main.jpg',
  thumbBucket: null,
  thumbPath: null,
  url: null,
  thumbUrl: null,
}

const renderedUrls = {
  renderUrl: 'https://public.example/main.jpg',
  renderThumbUrl: null,
}

// The authoritative session validateUploadSession returns by default. The route
// reads the storage pointer back from here; the client only sends uploadSessionId.
function imageSession(overrides: Record<string, unknown> = {}) {
  return {
    id: 'us_1',
    surface: 'CLIENT_REVIEW',
    status: 'PENDING',
    tenantId: null,
    professionalId: null,
    clientId: 'client_1',
    bookingId: null,
    phase: null,
    storageBucket: BUCKETS.mediaPublic,
    storagePath: 'reviews/review_1/main.jpg',
    contentType: 'image/jpeg',
    maxBytes: 30 * 1024 * 1024,
    checksumSha256: null,
    expiresAt: new Date(createdAt.getTime() + 3_600_000),
    consumedAt: null,
    mediaAssetId: null,
    ...overrides,
  }
}

const mocks = vi.hoisted(() => ({
  requireClient: vi.fn(),
  jsonFail: vi.fn(),
  jsonOk: vi.fn(),
  pickString: vi.fn(),

  reviewFindUnique: vi.fn(),
  mediaAssetCount: vi.fn(),
  transaction: vi.fn(),
  txMediaAssetCreate: vi.fn(),
  txReviewFindUnique: vi.fn(),
  txProfessionalProfileFindUnique: vi.fn(),

  safeUrl: vi.fn(),
  renderMediaUrls: vi.fn(),

  validateUploadSession: vi.fn(),
  consumeUploadSession: vi.fn(),

  getSupabaseAdmin: vi.fn(),
  getPublicUrl: vi.fn(),
  createSignedUrl: vi.fn(),

  safeError: vi.fn((error: unknown) => ({
    name: error instanceof Error ? error.name : 'NonErrorThrown',
    message: error instanceof Error ? error.message : String(error),
  })),
}))

vi.mock('@/app/api/_utils/auth/requireClient', () => ({
  requireClient: mocks.requireClient,
}))

vi.mock('@/app/api/_utils/responses', () => ({
  jsonFail: mocks.jsonFail,
  jsonOk: mocks.jsonOk,
}))

vi.mock('@/lib/pick', () => ({
  pickString: mocks.pickString,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    review: {
      findUnique: mocks.reviewFindUnique,
    },
    mediaAsset: {
      count: mocks.mediaAssetCount,
    },
    $transaction: mocks.transaction,
  },
}))

vi.mock('@/lib/media', () => ({
  safeUrl: mocks.safeUrl,
}))

vi.mock('@/lib/media/renderUrls', () => ({
  renderMediaUrls: mocks.renderMediaUrls,
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

vi.mock('@/lib/supabaseAdmin', () => ({
  getSupabaseAdmin: mocks.getSupabaseAdmin,
}))

vi.mock('@/lib/security/logging', () => ({
  safeError: mocks.safeError,
}))

import { POST } from './route'
import { UploadSessionError } from '@/lib/media/uploadSession'

type TxForReviewMedia = {
  mediaAsset: {
    create: typeof mocks.txMediaAssetCreate
  }
  review: {
    findUnique: typeof mocks.txReviewFindUnique
  }
  professionalProfile: {
    findUnique: typeof mocks.txProfessionalProfileFindUnique
  }
}

function makeJsonResponse(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'content-type': 'application/json',
    },
  })
}

function makeCtx(id = 'review_1') {
  return {
    params: Promise.resolve({ id }),
  }
}

function makePostRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/client/reviews/review_1/media', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  })
}

function makeValidBody(sessionIds: string[] = ['us_1']) {
  return {
    media: sessionIds.map((uploadSessionId) => ({ uploadSessionId })),
  }
}

describe('app/api/client/reviews/[id]/media/route.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 200 })),
    )

    mocks.requireClient.mockResolvedValue({
      ok: true,
      clientId: 'client_1',
      user: {
        id: 'user_1',
      },
    })

    mocks.jsonFail.mockImplementation((status: number, error: string) =>
      makeJsonResponse(status, {
        ok: false,
        error,
      }),
    )

    mocks.jsonOk.mockImplementation(
      (data: Record<string, unknown>, status = 200) =>
        makeJsonResponse(status, {
          ok: true,
          ...(data ?? {}),
        }),
    )

    mocks.pickString.mockImplementation((value: unknown) => {
      if (typeof value !== 'string') return null

      const trimmed = value.trim()
      return trimmed.length > 0 ? trimmed : null
    })

    mocks.safeUrl.mockImplementation((value: unknown) => {
      if (typeof value !== 'string') return null

      const trimmed = value.trim()
      if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) {
        return null
      }

      return trimmed
    })

    mocks.reviewFindUnique.mockResolvedValue(review)
    mocks.mediaAssetCount.mockResolvedValue(0)

    mocks.validateUploadSession.mockResolvedValue(imageSession())
    mocks.consumeUploadSession.mockResolvedValue(undefined)

    mocks.txMediaAssetCreate.mockResolvedValue(createdMedia)
    mocks.txReviewFindUnique.mockResolvedValue({
      ...review,
      mediaAssets: [createdMedia],
    })

    mocks.transaction.mockImplementation(
      async (fn: (tx: TxForReviewMedia) => Promise<unknown>) =>
        fn({
          mediaAsset: {
            create: mocks.txMediaAssetCreate,
          },
          review: {
            findUnique: mocks.txReviewFindUnique,
          },
          professionalProfile: {
            findUnique: mocks.txProfessionalProfileFindUnique,
          },
        }),
    )

    mocks.txProfessionalProfileFindUnique.mockResolvedValue({
      homeTenantId: 'tenant_root',
    })

    mocks.renderMediaUrls.mockResolvedValue(renderedUrls)

    mocks.getPublicUrl.mockReturnValue({
      data: {
        publicUrl: 'https://public.example/storage-object.jpg',
      },
    })

    mocks.createSignedUrl.mockResolvedValue({
      data: {
        signedUrl: 'https://signed.example/storage-object.jpg',
      },
      error: null,
    })

    mocks.getSupabaseAdmin.mockReturnValue({
      storage: {
        from: vi.fn(() => ({
          getPublicUrl: mocks.getPublicUrl,
          createSignedUrl: mocks.createSignedUrl,
        })),
      },
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
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

    const result = await POST(makePostRequest(makeValidBody()), makeCtx())

    expect(result).toBe(authRes)
    expect(mocks.reviewFindUnique).not.toHaveBeenCalled()
    expect(mocks.transaction).not.toHaveBeenCalled()
  })

  it('returns 400 when review id is missing', async () => {
    const result = await POST(makePostRequest(makeValidBody()), makeCtx(''))

    expect(result.status).toBe(400)
    await expect(result.json()).resolves.toEqual({
      ok: false,
      error: 'Missing review id.',
    })

    expect(mocks.reviewFindUnique).not.toHaveBeenCalled()
    expect(mocks.transaction).not.toHaveBeenCalled()
  })

  it('returns 400 when no valid media is provided', async () => {
    const result = await POST(
      makePostRequest({
        media: [],
      }),
      makeCtx(),
    )

    expect(result.status).toBe(400)
    await expect(result.json()).resolves.toEqual({
      ok: false,
      error: 'No valid media provided.',
    })

    expect(mocks.reviewFindUnique).not.toHaveBeenCalled()
    expect(mocks.transaction).not.toHaveBeenCalled()
  })

  it('returns 400 when more than the total cap of items is submitted', async () => {
    const result = await POST(
      makePostRequest(
        makeValidBody(Array.from({ length: 8 }, (_, i) => `us_${i}`)),
      ),
      makeCtx(),
    )

    expect(result.status).toBe(400)
    await expect(result.json()).resolves.toEqual({
      ok: false,
      error: 'You can upload up to 6 images + 1 video (7 total).',
    })

    expect(mocks.reviewFindUnique).not.toHaveBeenCalled()
    expect(mocks.transaction).not.toHaveBeenCalled()
  })

  it('returns 400 when the resolved image cap is exceeded', async () => {
    // 7 items (== total cap) all resolve to images -> per-type image cap (6).
    const result = await POST(
      makePostRequest(
        makeValidBody(Array.from({ length: 7 }, (_, i) => `us_${i}`)),
      ),
      makeCtx(),
    )

    expect(result.status).toBe(400)
    await expect(result.json()).resolves.toEqual({
      ok: false,
      error: 'You can upload up to 6 images.',
    })

    expect(mocks.transaction).not.toHaveBeenCalled()
  })

  it('returns 400 when the resolved video cap is exceeded', async () => {
    mocks.validateUploadSession.mockResolvedValue(
      imageSession({ contentType: 'video/mp4' }),
    )

    const result = await POST(
      makePostRequest(makeValidBody(['us_1', 'us_2'])),
      makeCtx(),
    )

    expect(result.status).toBe(400)
    await expect(result.json()).resolves.toEqual({
      ok: false,
      error: 'You can upload up to 1 video.',
    })

    expect(mocks.transaction).not.toHaveBeenCalled()
  })

  it('returns 404 when review is not found', async () => {
    mocks.reviewFindUnique.mockResolvedValueOnce(null)

    const result = await POST(makePostRequest(makeValidBody()), makeCtx())

    expect(result.status).toBe(404)
    await expect(result.json()).resolves.toEqual({
      ok: false,
      error: 'Review not found.',
    })

    expect(mocks.mediaAssetCount).not.toHaveBeenCalled()
    expect(mocks.transaction).not.toHaveBeenCalled()
  })

  it('returns 403 when review belongs to another client and creates no media', async () => {
    mocks.reviewFindUnique.mockResolvedValueOnce({
      ...review,
      clientId: 'other_client',
    })

    const result = await POST(makePostRequest(makeValidBody()), makeCtx())

    expect(result.status).toBe(403)
    await expect(result.json()).resolves.toEqual({
      ok: false,
      error: 'Forbidden.',
    })

    expect(mocks.transaction).not.toHaveBeenCalled()
    expect(mocks.txMediaAssetCreate).not.toHaveBeenCalled()
  })

  it('returns 409 when review is not linked to a booking and creates no media', async () => {
    mocks.reviewFindUnique.mockResolvedValueOnce({
      ...review,
      bookingId: null,
    })

    const result = await POST(makePostRequest(makeValidBody()), makeCtx())

    expect(result.status).toBe(409)
    await expect(result.json()).resolves.toEqual({
      ok: false,
      error:
        'This review is not linked to a booking. Media must be attached to a booking to appear in aftercare.',
    })

    expect(mocks.transaction).not.toHaveBeenCalled()
    expect(mocks.txMediaAssetCreate).not.toHaveBeenCalled()
  })

  it('returns 400 when existing uploads would exceed total cap', async () => {
    mocks.mediaAssetCount.mockResolvedValueOnce(7)

    const result = await POST(makePostRequest(makeValidBody()), makeCtx())

    expect(result.status).toBe(400)
    await expect(result.json()).resolves.toEqual({
      ok: false,
      error: 'This review already has 7 upload(s). Max is 7.',
    })

    expect(mocks.transaction).not.toHaveBeenCalled()
    expect(mocks.txMediaAssetCreate).not.toHaveBeenCalled()
  })

  it('maps upload-session validation errors (e.g. wrong client)', async () => {
    mocks.validateUploadSession.mockRejectedValueOnce(
      new UploadSessionError('FORBIDDEN', 'Upload session belongs to another client.'),
    )

    const result = await POST(makePostRequest(makeValidBody()), makeCtx())

    expect(result.status).toBe(403)
    await expect(result.json()).resolves.toEqual({
      ok: false,
      error: 'Upload session belongs to another client.',
    })

    expect(mocks.transaction).not.toHaveBeenCalled()
    expect(mocks.txMediaAssetCreate).not.toHaveBeenCalled()
  })

  it('rejects a session whose pointer is not in the public bucket', async () => {
    mocks.validateUploadSession.mockResolvedValueOnce(
      imageSession({ storageBucket: BUCKETS.mediaPrivate }),
    )

    const result = await POST(makePostRequest(makeValidBody()), makeCtx())

    expect(result.status).toBe(400)
    await expect(result.json()).resolves.toEqual({
      ok: false,
      error: `Review media must upload to ${BUCKETS.mediaPublic}.`,
    })

    expect(mocks.transaction).not.toHaveBeenCalled()
  })

  it('rejects missing uploaded file before DB write', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      new Response(null, { status: 404 }),
    )

    const result = await POST(makePostRequest(makeValidBody()), makeCtx())

    expect(result.status).toBe(400)
    await expect(result.json()).resolves.toEqual({
      ok: false,
      error: 'Uploaded file not found in storage.',
    })

    expect(mocks.getPublicUrl).toHaveBeenCalled()
    expect(mocks.transaction).not.toHaveBeenCalled()
    expect(mocks.txMediaAssetCreate).not.toHaveBeenCalled()
  })

  it('creates public review media for the owning client, consumes the session, and returns render-safe urls', async () => {
    const result = await POST(makePostRequest(makeValidBody()), makeCtx())

    expect(mocks.reviewFindUnique).toHaveBeenCalledWith({
      where: {
        id: 'review_1',
      },
      select: {
        id: true,
        clientId: true,
        professionalId: true,
        bookingId: true,
        booking: { select: { serviceId: true } },
      },
    })

    expect(mocks.validateUploadSession).toHaveBeenCalledWith(expect.anything(), {
      uploadSessionId: 'us_1',
      surface: 'CLIENT_REVIEW',
      clientId: 'client_1',
      now: expect.any(Date),
    })

    expect(mocks.mediaAssetCount).toHaveBeenCalledWith({
      where: {
        reviewId: 'review_1',
        uploadedByRole: Role.CLIENT,
      },
    })

    // Only the main object is probed — review media has no separate thumb.
    expect(mocks.getPublicUrl).toHaveBeenCalledTimes(1)
    expect(globalThis.fetch).toHaveBeenCalledTimes(1)

    expect(mocks.txMediaAssetCreate).toHaveBeenCalledWith({
      data: {
        professionalId: 'pro_1',
        proTenantId: 'tenant_root',
        primaryServiceId: 'service_1',
        bookingId: 'booking_1',
        reviewId: 'review_1',
        storageBucket: BUCKETS.mediaPublic,
        storagePath: 'reviews/review_1/main.jpg',
        thumbBucket: null,
        thumbPath: null,
        url: null,
        thumbUrl: null,
        mediaType: MediaType.IMAGE,
        caption: null,
        phase: MediaPhase.OTHER,
        visibility: MediaVisibility.PUBLIC,
        uploadedByUserId: 'user_1',
        uploadedByRole: Role.CLIENT,
        isFeaturedInPortfolio: false,
        isEligibleForLooks: false,
        reviewLocked: true,
      },
      select: {
        id: true,
        mediaType: true,
        visibility: true,
        createdAt: true,
        storageBucket: true,
        storagePath: true,
        thumbBucket: true,
        thumbPath: true,
        url: true,
        thumbUrl: true,
      },
    })

    expect(mocks.consumeUploadSession).toHaveBeenCalledWith(expect.anything(), {
      uploadSessionId: 'us_1',
      mediaAssetId: 'media_1',
      now: expect.any(Date),
    })

    expect(mocks.txReviewFindUnique).toHaveBeenCalledWith({
      where: {
        id: 'review_1',
      },
      include: {
        mediaAssets: true,
      },
    })

    expect(result.status).toBe(201)
  })

  it('returns 500 and logs a safe error when media creation throws', async () => {
    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined)

    mocks.txMediaAssetCreate.mockRejectedValueOnce(
      new Error('db blew up for https://signed.example/x?token=secret'),
    )

    const result = await POST(makePostRequest(makeValidBody()), makeCtx())

    expect(result.status).toBe(500)
    await expect(result.json()).resolves.toEqual({
      ok: false,
      error: 'Internal server error',
    })

    consoleErrorSpy.mockRestore()
  })
})
