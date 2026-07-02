import { MediaPhase, MediaType } from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  jsonOk: vi.fn((data?: Record<string, unknown>, status = 200) =>
    Response.json({ ok: true, ...(data ?? {}) }, { status }),
  ),
  jsonFail: vi.fn((status: number, error: string) =>
    Response.json({ ok: false, error }, { status }),
  ),
  requirePro: vi.fn(),
  mediaAssetFindUnique: vi.fn(),
  mediaAssetFindMany: vi.fn(),
  renderMediaUrls: vi.fn(),
  safeError: vi.fn((e: unknown) => ({ message: String(e) })),
}))

vi.mock('@/app/api/_utils', () => ({
  jsonOk: mocks.jsonOk,
  jsonFail: mocks.jsonFail,
  requirePro: mocks.requirePro,
  pickString: (v: unknown) =>
    typeof v === 'string' && v.trim() ? v.trim() : null,
}))

vi.mock('@/lib/media/renderUrls', () => ({
  renderMediaUrls: mocks.renderMediaUrls,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    mediaAsset: {
      findUnique: mocks.mediaAssetFindUnique,
      findMany: mocks.mediaAssetFindMany,
    },
  },
}))

vi.mock('@/lib/security/logging', () => ({ safeError: mocks.safeError }))

import { GET } from './route'

function makeCtx(id = 'after_1') {
  return { params: Promise.resolve({ id }) }
}

function makeAfter(overrides?: Record<string, unknown>) {
  return {
    id: 'after_1',
    professionalId: 'pro_1',
    bookingId: 'booking_1',
    mediaType: MediaType.IMAGE,
    ...(overrides ?? {}),
  }
}

describe('GET /api/v1/pro/media/[id]/before-options', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requirePro.mockResolvedValue({ ok: true, professionalId: 'pro_1' })
    mocks.mediaAssetFindUnique.mockResolvedValue(makeAfter())
    mocks.renderMediaUrls.mockImplementation(async (row: { url?: string }) => ({
      renderUrl: row.url ?? null,
      renderThumbUrl: `${row.url ?? 'x'}-thumb`,
    }))
  })

  it('returns 403 when the media is owned by another pro', async () => {
    mocks.mediaAssetFindUnique.mockResolvedValueOnce(
      makeAfter({ professionalId: 'other' }),
    )
    const res = await GET(new Request('http://x'), makeCtx())
    expect(res.status).toBe(403)
    expect(mocks.mediaAssetFindMany).not.toHaveBeenCalled()
  })

  it('returns an empty list for a video after', async () => {
    mocks.mediaAssetFindUnique.mockResolvedValueOnce(
      makeAfter({ mediaType: MediaType.VIDEO }),
    )
    const res = await GET(new Request('http://x'), makeCtx())
    await expect(res.json()).resolves.toEqual({ ok: true, options: [] })
    expect(mocks.mediaAssetFindMany).not.toHaveBeenCalled()
  })

  it('returns an empty list when the after has no booking', async () => {
    mocks.mediaAssetFindUnique.mockResolvedValueOnce(
      makeAfter({ bookingId: null }),
    )
    const res = await GET(new Request('http://x'), makeCtx())
    await expect(res.json()).resolves.toEqual({ ok: true, options: [] })
  })

  it('returns booking candidates with BEFORE photos ranked first', async () => {
    mocks.mediaAssetFindMany.mockResolvedValueOnce([
      {
        id: 'other_1',
        phase: MediaPhase.OTHER,
        createdAt: new Date('2026-01-01'),
        url: 'other',
      },
      {
        id: 'before_1',
        phase: MediaPhase.BEFORE,
        createdAt: new Date('2026-01-02'),
        url: 'before',
      },
    ])

    const res = await GET(new Request('http://x'), makeCtx())
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.options).toEqual([
      { id: 'before_1', thumbUrl: 'before-thumb', phase: MediaPhase.BEFORE },
      { id: 'other_1', thumbUrl: 'other-thumb', phase: MediaPhase.OTHER },
    ])
  })
})
