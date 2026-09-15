// app/api/v1/pro/viral-requests/[id]/offer/route.test.ts
//
// What is only true HERE, above the loader's own tests: the route hands the
// gate the ACTING pro's id (never one from the URL or a body), and it collapses
// both refusals onto the same 404.
//
// 🔴 The 404-vs-403 choice is the assertion worth keeping. Answering 403 for
// "you were not matched" and 404 for "no such look" would let any pro probe
// which viral looks exist and which matched somebody else. Both must be
// indistinguishable from outside.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  jsonOk: vi.fn((data?: Record<string, unknown>) =>
    Response.json({ ok: true, ...(data ?? {}) }, { status: 200 }),
  ),
  jsonFail: vi.fn((status: number, error: string) =>
    Response.json({ ok: false, error }, { status }),
  ),
  requirePro: vi.fn(),
  offerViralRequestAsPro: vi.fn(),
  withdrawViralRequestOfferAsPro: vi.fn(),
}))

vi.mock('@/app/api/_utils', () => ({
  jsonOk: mocks.jsonOk,
  jsonFail: mocks.jsonFail,
  requirePro: mocks.requirePro,
}))

vi.mock('@/lib/viralRequests/proLibrary', () => ({
  offerViralRequestAsPro: mocks.offerViralRequestAsPro,
  withdrawViralRequestOfferAsPro: mocks.withdrawViralRequestOfferAsPro,
}))

import { DELETE, POST } from './route'

const ENTRY = {
  id: 'viral_1',
  name: 'Wolf Cut',
  sourceUrl: null,
  coverImageUrl: null,
  approvedAt: new Date('2026-09-10T12:00:00.000Z'),
  categoryId: null,
  categoryName: null,
  offering: true,
  offeredAt: new Date('2026-09-11T09:00:00.000Z'),
  offeringProCount: 3,
}

function ctx(id: string) {
  return { params: Promise.resolve({ id }) }
}

describe('POST/DELETE /api/v1/pro/viral-requests/[id]/offer', () => {
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

  it('opts in as the ACTING pro and returns the updated look', async () => {
    mocks.offerViralRequestAsPro.mockResolvedValue({ ok: true, entry: ENTRY })

    const res = await POST(new Request('http://t/x', { method: 'POST' }), ctx('viral_1'))
    expect(res.status).toBe(200)

    // The pro id comes from the session, never from the request.
    expect(mocks.offerViralRequestAsPro).toHaveBeenCalledWith({
      professionalId: 'pro_1',
      viralRequestId: 'viral_1',
    })

    const body = await res.json()
    expect(body.request.offering).toBe(true)
    expect(body.request.offeringProCount).toBe(3)
    // Dates crossed the DTO boundary as ISO instants.
    expect(body.request.approvedAt).toBe('2026-09-10T12:00:00.000Z')
  })

  it('withdraws through the withdraw path, not the offer one', async () => {
    mocks.withdrawViralRequestOfferAsPro.mockResolvedValue({
      ok: true,
      entry: { ...ENTRY, offering: false, offeredAt: null, offeringProCount: 2 },
    })

    const res = await DELETE(new Request('http://t/x', { method: 'DELETE' }), ctx('viral_1'))
    expect(res.status).toBe(200)
    expect(mocks.offerViralRequestAsPro).not.toHaveBeenCalled()

    const body = await res.json()
    expect(body.request.offering).toBe(false)
    expect(body.request.offeredAt).toBeNull()
  })

  it.each([
    ['NOT_FOUND' as const],
    ['NOT_MATCHED' as const],
  ])('answers an indistinguishable 404 for %s', async (reason) => {
    mocks.offerViralRequestAsPro.mockResolvedValue({ ok: false, reason })

    const res = await POST(new Request('http://t/x', { method: 'POST' }), ctx('viral_1'))
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ ok: false, error: 'Not found.' })
  })

  it('refuses a caller who is not a pro, without touching the library', async () => {
    mocks.requirePro.mockResolvedValue({
      ok: false,
      res: Response.json({ ok: false, error: 'Unauthorized.' }, { status: 401 }),
    })

    const res = await POST(new Request('http://t/x', { method: 'POST' }), ctx('viral_1'))
    expect(res.status).toBe(401)
    expect(mocks.offerViralRequestAsPro).not.toHaveBeenCalled()
  })

  it('refuses a blank id rather than passing it down', async () => {
    const res = await POST(new Request('http://t/x', { method: 'POST' }), ctx('   '))
    expect(res.status).toBe(404)
    expect(mocks.offerViralRequestAsPro).not.toHaveBeenCalled()
  })

  it('does not leak an internal error to the caller', async () => {
    mocks.offerViralRequestAsPro.mockRejectedValue(new Error('db exploded: dsn=secret'))
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const res = await POST(new Request('http://t/x', { method: 'POST' }), ctx('viral_1'))
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toBe('Failed to update your answer.')
    expect(JSON.stringify(body)).not.toContain('dsn=secret')

    spy.mockRestore()
  })
})
