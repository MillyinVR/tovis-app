// lib/media/cdnCache.test.ts
//
// The purge call is the difference between a three-second exposure window and a
// sixty-second one, so the parts that are easy to get silently wrong — the auth
// header shape and "a non-2xx is not a success" — are pinned here.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/security/logging', () => ({
  safeError: (e: unknown) => (e instanceof Error ? e.message : String(e)),
}))

import { purgeCdnObject } from './cdnCache'

const ORIGIN = 'https://project.supabase.co'
const KEY = 'service-role-key'

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', ORIGIN)
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', KEY)
  fetchMock = vi.fn(() => Promise.resolve(new Response('{"message":"success"}', { status: 200 })))
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('purgeCdnObject', () => {
  it('DELETEs the CDN path with a bearer token', async () => {
    const result = await purgeCdnObject('media-public', 'pro/p1/looks_public/2026-08/a.jpg')

    expect(result).toEqual({ ok: true })

    const call = fetchMock.mock.calls[0]
    if (!call) throw new Error('expected a purge request')
    const [url, init] = call as [string, RequestInit]

    expect(url).toBe(
      `${ORIGIN}/storage/v1/cdn/media-public/pro/p1/looks_public/2026-08/a.jpg`,
    )
    expect(init.method).toBe('DELETE')

    // 🔴 `apikey` ALONE is rejected by the endpoint with a 400 that reads like
    // "this project cannot purge" rather than "you sent the wrong header".
    // Verified against production: apikey only -> 400, bearer -> 200.
    const headers = init.headers as Record<string, string>
    expect(headers.Authorization).toBe(`Bearer ${KEY}`)
  })

  it('escapes each path segment without escaping the separators', async () => {
    await purgeCdnObject('media-public', 'pro/p 1/a+b.jpg')

    const call = fetchMock.mock.calls[0]
    if (!call) throw new Error('expected a purge request')
    expect(call[0]).toBe(`${ORIGIN}/storage/v1/cdn/media-public/pro/p%201/a%2Bb.jpg`)
  })

  it('treats a non-2xx as a failure, not a success', async () => {
    fetchMock.mockResolvedValue(new Response('nope', { status: 403 }))

    const result = await purgeCdnObject('media-public', 'a.jpg')

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toContain('403')
  })

  it('reports a transport failure instead of throwing', async () => {
    fetchMock.mockRejectedValue(new Error('socket hang up'))

    const result = await purgeCdnObject('media-public', 'a.jpg')

    // A retraction whose bytes are already deleted must not be turned into an
    // error by the edge call that comes after it.
    expect(result).toEqual({ ok: false, reason: 'socket hang up' })
  })

  it('refuses quietly when storage credentials are missing', async () => {
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '')

    const result = await purgeCdnObject('media-public', 'a.jpg')

    expect(result.ok).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
