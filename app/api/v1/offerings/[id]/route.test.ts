import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  jsonOk: vi.fn(),
  jsonFail: vi.fn(),
  pickString: vi.fn(),
  getCurrentUser: vi.fn(),
  loadOfferingDetail: vi.fn(),
  safeError: vi.fn(),
}))

vi.mock('@/app/api/_utils/responses', () => ({
  jsonOk: mocks.jsonOk,
  jsonFail: mocks.jsonFail,
}))

vi.mock('@/app/api/_utils/pick', () => ({
  pickString: mocks.pickString,
}))

vi.mock('@/lib/currentUser', () => ({
  getCurrentUser: mocks.getCurrentUser,
}))

vi.mock('@/app/(main)/offerings/[offeringId]/_data/loadOfferingDetail', () => ({
  loadOfferingDetail: mocks.loadOfferingDetail,
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

function makeRequest(qs = '?openingId=op_1&scheduledFor=2026-04-20T18:00:00.000Z') {
  return new Request(`http://localhost/api/v1/offerings/off_1${qs}`)
}

function ctx(id: string) {
  return { params: Promise.resolve({ id }) }
}

describe('GET /api/v1/offerings/[id]', () => {
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
    mocks.pickString.mockImplementation((v: unknown) =>
      typeof v === 'string' && v.trim() ? v.trim() : null,
    )

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

  it('returns the JSON-safe offering detail when claimable', async () => {
    const detail = {
      claimable: true,
      offeringId: 'off_1',
      openingId: 'op_1',
      professionalId: 'pro_1',
      serviceId: 'svc_1',
      scheduledForIso: '2026-04-20T18:00:00.000Z',
      locationId: 'loc_1',
      isMobile: false,
      serviceName: 'Cut',
      proName: 'Ada',
      profession: 'Stylist',
      when: 'Mon 11:00 AM',
      place: 'LA, CA',
      durationMin: 60,
      baseStr: '80',
      discountedStr: '64',
      incentiveLabel: '20% off',
      services: [{ id: 's1', service: { minPrice: '80' } }],
      publicIncentive: { tier: 'TIER_1', amountOff: null },
      defaultAddressId: null,
    }
    mocks.loadOfferingDetail.mockResolvedValue(detail)

    const response = await GET(makeRequest(), ctx('off_1'))
    const json = await response.json()

    expect(mocks.loadOfferingDetail).toHaveBeenCalledWith({
      offeringId: 'off_1',
      openingId: 'op_1',
      scheduledForRaw: '2026-04-20T18:00:00.000Z',
      clientId: null,
    })
    expect(response.status).toBe(200)
    expect(json).toEqual({ ok: true, offering: detail })
    // JSON-safe: prices are strings, instants are ISO strings.
    expect(json.offering.scheduledForIso).toBe('2026-04-20T18:00:00.000Z')
    expect(json.offering.baseStr).toBe('80')
  })

  it('passes clientId from a signed-in client viewer', async () => {
    mocks.getCurrentUser.mockResolvedValue({
      clientProfile: { id: 'client_5' },
    })
    mocks.loadOfferingDetail.mockResolvedValue({ claimable: false })

    await GET(makeRequest(), ctx('off_1'))

    expect(mocks.loadOfferingDetail).toHaveBeenCalledWith(
      expect.objectContaining({ clientId: 'client_5' }),
    )
  })

  it('returns 404 when the opening is not claimable', async () => {
    mocks.loadOfferingDetail.mockResolvedValue({ claimable: false })

    const response = await GET(makeRequest(), ctx('off_1'))

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: 'This opening is no longer available.',
    })
  })

  it('returns 500 when the loader throws', async () => {
    const thrown = new Error('boom')
    mocks.loadOfferingDetail.mockRejectedValueOnce(thrown)

    const response = await GET(makeRequest(), ctx('off_1'))

    expect(mocks.safeError).toHaveBeenCalledWith(thrown)
    expect(response.status).toBe(500)
  })
})
