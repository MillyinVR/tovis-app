// app/api/v1/pro/camera/shot-packs/route.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requirePro: vi.fn(),
  findMany: vi.fn(),
}))

vi.mock('@/app/api/_utils/auth/requirePro', () => ({
  requirePro: mocks.requirePro,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: { lookCategoryTrendStat: { findMany: mocks.findMany } },
}))

import { LOOK_CATEGORY_TREND } from '@/lib/looks/categoryTrendStats'
import { buildShotPacksEtag, loadCameraShotPacks } from '@/lib/pro/cameraShotPacks'
import { prisma } from '@/lib/prisma'

import { GET } from './route'

type ShotPacksBody = {
  version: number
  packs: Array<{ id: string; trendScore: number }>
}

async function readJson<T>(res: Response): Promise<T> {
  return (await res.json()) as T
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requirePro.mockResolvedValue({
    ok: true,
    professionalId: 'pro-1',
    userId: 'user-1',
  })
  // Default: no trend data → the shot packs keep their editorial order.
  mocks.findMany.mockResolvedValue([])
})

const ROUTE = 'http://localhost/api/v1/pro/camera/shot-packs'

function get(headers?: HeadersInit): Promise<Response> {
  return GET(new Request(ROUTE, { headers }))
}

async function currentEtag(): Promise<string> {
  return buildShotPacksEtag(await loadCameraShotPacks(prisma))
}

describe('GET /api/v1/pro/camera/shot-packs', () => {
  it('returns the auth failure response untouched', async () => {
    const res = new Response('nope', { status: 401 })
    mocks.requirePro.mockResolvedValue({ ok: false, res })

    expect(await get()).toBe(res)
  })

  it('returns the current shot packs, hottest first', async () => {
    const res = await get()
    expect(res.status).toBe(200)

    const body = await readJson<ShotPacksBody>(res)
    const expected = await loadCameraShotPacks(prisma)

    expect(body.version).toBe(expected.version)
    expect(body.packs.map((p) => p.id)).toEqual(expected.packs.map((p) => p.id))

    // The route serves the packs sorted by trendScore descending.
    const scores = body.packs.map((p) => p.trendScore)
    expect(scores).toEqual([...scores].sort((a, b) => b - a))
  })

  it('serves a data-aware ETag and a cacheable directive (not no-store)', async () => {
    const res = await get()

    expect(res.headers.get('etag')).toBe(await currentEtag())
    const cacheControl = res.headers.get('cache-control')
    expect(cacheControl).not.toContain('no-store')
    expect(cacheControl).toContain('max-age')
  })

  it('answers a matching If-None-Match with 304 and no body', async () => {
    const etag = await currentEtag()
    const res = await get({ 'If-None-Match': etag })

    expect(res.status).toBe(304)
    expect(res.headers.get('etag')).toBe(etag)
    expect(await res.text()).toBe('')
  })

  it('serves 200 when If-None-Match is a stale ETag', async () => {
    const res = await get({ 'If-None-Match': 'W/"shot-packs-0-deadbeef0000"' })

    expect(res.status).toBe(200)
    const body = await readJson<ShotPacksBody>(res)
    expect(body.version).toBe((await loadCameraShotPacks(prisma)).version)
  })

  it('re-ranks on live engagement and mints a fresh ETag for it', async () => {
    const editorialEtag = await currentEtag()

    // A red-hot nails family reorders the packs → new content → new ETag.
    const min = LOOK_CATEGORY_TREND.minImpressions
    mocks.findMany.mockResolvedValue([
      { categorySlug: 'nails', weightedEngagement: 0.4 * min * 2, impressions: min * 2 },
    ])

    const res = await get()
    const body = await readJson<ShotPacksBody>(res)
    expect(body.packs[0]?.id).toBe('nails-claw-sparkle-v1')
    expect(res.headers.get('etag')).not.toBe(editorialEtag)
    // A client holding the editorial ETag now revalidates to a 200, not a 304.
    const revalidate = await get({ 'If-None-Match': editorialEtag })
    expect(revalidate.status).toBe(200)
  })

  it('returns 500 when the auth check throws', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mocks.requirePro.mockRejectedValue(new Error('boom'))

    const res = await get()
    expect(res.status).toBe(500)

    spy.mockRestore()
  })
})
