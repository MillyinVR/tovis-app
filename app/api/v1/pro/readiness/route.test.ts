// app/api/v1/pro/readiness/route.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  checkProReadiness: vi.fn(),
  jsonOk: vi.fn(),
  requirePro: vi.fn(),
}))

vi.mock('@/app/api/_utils', () => ({
  jsonOk: mocks.jsonOk,
  requirePro: mocks.requirePro,
}))

vi.mock('@/lib/pro/readiness/proReadiness', () => ({
  checkProReadiness: mocks.checkProReadiness,
}))

import { GET } from './route'

describe('GET /api/v1/pro/readiness', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mocks.jsonOk.mockImplementation((data: unknown, status = 200) => ({
      status,
      body: data,
    }))
  })

  it('returns the auth failure response when requirePro fails', async () => {
    const authResponse = {
      status: 401,
      body: {
        ok: false,
        error: 'Unauthorized.',
      },
    }

    mocks.requirePro.mockResolvedValueOnce({
      ok: false,
      res: authResponse,
    })

    const result = await GET()

    expect(result).toBe(authResponse)
    expect(mocks.requirePro).toHaveBeenCalledTimes(1)
    expect(mocks.checkProReadiness).not.toHaveBeenCalled()
    expect(mocks.jsonOk).not.toHaveBeenCalled()
  })

  it('returns canonical readiness for the authenticated professional', async () => {
    const readiness = {
      ok: true,
      liveModes: ['SALON'],
      readyLocationIds: ['location_123'],
    }

    mocks.requirePro.mockResolvedValueOnce({
      ok: true,
      user: {
        id: 'user_123',
      },
      userId: 'user_123',
      professionalId: 'pro_123',
      proId: 'pro_123',
    })

    mocks.checkProReadiness.mockResolvedValueOnce(readiness)

    const result = await GET()

    expect(mocks.requirePro).toHaveBeenCalledTimes(1)
    expect(mocks.checkProReadiness).toHaveBeenCalledTimes(1)
    expect(mocks.checkProReadiness).toHaveBeenCalledWith('pro_123')
    expect(mocks.jsonOk).toHaveBeenCalledTimes(1)
    expect(mocks.jsonOk).toHaveBeenCalledWith(
      {
        readiness,
      },
      200,
    )
    expect(result).toEqual({
      status: 200,
      body: {
        readiness,
      },
    })
  })

  it('returns canonical blockers when the professional is not ready', async () => {
    const readiness = {
      ok: false,
      blockers: ['NO_ACTIVE_OFFERING', 'NO_BOOKABLE_LOCATION'],
    }

    mocks.requirePro.mockResolvedValueOnce({
      ok: true,
      user: {
        id: 'user_123',
      },
      userId: 'user_123',
      professionalId: 'pro_123',
      proId: 'pro_123',
    })

    mocks.checkProReadiness.mockResolvedValueOnce(readiness)

    const result = await GET()

    expect(mocks.requirePro).toHaveBeenCalledTimes(1)
    expect(mocks.checkProReadiness).toHaveBeenCalledTimes(1)
    expect(mocks.checkProReadiness).toHaveBeenCalledWith('pro_123')
    expect(mocks.jsonOk).toHaveBeenCalledTimes(1)
    expect(mocks.jsonOk).toHaveBeenCalledWith(
      {
        readiness,
      },
      200,
    )
    expect(result).toEqual({
      status: 200,
      body: {
        readiness,
      },
    })
  })
})