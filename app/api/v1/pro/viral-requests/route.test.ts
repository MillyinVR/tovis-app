// app/api/v1/pro/viral-requests/route.test.ts
//
// The route's own jobs, above what the loader's tests already prove: refuse a
// caller who is not a pro, hand the loader the ACTING pro's id, and put the
// built DTO on the wire.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  jsonOk: vi.fn(),
  jsonFail: vi.fn(),
  requirePro: vi.fn(),
  loadProViralRequestLibrary: vi.fn(),
}))

vi.mock('@/app/api/_utils', () => ({
  jsonOk: mocks.jsonOk,
  jsonFail: mocks.jsonFail,
  requirePro: mocks.requirePro,
}))

vi.mock('@/lib/viralRequests/proLibrary', () => ({
  loadProViralRequestLibrary: mocks.loadProViralRequestLibrary,
}))

import { GET } from './route'

describe('GET /api/v1/pro/viral-requests', () => {
  beforeEach(() => {
    for (const fn of Object.values(mocks)) fn.mockReset()
    mocks.jsonOk.mockImplementation((data?: Record<string, unknown>) =>
      Response.json({ ok: true, ...(data ?? {}) }, { status: 200 }),
    )
    mocks.jsonFail.mockImplementation((status: number, error: string) =>
      Response.json({ ok: false, error }, { status }),
    )
    mocks.requirePro.mockResolvedValue({ ok: true, professionalId: 'pro_1' })
  })

  it('serves the acting pro\'s matched looks as ISO-dated DTOs', async () => {
    mocks.loadProViralRequestLibrary.mockResolvedValue([
      {
        id: 'viral_1',
        name: 'Wolf Cut',
        sourceUrl: null,
        coverImageUrl: null,
        approvedAt: new Date('2026-09-10T12:00:00.000Z'),
        categoryId: null,
        categoryName: null,
        offering: true,
        offeredAt: new Date('2026-09-11T09:00:00.000Z'),
        offeringProCount: 2,
      },
    ])

    const res = await GET()
    expect(res.status).toBe(200)
    expect(mocks.loadProViralRequestLibrary).toHaveBeenCalledWith('pro_1')

    const body = await res.json()
    expect(body.requests).toHaveLength(1)
    expect(body.requests[0].offering).toBe(true)
    expect(body.requests[0].approvedAt).toBe('2026-09-10T12:00:00.000Z')
    // The submitter's evidence has no business on a pro surface.
    expect(body.requests[0]).not.toHaveProperty('mediaUrls')
  })

  it('refuses a caller who is not a pro, without reading anything', async () => {
    mocks.requirePro.mockResolvedValue({
      ok: false,
      res: Response.json({ ok: false, error: 'Unauthorized.' }, { status: 401 }),
    })

    const res = await GET()
    expect(res.status).toBe(401)
    expect(mocks.loadProViralRequestLibrary).not.toHaveBeenCalled()
  })

  it('does not leak an internal error to the caller', async () => {
    mocks.loadProViralRequestLibrary.mockRejectedValue(new Error('dsn=secret'))
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const res = await GET()
    expect(res.status).toBe(500)
    expect(JSON.stringify(await res.json())).not.toContain('dsn=secret')
    spy.mockRestore()
  })
})
