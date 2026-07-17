// app/.well-known/apple-app-site-association/route.test.ts

import { describe, expect, it } from 'vitest'

import { GET } from './route'

describe('GET /.well-known/apple-app-site-association', () => {
  it('serves the AASA as application/json with no redirect', async () => {
    const res = GET()

    expect(res.status).toBe(200)
    // Apple requires application/json and a direct (un-redirected) response.
    expect(res.headers.get('content-type')).toBe('application/json')
  })

  it('associates the reset-password + claim + look paths with the real app id', async () => {
    const res = GET()
    const body = await res.json()

    const details = body.applinks.details
    expect(details).toHaveLength(1)

    const detail = details[0]
    // Team id + real App Attest bundle id (NOT the Sign-in-with-Apple services id).
    expect(detail.appID).toBe('SB3J675LNU.app.tovis.Tovis')
    expect(detail.appIDs).toEqual(['SB3J675LNU.app.tovis.Tovis'])

    // The emailed reset link, the §27 account-claim link, and a shared look open
    // in-app; everything else stays in the browser. `components` mirrors `paths`
    // one-for-one (legacy "NOT " prefix ↔ modern `exclude: true`).
    expect(detail.paths).toEqual([
      '/reset-password/*',
      '/claim/*',
      'NOT /looks/tags',
      'NOT /looks/tags/*',
      '/looks/*',
    ])
    expect(detail.components).toEqual([
      { '/': '/reset-password/*' },
      { '/': '/claim/*' },
      { '/': '/looks/tags', exclude: true },
      { '/': '/looks/tags/*', exclude: true },
      { '/': '/looks/*' },
    ])
  })

  // The single rule that makes the tag exclusion work at all: iOS stops at the
  // first match, so `NOT /looks/tags/*` is only honored while it precedes
  // `/looks/*`. Reordering them silently sends every tag link into the app,
  // which has no tag screen — the tap would become a no-op instead of loading
  // the web page.
  it('orders the tag exclusions BEFORE the broad /looks/* pattern', async () => {
    const res = GET()
    const body = await res.json()
    const { paths } = body.applinks.details[0]

    const broadLooks = paths.indexOf('/looks/*')
    expect(broadLooks).toBeGreaterThan(-1)
    for (const exclusion of ['NOT /looks/tags', 'NOT /looks/tags/*']) {
      expect(paths.indexOf(exclusion)).toBeGreaterThan(-1)
      expect(paths.indexOf(exclusion)).toBeLessThan(broadLooks)
    }
  })
})
