// app/api/v1/pro/services/catalog/route.test.ts
import { describe, expect, it, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => {
  const jsonOk = vi.fn((data: unknown, status = 200) => {
    return new Response(JSON.stringify({ ok: true, ...((data as Record<string, unknown>) ?? {}) }), {
      status,
      headers: { 'content-type': 'application/json' },
    })
  })
  const jsonFail = vi.fn((status: number, error: string) => {
    return new Response(JSON.stringify({ ok: false, error }), {
      status,
      headers: { 'content-type': 'application/json' },
    })
  })
  const requirePro = vi.fn()
  const serviceCategory = { findMany: vi.fn() }
  const professionalServiceOffering = { findMany: vi.fn() }
  return {
    jsonOk,
    jsonFail,
    requirePro,
    prisma: { serviceCategory, professionalServiceOffering },
  }
})

vi.mock('@/lib/prisma', () => ({ prisma: mocks.prisma }))
vi.mock('@/app/api/_utils', () => ({
  jsonOk: mocks.jsonOk,
  jsonFail: mocks.jsonFail,
  requirePro: mocks.requirePro,
}))
vi.mock('@/lib/money', async () =>
  await vi.importActual<typeof import('@/lib/money')>('@/lib/money'),
)

import { GET } from './route'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('GET /api/v1/pro/services/catalog', () => {
  it('403s a non-pro', async () => {
    mocks.requirePro.mockResolvedValue({
      ok: false,
      res: new Response('forbidden', { status: 403 }),
    })
    const res = await GET()
    expect(res.status).toBe(403)
  })

  it('returns the category tree + the pro own offerings', async () => {
    mocks.requirePro.mockResolvedValue({ ok: true, professionalId: 'pro_1' })
    mocks.prisma.serviceCategory.findMany.mockResolvedValue([
      {
        id: 'cat_hair',
        name: 'Hair',
        services: [
          {
            id: 'svc_balayage',
            name: 'Balayage',
            minPrice: '180',
            defaultDurationMinutes: 180,
            defaultImageUrl: 'https://x/b.jpg',
            isAddOnEligible: false,
            addOnGroup: null,
          },
        ],
        children: [
          {
            id: 'cat_color',
            name: 'Color',
            services: [
              {
                id: 'svc_toner',
                name: 'Toner',
                minPrice: '40',
                defaultDurationMinutes: null,
                defaultImageUrl: null,
                isAddOnEligible: true,
                addOnGroup: 'COLOR',
              },
            ],
          },
        ],
      },
    ])
    mocks.prisma.professionalServiceOffering.findMany.mockResolvedValue([
      { id: 'off_1', serviceId: 'svc_balayage' },
    ])

    const res = await GET()
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.categories).toHaveLength(1)
    expect(body.categories[0].services[0].minPrice).toBe('180')
    expect(body.categories[0].children[0].services[0].defaultDurationMinutes).toBe(60)
    expect(body.categories[0].children[0].services[0].isAddOnEligible).toBe(true)
    expect(body.offerings).toEqual([{ id: 'off_1', serviceId: 'svc_balayage' }])
  })
})
