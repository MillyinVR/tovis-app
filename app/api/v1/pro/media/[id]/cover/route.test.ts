// app/api/v1/pro/media/[id]/cover/route.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MediaType } from '@prisma/client'

const mocks = vi.hoisted(() => {
  const jsonOk = vi.fn((data?: Record<string, unknown>, status?: number) =>
    Response.json({ ok: true, ...(data ?? {}) }, { status: status ?? 200 }),
  )
  const jsonFail = vi.fn((status: number, error: string) =>
    Response.json({ ok: false, error }, { status }),
  )
  const requirePro = vi.fn()

  const mediaAssetFindUnique = vi.fn()
  const professionalProfileUpdate = vi.fn()
  const professionalProfileUpdateMany = vi.fn()

  const prisma = {
    mediaAsset: { findUnique: mediaAssetFindUnique },
    professionalProfile: {
      update: professionalProfileUpdate,
      updateMany: professionalProfileUpdateMany,
    },
  }

  return {
    jsonOk,
    jsonFail,
    requirePro,
    prisma,
    mediaAssetFindUnique,
    professionalProfileUpdate,
    professionalProfileUpdateMany,
  }
})

vi.mock('@/app/api/_utils', () => ({
  jsonOk: mocks.jsonOk,
  jsonFail: mocks.jsonFail,
  requirePro: mocks.requirePro,
  pickString: (value: unknown) =>
    typeof value === 'string' && value.trim() ? value.trim() : null,
}))

vi.mock('@/app/api/_utils/routeContext', () => ({
  resolveRouteParams: async (ctx: { params: Promise<{ id: string }> }) =>
    ctx.params,
}))

vi.mock('@/lib/prisma', () => ({ prisma: mocks.prisma }))

vi.mock('@/lib/security/logging', () => ({
  safeError: vi.fn((e: unknown) => ({
    message: e instanceof Error ? e.message : String(e),
  })),
}))

import { DELETE, POST } from './route'
import { BUCKETS } from '@/lib/storageBuckets'

function ctx(id: string) {
  return { params: Promise.resolve({ id }) }
}

function makeMedia(overrides?: Record<string, unknown>) {
  return {
    id: 'media_1',
    professionalId: 'pro_1',
    mediaType: MediaType.IMAGE,
    // A public-bucket image is publicly shareable → a valid cover.
    storageBucket: BUCKETS.mediaPublic,
    reviewId: null,
    booking: null,
    ...overrides,
  }
}

async function readJson(res: Response) {
  return (await res.json()) as Record<string, unknown>
}

describe('POST /api/v1/pro/media/[id]/cover', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requirePro.mockResolvedValue({ ok: true, professionalId: 'pro_1' })
    mocks.professionalProfileUpdate.mockResolvedValue({ id: 'pro_1' })
  })

  it('sets an owned public image as the cover', async () => {
    mocks.mediaAssetFindUnique.mockResolvedValue(makeMedia())

    const res = await POST(new Request('http://x') as never, ctx('media_1'))

    expect(mocks.professionalProfileUpdate).toHaveBeenCalledWith({
      where: { id: 'pro_1' },
      data: { coverMediaAssetId: 'media_1' },
      select: { id: true },
    })
    expect(res.status).toBe(200)
    expect(await readJson(res)).toEqual({
      ok: true,
      coverMediaAssetId: 'media_1',
    })
  })

  it('404s when the media does not exist', async () => {
    mocks.mediaAssetFindUnique.mockResolvedValue(null)

    const res = await POST(new Request('http://x') as never, ctx('nope'))

    expect(res.status).toBe(404)
    expect(mocks.professionalProfileUpdate).not.toHaveBeenCalled()
  })

  it('403s when the media belongs to another pro', async () => {
    mocks.mediaAssetFindUnique.mockResolvedValue(
      makeMedia({ professionalId: 'pro_2' }),
    )

    const res = await POST(new Request('http://x') as never, ctx('media_1'))

    expect(res.status).toBe(403)
    expect(mocks.professionalProfileUpdate).not.toHaveBeenCalled()
  })

  it('400s when the media is a video (a banner must be an image)', async () => {
    mocks.mediaAssetFindUnique.mockResolvedValue(
      makeMedia({ mediaType: MediaType.VIDEO }),
    )

    const res = await POST(new Request('http://x') as never, ctx('media_1'))

    expect(res.status).toBe(400)
    expect(mocks.professionalProfileUpdate).not.toHaveBeenCalled()
  })

  it('403s an unpromoted private session photo (no consent)', async () => {
    mocks.mediaAssetFindUnique.mockResolvedValue(
      makeMedia({
        storageBucket: BUCKETS.mediaPrivate,
        reviewId: null,
        booking: { mediaUseConsentAt: null },
      }),
    )

    const res = await POST(new Request('http://x') as never, ctx('media_1'))

    expect(res.status).toBe(403)
    expect(mocks.professionalProfileUpdate).not.toHaveBeenCalled()
  })

  it('allows a consented (review-promoted) private photo as cover', async () => {
    mocks.mediaAssetFindUnique.mockResolvedValue(
      makeMedia({ storageBucket: BUCKETS.mediaPrivate, reviewId: 'review_1' }),
    )

    const res = await POST(new Request('http://x') as never, ctx('media_1'))

    expect(res.status).toBe(200)
    expect(mocks.professionalProfileUpdate).toHaveBeenCalled()
  })

  it('passes through failed pro auth', async () => {
    const authRes = Response.json({ ok: false }, { status: 401 })
    mocks.requirePro.mockResolvedValue({ ok: false, res: authRes })

    const res = await POST(new Request('http://x') as never, ctx('media_1'))

    expect(res).toBe(authRes)
    expect(mocks.mediaAssetFindUnique).not.toHaveBeenCalled()
  })
})

describe('DELETE /api/v1/pro/media/[id]/cover', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requirePro.mockResolvedValue({ ok: true, professionalId: 'pro_1' })
    mocks.professionalProfileUpdateMany.mockResolvedValue({ count: 1 })
  })

  it('clears the cover only when this media is the current cover', async () => {
    const res = await DELETE(new Request('http://x') as never, ctx('media_1'))

    expect(mocks.professionalProfileUpdateMany).toHaveBeenCalledWith({
      where: { id: 'pro_1', coverMediaAssetId: 'media_1' },
      data: { coverMediaAssetId: null },
    })
    expect(res.status).toBe(200)
    expect(await readJson(res)).toEqual({ ok: true, coverMediaAssetId: null })
  })

  it('is idempotent (200) when this media is not the cover', async () => {
    mocks.professionalProfileUpdateMany.mockResolvedValue({ count: 0 })

    const res = await DELETE(new Request('http://x') as never, ctx('media_9'))

    expect(res.status).toBe(200)
  })
})
