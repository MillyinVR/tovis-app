import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Role } from '@prisma/client'

const mocks = vi.hoisted(() => ({
  jsonOk: vi.fn(),
  jsonFail: vi.fn(),
  getCurrentUser: vi.fn(),
  loadPublicBoard: vi.fn(),
  safeError: vi.fn(),
}))

vi.mock('@/app/api/_utils/responses', () => ({
  jsonOk: mocks.jsonOk,
  jsonFail: mocks.jsonFail,
}))

vi.mock('@/lib/currentUser', () => ({
  getCurrentUser: mocks.getCurrentUser,
}))

vi.mock('@/lib/boards/publicBoard', () => ({
  loadPublicBoard: mocks.loadPublicBoard,
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
  return new Request('http://localhost/api/v1/u/ada/boards/summer-hair')
}

function ctx(handle: string, slug: string) {
  return { params: Promise.resolve({ handle, slug }) }
}

const sampleBoard = {
  handle: 'ada',
  ownerProfilePublic: true,
  ownerAvatarUrl: null,
  boardName: 'Summer hair',
  boardSlug: 'summer-hair',
  looks: [{ id: 'look_1', name: 'Balayage', imageUrl: null, href: '/looks/look_1' }],
  viewer: { isOwn: false, followingOwner: false },
}

describe('GET /api/v1/u/[handle]/boards/[slug]', () => {
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

  it('returns the already-JSON-safe board for a guest viewer', async () => {
    mocks.loadPublicBoard.mockResolvedValue(sampleBoard)

    const response = await GET(makeRequest(), ctx('ada', 'summer-hair'))
    const json = await response.json()

    // Guest → no viewerClientId.
    expect(mocks.loadPublicBoard).toHaveBeenCalledWith('ada', 'summer-hair', {
      viewerClientId: null,
    })
    expect(response.status).toBe(200)
    expect(json).toEqual({ ok: true, board: sampleBoard })
  })

  it('passes the client viewer id when a CLIENT is signed in', async () => {
    mocks.getCurrentUser.mockResolvedValue({
      role: Role.CLIENT,
      clientProfile: { id: 'client_9' },
    })
    mocks.loadPublicBoard.mockResolvedValue({
      ...sampleBoard,
      viewer: { isOwn: false, followingOwner: true },
    })

    await GET(makeRequest(), ctx('ada', 'summer-hair'))

    expect(mocks.loadPublicBoard).toHaveBeenCalledWith('ada', 'summer-hair', {
      viewerClientId: 'client_9',
    })
  })

  it('does not carry a viewer id for a signed-in PRO (views as guest)', async () => {
    mocks.getCurrentUser.mockResolvedValue({
      role: Role.PRO,
      clientProfile: null,
    })
    mocks.loadPublicBoard.mockResolvedValue(sampleBoard)

    await GET(makeRequest(), ctx('ada', 'summer-hair'))

    expect(mocks.loadPublicBoard).toHaveBeenCalledWith('ada', 'summer-hair', {
      viewerClientId: null,
    })
  })

  it('returns 404 when the loader returns null (private / hidden / not found)', async () => {
    mocks.loadPublicBoard.mockResolvedValue(null)

    const response = await GET(makeRequest(), ctx('ada', 'missing'))

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: 'Board not found.',
    })
  })

  it('returns 500 when the loader throws', async () => {
    const thrown = new Error('boom')
    mocks.loadPublicBoard.mockRejectedValueOnce(thrown)

    const response = await GET(makeRequest(), ctx('ada', 'summer-hair'))

    expect(mocks.safeError).toHaveBeenCalledWith(thrown)
    expect(response.status).toBe(500)
  })
})
