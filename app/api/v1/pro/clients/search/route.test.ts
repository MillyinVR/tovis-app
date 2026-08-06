// app/api/v1/pro/clients/search/route.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  jsonOk: vi.fn(
    (data: unknown, status = 200) =>
      new Response(JSON.stringify({ ok: true, ...(data as object) }), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
  ),
  jsonFail: vi.fn(
    (status: number, error: string) =>
      new Response(JSON.stringify({ ok: false, error }), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
  ),
  requirePro: vi.fn(),
  getVisibleClientIdSetForPro: vi.fn(),
  getChartVisibleClientIdSetForPro: vi.fn(),
  prisma: {
    booking: { findMany: vi.fn() },
    clientProfile: { findMany: vi.fn() },
  },
}))

vi.mock('@/lib/prisma', () => ({ prisma: mocks.prisma }))
vi.mock('@/app/api/_utils', () => ({
  jsonOk: mocks.jsonOk,
  jsonFail: mocks.jsonFail,
  requirePro: mocks.requirePro,
}))
vi.mock('@/lib/clientVisibility', () => ({
  getVisibleClientIdSetForPro: mocks.getVisibleClientIdSetForPro,
  getChartVisibleClientIdSetForPro: mocks.getChartVisibleClientIdSetForPro,
}))

import { GET } from './route'

function req(q: string) {
  return new Request(
    `http://localhost/api/v1/pro/clients/search?q=${encodeURIComponent(q)}`,
  )
}

function client(overrides: Record<string, unknown> = {}) {
  return {
    id: 'c_1',
    firstName: 'Avery',
    lastName: 'Stone',
    phone: '+15555550100',
    user: { email: 'avery@example.com' },
    ...overrides,
  }
}

type SearchRow = { id: string; canViewClient: boolean }
type SearchBody = { recentClients: SearchRow[]; otherClients: SearchRow[] }

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requirePro.mockResolvedValue({ ok: true, professionalId: 'pro_1' })
  // No recent bookings by default, so every match falls into `otherClients`
  // and only one clientProfile.findMany call happens per test.
  mocks.prisma.booking.findMany.mockResolvedValue([])
  mocks.prisma.clientProfile.findMany.mockResolvedValue([])
  mocks.getVisibleClientIdSetForPro.mockResolvedValue(new Set(['c_1', 'c_2']))
  mocks.getChartVisibleClientIdSetForPro.mockResolvedValue(new Set())
})

describe('GET /api/v1/pro/clients/search', () => {
  it('403s a non-pro without querying', async () => {
    mocks.requirePro.mockResolvedValue({
      ok: false,
      res: new Response('forbidden', { status: 403 }),
    })

    const res = await GET(req('avery'))

    expect(res.status).toBe(403)
    expect(mocks.prisma.clientProfile.findMany).not.toHaveBeenCalled()
  })

  it('returns an empty result without querying clients when nothing is visible', async () => {
    mocks.getVisibleClientIdSetForPro.mockResolvedValue(new Set())

    const res = await GET(req('avery'))
    const body = (await res.json()) as SearchBody

    expect(body.recentClients).toEqual([])
    expect(body.otherClients).toEqual([])
    expect(mocks.prisma.clientProfile.findMany).not.toHaveBeenCalled()
  })

  // 🔴 The regression this guards: `canViewClient` used to be a literal `true`
  // on every row. Both cases below prove it now comes from
  // getChartVisibleClientIdSetForPro's answer, not from the row's presence.
  it('derives canViewClient: true from the chart-visibility gate', async () => {
    mocks.prisma.clientProfile.findMany.mockResolvedValue([client({ id: 'c_1' })])
    mocks.getChartVisibleClientIdSetForPro.mockResolvedValue(new Set(['c_1']))

    const res = await GET(req('avery'))
    const body = (await res.json()) as SearchBody
    const row = [...body.recentClients, ...body.otherClients].find(
      (r) => r.id === 'c_1',
    )

    expect(row?.canViewClient).toBe(true)
    expect(mocks.getChartVisibleClientIdSetForPro).toHaveBeenCalledWith(
      'pro_1',
      ['c_1'],
    )
  })

  it('derives canViewClient: false for a result the chart gate refuses', async () => {
    mocks.prisma.clientProfile.findMany.mockResolvedValue([client({ id: 'c_1' })])
    // Deliberately empty — proves the field is READ from the gate's answer,
    // not defaulted true because the row made it into the search results.
    mocks.getChartVisibleClientIdSetForPro.mockResolvedValue(new Set())

    const res = await GET(req('avery'))
    const body = (await res.json()) as SearchBody
    const row = [...body.recentClients, ...body.otherClients].find(
      (r) => r.id === 'c_1',
    )

    expect(row?.canViewClient).toBe(false)
  })
})
