// app/api/v1/pro-license/verify/route.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  enforceRateLimit: vi.fn(),
  rateLimitIdentity: vi.fn(),
}))

vi.mock('@/lib/currentUser', () => ({
  getCurrentUser: mocks.getCurrentUser,
}))

vi.mock('@/app/api/_utils/rateLimit', () => ({
  enforceRateLimit: mocks.enforceRateLimit,
  rateLimitIdentity: mocks.rateLimitIdentity,
}))

import { POST } from './route'

function makeReq(body: unknown) {
  return new Request('http://localhost/api/v1/pro-license/verify', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })
}

const VALID_BODY = { state: 'CA', profession: 'BARBER', licenseNumber: '12345' }

// Guard: the upstream government API must never be hit when a gate trips.
const spyOnFetch = () =>
  vi
    .spyOn(globalThis, 'fetch')
    .mockResolvedValue(new Response('{}', { status: 200 }))

describe('POST /api/v1/pro-license/verify — auth + throttle gates', () => {
  let fetchSpy: ReturnType<typeof spyOnFetch>

  beforeEach(() => {
    mocks.getCurrentUser.mockReset()
    mocks.enforceRateLimit.mockReset()
    mocks.rateLimitIdentity.mockReset()
    mocks.rateLimitIdentity.mockResolvedValue({ kind: 'user', id: 'user_1' })
    mocks.enforceRateLimit.mockResolvedValue(null)
    fetchSpy = spyOnFetch()
  })

  afterEach(() => {
    fetchSpy.mockRestore()
  })

  it('rejects unauthenticated requests with 401 and never calls the upstream API', async () => {
    mocks.getCurrentUser.mockResolvedValue(null)

    const res = await POST(makeReq(VALID_BODY))

    expect(res.status).toBe(401)
    expect(mocks.enforceRateLimit).not.toHaveBeenCalled()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('returns the throttle response (per-user) before any upstream call', async () => {
    mocks.getCurrentUser.mockResolvedValue({ id: 'user_1' })
    mocks.enforceRateLimit.mockResolvedValue(
      new Response(JSON.stringify({ ok: false }), { status: 429 }),
    )

    const res = await POST(makeReq(VALID_BODY))

    expect(res.status).toBe(429)
    expect(mocks.rateLimitIdentity).toHaveBeenCalledWith('user_1')
    expect(mocks.enforceRateLimit).toHaveBeenCalledWith(
      expect.objectContaining({ bucket: 'pro-license:verify' }),
    )
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
