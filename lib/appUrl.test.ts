import { afterEach, describe, expect, it } from 'vitest'
import { getAppUrlFromRequest } from './appUrl'

afterEach(() => {
  delete process.env.NEXT_PUBLIC_APP_URL
})

function req(headers: Record<string, string>): Request {
  return new Request('http://localhost/x', { headers })
}

describe('getAppUrlFromRequest', () => {
  it('prefers NEXT_PUBLIC_APP_URL and strips trailing slashes', () => {
    process.env.NEXT_PUBLIC_APP_URL = 'https://app.tovis.app///'
    expect(getAppUrlFromRequest(req({}))).toBe('https://app.tovis.app')
  })

  it('derives from forwarded host + proto when env is unset', () => {
    expect(
      getAppUrlFromRequest(
        req({ 'x-forwarded-host': 'tovis.app', 'x-forwarded-proto': 'https' }),
      ),
    ).toBe('https://tovis.app')
  })

  it('falls back to host header and defaults proto to https', () => {
    expect(getAppUrlFromRequest(req({ host: 'tovis.app' }))).toBe(
      'https://tovis.app',
    )
  })

  it('returns null when neither env nor host is available', () => {
    expect(getAppUrlFromRequest(req({}))).toBeNull()
  })
})
