// app/api/pro/readiness/route.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  jsonFail: vi.fn(),
  jsonOk: vi.fn(),
  loadProReadiness: vi.fn(),
  requirePro: vi.fn(),
}))

vi.mock('@/app/api/_utils', () => ({
  jsonFail: mocks.jsonFail,
  jsonOk: mocks.jsonOk,
  requirePro: mocks.requirePro,
}))

vi.mock('@/lib/pro-readiness', () => ({
  loadProReadiness: mocks.loadProReadiness,
}))

import { GET } from './route'

describe('GET /api/pro/readiness', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mocks.jsonFail.mockImplementation((status: number, message: string) => ({
      status,
      body: {
        ok: false,
        error: message,
      },
    }))

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
    expect(mocks.loadProReadiness).not.toHaveBeenCalled()
    expect(mocks.jsonOk).not.toHaveBeenCalled()
    expect(mocks.jsonFail).not.toHaveBeenCalled()
  })

  it('returns 404 when readiness cannot be loaded', async () => {
    mocks.requirePro.mockResolvedValueOnce({
      ok: true,
      user: {
        id: 'user_123',
      },
      userId: 'user_123',
      professionalId: 'pro_123',
      proId: 'pro_123',
    })

    mocks.loadProReadiness.mockResolvedValueOnce(null)

    const result = await GET()

    expect(mocks.requirePro).toHaveBeenCalledTimes(1)
    expect(mocks.loadProReadiness).toHaveBeenCalledTimes(1)
    expect(mocks.loadProReadiness).toHaveBeenCalledWith('pro_123')
    expect(mocks.jsonFail).toHaveBeenCalledTimes(1)
    expect(mocks.jsonFail).toHaveBeenCalledWith(
      404,
      'Professional profile was not found.',
    )
    expect(mocks.jsonOk).not.toHaveBeenCalled()
    expect(result).toEqual({
      status: 404,
      body: {
        ok: false,
        error: 'Professional profile was not found.',
      },
    })
  })

  it('returns readiness when the professional profile exists', async () => {
    const readiness = {
      professionalId: 'pro_123',
      status: 'BOOKABLE',
      isBookable: true,
      blockers: [],
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

    mocks.loadProReadiness.mockResolvedValueOnce(readiness)

    const result = await GET()

    expect(mocks.requirePro).toHaveBeenCalledTimes(1)
    expect(mocks.loadProReadiness).toHaveBeenCalledTimes(1)
    expect(mocks.loadProReadiness).toHaveBeenCalledWith('pro_123')
    expect(mocks.jsonOk).toHaveBeenCalledTimes(1)
    expect(mocks.jsonOk).toHaveBeenCalledWith(
      {
        readiness,
      },
      200,
    )
    expect(mocks.jsonFail).not.toHaveBeenCalled()
    expect(result).toEqual({
      status: 200,
      body: {
        readiness,
      },
    })
  })
})