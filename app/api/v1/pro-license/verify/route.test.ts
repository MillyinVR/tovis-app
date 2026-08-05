// app/api/v1/pro-license/verify/route.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  enforceRateLimit: vi.fn(),
  rateLimitIdentity: vi.fn(),
}))

vi.mock('@/lib/currentUser', () => ({
  getCurrentUser: mocks.getCurrentUser,
}))

vi.mock('@/app/api/_utils/rateLimit', () => ({
  enforceRateLimit: mocks.enforceRateLimit,
  rateLimitIdentity: mocks.rateLimitIdentity,
}))

import { POST } from './route'

function makeReq(body: unknown) {
  return new Request('http://localhost/api/v1/pro-license/verify', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })
}

const VALID_BODY = { state: 'CA', profession: 'BARBER', licenseNumber: '12345' }

// Guard: the upstream government API must never be hit when a gate trips.
const spyOnFetch = () =>
  vi
    .spyOn(globalThis, 'fetch')
    .mockResolvedValue(new Response('{}', { status: 200 }))

describe('POST /api/v1/pro-license/verify — auth + throttle gates', () => {
  let fetchSpy: ReturnType<typeof spyOnFetch>

  beforeEach(() => {
    mocks.getCurrentUser.mockReset()
    mocks.enforceRateLimit.mockReset()
    mocks.rateLimitIdentity.mockReset()
    mocks.rateLimitIdentity.mockResolvedValue({ kind: 'user', id: 'user_1' })
    mocks.enforceRateLimit.mockResolvedValue(null)
    fetchSpy = spyOnFetch()
  })

  afterEach(() => {
    fetchSpy.mockRestore()
  })

  it('rejects unauthenticated requests with 401 and never calls the upstream API', async () => {
    mocks.getCurrentUser.mockResolvedValue(null)

    const res = await POST(makeReq(VALID_BODY))

    expect(res.status).toBe(401)
    expect(mocks.enforceRateLimit).not.toHaveBeenCalled()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('returns the throttle response (per-user) before any upstream call', async () => {
    mocks.getCurrentUser.mockResolvedValue({ id: 'user_1' })
    mocks.enforceRateLimit.mockResolvedValue(
      new Response(JSON.stringify({ ok: false }), { status: 429 }),
    )

    const res = await POST(makeReq(VALID_BODY))

    expect(res.status).toBe(429)
    expect(mocks.rateLimitIdentity).toHaveBeenCalledWith('user_1')
    expect(mocks.enforceRateLimit).toHaveBeenCalledWith(
      expect.objectContaining({ bucket: 'pro-license:verify' }),
    )
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

describe('POST /api/v1/pro-license/verify — reading the DCA answer', () => {
  const ORIGINAL_ENV = process.env

  function jsonResponse(data: unknown, status = 200) {
    return new Response(JSON.stringify(data), {
      status,
      headers: { 'content-type': 'application/json' },
    })
  }

  const LICENSE_TYPES = {
    getAllLicenseTypes: [
      {
        licenseTypes: [
          { licenseLongName: 'COSMETOLOGIST', clientCode: 'COSM' },
          { licenseLongName: 'BARBER', clientCode: 'BARB' },
          { licenseLongName: 'ESTHETICIAN', clientCode: 'ESTH' },
          { licenseLongName: 'MANICURIST', clientCode: 'MANI' },
          { licenseLongName: 'HAIRSTYLIST', clientCode: 'HAIR' },
          { licenseLongName: 'ELECTROLOGIST', clientCode: 'ELEC' },
        ],
      },
    ],
  }

  /** Serve the license-type map, then whatever the search should answer. */
  function spyOnDcaFetch(searchBody: unknown) {
    return vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (input: RequestInfo | URL) => {
        const url =
          typeof input === 'string'
            ? input
            : input instanceof URL
              ? input.toString()
              : input.url

        if (url.includes('getAllLicenseTypes')) return jsonResponse(LICENSE_TYPES)
        if (url.includes('getLicenseNumberSearch')) return jsonResponse(searchBody)
        throw new Error(`Unexpected fetch URL: ${url}`)
      })
  }

  let fetchSpy: ReturnType<typeof spyOnDcaFetch> | null = null

  function serveDca(searchBody: unknown) {
    fetchSpy = spyOnDcaFetch(searchBody)
    return fetchSpy
  }

  function searchAnswer(detail: {
    licNumber?: string
    primaryStatusCode?: string
    expDate?: string
  }) {
    return {
      licenseDetails: [
        { getFullLicenseDetail: [{ getLicenseDetails: [detail] }] },
      ],
    }
  }

  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV }
    process.env.DCA_SEARCH_APP_ID = 'dca_app_id'
    process.env.DCA_SEARCH_APP_KEY = 'dca_app_key'

    mocks.getCurrentUser.mockReset()
    mocks.enforceRateLimit.mockReset()
    mocks.rateLimitIdentity.mockReset()
    mocks.getCurrentUser.mockResolvedValue({ id: 'user_1' })
    mocks.rateLimitIdentity.mockResolvedValue({ kind: 'user', id: 'user_1' })
    mocks.enforceRateLimit.mockResolvedValue(null)
  })

  afterEach(() => {
    fetchSpy?.mockRestore()
    process.env = ORIGINAL_ENV
  })

  it('sends BreEZe the numeric portion, and matches a CURRENT record despite the printed prefix', async () => {
    const spy = serveDca(
      searchAnswer({ licNumber: '123456', primaryStatusCode: 'CURRENT' }),
    )

    const res = await POST(
      makeReq({ state: 'CA', profession: 'BARBER', licenseNumber: 'B-123456' }),
    )
    const body = await res.json()

    expect(body).toMatchObject({ ok: true, status: 'VERIFIED' })

    const searchCall = spy.mock.calls
      .map((call) => String(call[0]))
      .find((url) => url.includes('getLicenseNumberSearch'))
    expect(searchCall).toContain('licNumber=123456')
  })

  it('degrades an unreadable 200 body to manual review rather than reporting a failure', async () => {
    serveDca({ message: 'Service temporarily unavailable' })

    const res = await POST(
      makeReq({ state: 'CA', profession: 'BARBER', licenseNumber: 'B123456' }),
    )
    const body = await res.json()

    expect(body).toMatchObject({ ok: true, status: 'PENDING_MANUAL_REVIEW' })
  })

  it('degrades a CURRENT record filed under a different number to manual review', async () => {
    serveDca(searchAnswer({ licNumber: '999999', primaryStatusCode: 'CURRENT' }))

    const res = await POST(
      makeReq({ state: 'CA', profession: 'BARBER', licenseNumber: 'B123456' }),
    )
    const body = await res.json()

    expect(body).toMatchObject({
      ok: true,
      status: 'PENDING_MANUAL_REVIEW',
      primaryStatusCode: 'CURRENT',
    })
  })

  it('still reports FAILED when the pro’s own record is genuinely not CURRENT', async () => {
    serveDca(searchAnswer({ licNumber: '123456', primaryStatusCode: 'EXPIRED' }))

    const res = await POST(
      makeReq({ state: 'CA', profession: 'BARBER', licenseNumber: 'B123456' }),
    )
    const body = await res.json()

    expect(body).toMatchObject({
      ok: true,
      status: 'FAILED',
      primaryStatusCode: 'EXPIRED',
    })
  })
})
