import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Role } from '@prisma/client'

const mocks = vi.hoisted(() => ({
  jsonOk: vi.fn(),
  jsonFail: vi.fn(),
  getCurrentUser: vi.fn(),
  loadPublicClientProfile: vi.fn(),
  safeError: vi.fn(),
}))

vi.mock('@/app/api/_utils/responses', () => ({
  jsonOk: mocks.jsonOk,
  jsonFail: mocks.jsonFail,
}))

vi.mock('@/lib/currentUser', () => ({
  getCurrentUser: mocks.getCurrentUser,
}))

vi.mock('@/app/u/[handle]/_data/loadPublicClientProfile', () => ({
  loadPublicClientProfile: mocks.loadPublicClientProfile,
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

function makeRequest(): Request {
  return new Request('http://localhost/api/v1/u/ada')
}

function ctx(handle: string) {
  return { params: Promise.resolve({ handle }) }
}

describe('GET /api/v1/u/[handle]', () => {
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

  it('returns the already-JSON-safe profile for a guest viewer', async () => {
    const profile = {
      handle: 'ada',
      displayName: '@ada',
      avatarUrl: null,
      bio: null,
      counts: { followers: 1, following: 2, looks: 0 },
      looks: [],
      viewer: { isOwn: false, following: false },
    }
    mocks.loadPublicClientProfile.mockResolvedValue(profile)

    const response = await GET(makeRequest(), ctx('ada'))
    const json = await response.json()

    // Guest → no viewerClientId.
    expect(mocks.loadPublicClientProfile).toHaveBeenCalledWith('ada', {
      viewerClientId: null,
    })
    expect(response.status).toBe(200)
    expect(json).toEqual({ ok: true, profile })
    expect(JSON.stringify(json)).toContain('"@ada"')
  })

  it('passes the client viewer id when a CLIENT is signed in', async () => {
    mocks.getCurrentUser.mockResolvedValue({
      role: Role.CLIENT,
      clientProfile: { id: 'client_9' },
    })
    mocks.loadPublicClientProfile.mockResolvedValue({
      handle: 'ada',
      displayName: '@ada',
      avatarUrl: null,
      bio: null,
      counts: { followers: 0, following: 0, looks: 0 },
      looks: [],
      viewer: { isOwn: false, following: true },
    })

    await GET(makeRequest(), ctx('ada'))

    expect(mocks.loadPublicClientProfile).toHaveBeenCalledWith('ada', {
      viewerClientId: 'client_9',
    })
  })

  it('returns 404 when the loader returns null (private / not found)', async () => {
    mocks.loadPublicClientProfile.mockResolvedValue(null)

    const response = await GET(makeRequest(), ctx('missing'))

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: 'Profile not found.',
    })
  })

  it('returns 500 when the loader throws', async () => {
    const thrown = new Error('boom')
    mocks.loadPublicClientProfile.mockRejectedValueOnce(thrown)

    const response = await GET(makeRequest(), ctx('ada'))

    expect(mocks.safeError).toHaveBeenCalledWith(thrown)
    expect(response.status).toBe(500)
  })
})
