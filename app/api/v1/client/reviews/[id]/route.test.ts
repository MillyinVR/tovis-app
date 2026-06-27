// app/api/v1/client/reviews/[id]/route.test.ts

import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const review = {
  id: 'review_1',
  clientId: 'client_1',
}

const reviewWithMedia = {
  id: 'review_1',
  clientId: 'client_1',
  rating: 5,
  headline: 'Great service',
  body: 'Loved it.',
  mediaAssets: [],
}

const mocks = vi.hoisted(() => ({
  requireClient: vi.fn(),
  pickString: vi.fn(),
  jsonFail: vi.fn(),
  jsonOk: vi.fn(),

  reviewFindUnique: vi.fn(),
  reviewUpdate: vi.fn(),
  reviewDelete: vi.fn(),
  mediaAssetCount: vi.fn(),
  mediaAssetDeleteMany: vi.fn(),
  transaction: vi.fn(),

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
      update: mocks.reviewUpdate,
      delete: mocks.reviewDelete,
    },
    mediaAsset: {
      count: mocks.mediaAssetCount,
    },
    $transaction: mocks.transaction,
  },
}))

vi.mock('@/lib/security/logging', () => ({
  safeError: mocks.safeError,
}))

import { DELETE, PATCH } from './route'

type TestCtx = {
  params: Promise<{ id: string }>
}

type TxForDeleteReview = {
  mediaAsset: {
    deleteMany: typeof mocks.mediaAssetDeleteMany
  }
  review: {
    delete: typeof mocks.reviewDelete
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

function makeCtx(id = 'review_1'): TestCtx {
  return {
    params: Promise.resolve({ id }),
  }
}

function makePatchRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/v1/client/reviews/review_1', {
    method: 'PATCH',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  })
}

function makeDeleteRequest(): NextRequest {
  return new NextRequest('http://localhost/api/v1/client/reviews/review_1', {
    method: 'DELETE',
  })
}

describe('app/api/v1/client/reviews/[id]/route.ts', () => {
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

    mocks.jsonFail.mockImplementation(
      (status: number, error: string, extra?: Record<string, unknown>) =>
        makeJsonResponse(status, {
          ok: false,
          error,
          ...(extra ?? {}),
        }),
    )

    mocks.jsonOk.mockImplementation(
      (data: Record<string, unknown> = {}, status = 200) =>
        makeJsonResponse(status, {
          ok: true,
          ...data,
        }),
    )

    mocks.reviewFindUnique.mockResolvedValue(review)

    mocks.reviewUpdate.mockResolvedValue({
      ...reviewWithMedia,
      rating: 4,
      headline: 'Updated headline',
      body: 'Updated body.',
    })

    mocks.mediaAssetCount.mockResolvedValue(0)
    mocks.mediaAssetDeleteMany.mockResolvedValue({ count: 0 })
    mocks.reviewDelete.mockResolvedValue(review)

    mocks.transaction.mockImplementation(
      async (fn: (tx: TxForDeleteReview) => Promise<unknown>) =>
        fn({
          mediaAsset: {
            deleteMany: mocks.mediaAssetDeleteMany,
          },
          review: {
            delete: mocks.reviewDelete,
          },
        }),
    )
  })

  describe('PATCH', () => {
    it('returns auth response when requireClient fails', async () => {
      const authRes = makeJsonResponse(401, {
        ok: false,
        error: 'Unauthorized',
      })

      mocks.requireClient.mockResolvedValueOnce({
        ok: false,
        res: authRes,
      })

      const result = await PATCH(makePatchRequest({ rating: 5 }), makeCtx())

      expect(result).toBe(authRes)
      expect(mocks.reviewFindUnique).not.toHaveBeenCalled()
      expect(mocks.reviewUpdate).not.toHaveBeenCalled()
    })

    it('returns 400 when review id is missing', async () => {
      const result = await PATCH(makePatchRequest({ rating: 5 }), makeCtx(''))

      expect(result.status).toBe(400)
      await expect(result.json()).resolves.toEqual({
        ok: false,
        error: 'Missing review id.',
      })

      expect(mocks.reviewFindUnique).not.toHaveBeenCalled()
      expect(mocks.reviewUpdate).not.toHaveBeenCalled()
    })

    it('returns 404 when review is not found', async () => {
      mocks.reviewFindUnique.mockResolvedValueOnce(null)

      const result = await PATCH(makePatchRequest({ rating: 5 }), makeCtx())

      expect(result.status).toBe(404)
      await expect(result.json()).resolves.toEqual({
        ok: false,
        error: 'Review not found.',
      })

      expect(mocks.reviewUpdate).not.toHaveBeenCalled()
    })

    it('returns 403 when review belongs to another client', async () => {
      mocks.reviewFindUnique.mockResolvedValueOnce({
        ...review,
        clientId: 'other_client',
      })

      const result = await PATCH(makePatchRequest({ rating: 5 }), makeCtx())

      expect(result.status).toBe(403)
      await expect(result.json()).resolves.toEqual({
        ok: false,
        error: 'Forbidden.',
      })

      expect(mocks.reviewUpdate).not.toHaveBeenCalled()
    })

    it('returns 400 when rating is invalid', async () => {
      const result = await PATCH(makePatchRequest({ rating: 6 }), makeCtx())

      expect(result.status).toBe(400)
      await expect(result.json()).resolves.toEqual({
        ok: false,
        error: 'Rating must be an integer 1–5.',
      })

      expect(mocks.reviewUpdate).not.toHaveBeenCalled()
    })

    it('returns 400 when headline is not a string', async () => {
      const result = await PATCH(
        makePatchRequest({
          headline: 123,
        }),
        makeCtx(),
      )

      expect(result.status).toBe(400)
      await expect(result.json()).resolves.toEqual({
        ok: false,
        error: 'Headline: Must be a string.',
      })

      expect(mocks.reviewUpdate).not.toHaveBeenCalled()
    })

    it('returns 400 when headline is too long', async () => {
      const result = await PATCH(
        makePatchRequest({
          headline: 'x'.repeat(121),
        }),
        makeCtx(),
      )

      expect(result.status).toBe(400)
      await expect(result.json()).resolves.toEqual({
        ok: false,
        error: 'Headline: Must be <= 120 characters.',
      })

      expect(mocks.reviewUpdate).not.toHaveBeenCalled()
    })

    it('returns 400 when body is not a string', async () => {
      const result = await PATCH(
        makePatchRequest({
          body: 123,
        }),
        makeCtx(),
      )

      expect(result.status).toBe(400)
      await expect(result.json()).resolves.toEqual({
        ok: false,
        error: 'Body: Must be a string.',
      })

      expect(mocks.reviewUpdate).not.toHaveBeenCalled()
    })

    it('returns 400 when body is too long', async () => {
      const result = await PATCH(
        makePatchRequest({
          body: 'x'.repeat(4001),
        }),
        makeCtx(),
      )

      expect(result.status).toBe(400)
      await expect(result.json()).resolves.toEqual({
        ok: false,
        error: 'Body: Must be <= 4000 characters.',
      })

      expect(mocks.reviewUpdate).not.toHaveBeenCalled()
    })

    it('returns current review when no changes are provided', async () => {
      mocks.reviewFindUnique
        .mockResolvedValueOnce(review)
        .mockResolvedValueOnce(reviewWithMedia)

      const result = await PATCH(makePatchRequest({}), makeCtx())

      expect(mocks.reviewFindUnique).toHaveBeenNthCalledWith(1, {
        where: { id: 'review_1' },
        select: { id: true, clientId: true },
      })

      expect(mocks.reviewFindUnique).toHaveBeenNthCalledWith(2, {
        where: { id: 'review_1' },
        include: { mediaAssets: true },
      })

      expect(mocks.reviewUpdate).not.toHaveBeenCalled()

      expect(result.status).toBe(200)
      await expect(result.json()).resolves.toEqual({
        ok: true,
        review: reviewWithMedia,
      })
    })

    it('updates rating, headline, and body for the owning client', async () => {
      const result = await PATCH(
        makePatchRequest({
          rating: '4',
          headline: '  Updated headline  ',
          body: '  Updated body.  ',
        }),
        makeCtx(),
      )

      expect(mocks.reviewFindUnique).toHaveBeenCalledWith({
        where: { id: 'review_1' },
        select: { id: true, clientId: true },
      })

      expect(mocks.reviewUpdate).toHaveBeenCalledWith({
        where: { id: 'review_1' },
        data: {
          rating: 4,
          headline: 'Updated headline',
          body: 'Updated body.',
        },
        include: { mediaAssets: true },
      })

      expect(result.status).toBe(200)
      await expect(result.json()).resolves.toEqual({
        ok: true,
        review: {
          ...reviewWithMedia,
          rating: 4,
          headline: 'Updated headline',
          body: 'Updated body.',
        },
      })
    })

    it('normalizes blank headline and body to null', async () => {
      await PATCH(
        makePatchRequest({
          headline: '   ',
          body: '   ',
        }),
        makeCtx(),
      )

      expect(mocks.reviewUpdate).toHaveBeenCalledWith({
        where: { id: 'review_1' },
        data: {
          headline: null,
          body: null,
        },
        include: { mediaAssets: true },
      })
    })

    it('returns 500 and logs a safe error when update throws', async () => {
      const consoleErrorSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => undefined)

      const thrown = new Error(
        'db exploded for token secret_123 and tori@example.com',
      )

      mocks.reviewUpdate.mockRejectedValueOnce(thrown)

      const result = await PATCH(makePatchRequest({ rating: 4 }), makeCtx())

      expect(result.status).toBe(500)
      await expect(result.json()).resolves.toEqual({
        ok: false,
        error: 'Internal server error',
      })

      expect(mocks.safeError).toHaveBeenCalledWith(thrown)
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'PATCH /api/v1/client/reviews/[id] error',
        {
          error: {
            name: 'Error',
            message: 'db exploded for token secret_123 and tori@example.com',
          },
        },
      )

      consoleErrorSpy.mockRestore()
    })
  })

  describe('DELETE', () => {
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
      expect(mocks.mediaAssetCount).not.toHaveBeenCalled()
      expect(mocks.transaction).not.toHaveBeenCalled()
    })

    it('returns 400 when review id is missing', async () => {
      const result = await DELETE(makeDeleteRequest(), makeCtx(''))

      expect(result.status).toBe(400)
      await expect(result.json()).resolves.toEqual({
        ok: false,
        error: 'Missing review id.',
      })

      expect(mocks.reviewFindUnique).not.toHaveBeenCalled()
      expect(mocks.transaction).not.toHaveBeenCalled()
    })

    it('returns 404 when review is not found', async () => {
      mocks.reviewFindUnique.mockResolvedValueOnce(null)

      const result = await DELETE(makeDeleteRequest(), makeCtx())

      expect(result.status).toBe(404)
      await expect(result.json()).resolves.toEqual({
        ok: false,
        error: 'Review not found.',
      })

      expect(mocks.mediaAssetCount).not.toHaveBeenCalled()
      expect(mocks.transaction).not.toHaveBeenCalled()
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

      expect(mocks.mediaAssetCount).not.toHaveBeenCalled()
      expect(mocks.transaction).not.toHaveBeenCalled()
    })

    it('returns 409 when review has media', async () => {
      mocks.mediaAssetCount.mockResolvedValueOnce(1)

      const result = await DELETE(makeDeleteRequest(), makeCtx())

      expect(mocks.mediaAssetCount).toHaveBeenCalledWith({
        where: { reviewId: 'review_1' },
      })

      expect(result.status).toBe(409)
      await expect(result.json()).resolves.toEqual({
        ok: false,
        error: 'Reviews with media cannot be deleted.',
      })

      expect(mocks.transaction).not.toHaveBeenCalled()
    })

    it('deletes an owned review with no media', async () => {
      const result = await DELETE(makeDeleteRequest(), makeCtx())

      expect(mocks.reviewFindUnique).toHaveBeenCalledWith({
        where: { id: 'review_1' },
        select: { id: true, clientId: true },
      })

      expect(mocks.mediaAssetCount).toHaveBeenCalledWith({
        where: { reviewId: 'review_1' },
      })

      expect(mocks.transaction).toHaveBeenCalledTimes(1)

      expect(mocks.mediaAssetDeleteMany).toHaveBeenCalledWith({
        where: { reviewId: 'review_1' },
      })

      expect(mocks.reviewDelete).toHaveBeenCalledWith({
        where: { id: 'review_1' },
      })

      expect(result.status).toBe(200)
      await expect(result.json()).resolves.toEqual({
        ok: true,
      })
    })

    it('returns 500 and logs a safe error when delete throws', async () => {
      const consoleErrorSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => undefined)

      const thrown = new Error(
        'delete exploded for token secret_123 and tori@example.com',
      )

      mocks.reviewDelete.mockRejectedValueOnce(thrown)

      const result = await DELETE(makeDeleteRequest(), makeCtx())

      expect(result.status).toBe(500)
      await expect(result.json()).resolves.toEqual({
        ok: false,
        error: 'Internal server error',
      })

      expect(mocks.safeError).toHaveBeenCalledWith(thrown)
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'DELETE /api/v1/client/reviews/[id] error',
        {
          error: {
            name: 'Error',
            message: 'delete exploded for token secret_123 and tori@example.com',
          },
        },
      )

      consoleErrorSpy.mockRestore()
    })
  })
})