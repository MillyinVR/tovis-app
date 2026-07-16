// app/api/v1/pro/visibility/route.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  jsonFail: vi.fn(),
  jsonOk: vi.fn(),
  loadProVisibilityHealth: vi.fn(),
  requirePro: vi.fn(),
}))

vi.mock('@/app/api/_utils', () => ({
  jsonFail: mocks.jsonFail,
  jsonOk: mocks.jsonOk,
}))

vi.mock('@/app/api/_utils/auth/requirePro', () => ({
  requirePro: mocks.requirePro,
}))

vi.mock('@/lib/pro/visibilityHealth', () => ({
  loadProVisibilityHealth: mocks.loadProVisibilityHealth,
}))

import { GET } from './route'

const HEALTH = {
  status: 'GOOD',
  discoverable: true,
  levers: [],
  looks: {
    feedEligibleCount: 3,
    pendingReviewCount: 0,
    rejectedCount: 0,
    draftCount: 0,
    distinctTagCount: 4,
    distinctServiceCount: 2,
  },
  notMeasured: [],
}

describe('GET /api/v1/pro/visibility', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.jsonOk.mockImplementation((data: unknown, status = 200) => ({
      status,
      body: data,
    }))
    mocks.jsonFail.mockImplementation((status: number, error: string) => ({
      status,
      body: { ok: false, error },
    }))
  })

  it('returns the auth failure response when requirePro fails', async () => {
    const authResponse = { status: 401, body: { ok: false, error: 'Unauthorized' } }
    mocks.requirePro.mockResolvedValue({ ok: false, res: authResponse })

    const res = await GET()

    expect(res).toBe(authResponse)
    expect(mocks.loadProVisibilityHealth).not.toHaveBeenCalled()
  })

  it('scopes the read to the authenticated pro — never a request-supplied id', async () => {
    mocks.requirePro.mockResolvedValue({ ok: true, professionalId: 'pro_123' })
    mocks.loadProVisibilityHealth.mockResolvedValue(HEALTH)

    const res = await GET()

    expect(mocks.loadProVisibilityHealth).toHaveBeenCalledTimes(1)
    expect(mocks.loadProVisibilityHealth.mock.calls[0]?.[0]).toMatchObject({
      professionalId: 'pro_123',
    })
    expect(res).toEqual({ status: 200, body: { visibility: HEALTH } })
  })

  it('fails closed on a loader error without leaking internals', async () => {
    mocks.requirePro.mockResolvedValue({ ok: true, professionalId: 'pro_123' })
    mocks.loadProVisibilityHealth.mockRejectedValue(new Error('boom'))
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined)

    const res = await GET()

    expect(res).toEqual({
      status: 500,
      body: { ok: false, error: 'Internal server error' },
    })
    consoleError.mockRestore()
  })
})
