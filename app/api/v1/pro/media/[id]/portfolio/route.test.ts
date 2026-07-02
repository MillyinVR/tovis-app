import { MediaPhase, MediaType, MediaVisibility } from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => {
  const jsonOk = vi.fn((data?: Record<string, unknown>, status = 200) =>
    Response.json({ ok: true, ...(data ?? {}) }, { status }),
  )

  const jsonFail = vi.fn(
    (status: number, error: string, extra?: Record<string, unknown>) =>
      Response.json({ ok: false, error, ...(extra ?? {}) }, { status }),
  )

  return {
    jsonOk,
    jsonFail,
    requirePro: vi.fn(),

    mediaAssetFindUnique: vi.fn(),
    mediaAssetUpdate: vi.fn(),
    loadPrimaryBeforeAssetId: vi.fn(),

    safeUrl: vi.fn((value: unknown) =>
      typeof value === 'string' && value.trim() ? value.trim() : null,
    ),
    resolveStoragePointers: vi.fn(),
    renderMediaUrls: vi.fn(),

    safeError: vi.fn((error: unknown) => ({
      name: error instanceof Error ? error.name : 'NonErrorThrown',
      message: error instanceof Error ? error.message : String(error),
    })),
  }
})

vi.mock('@/app/api/_utils', () => ({
  jsonOk: mocks.jsonOk,
  jsonFail: mocks.jsonFail,
  requirePro: mocks.requirePro,
  pickString: (value: unknown) => {
    if (typeof value !== 'string') return null
    const trimmed = value.trim()
    return trimmed.length > 0 ? trimmed : null
  },
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    mediaAsset: {
      findUnique: mocks.mediaAssetFindUnique,
      update: mocks.mediaAssetUpdate,
    },
  },
}))

vi.mock('@/lib/media', () => ({
  safeUrl: mocks.safeUrl,
  resolveStoragePointers: mocks.resolveStoragePointers,
}))

vi.mock('@/lib/media/renderUrls', () => ({
  renderMediaUrls: mocks.renderMediaUrls,
}))

vi.mock('@/lib/media/bookingBeforeAfter', () => ({
  loadPrimaryBeforeAssetId: mocks.loadPrimaryBeforeAssetId,
}))

vi.mock('@/lib/security/logging', () => ({
  safeError: mocks.safeError,
}))

import { DELETE, POST } from './route'

type TestCtx = {
  params: Promise<{ id: string }>
}

function makeCtx(id = 'media_1'): TestCtx {
  return {
    params: Promise.resolve({ id }),
  }
}

function makeRequest(
  method: 'POST' | 'DELETE' = 'POST',
  body?: Record<string, unknown>,
): NextRequest {
  return new NextRequest(
    'http://localhost/api/v1/pro/media/media_1/portfolio',
    {
      method,
      ...(body
        ? {
            body: JSON.stringify(body),
            headers: { 'content-type': 'application/json' },
          }
        : {}),
    },
  )
}

function makeOwnedMedia(
  overrides?: Partial<{
    id: string
    professionalId: string
    reviewId: string | null
    isFeaturedInPortfolio: boolean
    isEligibleForLooks: boolean
    visibility: MediaVisibility
    bookingId: string | null
    phase: MediaPhase
    mediaType: MediaType
    storageBucket: string
    storagePath: string
    thumbBucket: string | null
    thumbPath: string | null
    url: string | null
    thumbUrl: string | null
  }>,
) {
  return {
    id: 'media_1',
    professionalId: 'pro_1',
    reviewId: null,
    isFeaturedInPortfolio: false,
    isEligibleForLooks: false,
    visibility: MediaVisibility.PRO_CLIENT,
    bookingId: null,
    phase: MediaPhase.AFTER,
    mediaType: MediaType.IMAGE,
    storageBucket: 'media-public',
    storagePath: 'pros/pro_1/media_1.jpg',
    thumbBucket: null,
    thumbPath: null,
    url: 'https://cdn.example.com/media_1.jpg',
    thumbUrl: null,
    ...(overrides ?? {}),
  }
}

function makeUpdatedMedia(
  overrides?: Partial<{
    id: string
    isFeaturedInPortfolio: boolean
    isEligibleForLooks: boolean
    visibility: MediaVisibility
    beforeAssetId: string | null
    storageBucket: string
    storagePath: string
    thumbBucket: string | null
    thumbPath: string | null
    url: string | null
    thumbUrl: string | null
  }>,
) {
  return {
    id: 'media_1',
    isFeaturedInPortfolio: true,
    isEligibleForLooks: false,
    visibility: MediaVisibility.PUBLIC,
    beforeAssetId: null,
    storageBucket: 'media-public',
    storagePath: 'pros/pro_1/media_1.jpg',
    thumbBucket: null,
    thumbPath: null,
    url: 'https://cdn.example.com/media_1.jpg',
    thumbUrl: null,
    ...(overrides ?? {}),
  }
}

describe('app/api/v1/pro/media/[id]/portfolio/route.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mocks.requirePro.mockResolvedValue({
      ok: true,
      professionalId: 'pro_1',
      user: {
        id: 'user_1',
      },
    })

    mocks.mediaAssetFindUnique.mockResolvedValue(makeOwnedMedia())

    mocks.mediaAssetUpdate.mockResolvedValue(makeUpdatedMedia())

    // Default: no auto-pairable before on the booking (assets have no bookingId
    // by default anyway, so this is only consulted by the auto-pair tests).
    mocks.loadPrimaryBeforeAssetId.mockResolvedValue(null)

    mocks.renderMediaUrls.mockResolvedValue({
      renderUrl: 'https://rendered.example.com/media_1.jpg',
      renderThumbUrl: null,
    })

    mocks.resolveStoragePointers.mockReturnValue({
      storageBucket: 'media-public',
      storagePath: 'backfilled/media_1.jpg',
      thumbBucket: null,
      thumbPath: null,
    })
  })

  describe('POST', () => {
    it('returns auth response when requirePro fails', async () => {
      const authRes = Response.json(
        { ok: false, error: 'Unauthorized' },
        { status: 401 },
      )

      mocks.requirePro.mockResolvedValueOnce({
        ok: false,
        res: authRes,
      })

      const res = await POST(makeRequest('POST'), makeCtx())

      expect(res).toBe(authRes)
      expect(mocks.mediaAssetFindUnique).not.toHaveBeenCalled()
      expect(mocks.mediaAssetUpdate).not.toHaveBeenCalled()
    })

    it('returns 400 when media id is missing', async () => {
      const res = await POST(makeRequest('POST'), makeCtx(''))

      expect(res.status).toBe(400)
      await expect(res.json()).resolves.toEqual({
        ok: false,
        error: 'Missing media id.',
      })

      expect(mocks.mediaAssetFindUnique).not.toHaveBeenCalled()
      expect(mocks.mediaAssetUpdate).not.toHaveBeenCalled()
    })

    it('returns 404 when media is not found', async () => {
      mocks.mediaAssetFindUnique.mockResolvedValueOnce(null)

      const res = await POST(makeRequest('POST'), makeCtx())

      expect(res.status).toBe(404)
      await expect(res.json()).resolves.toEqual({
        ok: false,
        error: 'Media not found.',
      })

      expect(mocks.mediaAssetUpdate).not.toHaveBeenCalled()
    })

    it('returns 403 when media belongs to another professional', async () => {
      mocks.mediaAssetFindUnique.mockResolvedValueOnce(
        makeOwnedMedia({
          professionalId: 'other_pro',
        }),
      )

      const res = await POST(makeRequest('POST'), makeCtx())

      expect(res.status).toBe(403)
      await expect(res.json()).resolves.toEqual({
        ok: false,
        error: 'Forbidden.',
      })

      expect(mocks.mediaAssetUpdate).not.toHaveBeenCalled()
    })

    it('returns 403 and does not update when media is an unpromoted private session photo', async () => {
      mocks.mediaAssetFindUnique.mockResolvedValueOnce(
        makeOwnedMedia({
          storageBucket: 'media-private',
          reviewId: null,
          visibility: MediaVisibility.PRO_CLIENT,
        }),
      )

      const res = await POST(makeRequest('POST'), makeCtx())

      expect(res.status).toBe(403)
      await expect(res.json()).resolves.toEqual({
        ok: false,
        error:
          'This session photo can only be shared publicly after the client adds it to a review or allows it in their aftercare.',
      })
      expect(mocks.mediaAssetUpdate).not.toHaveBeenCalled()
    })

    it('allows featuring a private session photo once it has been promoted via a review', async () => {
      mocks.mediaAssetFindUnique.mockResolvedValueOnce(
        makeOwnedMedia({
          storageBucket: 'media-private',
          reviewId: 'review_1',
          visibility: MediaVisibility.PUBLIC,
        }),
      )

      const res = await POST(makeRequest('POST'), makeCtx())

      expect(res.status).toBe(200)
      expect(mocks.mediaAssetUpdate).toHaveBeenCalledTimes(1)
    })

    it('marks owned media as featured and public when not eligible for Looks', async () => {
      const updated = makeUpdatedMedia({
        isFeaturedInPortfolio: true,
        isEligibleForLooks: false,
        visibility: MediaVisibility.PUBLIC,
      })

      mocks.mediaAssetUpdate.mockResolvedValueOnce(updated)

      const res = await POST(makeRequest('POST'), makeCtx())

      expect(mocks.mediaAssetFindUnique).toHaveBeenCalledWith({
        where: { id: 'media_1' },
        select: {
          id: true,
          professionalId: true,
          reviewId: true,
          isFeaturedInPortfolio: true,
          isEligibleForLooks: true,
          visibility: true,
          bookingId: true,
          phase: true,
          mediaType: true,
          booking: { select: { mediaUseConsentAt: true } },
          storageBucket: true,
          storagePath: true,
          thumbBucket: true,
          thumbPath: true,
          url: true,
          thumbUrl: true,
        },
      })

      expect(mocks.mediaAssetUpdate).toHaveBeenCalledTimes(1)
      expect(mocks.mediaAssetUpdate).toHaveBeenCalledWith({
        where: { id: 'media_1' },
        data: {
          isFeaturedInPortfolio: true,
          visibility: MediaVisibility.PUBLIC,
          beforeAssetId: null,
        },
        select: {
          id: true,
          isFeaturedInPortfolio: true,
          isEligibleForLooks: true,
          visibility: true,
          beforeAssetId: true,
          storageBucket: true,
          storagePath: true,
          thumbBucket: true,
          thumbPath: true,
          url: true,
          thumbUrl: true,
        },
      })

      expect(mocks.renderMediaUrls).toHaveBeenCalledWith(updated)

      expect(res.status).toBe(200)
      await expect(res.json()).resolves.toEqual({
        ok: true,
        media: {
          ...updated,
          url: 'https://rendered.example.com/media_1.jpg',
          thumbUrl: null,
        },
      })
    })

    it('keeps visibility public when media is already eligible for Looks', async () => {
      mocks.mediaAssetFindUnique.mockResolvedValueOnce(
        makeOwnedMedia({
          isEligibleForLooks: true,
          visibility: MediaVisibility.PUBLIC,
        }),
      )

      const updated = makeUpdatedMedia({
        isFeaturedInPortfolio: true,
        isEligibleForLooks: true,
        visibility: MediaVisibility.PUBLIC,
      })

      mocks.mediaAssetUpdate.mockResolvedValueOnce(updated)

      const res = await POST(makeRequest('POST'), makeCtx())

      expect(mocks.mediaAssetUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: {
            isFeaturedInPortfolio: true,
            visibility: MediaVisibility.PUBLIC,
            beforeAssetId: null,
          },
        }),
      )

      expect(res.status).toBe(200)
    })

    it('backfills canonical pointers when missing and legacy url can be resolved', async () => {
      mocks.mediaAssetFindUnique.mockResolvedValueOnce(
        makeOwnedMedia({
          storageBucket: '',
          storagePath: '',
          url: 'https://cdn.example.com/legacy/media_1.jpg',
          thumbUrl: 'https://cdn.example.com/legacy/thumb_1.jpg',
        }),
      )

      const updated = makeUpdatedMedia()
      mocks.mediaAssetUpdate
        .mockResolvedValueOnce({ id: 'media_1' })
        .mockResolvedValueOnce(updated)

      const res = await POST(makeRequest('POST'), makeCtx())

      expect(mocks.safeUrl).toHaveBeenCalledWith(
        'https://cdn.example.com/legacy/media_1.jpg',
      )
      expect(mocks.safeUrl).toHaveBeenCalledWith(
        'https://cdn.example.com/legacy/thumb_1.jpg',
      )

      expect(mocks.resolveStoragePointers).toHaveBeenCalledWith({
        url: 'https://cdn.example.com/legacy/media_1.jpg',
        thumbUrl: 'https://cdn.example.com/legacy/thumb_1.jpg',
        storageBucket: null,
        storagePath: null,
        thumbBucket: null,
        thumbPath: null,
      })

      expect(mocks.mediaAssetUpdate).toHaveBeenNthCalledWith(1, {
        where: { id: 'media_1' },
        data: {
          storageBucket: 'media-public',
          storagePath: 'backfilled/media_1.jpg',
          thumbBucket: null,
          thumbPath: null,
        },
        select: { id: true },
      })

      expect(mocks.mediaAssetUpdate).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          data: {
            isFeaturedInPortfolio: true,
            visibility: MediaVisibility.PUBLIC,
            beforeAssetId: null,
          },
        }),
      )

      expect(res.status).toBe(200)
    })

    it('returns 500 and logs a safe error when update throws', async () => {
      const consoleErrorSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => undefined)

      const thrown = new Error(
        'update failed for https://example.com/private.jpg?token=secret',
      )

      mocks.mediaAssetUpdate.mockRejectedValueOnce(thrown)

      const res = await POST(makeRequest('POST'), makeCtx())

      expect(res.status).toBe(500)
      await expect(res.json()).resolves.toEqual({
        ok: false,
        error: 'Internal server error',
      })

      expect(mocks.safeError).toHaveBeenCalledWith(thrown)
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'POST /api/v1/pro/media/[id]/portfolio error',
        {
          error: {
            name: 'Error',
            message:
              'update failed for https://example.com/private.jpg?token=secret',
          },
        },
      )

      consoleErrorSpy.mockRestore()
    })
  })

  describe('POST before/after pairing', () => {
    it('auto-pairs a featured after with its booking’s primary before (default-on)', async () => {
      mocks.mediaAssetFindUnique.mockResolvedValueOnce(
        makeOwnedMedia({ bookingId: 'book_1', phase: MediaPhase.AFTER }),
      )
      mocks.loadPrimaryBeforeAssetId.mockResolvedValueOnce('before_1')
      mocks.mediaAssetUpdate.mockResolvedValueOnce(
        makeUpdatedMedia({ beforeAssetId: 'before_1' }),
      )

      const res = await POST(makeRequest('POST'), makeCtx())

      expect(mocks.loadPrimaryBeforeAssetId).toHaveBeenCalledWith(
        'book_1',
        'media_1',
      )
      expect(mocks.mediaAssetUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ beforeAssetId: 'before_1' }),
        }),
      )
      expect(res.status).toBe(200)
    })

    it('does not auto-pair a video after', async () => {
      mocks.mediaAssetFindUnique.mockResolvedValueOnce(
        makeOwnedMedia({
          bookingId: 'book_1',
          mediaType: MediaType.VIDEO,
          phase: MediaPhase.OTHER,
        }),
      )

      const res = await POST(makeRequest('POST'), makeCtx())

      expect(mocks.loadPrimaryBeforeAssetId).not.toHaveBeenCalled()
      expect(mocks.mediaAssetUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ beforeAssetId: null }),
        }),
      )
      expect(res.status).toBe(200)
    })

    it('does not auto-pair when the featured photo is itself a before', async () => {
      mocks.mediaAssetFindUnique.mockResolvedValueOnce(
        makeOwnedMedia({ bookingId: 'book_1', phase: MediaPhase.BEFORE }),
      )

      const res = await POST(makeRequest('POST'), makeCtx())

      expect(mocks.loadPrimaryBeforeAssetId).not.toHaveBeenCalled()
      expect(mocks.mediaAssetUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ beforeAssetId: null }),
        }),
      )
      expect(res.status).toBe(200)
    })

    it('pairs with an explicit before after validating ownership', async () => {
      mocks.mediaAssetFindUnique
        .mockResolvedValueOnce(makeOwnedMedia({ bookingId: 'book_1' }))
        .mockResolvedValueOnce({
          id: 'before_1',
          professionalId: 'pro_1',
          mediaType: MediaType.IMAGE,
        })
      mocks.mediaAssetUpdate.mockResolvedValueOnce(
        makeUpdatedMedia({ beforeAssetId: 'before_1' }),
      )

      const res = await POST(
        makeRequest('POST', { beforeAssetId: 'before_1' }),
        makeCtx(),
      )

      // Explicit choice wins — the booking auto-pair helper is never consulted.
      expect(mocks.loadPrimaryBeforeAssetId).not.toHaveBeenCalled()
      expect(mocks.mediaAssetUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ beforeAssetId: 'before_1' }),
        }),
      )
      expect(res.status).toBe(200)
    })

    it('rejects pairing a photo with itself', async () => {
      const res = await POST(
        makeRequest('POST', { beforeAssetId: 'media_1' }),
        makeCtx(),
      )

      expect(res.status).toBe(400)
      await expect(res.json()).resolves.toEqual({
        ok: false,
        error: 'A photo can’t be paired with itself.',
      })
      expect(mocks.mediaAssetUpdate).not.toHaveBeenCalled()
    })

    it('rejects an explicit before owned by another professional', async () => {
      mocks.mediaAssetFindUnique
        .mockResolvedValueOnce(makeOwnedMedia())
        .mockResolvedValueOnce({
          id: 'before_1',
          professionalId: 'other_pro',
          mediaType: MediaType.IMAGE,
        })

      const res = await POST(
        makeRequest('POST', { beforeAssetId: 'before_1' }),
        makeCtx(),
      )

      expect(res.status).toBe(400)
      await expect(res.json()).resolves.toEqual({
        ok: false,
        error: 'Before photo not found.',
      })
      expect(mocks.mediaAssetUpdate).not.toHaveBeenCalled()
    })

    it('rejects an explicit before that is a video', async () => {
      mocks.mediaAssetFindUnique
        .mockResolvedValueOnce(makeOwnedMedia())
        .mockResolvedValueOnce({
          id: 'before_1',
          professionalId: 'pro_1',
          mediaType: MediaType.VIDEO,
        })

      const res = await POST(
        makeRequest('POST', { beforeAssetId: 'before_1' }),
        makeCtx(),
      )

      expect(res.status).toBe(400)
      await expect(res.json()).resolves.toEqual({
        ok: false,
        error: 'A before/after pair must both be photos.',
      })
      expect(mocks.mediaAssetUpdate).not.toHaveBeenCalled()
    })

    it('unpairs when sent an explicit null before', async () => {
      mocks.mediaAssetFindUnique.mockResolvedValueOnce(
        makeOwnedMedia({ bookingId: 'book_1' }),
      )

      const res = await POST(
        makeRequest('POST', { beforeAssetId: null }),
        makeCtx(),
      )

      // Explicit null → unpair, and the auto-pair helper is not consulted.
      expect(mocks.loadPrimaryBeforeAssetId).not.toHaveBeenCalled()
      expect(mocks.mediaAssetUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ beforeAssetId: null }),
        }),
      )
      expect(res.status).toBe(200)
    })
  })

  describe('DELETE', () => {
    it('returns auth response when requirePro fails', async () => {
      const authRes = Response.json(
        { ok: false, error: 'Unauthorized' },
        { status: 401 },
      )

      mocks.requirePro.mockResolvedValueOnce({
        ok: false,
        res: authRes,
      })

      const res = await DELETE(makeRequest('DELETE'), makeCtx())

      expect(res).toBe(authRes)
      expect(mocks.mediaAssetFindUnique).not.toHaveBeenCalled()
      expect(mocks.mediaAssetUpdate).not.toHaveBeenCalled()
    })

    it('returns 400 when media id is missing', async () => {
      const res = await DELETE(makeRequest('DELETE'), makeCtx(''))

      expect(res.status).toBe(400)
      await expect(res.json()).resolves.toEqual({
        ok: false,
        error: 'Missing media id.',
      })

      expect(mocks.mediaAssetFindUnique).not.toHaveBeenCalled()
      expect(mocks.mediaAssetUpdate).not.toHaveBeenCalled()
    })

    it('returns 404 when media is not found', async () => {
      mocks.mediaAssetFindUnique.mockResolvedValueOnce(null)

      const res = await DELETE(makeRequest('DELETE'), makeCtx())

      expect(res.status).toBe(404)
      await expect(res.json()).resolves.toEqual({
        ok: false,
        error: 'Media not found.',
      })

      expect(mocks.mediaAssetUpdate).not.toHaveBeenCalled()
    })

    it('returns 403 when media belongs to another professional', async () => {
      mocks.mediaAssetFindUnique.mockResolvedValueOnce(
        makeOwnedMedia({
          professionalId: 'other_pro',
        }),
      )

      const res = await DELETE(makeRequest('DELETE'), makeCtx())

      expect(res.status).toBe(403)
      await expect(res.json()).resolves.toEqual({
        ok: false,
        error: 'Forbidden.',
      })

      expect(mocks.mediaAssetUpdate).not.toHaveBeenCalled()
    })

    it('removes media from portfolio and makes it pro-client when not eligible for Looks', async () => {
      mocks.mediaAssetFindUnique.mockResolvedValueOnce(
        makeOwnedMedia({
          isFeaturedInPortfolio: true,
          isEligibleForLooks: false,
          visibility: MediaVisibility.PUBLIC,
        }),
      )

      const updated = makeUpdatedMedia({
        isFeaturedInPortfolio: false,
        isEligibleForLooks: false,
        visibility: MediaVisibility.PRO_CLIENT,
      })

      mocks.mediaAssetUpdate.mockResolvedValueOnce(updated)

      const res = await DELETE(makeRequest('DELETE'), makeCtx())

      expect(mocks.mediaAssetUpdate).toHaveBeenCalledWith({
        where: { id: 'media_1' },
        data: {
          isFeaturedInPortfolio: false,
          visibility: MediaVisibility.PRO_CLIENT,
          beforeAssetId: null,
        },
        select: {
          id: true,
          isFeaturedInPortfolio: true,
          isEligibleForLooks: true,
          visibility: true,
          beforeAssetId: true,
          storageBucket: true,
          storagePath: true,
          thumbBucket: true,
          thumbPath: true,
          url: true,
          thumbUrl: true,
        },
      })

      expect(mocks.renderMediaUrls).toHaveBeenCalledWith(updated)

      expect(res.status).toBe(200)
      await expect(res.json()).resolves.toEqual({
        ok: true,
        media: {
          ...updated,
          url: 'https://rendered.example.com/media_1.jpg',
          thumbUrl: null,
        },
      })
    })

    it('keeps media public when removing from portfolio but still eligible for Looks', async () => {
      mocks.mediaAssetFindUnique.mockResolvedValueOnce(
        makeOwnedMedia({
          isFeaturedInPortfolio: true,
          isEligibleForLooks: true,
          visibility: MediaVisibility.PUBLIC,
        }),
      )

      const updated = makeUpdatedMedia({
        isFeaturedInPortfolio: false,
        isEligibleForLooks: true,
        visibility: MediaVisibility.PUBLIC,
      })

      mocks.mediaAssetUpdate.mockResolvedValueOnce(updated)

      const res = await DELETE(makeRequest('DELETE'), makeCtx())

      expect(mocks.mediaAssetUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: {
            isFeaturedInPortfolio: false,
            visibility: MediaVisibility.PUBLIC,
            beforeAssetId: null,
          },
        }),
      )

      expect(res.status).toBe(200)
    })

    it('returns 500 and logs a safe error when update throws', async () => {
      const consoleErrorSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => undefined)

      const thrown = new Error(
        'delete failed for https://example.com/private.jpg?token=secret',
      )

      mocks.mediaAssetUpdate.mockRejectedValueOnce(thrown)

      const res = await DELETE(makeRequest('DELETE'), makeCtx())

      expect(res.status).toBe(500)
      await expect(res.json()).resolves.toEqual({
        ok: false,
        error: 'Internal server error',
      })

      expect(mocks.safeError).toHaveBeenCalledWith(thrown)
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'DELETE /api/v1/pro/media/[id]/portfolio error',
        {
          error: {
            name: 'Error',
            message:
              'delete failed for https://example.com/private.jpg?token=secret',
          },
        },
      )

      consoleErrorSpy.mockRestore()
    })
  })
})