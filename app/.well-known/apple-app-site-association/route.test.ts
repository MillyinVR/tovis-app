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

  it('associates only the reset-password path with the real app id', async () => {
    const res = GET()
    const body = await res.json()

    const details = body.applinks.details
    expect(details).toHaveLength(1)

    const detail = details[0]
    // Team id + real App Attest bundle id (NOT the Sign-in-with-Apple services id).
    expect(detail.appID).toBe('SB3J675LNU.app.tovis.Tovis')
    expect(detail.appIDs).toEqual(['SB3J675LNU.app.tovis.Tovis'])

    // Only the emailed reset link opens in-app; everything else stays in the browser.
    expect(detail.paths).toEqual(['/reset-password/*'])
    expect(detail.components).toEqual([{ '/': '/reset-password/*' }])
  })
})
