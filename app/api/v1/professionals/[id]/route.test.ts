import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Role } from '@prisma/client'

const mocks = vi.hoisted(() => ({
  jsonOk: vi.fn(),
  jsonFail: vi.fn(),
  getCurrentUser: vi.fn(),
  loadProPublicProfile: vi.fn(),
  safeError: vi.fn(),
}))

vi.mock('@/app/api/_utils/responses', () => ({
  jsonOk: mocks.jsonOk,
  jsonFail: mocks.jsonFail,
}))

vi.mock('@/lib/currentUser', () => ({
  getCurrentUser: mocks.getCurrentUser,
}))

vi.mock('@/app/professionals/[id]/_data/loadProPublicProfile', () => ({
  loadProPublicProfile: mocks.loadProPublicProfile,
}))

vi.mock('@/lib/security/logging', () => ({
  safeError: mocks.safeError,
}))

import { GET } from './route'

function makeJsonResponse(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function makeRequest() {
  return new Request('http://localhost/api/v1/professionals/pro_1')
}

function ctx(id: string) {
  return { params: Promise.resolve({ id }) }
}

describe('GET /api/v1/professionals/[id]', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.clearAllMocks()
    consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined)

    mocks.safeError.mockImplementation((error: unknown) => ({
      message: error instanceof Error ? error.message : 'Unknown error',
    }))

    mocks.getCurrentUser.mockResolvedValue(null)

    mocks.jsonOk.mockImplementation(
      (data: Record<string, unknown>, status = 200) =>
        makeJsonResponse(status, { ok: true, ...(data ?? {}) }),
    )

    mocks.jsonFail.mockImplementation((status: number, error: string) =>
      makeJsonResponse(status, { ok: false, error }),
    )
  })

  afterEach(() => {
    consoleErrorSpy.mockRestore()
  })

  it('returns the JSON-safe profile for a guest viewer', async () => {
    const profile = {
      professionalId: 'pro_1',
      header: { id: 'pro_1', displayName: 'Ada' },
      stats: { priceFromLabel: '$80' },
      offerings: [{ id: 'o1', priceFromNumber: 80 }],
      portfolioTiles: [],
      reviews: [{ id: 'r1', createdAt: '2026-01-01T00:00:00.000Z' }],
      isFavoritedByMe: false,
    }
    mocks.loadProPublicProfile.mockResolvedValue(profile)

    const response = await GET(makeRequest(), ctx('pro_1'))
    const json = await response.json()

    expect(mocks.loadProPublicProfile).toHaveBeenCalledWith({
      professionalId: 'pro_1',
      viewer: null,
    })
    expect(response.status).toBe(200)
    expect(json).toEqual({ ok: true, professional: profile })
    // JSON-safe: review createdAt is an ISO string, not a Date.
    expect(json.professional.reviews[0].createdAt).toBe(
      '2026-01-01T00:00:00.000Z',
    )
  })

  it('forwards a CLIENT viewer context to the loader', async () => {
    mocks.getCurrentUser.mockResolvedValue({
      id: 'user_2',
      role: Role.CLIENT,
      professionalProfile: null,
    })
    mocks.loadProPublicProfile.mockResolvedValue({
      professionalId: 'pro_1',
      header: {},
      stats: {},
      offerings: [],
      portfolioTiles: [],
      reviews: [],
      isFavoritedByMe: true,
    })

    await GET(makeRequest(), ctx('pro_1'))

    expect(mocks.loadProPublicProfile).toHaveBeenCalledWith({
      professionalId: 'pro_1',
      viewer: { id: 'user_2', role: Role.CLIENT, professionalProfile: null },
    })
  })

  it('returns 404 when the loader returns null (missing / not viewable)', async () => {
    mocks.loadProPublicProfile.mockResolvedValue(null)

    const response = await GET(makeRequest(), ctx('pro_1'))

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: 'Professional not found.',
    })
  })

  it('returns 500 when the loader throws', async () => {
    const thrown = new Error('boom')
    mocks.loadProPublicProfile.mockRejectedValueOnce(thrown)

    const response = await GET(makeRequest(), ctx('pro_1'))

    expect(mocks.safeError).toHaveBeenCalledWith(thrown)
    expect(response.status).toBe(500)
  })
})
