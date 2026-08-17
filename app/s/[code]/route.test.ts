// app/s/[code]/route.test.ts

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  prisma: {
    shortLink: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
  isShortLinkResolveWithinRateLimit: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({ prisma: mocks.prisma }))
vi.mock('@/lib/shortLink/rateLimit', () => ({
  isShortLinkResolveWithinRateLimit: mocks.isShortLinkResolveWithinRateLimit,
}))

import { GET } from './route'

function request(code: string): Request {
  return new Request(`https://tovis.me/s/${code}`, {
    headers: { host: 'tovis.me' },
  })
}

function ctx(code: string) {
  return { params: Promise.resolve({ code }) }
}

describe('GET /s/[code]', () => {
  const originalAppUrl = process.env.APP_URL
  const originalNextPublicAppUrl = process.env.NEXT_PUBLIC_APP_URL

  beforeEach(() => {
    vi.clearAllMocks()
    // Unset so the route falls back to deriving the redirect base from the
    // REQUEST's forwarded host (lib/appUrl.ts's getAppUrlFromRequest) —
    // deterministic per-test via the `request()` helper's host header, and
    // exercises the actual fallback path rather than the env short-circuit.
    delete process.env.APP_URL
    delete process.env.NEXT_PUBLIC_APP_URL
    mocks.isShortLinkResolveWithinRateLimit.mockResolvedValue(true)
    mocks.prisma.shortLink.update.mockResolvedValue({})
  })

  afterEach(() => {
    if (originalAppUrl === undefined) {
      delete process.env.APP_URL
    } else {
      process.env.APP_URL = originalAppUrl
    }
    if (originalNextPublicAppUrl === undefined) {
      delete process.env.NEXT_PUBLIC_APP_URL
    } else {
      process.env.NEXT_PUBLIC_APP_URL = originalNextPublicAppUrl
    }
  })

  it('301-redirects to the destination and logs a click', async () => {
    mocks.prisma.shortLink.findUnique.mockResolvedValue({
      id: 'sl_1',
      destinationPath: '/client/deposit/rawtoken123',
      expiresAt: null,
    })

    const res = await GET(request('Ab3xK9pQ'), ctx('Ab3xK9pQ'))

    expect(res.status).toBe(301)
    expect(res.headers.get('location')).toBe(
      'https://tovis.me/client/deposit/rawtoken123',
    )
    expect(res.headers.get('Cache-Control')).toBe('no-store')

    expect(mocks.prisma.shortLink.update).toHaveBeenCalledWith({
      where: { id: 'sl_1' },
      data: { clickCount: { increment: 1 }, lastClickedAt: expect.any(Date) },
    })
  })

  it('404s for a malformed code without touching the database', async () => {
    const res = await GET(request('short'), ctx('short'))

    expect(res.status).toBe(404)
    expect(mocks.prisma.shortLink.findUnique).not.toHaveBeenCalled()
  })

  it('404s for an unknown code', async () => {
    mocks.prisma.shortLink.findUnique.mockResolvedValue(null)

    const res = await GET(request('Ab3xK9pQ'), ctx('Ab3xK9pQ'))

    expect(res.status).toBe(404)
    expect(mocks.prisma.shortLink.update).not.toHaveBeenCalled()
  })

  it('404s for an expired code and never redirects to it', async () => {
    mocks.prisma.shortLink.findUnique.mockResolvedValue({
      id: 'sl_1',
      destinationPath: '/client/deposit/rawtoken123',
      expiresAt: new Date('2020-01-01T00:00:00.000Z'),
    })

    const res = await GET(request('Ab3xK9pQ'), ctx('Ab3xK9pQ'))

    expect(res.status).toBe(404)
    expect(mocks.prisma.shortLink.update).not.toHaveBeenCalled()
  })

  it('404s (never redirects) for a row whose destination fails allowlist re-validation', async () => {
    mocks.prisma.shortLink.findUnique.mockResolvedValue({
      id: 'sl_1',
      destinationPath: '/pro/dashboard', // not an allowlisted client path
      expiresAt: null,
    })

    const res = await GET(request('Ab3xK9pQ'), ctx('Ab3xK9pQ'))

    expect(res.status).toBe(404)
    expect(mocks.prisma.shortLink.update).not.toHaveBeenCalled()
  })

  it('429s when the caller is rate limited, without querying the database', async () => {
    mocks.isShortLinkResolveWithinRateLimit.mockResolvedValue(false)

    const res = await GET(request('Ab3xK9pQ'), ctx('Ab3xK9pQ'))

    expect(res.status).toBe(429)
    expect(mocks.prisma.shortLink.findUnique).not.toHaveBeenCalled()
  })

  it('still redirects when the best-effort click log fails', async () => {
    mocks.prisma.shortLink.findUnique.mockResolvedValue({
      id: 'sl_1',
      destinationPath: '/client/deposit/rawtoken123',
      expiresAt: null,
    })
    mocks.prisma.shortLink.update.mockRejectedValue(new Error('db hiccup'))

    const res = await GET(request('Ab3xK9pQ'), ctx('Ab3xK9pQ'))

    expect(res.status).toBe(301)
    expect(res.headers.get('location')).toBe(
      'https://tovis.me/client/deposit/rawtoken123',
    )
  })
})
