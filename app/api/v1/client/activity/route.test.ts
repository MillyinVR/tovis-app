import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireClient: vi.fn(),
  jsonOk: vi.fn(),
  jsonFail: vi.fn(),
  loadClientActivityPage: vi.fn(),
  serializeClientActivityFeed: vi.fn(),
  safeError: vi.fn(),
}))

vi.mock('@/app/api/_utils/auth/requireClient', () => ({
  requireClient: mocks.requireClient,
}))

vi.mock('@/app/api/_utils/responses', () => ({
  jsonOk: mocks.jsonOk,
  jsonFail: mocks.jsonFail,
}))

vi.mock('@/app/client/(gated)/activity/_data/loadClientActivityPage', () => ({
  loadClientActivityPage: mocks.loadClientActivityPage,
}))

vi.mock('@/lib/dto/clientActivity', () => ({
  serializeClientActivityFeed: mocks.serializeClientActivityFeed,
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

describe('GET /api/v1/client/activity', () => {
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
      res: makeJsonResponse(401, { ok: false, error: 'Unauthorized' }),
    })

    const response = await GET()

    expect(response.status).toBe(401)
    // The gate must run BEFORE the loader: the loader would otherwise
    // redirect() a native caller to an HTML login page.
    expect(mocks.loadClientActivityPage).not.toHaveBeenCalled()
  })

  it('loads + serializes the activity feed', async () => {
    const rawData = { items: [], unreadCount: 0, markReadEventKeys: [] }
    const serialized = {
      items: [
        {
          id: 'notif_1',
          iconKind: 'follow',
          who: '@ava',
          action: 'started following you',
          highlight: null,
          timestamp: '2026-07-17T00:00:00.000Z',
          unread: true,
          href: '/u/ava',
          followBack: { handle: 'ava', alreadyFollowing: false },
        },
      ],
      unreadCount: 1,
      markReadEventKeys: ['CLIENT_FOLLOW'],
    }

    mocks.loadClientActivityPage.mockResolvedValue(rawData)
    mocks.serializeClientActivityFeed.mockReturnValue(serialized)

    const response = await GET()
    const json = await response.json()

    expect(mocks.loadClientActivityPage).toHaveBeenCalledTimes(1)
    expect(mocks.serializeClientActivityFeed).toHaveBeenCalledWith(rawData)
    expect(response.status).toBe(200)
    expect(json).toEqual({ ok: true, activity: serialized })
    // The client formats the relative time, so the wire carries a raw ISO
    // instant rather than a pre-baked "2h ago" that would go stale.
    expect(json.activity.items[0].timestamp).toBe('2026-07-17T00:00:00.000Z')
  })

  it('returns 500 when the loader throws', async () => {
    const thrown = new Error('db blew up')
    mocks.loadClientActivityPage.mockRejectedValueOnce(thrown)

    const response = await GET()

    expect(mocks.safeError).toHaveBeenCalledWith(thrown)
    expect(response.status).toBe(500)
  })
})
