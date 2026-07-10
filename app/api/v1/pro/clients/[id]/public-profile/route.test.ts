// app/api/v1/pro/clients/[id]/public-profile/route.test.ts
import { describe, expect, it, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => {
  const jsonOk = vi.fn((data: unknown, status = 200) =>
    new Response(JSON.stringify({ ok: true, ...((data as Record<string, unknown>) ?? {}) }), {
      status,
      headers: { 'content-type': 'application/json' },
    }),
  )
  const jsonFail = vi.fn((status: number, error: string) =>
    new Response(JSON.stringify({ ok: false, error }), { status, headers: { 'content-type': 'application/json' } }),
  )
  const pickString = vi.fn((v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null))
  const requirePro = vi.fn()
  const assertProCanViewClient = vi.fn()
  const loadPublicClientProfileByClientId = vi.fn()
  return { jsonOk, jsonFail, pickString, requirePro, assertProCanViewClient, loadPublicClientProfileByClientId }
})

vi.mock('@/app/api/_utils', () => ({
  jsonOk: mocks.jsonOk,
  jsonFail: mocks.jsonFail,
  pickString: mocks.pickString,
  requirePro: mocks.requirePro,
}))
vi.mock('@/lib/clientVisibility', () => ({ assertProCanViewClient: mocks.assertProCanViewClient }))
vi.mock('@/app/u/[handle]/_data/loadPublicClientProfile', () => ({
  loadPublicClientProfileByClientId: mocks.loadPublicClientProfileByClientId,
}))
vi.mock('@/app/api/_utils/routeContext', () => ({ resolveRouteParams: vi.fn(async (ctx: { params: Promise<{ id: string }> }) => ctx.params) }))

import { GET } from './route'

function ctx(id = 'client_1') {
  return { params: Promise.resolve({ id }) }
}

const sampleProfile = {
  handle: 'ava',
  displayName: '@ava',
  avatarUrl: 'https://cdn/a.jpg',
  bio: 'Balayage lover',
  counts: { followers: 12, following: 3, looks: 2 },
  looks: [
    { id: 'lk_1', name: 'Sunlit balayage', imageUrl: 'https://cdn/1.jpg', saveCount: 8, href: '/looks/lk_1' },
    { id: 'lk_2', name: 'Copper melt', imageUrl: null, saveCount: 0, href: '/looks/lk_2' },
  ],
  viewer: { isOwn: false, following: false },
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('GET /api/v1/pro/clients/[id]/public-profile', () => {
  it('403s a non-pro', async () => {
    mocks.requirePro.mockResolvedValue({ ok: false, res: new Response('forbidden', { status: 403 }) })
    const res = await GET(new Request('http://x'), ctx())
    expect(res.status).toBe(403)
    expect(mocks.loadPublicClientProfileByClientId).not.toHaveBeenCalled()
  })

  it('404s when the pro cannot view the client, without loading the profile', async () => {
    mocks.requirePro.mockResolvedValue({ ok: true, professionalId: 'pro_1' })
    mocks.assertProCanViewClient.mockResolvedValue({ ok: false })
    const res = await GET(new Request('http://x'), ctx())
    expect(res.status).toBe(404)
    expect(mocks.loadPublicClientProfileByClientId).not.toHaveBeenCalled()
  })

  it('returns the public profile as a neutral viewer (no viewer options passed)', async () => {
    mocks.requirePro.mockResolvedValue({ ok: true, professionalId: 'pro_1' })
    mocks.assertProCanViewClient.mockResolvedValue({ ok: true, visibility: { accessUntil: null } })
    mocks.loadPublicClientProfileByClientId.mockResolvedValue(sampleProfile)

    const res = await GET(new Request('http://x'), ctx('client_9'))
    const body = await res.json()

    expect(res.status).toBe(200)
    // Neutral viewer: keyed by clientId, no viewerClientId → isOwn/following false.
    expect(mocks.loadPublicClientProfileByClientId).toHaveBeenCalledWith('client_9')
    expect(body.profile.handle).toBe('ava')
    expect(body.profile.displayName).toBe('@ava')
    expect(body.profile.counts.looks).toBe(2)
    expect(body.profile.looks[0].saveCount).toBe(8)
    expect(body.profile.viewer.isOwn).toBe(false)
  })

  it('returns profile: null (200, not 404) when the client has no public profile', async () => {
    mocks.requirePro.mockResolvedValue({ ok: true, professionalId: 'pro_1' })
    mocks.assertProCanViewClient.mockResolvedValue({ ok: true, visibility: { accessUntil: null } })
    mocks.loadPublicClientProfileByClientId.mockResolvedValue(null)

    const res = await GET(new Request('http://x'), ctx())
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.profile).toBeNull()
  })
})
