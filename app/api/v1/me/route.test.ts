import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireClient: vi.fn(),
  jsonOk: vi.fn(),
  jsonFail: vi.fn(),
  loadClientMePage: vi.fn(),
  serializeClientMePageData: vi.fn(),
  safeError: vi.fn(),
}))

vi.mock('@/app/api/_utils/auth/requireClient', () => ({
  requireClient: mocks.requireClient,
}))

vi.mock('@/app/api/_utils/responses', () => ({
  jsonOk: mocks.jsonOk,
  jsonFail: mocks.jsonFail,
}))

vi.mock('@/app/client/(gated)/me/_data/loadClientMePage', () => ({
  loadClientMePage: mocks.loadClientMePage,
}))

vi.mock('@/lib/dto/clientMe', () => ({
  serializeClientMePageData: mocks.serializeClientMePageData,
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

describe('GET /api/v1/me', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.clearAllMocks()
    consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined)

    mocks.safeError.mockImplementation((error: unknown) => ({
      message: error instanceof Error ? error.message : 'Unknown error',
    }))

    mocks.requireClient.mockResolvedValue({ ok: true, clientId: 'client_1' })

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

  it('returns auth response when requireClient fails (no loader call)', async () => {
    mocks.requireClient.mockResolvedValueOnce({
      ok: false,
      res: makeJsonResponse(403, { ok: false, error: 'Forbidden' }),
    })

    const response = await GET()

    expect(response.status).toBe(403)
    expect(mocks.loadClientMePage).not.toHaveBeenCalled()
  })

  it('loads + serializes the me aggregate', async () => {
    const rawData = { user: { id: 'user_1' } }
    const serialized = {
      user: { id: 'user_1', createdAt: '2026-01-01T00:00:00.000Z' },
      profile: { id: 'client_1', claimedAt: null },
      boards: [],
      following: { clientId: 'client_1', items: [], pagination: {} },
      counts: {
        boards: 0,
        saved: 0,
        booked: 3,
        following: 0,
        followers: 0,
      },
      upcomingNotificationBooking: null,
      history: [],
      myLooks: [],
      activityUnreadCount: 0,
      creator: {
        isCreator: false,
        savesOnYourLooks: 0,
        bookedFromYou: 0,
        remixes: [],
      },
    }

    mocks.loadClientMePage.mockResolvedValue(rawData)
    mocks.serializeClientMePageData.mockReturnValue(serialized)

    const response = await GET()
    const json = await response.json()

    expect(mocks.loadClientMePage).toHaveBeenCalledTimes(1)
    expect(mocks.serializeClientMePageData).toHaveBeenCalledWith(rawData)
    expect(response.status).toBe(200)
    expect(json).toEqual({ ok: true, me: serialized })
    // JSON-safe: createdAt serialized to an ISO string, not a Date.
    expect(json.me.user.createdAt).toBe('2026-01-01T00:00:00.000Z')
  })

  it('returns 500 when the loader throws', async () => {
    const thrown = new Error('db blew up')
    mocks.loadClientMePage.mockRejectedValueOnce(thrown)

    const response = await GET()

    expect(mocks.safeError).toHaveBeenCalledWith(thrown)
    expect(response.status).toBe(500)
  })
})
