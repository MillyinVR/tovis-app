import { MediaVisibility } from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'

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
    mediaAssetDelete: vi.fn(),
    serviceFindMany: vi.fn(),

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
}))

vi.mock('@/lib/pick', () => ({
  pickString: (value: unknown) => {
    if (typeof value !== 'string') return null
    const trimmed = value.trim()
    return trimmed.length > 0 ? trimmed : null
  },
  pickBool: (value: unknown) => {
    if (typeof value === 'boolean') return value

    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase()
      if (['true', '1', 'yes', 'on'].includes(normalized)) return true
      if (['false', '0', 'no', 'off'].includes(normalized)) return false
    }

    return null
  },
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    mediaAsset: {
      findUnique: mocks.mediaAssetFindUnique,
      update: mocks.mediaAssetUpdate,
      delete: mocks.mediaAssetDelete,
    },
    service: {
      findMany: mocks.serviceFindMany,
    },
  },
}))

vi.mock('@/lib/security/logging', () => ({
  safeError: mocks.safeError,
}))

import { DELETE, PATCH } from './route'

type TestCtx = {
  params: Promise<{ id: string }>
}

function makeCtx(id = 'media_1'): TestCtx {
  return {
    params: Promise.resolve({ id }),
  }
}

function makeJsonRequest(body: unknown): Request {
  return new Request('http://localhost/api/v1/pro/media/media_1', {
    method: 'PATCH',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  })
}

function makeDeleteRequest(): Request {
  return new Request('http://localhost/api/v1/pro/media/media_1', {
    method: 'DELETE',
  })
}

function makeExistingMedia(
  overrides?: Partial<{
    id: string
    professionalId: string
    reviewId: string | null
    storageBucket: string
    caption: string | null
    isEligibleForLooks: boolean
    isFeaturedInPortfolio: boolean
    services: { serviceId: string }[]
  }>,
) {
  return {
    id: 'media_1',
    professionalId: 'pro_1',
    reviewId: null,
    storageBucket: 'media-public',
    caption: 'Before caption',
    isEligibleForLooks: false,
    isFeaturedInPortfolio: false,
    services: [{ serviceId: 'service_1' }],
    ...(overrides ?? {}),
  }
}

describe('app/api/v1/pro/media/[id]/route.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mocks.requirePro.mockResolvedValue({
      ok: true,
      professionalId: 'pro_1',
      user: {
        id: 'user_1',
      },
    })

    mocks.mediaAssetFindUnique.mockResolvedValue(makeExistingMedia())

    mocks.serviceFindMany.mockResolvedValue([{ id: 'service_1' }])

    mocks.mediaAssetUpdate.mockResolvedValue({
      id: 'media_1',
      caption: 'Updated caption',
      visibility: MediaVisibility.PRO_CLIENT,
      isEligibleForLooks: false,
      isFeaturedInPortfolio: false,
    })

    mocks.mediaAssetDelete.mockResolvedValue({
      id: 'media_1',
    })
  })

  describe('PATCH', () => {
    it('returns auth response when requirePro fails', async () => {
      const authRes = Response.json(
        { ok: false, error: 'Unauthorized' },
        { status: 401 },
      )

      mocks.requirePro.mockResolvedValueOnce({
        ok: false,
        res: authRes,
      })

      const res = await PATCH(makeJsonRequest({ caption: 'Nope' }), makeCtx())

      expect(res).toBe(authRes)
      expect(mocks.mediaAssetFindUnique).not.toHaveBeenCalled()
      expect(mocks.mediaAssetUpdate).not.toHaveBeenCalled()
    })

    it('returns 400 when media id is missing', async () => {
      const res = await PATCH(
        makeJsonRequest({ caption: 'Updated' }),
        makeCtx(''),
      )

      expect(res.status).toBe(400)
      await expect(res.json()).resolves.toEqual({
        ok: false,
        error: 'Missing id.',
      })

      expect(mocks.mediaAssetFindUnique).not.toHaveBeenCalled()
      expect(mocks.mediaAssetUpdate).not.toHaveBeenCalled()
    })

    it('returns 404 when media is not found', async () => {
      mocks.mediaAssetFindUnique.mockResolvedValueOnce(null)

      const res = await PATCH(makeJsonRequest({ caption: 'Updated' }), makeCtx())

      expect(res.status).toBe(404)
      await expect(res.json()).resolves.toEqual({
        ok: false,
        error: 'Not found.',
      })

      expect(mocks.mediaAssetUpdate).not.toHaveBeenCalled()
    })

    it('returns 403 when media belongs to another professional', async () => {
      mocks.mediaAssetFindUnique.mockResolvedValueOnce(
        makeExistingMedia({
          professionalId: 'other_pro',
        }),
      )

      const res = await PATCH(makeJsonRequest({ caption: 'Updated' }), makeCtx())

      expect(res.status).toBe(403)
      await expect(res.json()).resolves.toEqual({
        ok: false,
        error: 'Forbidden.',
      })

      expect(mocks.mediaAssetUpdate).not.toHaveBeenCalled()
    })

    it('returns 403 when making an unpromoted private session photo public', async () => {
      mocks.mediaAssetFindUnique.mockResolvedValueOnce(
        makeExistingMedia({
          storageBucket: 'media-private',
          reviewId: null,
        }),
      )

      const res = await PATCH(
        makeJsonRequest({ isEligibleForLooks: true }),
        makeCtx(),
      )

      expect(res.status).toBe(403)
      await expect(res.json()).resolves.toEqual({
        ok: false,
        error:
          'This session photo can only be shared publicly after the client adds it to a review.',
      })
      expect(mocks.mediaAssetUpdate).not.toHaveBeenCalled()
    })

    it('allows making a review-promoted private photo public', async () => {
      mocks.mediaAssetFindUnique.mockResolvedValueOnce(
        makeExistingMedia({
          storageBucket: 'media-private',
          reviewId: 'review_1',
        }),
      )
      mocks.mediaAssetUpdate.mockResolvedValueOnce({
        id: 'media_1',
        caption: 'Before caption',
        visibility: MediaVisibility.PUBLIC,
        isEligibleForLooks: true,
        isFeaturedInPortfolio: false,
      })

      const res = await PATCH(
        makeJsonRequest({ isEligibleForLooks: true }),
        makeCtx(),
      )

      expect(res.status).toBe(200)
      expect(mocks.mediaAssetUpdate).toHaveBeenCalledTimes(1)
    })

    it('returns 400 when provided serviceIds is empty', async () => {
      const res = await PATCH(
        makeJsonRequest({
          caption: 'Updated',
          serviceIds: [],
        }),
        makeCtx(),
      )

      expect(res.status).toBe(400)
      await expect(res.json()).resolves.toEqual({
        ok: false,
        error: 'Select at least one service tag.',
      })

      expect(mocks.serviceFindMany).not.toHaveBeenCalled()
      expect(mocks.mediaAssetUpdate).not.toHaveBeenCalled()
    })

    it('returns 400 when provided serviceIds are invalid', async () => {
      mocks.serviceFindMany.mockResolvedValueOnce([{ id: 'service_1' }])

      const res = await PATCH(
        makeJsonRequest({
          caption: 'Updated',
          serviceIds: ['service_1', 'missing_service'],
        }),
        makeCtx(),
      )

      expect(res.status).toBe(400)
      await expect(res.json()).resolves.toEqual({
        ok: false,
        error: 'One or more serviceIds are invalid.',
      })

      expect(mocks.serviceFindMany).toHaveBeenCalledWith({
        where: {
          id: { in: ['service_1', 'missing_service'] },
          isActive: true,
        },
        select: { id: true },
      })

      expect(mocks.mediaAssetUpdate).not.toHaveBeenCalled()
    })

    it('returns 409 when serviceIds are omitted and existing media has no services', async () => {
      mocks.mediaAssetFindUnique.mockResolvedValueOnce(
        makeExistingMedia({
          services: [],
        }),
      )

      const res = await PATCH(makeJsonRequest({ caption: 'Updated' }), makeCtx())

      expect(res.status).toBe(409)
      await expect(res.json()).resolves.toEqual({
        ok: false,
        error:
          'This media has no services attached. Please add at least one service before saving edits.',
      })

      expect(mocks.serviceFindMany).not.toHaveBeenCalled()
      expect(mocks.mediaAssetUpdate).not.toHaveBeenCalled()
    })

    it('updates caption, visibility flags, and services', async () => {
      mocks.serviceFindMany.mockResolvedValueOnce([
        { id: 'service_1' },
        { id: 'service_2' },
      ])

      mocks.mediaAssetUpdate.mockResolvedValueOnce({
        id: 'media_1',
        caption: 'Updated caption',
        visibility: MediaVisibility.PUBLIC,
        isEligibleForLooks: true,
        isFeaturedInPortfolio: false,
      })

      const res = await PATCH(
        makeJsonRequest({
          caption: 'Updated caption',
          isEligibleForLooks: true,
          isFeaturedInPortfolio: false,
          serviceIds: ['service_1', 'service_1', 'service_2'],
        }),
        makeCtx(),
      )

      expect(mocks.serviceFindMany).toHaveBeenCalledWith({
        where: {
          id: { in: ['service_1', 'service_2'] },
          isActive: true,
        },
        select: { id: true },
      })

      expect(mocks.mediaAssetUpdate).toHaveBeenCalledWith({
        where: { id: 'media_1' },
        data: {
          caption: 'Updated caption',
          visibility: MediaVisibility.PUBLIC,
          isEligibleForLooks: true,
          isFeaturedInPortfolio: false,
          services: {
            deleteMany: {},
            create: [{ serviceId: 'service_1' }, { serviceId: 'service_2' }],
          },
        },
        select: {
          id: true,
          caption: true,
          visibility: true,
          isEligibleForLooks: true,
          isFeaturedInPortfolio: true,
        },
      })

      expect(res.status).toBe(200)
      await expect(res.json()).resolves.toEqual({
        ok: true,
        media: {
          id: 'media_1',
          caption: 'Updated caption',
          visibility: MediaVisibility.PUBLIC,
          isEligibleForLooks: true,
          isFeaturedInPortfolio: false,
        },
      })
    })

    it('updates without replacing services when serviceIds are omitted', async () => {
      mocks.mediaAssetUpdate.mockResolvedValueOnce({
        id: 'media_1',
        caption: 'Caption only',
        visibility: MediaVisibility.PRO_CLIENT,
        isEligibleForLooks: false,
        isFeaturedInPortfolio: false,
      })

      const res = await PATCH(
        makeJsonRequest({
          caption: 'Caption only',
        }),
        makeCtx(),
      )

      expect(mocks.serviceFindMany).not.toHaveBeenCalled()

      expect(mocks.mediaAssetUpdate).toHaveBeenCalledWith({
        where: { id: 'media_1' },
        data: {
          caption: 'Caption only',
          visibility: MediaVisibility.PRO_CLIENT,
        },
        select: {
          id: true,
          caption: true,
          visibility: true,
          isEligibleForLooks: true,
          isFeaturedInPortfolio: true,
        },
      })

      expect(res.status).toBe(200)
      await expect(res.json()).resolves.toEqual({
        ok: true,
        media: {
          id: 'media_1',
          caption: 'Caption only',
          visibility: MediaVisibility.PRO_CLIENT,
          isEligibleForLooks: false,
          isFeaturedInPortfolio: false,
        },
      })
    })

    it('returns 500 and logs a safe error when update throws', async () => {
      const consoleErrorSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => undefined)

      const thrown = new Error(
        'update failed for https://example.com/private.jpg?token=secret',
      )

      mocks.mediaAssetUpdate.mockRejectedValueOnce(thrown)

      const res = await PATCH(
        makeJsonRequest({
          caption: 'Updated caption',
          serviceIds: ['service_1'],
        }),
        makeCtx(),
      )

      expect(res.status).toBe(500)
      await expect(res.json()).resolves.toEqual({
        ok: false,
        error: 'Failed to update media.',
      })

      expect(mocks.safeError).toHaveBeenCalledWith(thrown)
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'PATCH /api/v1/pro/media/[id] error',
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

      const res = await DELETE(makeDeleteRequest(), makeCtx())

      expect(res).toBe(authRes)
      expect(mocks.mediaAssetFindUnique).not.toHaveBeenCalled()
      expect(mocks.mediaAssetDelete).not.toHaveBeenCalled()
    })

    it('returns 400 when media id is missing', async () => {
      const res = await DELETE(makeDeleteRequest(), makeCtx(''))

      expect(res.status).toBe(400)
      await expect(res.json()).resolves.toEqual({
        ok: false,
        error: 'Missing id.',
      })

      expect(mocks.mediaAssetFindUnique).not.toHaveBeenCalled()
      expect(mocks.mediaAssetDelete).not.toHaveBeenCalled()
    })

    it('returns 404 when media is not found', async () => {
      mocks.mediaAssetFindUnique.mockResolvedValueOnce(null)

      const res = await DELETE(makeDeleteRequest(), makeCtx())

      expect(res.status).toBe(404)
      await expect(res.json()).resolves.toEqual({
        ok: false,
        error: 'Not found.',
      })

      expect(mocks.mediaAssetDelete).not.toHaveBeenCalled()
    })

    it('returns 403 when media belongs to another professional', async () => {
      mocks.mediaAssetFindUnique.mockResolvedValueOnce(
        makeExistingMedia({
          professionalId: 'other_pro',
        }),
      )

      const res = await DELETE(makeDeleteRequest(), makeCtx())

      expect(res.status).toBe(403)
      await expect(res.json()).resolves.toEqual({
        ok: false,
        error: 'Forbidden.',
      })

      expect(mocks.mediaAssetDelete).not.toHaveBeenCalled()
    })

    it('deletes owned media', async () => {
      const res = await DELETE(makeDeleteRequest(), makeCtx())

      expect(mocks.mediaAssetDelete).toHaveBeenCalledWith({
        where: { id: 'media_1' },
      })

      expect(res.status).toBe(200)
      await expect(res.json()).resolves.toEqual({
        ok: true,
      })
    })

    it('returns 500 and logs a safe error when delete throws', async () => {
      const consoleErrorSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => undefined)

      const thrown = new Error(
        'delete failed for https://example.com/private.jpg?token=secret',
      )

      mocks.mediaAssetDelete.mockRejectedValueOnce(thrown)

      const res = await DELETE(makeDeleteRequest(), makeCtx())

      expect(res.status).toBe(500)
      await expect(res.json()).resolves.toEqual({
        ok: false,
        error: 'Failed to delete media.',
      })

      expect(mocks.safeError).toHaveBeenCalledWith(thrown)
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'DELETE /api/v1/pro/media/[id] error',
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