import { MediaVisibility } from '@prisma/client'
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

function makeRequest(method: 'POST' | 'DELETE' = 'POST'): NextRequest {
  return new NextRequest(
    'http://localhost/api/pro/media/media_1/portfolio',
    {
      method,
    },
  )
}

function makeOwnedMedia(
  overrides?: Partial<{
    id: string
    professionalId: string
    isFeaturedInPortfolio: boolean
    isEligibleForLooks: boolean
    visibility: MediaVisibility
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
    isFeaturedInPortfolio: false,
    isEligibleForLooks: false,
    visibility: MediaVisibility.PRO_CLIENT,
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
    storageBucket: 'media-public',
    storagePath: 'pros/pro_1/media_1.jpg',
    thumbBucket: null,
    thumbPath: null,
    url: 'https://cdn.example.com/media_1.jpg',
    thumbUrl: null,
    ...(overrides ?? {}),
  }
}

describe('app/api/pro/media/[id]/portfolio/route.ts', () => {
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
          isFeaturedInPortfolio: true,
          isEligibleForLooks: true,
          visibility: true,
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
        },
        select: {
          id: true,
          isFeaturedInPortfolio: true,
          isEligibleForLooks: true,
          visibility: true,
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
        'POST /api/pro/media/[id]/portfolio error',
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
        },
        select: {
          id: true,
          isFeaturedInPortfolio: true,
          isEligibleForLooks: true,
          visibility: true,
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
        'DELETE /api/pro/media/[id]/portfolio error',
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