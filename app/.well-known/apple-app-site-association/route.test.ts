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

  it('associates the reset-password + claim + referral + look + profile paths with the real app id', async () => {
    const res = GET()
    const body = await res.json()

    const details = body.applinks.details
    expect(details).toHaveLength(1)

    const detail = details[0]
    // Team id + real App Attest bundle id (NOT the Sign-in-with-Apple services id).
    expect(detail.appID).toBe('SB3J675LNU.app.tovis.Tovis')
    expect(detail.appIDs).toEqual(['SB3J675LNU.app.tovis.Tovis'])

    // The emailed reset link, the §27 account-claim link, the client referral
    // short-link (`/c/*`, opened in the in-app browser), a shared look, a shared
    // public board (`/u/*/boards/*`), a shared creator profile (`/u/*`) and a
    // shared PRO profile (`/professionals/*`) open in-app; everything else stays
    // in the browser. `components` mirrors `paths` one-for-one (legacy "NOT "
    // prefix ↔ modern `exclude: true`).
    expect(detail.paths).toEqual([
      '/reset-password/*',
      '/claim/*',
      '/c/*',
      'NOT /looks/tags',
      'NOT /looks/tags/*',
      '/looks/*',
      '/u/*/boards/*',
      '/u/*',
      'NOT /professionals/dashboard',
      '/professionals/*',
    ])
    expect(detail.components).toEqual([
      { '/': '/reset-password/*' },
      { '/': '/claim/*' },
      { '/': '/c/*' },
      { '/': '/looks/tags', exclude: true },
      { '/': '/looks/tags/*', exclude: true },
      { '/': '/looks/*' },
      { '/': '/u/*/boards/*' },
      { '/': '/u/*' },
      { '/': '/professionals/dashboard', exclude: true },
      { '/': '/professionals/*' },
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

  // Both `/u/` shapes are now routed natively — the board detail by
  // `PublicBoardLink` → PublicBoardView, the bare profile by
  // `PushDeepLink.Target.publicClient` → PublicClientViewerView — so both are
  // associated. The specific board pattern is listed first so it is the one iOS
  // matches for a board link.
  it('associates the board detail BEFORE the broader /u/<handle> profile', async () => {
    const res = GET()
    const body = await res.json()
    const { paths } = body.applinks.details[0]

    const board = paths.indexOf('/u/*/boards/*')
    const profile = paths.indexOf('/u/*')
    expect(board).toBeGreaterThan(-1)
    expect(profile).toBeGreaterThan(-1)
    expect(board).toBeLessThan(profile)
    // There is no `/u/<handle>/boards` index route, so nothing between the two
    // patterns goes unhandled.
    expect(paths).not.toContain('/u/*/boards')
  })

  // `/professionals/dashboard` is a legacy redirect to `/pro`, not a pro id. The
  // native parser takes the second segment as a professionalId, so an associated
  // tap would open the app and fetch a pro called "dashboard". iOS stops at the
  // first match, so the exclusion only works while it precedes the broad pattern.
  it('excludes /professionals/dashboard BEFORE the broad /professionals/* pattern', async () => {
    const res = GET()
    const body = await res.json()
    const { paths } = body.applinks.details[0]

    const broad = paths.indexOf('/professionals/*')
    const exclusion = paths.indexOf('NOT /professionals/dashboard')
    expect(broad).toBeGreaterThan(-1)
    expect(exclusion).toBeGreaterThan(-1)
    expect(exclusion).toBeLessThan(broad)
  })

  // The handle-keyed mirror of the pro profile. Resolving a handle to a
  // professionalId needs a lookup the native parser cannot do, so the app cannot
  // handle `/p/<handle>` — associating it would turn a working web page into a
  // silent no-op.
  it('leaves the handle-keyed /p/<handle> mirror on the web', async () => {
    const res = GET()
    const body = await res.json()
    const { paths } = body.applinks.details[0]

    expect(paths.some((p: string) => p.startsWith('/p/'))).toBe(false)
  })
})
