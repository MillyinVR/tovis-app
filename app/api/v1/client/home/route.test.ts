import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireClient: vi.fn(),
  jsonOk: vi.fn(),
  jsonFail: vi.fn(),
  getClientHomeData: vi.fn(),
  serializeClientHomeData: vi.fn(),
  safeError: vi.fn(),
}))

vi.mock('@/app/api/_utils/auth/requireClient', () => ({
  requireClient: mocks.requireClient,
}))

vi.mock('@/app/api/_utils/responses', () => ({
  jsonOk: mocks.jsonOk,
  jsonFail: mocks.jsonFail,
}))

vi.mock('@/app/client/(gated)/_data/getClientHomeData', () => ({
  getClientHomeData: mocks.getClientHomeData,
}))

vi.mock('@/lib/dto/clientHome', () => ({
  serializeClientHomeData: mocks.serializeClientHomeData,
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

describe('GET /api/v1/client/home', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.clearAllMocks()
    consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined)

    mocks.safeError.mockImplementation((error: unknown) => ({
      message: error instanceof Error ? error.message : 'Unknown error',
    }))

    mocks.requireClient.mockResolvedValue({
      ok: true,
      clientId: 'client_1',
      user: { id: 'user_1' },
    })

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

  it('returns auth response when requireClient fails', async () => {
    mocks.requireClient.mockResolvedValueOnce({
      ok: false,
      res: makeJsonResponse(401, { ok: false, error: 'Unauthorized' }),
    })

    const response = await GET()

    expect(response.status).toBe(401)
    expect(mocks.getClientHomeData).not.toHaveBeenCalled()
  })

  it('loads + serializes the home data with clientId and userId', async () => {
    const rawData = { upcoming: null }
    const serialized = {
      upcoming: null,
      upcomingCount: 2,
      action: null,
      invites: [],
      waitlists: [],
      favoritePros: [],
      favoriteServices: [],
      viralLive: [],
      viralPending: [],
    }

    mocks.getClientHomeData.mockResolvedValue(rawData)
    mocks.serializeClientHomeData.mockReturnValue(serialized)

    const response = await GET()
    const json = await response.json()

    expect(mocks.getClientHomeData).toHaveBeenCalledWith({
      clientId: 'client_1',
      userId: 'user_1',
    })
    expect(mocks.serializeClientHomeData).toHaveBeenCalledWith(rawData)

    expect(response.status).toBe(200)
    expect(json).toEqual({ ok: true, home: serialized })
    // JSON-safe: round-trips with no thrown errors and no Date/Decimal objects.
    expect(JSON.stringify(json)).toContain('"upcomingCount":2')
  })

  it('returns 500 when the loader throws', async () => {
    const thrown = new Error('db blew up')
    mocks.getClientHomeData.mockRejectedValueOnce(thrown)

    const response = await GET()

    expect(mocks.safeError).toHaveBeenCalledWith(thrown)
    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: 'Failed to load client home.',
    })
  })
})
