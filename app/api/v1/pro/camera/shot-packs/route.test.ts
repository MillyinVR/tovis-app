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

describe('GET /api/v1/pro/camera/shot-packs', () => {
  it('returns the auth failure response untouched', async () => {
    const res = new Response('nope', { status: 401 })
    mocks.requirePro.mockResolvedValue({ ok: false, res })

    expect(await GET()).toBe(res)
  })

  it('returns the current shot packs, hottest first', async () => {
    const res = await GET()
    expect(res.status).toBe(200)

    const body = await readJson<ShotPacksBody>(res)
    const expected = loadCameraShotPacks()

    expect(body.version).toBe(expected.version)
    expect(body.packs.map((p) => p.id)).toEqual(expected.packs.map((p) => p.id))

    // The route serves the packs sorted by trendScore descending.
    const scores = body.packs.map((p) => p.trendScore)
    expect(scores).toEqual([...scores].sort((a, b) => b - a))
  })

  it('returns 500 when the auth check throws', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mocks.requirePro.mockRejectedValue(new Error('boom'))

    const res = await GET()
    expect(res.status).toBe(500)

    spy.mockRestore()
  })
})
