// app/api/client/reviews/[id]/media/route.test.ts

import { MediaType, MediaVisibility, Role } from '@prisma/client'
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
}

const createdMedia = {
  id: 'media_1',
  mediaType: MediaType.IMAGE,
  visibility: MediaVisibility.PUBLIC,
  createdAt,
  storageBucket: BUCKETS.mediaPublic,
  storagePath: 'reviews/review_1/main.jpg',
  thumbBucket: BUCKETS.mediaPublic,
  thumbPath: 'reviews/review_1/thumb.jpg',
  url: null,
  thumbUrl: null,
}

const renderedUrls = {
  renderUrl: 'https://public.example/main.jpg',
  renderThumbUrl: 'https://public.example/thumb.jpg',
}

type TestMediaItem = {
  url: string
  thumbUrl?: string | null
  mediaType: MediaType
  storageBucket?: string | null
  storagePath?: string | null
  thumbBucket?: string | null
  thumbPath?: string | null
}

const validMediaItem: TestMediaItem = {
  url: 'https://example.com/uploaded-main.jpg',
  thumbUrl: 'https://example.com/uploaded-thumb.jpg',
  mediaType: MediaType.IMAGE,
  storageBucket: BUCKETS.mediaPublic,
  storagePath: 'reviews/review_1/main.jpg',
  thumbBucket: BUCKETS.mediaPublic,
  thumbPath: 'reviews/review_1/thumb.jpg',
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

  safeUrl: vi.fn(),
  resolveStoragePointers: vi.fn(),
  renderMediaUrls: vi.fn(),

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
  resolveStoragePointers: mocks.resolveStoragePointers,
}))

vi.mock('@/lib/media/renderUrls', () => ({
  renderMediaUrls: mocks.renderMediaUrls,
}))

vi.mock('@/lib/supabaseAdmin', () => ({
  getSupabaseAdmin: mocks.getSupabaseAdmin,
}))

vi.mock('@/lib/security/logging', () => ({
  safeError: mocks.safeError,
}))

import { POST } from './route'

type TxForReviewMedia = {
  mediaAsset: {
    create: typeof mocks.txMediaAssetCreate
  }
  review: {
    findUnique: typeof mocks.txReviewFindUnique
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

function makeValidBody(overrides?: Partial<TestMediaItem>) {
  const item: TestMediaItem = {
    ...validMediaItem,
    ...(overrides ?? {}),
  }

  return {
    media: [item],
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

    mocks.resolveStoragePointers.mockImplementation(
      (input: {
        storageBucket: string | null
        storagePath: string | null
        thumbBucket: string | null
        thumbPath: string | null
      }) => ({
        storageBucket: input.storageBucket,
        storagePath: input.storagePath,
        thumbBucket: input.thumbBucket,
        thumbPath: input.thumbPath,
      }),
    )

    mocks.reviewFindUnique.mockResolvedValue(review)
    mocks.mediaAssetCount.mockResolvedValue(0)

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
        }),
    )

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

  it('returns 400 when image cap is exceeded', async () => {
    const media = Array.from({ length: 7 }, (_, index) => ({
      ...validMediaItem,
      storagePath: `reviews/review_1/image-${index}.jpg`,
      thumbPath: `reviews/review_1/thumb-${index}.jpg`,
    }))

    const result = await POST(
      makePostRequest({
        media,
      }),
      makeCtx(),
    )

    expect(result.status).toBe(400)
    await expect(result.json()).resolves.toEqual({
      ok: false,
      error: 'You can upload up to 6 images.',
    })

    expect(mocks.reviewFindUnique).not.toHaveBeenCalled()
    expect(mocks.transaction).not.toHaveBeenCalled()
  })

  it('returns 400 when video cap is exceeded', async () => {
    const result = await POST(
      makePostRequest({
        media: [
          {
            ...validMediaItem,
            mediaType: MediaType.VIDEO,
            storagePath: 'reviews/review_1/video-1.mp4',
            thumbPath: null,
            thumbBucket: null,
          },
          {
            ...validMediaItem,
            mediaType: MediaType.VIDEO,
            storagePath: 'reviews/review_1/video-2.mp4',
            thumbPath: null,
            thumbBucket: null,
          },
        ],
      }),
      makeCtx(),
    )

    expect(result.status).toBe(400)
    await expect(result.json()).resolves.toEqual({
      ok: false,
      error: 'You can upload up to 1 video.',
    })

    expect(mocks.reviewFindUnique).not.toHaveBeenCalled()
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

    expect(mocks.mediaAssetCount).not.toHaveBeenCalled()
    expect(mocks.getPublicUrl).not.toHaveBeenCalled()
    expect(globalThis.fetch).not.toHaveBeenCalled()
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

    expect(mocks.mediaAssetCount).not.toHaveBeenCalled()
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

  it('rejects media-private for public review media before storage lookup or DB write', async () => {
    const result = await POST(
      makePostRequest(
        makeValidBody({
          storageBucket: BUCKETS.mediaPrivate,
          storagePath: 'reviews/review_1/private-main.jpg',
        }),
      ),
      makeCtx(),
    )

    expect(result.status).toBe(400)
    await expect(result.json()).resolves.toEqual({
      ok: false,
      error: `Review media must upload to ${BUCKETS.mediaPublic}.`,
    })

    expect(mocks.getPublicUrl).not.toHaveBeenCalled()
    expect(mocks.createSignedUrl).not.toHaveBeenCalled()
    expect(globalThis.fetch).not.toHaveBeenCalled()
    expect(mocks.transaction).not.toHaveBeenCalled()
    expect(mocks.txMediaAssetCreate).not.toHaveBeenCalled()
  })

  it('rejects media-private thumb for public review media before storage lookup or DB write', async () => {
    const result = await POST(
      makePostRequest(
        makeValidBody({
          thumbBucket: BUCKETS.mediaPrivate,
          thumbPath: 'reviews/review_1/private-thumb.jpg',
        }),
      ),
      makeCtx(),
    )

    expect(result.status).toBe(400)
    await expect(result.json()).resolves.toEqual({
      ok: false,
      error: `Review thumb must upload to ${BUCKETS.mediaPublic}.`,
    })

    expect(mocks.getPublicUrl).not.toHaveBeenCalled()
    expect(mocks.createSignedUrl).not.toHaveBeenCalled()
    expect(globalThis.fetch).not.toHaveBeenCalled()
    expect(mocks.transaction).not.toHaveBeenCalled()
    expect(mocks.txMediaAssetCreate).not.toHaveBeenCalled()
  })

  it('rejects path traversal before storage lookup or DB write', async () => {
    const result = await POST(
      makePostRequest(
        makeValidBody({
          storagePath: '../private/file.jpg',
        }),
      ),
      makeCtx(),
    )

    expect(result.status).toBe(400)
    await expect(result.json()).resolves.toEqual({
      ok: false,
      error: 'Invalid storageBucket/storagePath.',
    })

    expect(mocks.getPublicUrl).not.toHaveBeenCalled()
    expect(globalThis.fetch).not.toHaveBeenCalled()
    expect(mocks.transaction).not.toHaveBeenCalled()
  })

  it('rejects unpaired thumb bucket and path before storage lookup or DB write', async () => {
    const result = await POST(
      makePostRequest(
        makeValidBody({
          thumbBucket: BUCKETS.mediaPublic,
          thumbPath: null,
        }),
      ),
      makeCtx(),
    )

    expect(result.status).toBe(400)
    await expect(result.json()).resolves.toEqual({
      ok: false,
      error: 'thumbBucket and thumbPath must be provided together.',
    })

    expect(mocks.getPublicUrl).not.toHaveBeenCalled()
    expect(globalThis.fetch).not.toHaveBeenCalled()
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

  it('rejects missing uploaded thumb before DB write', async () => {
    vi.mocked(globalThis.fetch)
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 404 }))

    const result = await POST(makePostRequest(makeValidBody()), makeCtx())

    expect(result.status).toBe(400)
    await expect(result.json()).resolves.toEqual({
      ok: false,
      error: 'Uploaded thumb not found in storage.',
    })

    expect(mocks.transaction).not.toHaveBeenCalled()
    expect(mocks.txMediaAssetCreate).not.toHaveBeenCalled()
  })

  it('creates public review media for the owning client and returns render-safe urls', async () => {
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
      },
    })

    expect(mocks.mediaAssetCount).toHaveBeenCalledWith({
      where: {
        reviewId: 'review_1',
        uploadedByRole: Role.CLIENT,
      },
    })

    expect(mocks.getPublicUrl).toHaveBeenCalledTimes(2)
    expect(globalThis.fetch).toHaveBeenCalledTimes(2)

    expect(mocks.txMediaAssetCreate).toHaveBeenCalledWith({
      data: {
        professionalId: 'pro_1',
        bookingId: 'booking_1',
        reviewId: 'review_1',
        storageBucket: BUCKETS.mediaPublic,
        storagePath: 'reviews/review_1/main.jpg',
        thumbBucket: BUCKETS.mediaPublic,
        thumbPath: 'reviews/review_1/thumb.jpg',
        url: null,
        thumbUrl: null,
        mediaType: MediaType.IMAGE,
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

    expect(mocks.txReviewFindUnique).toHaveBeenCalledWith({
      where: {
        id: 'review_1',
      },
      include: {
        mediaAssets: true,
      },
    })

    expect(mocks.renderMediaUrls).toHaveBeenCalledWith({
      storageBucket: BUCKETS.mediaPublic,
      storagePath: 'reviews/review_1/main.jpg',
      thumbBucket: BUCKETS.mediaPublic,
      thumbPath: 'reviews/review_1/thumb.jpg',
      url: null,
      thumbUrl: null,
    })

    expect(result.status).toBe(201)
    await expect(result.json()).resolves.toEqual({
      ok: true,
      createdCount: 1,
      created: [
        {
          ...createdMedia,
          createdAt: createdAtIso,
          renderUrl: renderedUrls.renderUrl,
          renderThumbUrl: renderedUrls.renderThumbUrl,
          url: renderedUrls.renderUrl,
          thumbUrl: renderedUrls.renderThumbUrl,
        },
      ],
      review: {
        ...review,
        mediaAssets: [
          {
            ...createdMedia,
            createdAt: createdAtIso,
          },
        ],
      },
    })
  })

  it('returns 500 and logs a safe error when media creation throws', async () => {
    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined)

    const thrown = new Error(
      'db failed for https://example.com/private.jpg?token=secret',
    )

    mocks.txMediaAssetCreate.mockRejectedValueOnce(thrown)

    const result = await POST(makePostRequest(makeValidBody()), makeCtx())

    expect(result.status).toBe(500)
    await expect(result.json()).resolves.toEqual({
      ok: false,
      error: 'Internal server error',
    })

    expect(mocks.safeError).toHaveBeenCalledWith(thrown)
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'POST /api/client/reviews/[id]/media error',
      {
        error: {
          name: 'Error',
          message:
            'db failed for https://example.com/private.jpg?token=secret',
        },
      },
    )

    consoleErrorSpy.mockRestore()
  })
})