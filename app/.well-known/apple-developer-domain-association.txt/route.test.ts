// app/.well-known/apple-developer-domain-association.txt/route.test.ts

import { afterEach, describe, expect, it, vi } from 'vitest'

import { GET } from './route'

const TOKEN = 'fixture-association-token-abc123'

function req(headers: Record<string, string> = {}): Request {
  return new Request('https://www.tovis.me/.well-known/apple-developer-domain-association.txt', {
    headers,
  })
}

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('GET /.well-known/apple-developer-domain-association.txt', () => {
  // The whole point of the env-gated shape: landing this changes NOTHING on a
  // deployment that has not provisioned the value. The path 404s today and must
  // keep 404ing until Tori sets the var.
  it('404s while APPLE_DOMAIN_ASSOCIATION is unset — ships inert', async () => {
    vi.stubEnv('APPLE_DOMAIN_ASSOCIATION', '')

    const res = GET(req({ host: 'www.tovis.me' }))

    expect(res.status).toBe(404)
    await expect(res.text()).resolves.not.toBe('')
  })

  it('serves a bare token verbatim, as un-cached text, for any host', async () => {
    vi.stubEnv('APPLE_DOMAIN_ASSOCIATION', TOKEN)

    for (const host of ['www.tovis.me', 'tovis.app', 'anything.example']) {
      const res = GET(req({ host }))

      expect(res.status).toBe(200)
      // Apple compares the body byte-for-byte against the token it issued.
      await expect(res.text()).resolves.toBe(TOKEN)
      expect(res.headers.get('content-type')).toBe('text/plain; charset=utf-8')
      // A cached stale token fails verification silently, after the fix landed.
      expect(res.headers.get('cache-control')).toBe('no-store')
    }
  })

  describe('when Apple issues one token PER DOMAIN (a JSON map)', () => {
    const MAP = JSON.stringify({
      'www.tovis.me': 'fixture-me-token',
      'tovis.app': 'fixture-app-token',
    })

    it('serves the token registered for the requested host', async () => {
      vi.stubEnv('APPLE_DOMAIN_ASSOCIATION', MAP)

      const me = GET(req({ host: 'www.tovis.me' }))
      expect(me.status).toBe(200)
      await expect(me.text()).resolves.toBe('fixture-me-token')

      const app = GET(req({ host: 'tovis.app' }))
      expect(app.status).toBe(200)
      await expect(app.text()).resolves.toBe('fixture-app-token')
    })

    // Hosts arrive from a header, so case and an explicit port are both possible
    // and neither should miss a key that is spelled the ordinary way.
    it('matches a host case-insensitively and ignores its port', async () => {
      vi.stubEnv('APPLE_DOMAIN_ASSOCIATION', MAP)

      const res = GET(req({ host: 'WWW.Tovis.ME:443' }))

      expect(res.status).toBe(200)
      await expect(res.text()).resolves.toBe('fixture-me-token')
    })

    // 404 rather than falling back to some other domain's token: serving the
    // WRONG token reads to Apple as a failed verification, which is a far more
    // confusing thing to debug than an absent file.
    it('404s for a host that is not in the map', async () => {
      vi.stubEnv('APPLE_DOMAIN_ASSOCIATION', MAP)

      expect(GET(req({ host: 'tovis.me' })).status).toBe(404)
      expect(GET(req()).status).toBe(404)
    })

    it('404s for a host whose configured token is blank', async () => {
      vi.stubEnv(
        'APPLE_DOMAIN_ASSOCIATION',
        JSON.stringify({ 'www.tovis.me': '   ' }),
      )

      expect(GET(req({ host: 'www.tovis.me' })).status).toBe(404)
    })

    it('prefers x-forwarded-host, and reads the first entry of a proxy chain', async () => {
      vi.stubEnv('APPLE_DOMAIN_ASSOCIATION', MAP)

      const forwarded = GET(
        req({ host: 'internal.vercel.app', 'x-forwarded-host': 'tovis.app' }),
      )
      expect(forwarded.status).toBe(200)
      await expect(forwarded.text()).resolves.toBe('fixture-app-token')

      const chained = GET(
        req({
          host: 'internal.vercel.app',
          'x-forwarded-host': 'www.tovis.me, internal.vercel.app',
        }),
      )
      expect(chained.status).toBe(200)
      await expect(chained.text()).resolves.toBe('fixture-me-token')
    })
  })

  // Only a JSON OBJECT means "map". A token that happens to be valid JSON any
  // other way is still a token — otherwise an all-digit token would silently
  // become an unmatchable map and 404 forever.
  it('treats a token that parses as JSON but is not an object as the literal body', async () => {
    for (const literal of ['1234567890', '"quoted-token"', 'null', '[1,2]']) {
      vi.stubEnv('APPLE_DOMAIN_ASSOCIATION', literal)

      const res = GET(req({ host: 'www.tovis.me' }))
      expect(res.status).toBe(200)
      await expect(res.text()).resolves.toBe(literal)
    }
  })
})
