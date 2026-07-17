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

  it('associates the reset-password + claim + referral + look paths with the real app id', async () => {
    const res = GET()
    const body = await res.json()

    const details = body.applinks.details
    expect(details).toHaveLength(1)

    const detail = details[0]
    // Team id + real App Attest bundle id (NOT the Sign-in-with-Apple services id).
    expect(detail.appID).toBe('SB3J675LNU.app.tovis.Tovis')
    expect(detail.appIDs).toEqual(['SB3J675LNU.app.tovis.Tovis'])

    // The emailed reset link, the §27 account-claim link, the client referral
    // short-link (`/c/*`, opened in the in-app browser), a shared look, and a
    // shared public board (`/u/*/boards/*`) open in-app; everything else stays in
    // the browser. `components` mirrors `paths` one-for-one (legacy "NOT " prefix
    // ↔ modern `exclude: true`).
    expect(detail.paths).toEqual([
      '/reset-password/*',
      '/claim/*',
      '/c/*',
      'NOT /looks/tags',
      'NOT /looks/tags/*',
      '/looks/*',
      '/u/*/boards/*',
    ])
    expect(detail.components).toEqual([
      { '/': '/reset-password/*' },
      { '/': '/claim/*' },
      { '/': '/c/*' },
      { '/': '/looks/tags', exclude: true },
      { '/': '/looks/tags/*', exclude: true },
      { '/': '/looks/*' },
      { '/': '/u/*/boards/*' },
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

  // The board association is deliberately SCOPED to the board detail the app
  // routes (`PublicBoardLink` → PublicBoardView). The bare `/u/<handle>` profile
  // is NOT routed natively, so it must stay in the browser — associating a broad
  // `/u/*` would turn every profile tap into the silent no-op the header warns
  // about.
  it('associates the board detail but NOT the bare /u/<handle> profile', async () => {
    const res = GET()
    const body = await res.json()
    const { paths } = body.applinks.details[0]

    expect(paths).toContain('/u/*/boards/*')
    expect(paths).not.toContain('/u/*')
    expect(paths).not.toContain('/u/*/boards')
  })
})
