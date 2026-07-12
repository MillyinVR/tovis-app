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

  it('associates the reset-password + claim paths with the real app id', async () => {
    const res = GET()
    const body = await res.json()

    const details = body.applinks.details
    expect(details).toHaveLength(1)

    const detail = details[0]
    // Team id + real App Attest bundle id (NOT the Sign-in-with-Apple services id).
    expect(detail.appID).toBe('SB3J675LNU.app.tovis.Tovis')
    expect(detail.appIDs).toEqual(['SB3J675LNU.app.tovis.Tovis'])

    // The emailed reset link + the §27 account-claim link open in-app; everything
    // else stays in the browser. `components` mirrors `paths` one-for-one.
    expect(detail.paths).toEqual(['/reset-password/*', '/claim/*'])
    expect(detail.components).toEqual([
      { '/': '/reset-password/*' },
      { '/': '/claim/*' },
    ])
  })
})
