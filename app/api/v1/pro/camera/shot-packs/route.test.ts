// app/api/v1/pro/camera/shot-packs/route.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requirePro: vi.fn(),
}))

vi.mock('@/app/api/_utils/auth/requirePro', () => ({
  requirePro: mocks.requirePro,
}))

import { loadCameraShotPacks } from '@/lib/pro/cameraShotPacks'

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
})

const ROUTE = 'http://localhost/api/v1/pro/camera/shot-packs'

function get(headers?: HeadersInit): Promise<Response> {
  return GET(new Request(ROUTE, { headers }))
}

function currentEtag(): string {
  return `W/"shot-packs-${loadCameraShotPacks().version}"`
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
    const expected = loadCameraShotPacks()

    expect(body.version).toBe(expected.version)
    expect(body.packs.map((p) => p.id)).toEqual(expected.packs.map((p) => p.id))

    // The route serves the packs sorted by trendScore descending.
    const scores = body.packs.map((p) => p.trendScore)
    expect(scores).toEqual([...scores].sort((a, b) => b - a))
  })

  it('serves a version-keyed ETag and a cacheable directive (not no-store)', async () => {
    const res = await get()

    expect(res.headers.get('etag')).toBe(currentEtag())
    const cacheControl = res.headers.get('cache-control')
    expect(cacheControl).not.toContain('no-store')
    expect(cacheControl).toContain('max-age')
  })

  it('answers a matching If-None-Match with 304 and no body', async () => {
    const etag = currentEtag()
    const res = await get({ 'If-None-Match': etag })

    expect(res.status).toBe(304)
    expect(res.headers.get('etag')).toBe(etag)
    expect(await res.text()).toBe('')
  })

  it('serves 200 when If-None-Match is a stale version', async () => {
    const res = await get({ 'If-None-Match': 'W/"shot-packs-0"' })

    expect(res.status).toBe(200)
    const body = await readJson<ShotPacksBody>(res)
    expect(body.version).toBe(loadCameraShotPacks().version)
  })

  it('returns 500 when the auth check throws', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mocks.requirePro.mockRejectedValue(new Error('boom'))

    const res = await get()
    expect(res.status).toBe(500)

    spy.mockRestore()
  })
})
