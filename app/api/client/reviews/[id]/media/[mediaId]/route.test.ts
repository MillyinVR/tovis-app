// app/api/client/reviews/[id]/media/[mediaId]/route.test.ts

import { Role } from '@prisma/client'
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const review = {
  id: 'review_1',
  clientId: 'client_1',
}

const media = {
  id: 'media_1',
  reviewId: 'review_1',
  uploadedByUserId: 'user_1',
  uploadedByRole: Role.CLIENT,
  isFeaturedInPortfolio: false,
  isEligibleForLooks: false,
}

const mocks = vi.hoisted(() => ({
  requireClient: vi.fn(),
  pickString: vi.fn(),
  jsonFail: vi.fn(),
  jsonOk: vi.fn(),

  reviewFindUnique: vi.fn(),
  mediaAssetFindUnique: vi.fn(),
  mediaAssetDelete: vi.fn(),

  safeError: vi.fn((error: unknown) => ({
    name: error instanceof Error ? error.name : 'NonErrorThrown',
    message: error instanceof Error ? error.message : String(error),
  })),
}))

vi.mock('@/app/api/_utils', () => ({
  requireClient: mocks.requireClient,
  pickString: mocks.pickString,
  jsonFail: mocks.jsonFail,
  jsonOk: mocks.jsonOk,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    review: {
      findUnique: mocks.reviewFindUnique,
    },
    mediaAsset: {
      findUnique: mocks.mediaAssetFindUnique,
      delete: mocks.mediaAssetDelete,
    },
  },
}))

vi.mock('@/lib/security/logging', () => ({
  safeError: mocks.safeError,
}))

import { DELETE } from './route'

function makeJsonResponse(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'content-type': 'application/json',
    },
  })
}

function makeCtx(args?: { id?: string; mediaId?: string }) {
  return {
    params: Promise.resolve({
      id: args?.id ?? 'review_1',
      mediaId: args?.mediaId ?? 'media_1',
    }),
  }
}

function makeDeleteRequest(): NextRequest {
  return new NextRequest(
    'http://localhost/api/client/reviews/review_1/media/media_1',
    {
      method: 'DELETE',
    },
  )
}

describe('app/api/client/reviews/[id]/media/[mediaId]/route.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mocks.requireClient.mockResolvedValue({
      ok: true,
      clientId: 'client_1',
      user: {
        id: 'user_1',
      },
    })

    mocks.pickString.mockImplementation((value: unknown) => {
      if (typeof value !== 'string') return null

      const trimmed = value.trim()
      return trimmed.length > 0 ? trimmed : null
    })

    mocks.jsonFail.mockImplementation((status: number, error: string) =>
      makeJsonResponse(status, {
        ok: false,
        error,
      }),
    )

    mocks.jsonOk.mockImplementation((data: Record<string, unknown> = {}) =>
      makeJsonResponse(200, {
        ok: true,
        ...data,
      }),
    )

    mocks.reviewFindUnique.mockResolvedValue(review)
    mocks.mediaAssetFindUnique.mockResolvedValue(media)
    mocks.mediaAssetDelete.mockResolvedValue(media)
  })

  afterEach(() => {
    vi.restoreAllMocks()
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

    const result = await DELETE(makeDeleteRequest(), makeCtx())

    expect(result).toBe(authRes)
    expect(mocks.reviewFindUnique).not.toHaveBeenCalled()
    expect(mocks.mediaAssetFindUnique).not.toHaveBeenCalled()
    expect(mocks.mediaAssetDelete).not.toHaveBeenCalled()
  })

  it('returns 400 when review id is missing', async () => {
    const result = await DELETE(
      makeDeleteRequest(),
      makeCtx({
        id: '',
        mediaId: 'media_1',
      }),
    )

    expect(result.status).toBe(400)
    await expect(result.json()).resolves.toEqual({
      ok: false,
      error: 'Missing id or mediaId.',
    })

    expect(mocks.reviewFindUnique).not.toHaveBeenCalled()
    expect(mocks.mediaAssetDelete).not.toHaveBeenCalled()
  })

  it('returns 400 when media id is missing', async () => {
    const result = await DELETE(
      makeDeleteRequest(),
      makeCtx({
        id: 'review_1',
        mediaId: '',
      }),
    )

    expect(result.status).toBe(400)
    await expect(result.json()).resolves.toEqual({
      ok: false,
      error: 'Missing id or mediaId.',
    })

    expect(mocks.reviewFindUnique).not.toHaveBeenCalled()
    expect(mocks.mediaAssetDelete).not.toHaveBeenCalled()
  })

  it('returns 404 when review is not found', async () => {
    mocks.reviewFindUnique.mockResolvedValueOnce(null)

    const result = await DELETE(makeDeleteRequest(), makeCtx())

    expect(result.status).toBe(404)
    await expect(result.json()).resolves.toEqual({
      ok: false,
      error: 'Review not found.',
    })

    expect(mocks.mediaAssetFindUnique).not.toHaveBeenCalled()
    expect(mocks.mediaAssetDelete).not.toHaveBeenCalled()
  })

  it('returns 403 when review belongs to another client', async () => {
    mocks.reviewFindUnique.mockResolvedValueOnce({
      ...review,
      clientId: 'other_client',
    })

    const result = await DELETE(makeDeleteRequest(), makeCtx())

    expect(result.status).toBe(403)
    await expect(result.json()).resolves.toEqual({
      ok: false,
      error: 'Forbidden.',
    })

    expect(mocks.mediaAssetFindUnique).not.toHaveBeenCalled()
    expect(mocks.mediaAssetDelete).not.toHaveBeenCalled()
  })

  it('returns 404 when media is not found', async () => {
    mocks.mediaAssetFindUnique.mockResolvedValueOnce(null)

    const result = await DELETE(makeDeleteRequest(), makeCtx())

    expect(result.status).toBe(404)
    await expect(result.json()).resolves.toEqual({
      ok: false,
      error: 'Media not found.',
    })

    expect(mocks.mediaAssetDelete).not.toHaveBeenCalled()
  })

  it('returns 404 when media belongs to another review', async () => {
    mocks.mediaAssetFindUnique.mockResolvedValueOnce({
      ...media,
      reviewId: 'other_review',
    })

    const result = await DELETE(makeDeleteRequest(), makeCtx())

    expect(result.status).toBe(404)
    await expect(result.json()).resolves.toEqual({
      ok: false,
      error: 'Media not found.',
    })

    expect(mocks.mediaAssetDelete).not.toHaveBeenCalled()
  })

  it('returns 404 when media was uploaded by another user', async () => {
    mocks.mediaAssetFindUnique.mockResolvedValueOnce({
      ...media,
      uploadedByUserId: 'other_user',
    })

    const result = await DELETE(makeDeleteRequest(), makeCtx())

    expect(result.status).toBe(404)
    await expect(result.json()).resolves.toEqual({
      ok: false,
      error: 'Media not found.',
    })

    expect(mocks.mediaAssetDelete).not.toHaveBeenCalled()
  })

  it('returns 404 when media was not uploaded by a client', async () => {
    mocks.mediaAssetFindUnique.mockResolvedValueOnce({
      ...media,
      uploadedByRole: Role.PRO,
    })

    const result = await DELETE(makeDeleteRequest(), makeCtx())

    expect(result.status).toBe(404)
    await expect(result.json()).resolves.toEqual({
      ok: false,
      error: 'Media not found.',
    })

    expect(mocks.mediaAssetDelete).not.toHaveBeenCalled()
  })

  it('returns 409 when media is featured in portfolio', async () => {
    mocks.mediaAssetFindUnique.mockResolvedValueOnce({
      ...media,
      isFeaturedInPortfolio: true,
    })

    const result = await DELETE(makeDeleteRequest(), makeCtx())

    expect(result.status).toBe(409)
    await expect(result.json()).resolves.toEqual({
      ok: false,
      error:
        'This media is in the professional’s portfolio/Looks and cannot be removed.',
    })

    expect(mocks.mediaAssetDelete).not.toHaveBeenCalled()
  })

  it('returns 409 when media is eligible for Looks', async () => {
    mocks.mediaAssetFindUnique.mockResolvedValueOnce({
      ...media,
      isEligibleForLooks: true,
    })

    const result = await DELETE(makeDeleteRequest(), makeCtx())

    expect(result.status).toBe(409)
    await expect(result.json()).resolves.toEqual({
      ok: false,
      error:
        'This media is in the professional’s portfolio/Looks and cannot be removed.',
    })

    expect(mocks.mediaAssetDelete).not.toHaveBeenCalled()
  })

  it('deletes client-owned review media and returns ok', async () => {
    const result = await DELETE(makeDeleteRequest(), makeCtx())

    expect(mocks.reviewFindUnique).toHaveBeenCalledWith({
      where: {
        id: 'review_1',
      },
      select: {
        id: true,
        clientId: true,
      },
    })

    expect(mocks.mediaAssetFindUnique).toHaveBeenCalledWith({
      where: {
        id: 'media_1',
      },
      select: {
        id: true,
        reviewId: true,
        uploadedByUserId: true,
        uploadedByRole: true,
        isFeaturedInPortfolio: true,
        isEligibleForLooks: true,
      },
    })

    expect(mocks.mediaAssetDelete).toHaveBeenCalledWith({
      where: {
        id: 'media_1',
      },
    })

    expect(result.status).toBe(200)
    await expect(result.json()).resolves.toEqual({
      ok: true,
    })
  })

  it('returns 500, logs a safe error, and does not leak unexpected errors', async () => {
    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined)

    const thrown = new Error(
      'db exploded for https://example.com/private.jpg?token=secret',
    )

    mocks.mediaAssetFindUnique.mockRejectedValueOnce(thrown)

    const result = await DELETE(makeDeleteRequest(), makeCtx())

    expect(result.status).toBe(500)
    await expect(result.json()).resolves.toEqual({
      ok: false,
      error: 'Internal server error',
    })

    expect(mocks.safeError).toHaveBeenCalledWith(thrown)
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'DELETE /api/client/reviews/[id]/media/[mediaId] error',
      {
        error: {
          name: 'Error',
          message:
            'db exploded for https://example.com/private.jpg?token=secret',
        },
      },
    )

    expect(mocks.mediaAssetDelete).not.toHaveBeenCalled()

    consoleErrorSpy.mockRestore()
  })
})