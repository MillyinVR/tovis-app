// app/api/v1/pro/clients/route.test.ts
import { describe, expect, it, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => {
  const jsonOk = vi.fn(
    (data: unknown, status = 200) =>
      new Response(
        JSON.stringify({ ok: true, ...((data as Record<string, unknown>) ?? {}) }),
        { status, headers: { 'content-type': 'application/json' } },
      ),
  )
  const jsonFail = vi.fn(
    (status: number, error: string) =>
      new Response(JSON.stringify({ ok: false, error }), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
  )
  const requirePro = vi.fn()
  const resolveProScheduleTimeZone = vi.fn(async () => 'America/Los_Angeles')
  const prisma = { clientProfile: { findMany: vi.fn() } }
  return { jsonOk, jsonFail, requirePro, resolveProScheduleTimeZone, prisma }
})

vi.mock('@/lib/prisma', () => ({ prisma: mocks.prisma }))
vi.mock('@/app/api/_utils', () => ({ jsonOk: mocks.jsonOk, jsonFail: mocks.jsonFail }))
vi.mock('@/app/api/_utils/auth/requirePro', () => ({ requirePro: mocks.requirePro }))
vi.mock('@/lib/proLocations/resolveProScheduleTimeZone', () => ({
  resolveProScheduleTimeZone: mocks.resolveProScheduleTimeZone,
}))
// Real visibility where-builder + label formatter (pure, deterministic enough).
vi.mock('@/lib/clientVisibility', async () =>
  await vi.importActual<typeof import('@/lib/clientVisibility')>('@/lib/clientVisibility'),
)

import { GET } from './route'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('GET /api/v1/pro/clients', () => {
  it('403s a non-pro', async () => {
    mocks.requirePro.mockResolvedValue({ ok: false, res: new Response('forbidden', { status: 403 }) })
    const res = await GET()
    expect(res.status).toBe(403)
    expect(mocks.prisma.clientProfile.findMany).not.toHaveBeenCalled()
  })

  it('returns the visible directory ordered with last-booking labels', async () => {
    mocks.requirePro.mockResolvedValue({
      ok: true,
      professionalId: 'pro_1',
      user: { professionalProfile: { timeZone: 'America/New_York' } },
    })
    mocks.prisma.clientProfile.findMany.mockResolvedValue([
      {
        id: 'c_1',
        firstName: 'Avery',
        lastName: 'Stone',
        phone: '+15555550100',
        user: { email: 'avery@example.com' },
        bookings: [{ scheduledFor: new Date('2026-07-01T17:00:00Z'), locationTimeZone: 'America/Los_Angeles' }],
      },
      {
        id: 'c_2',
        firstName: 'Blair',
        lastName: 'Nguyen',
        phone: null,
        user: { email: 'blair@example.com' },
        bookings: [],
      },
    ])

    const res = await GET()
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      clients: Array<{ id: string; fullName: string; canViewClient: boolean; email: string | null; phone: string | null; lastBookingLabel: string }>
      count: number
    }

    expect(body.count).toBe(2)
    const [first, second] = body.clients
    expect(first).toMatchObject({
      id: 'c_1',
      fullName: 'Avery Stone',
      canViewClient: true,
      email: 'avery@example.com',
      phone: '+15555550100',
    })
    expect(first?.lastBookingLabel).toMatch(/^Last booking: /)
    expect(second?.lastBookingLabel).toBe('No bookings yet')
    expect(second?.phone).toBeNull()
  })

  it('falls back to email then "Client" when the name is blank', async () => {
    mocks.requirePro.mockResolvedValue({
      ok: true,
      professionalId: 'pro_1',
      user: { professionalProfile: { timeZone: null } },
    })
    mocks.prisma.clientProfile.findMany.mockResolvedValue([
      { id: 'c_3', firstName: '', lastName: '', phone: null, user: { email: 'name@example.com' }, bookings: [] },
      { id: 'c_4', firstName: null, lastName: null, phone: null, user: null, bookings: [] },
    ])

    const res = await GET()
    const body = (await res.json()) as { clients: Array<{ fullName: string }> }
    const [byEmail, byFallback] = body.clients
    expect(byEmail?.fullName).toBe('name@example.com')
    expect(byFallback?.fullName).toBe('Client')
  })
})
