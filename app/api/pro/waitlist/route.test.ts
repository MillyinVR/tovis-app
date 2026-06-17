// app/api/pro/waitlist/route.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requirePro: vi.fn(),
  jsonOk: vi.fn(),
  jsonFail: vi.fn(),
  waitlistFindMany: vi.fn(),
}))

vi.mock('@/app/api/_utils', () => ({
  requirePro: mocks.requirePro,
  jsonOk: mocks.jsonOk,
  jsonFail: mocks.jsonFail,
}))

vi.mock('@/lib/prisma', () => ({
  prismaRead: {
    waitlistEntry: {
      findMany: mocks.waitlistFindMany,
    },
  },
}))

import { GET } from './route'

type Payload = {
  services: {
    serviceId: string
    serviceName: string
    entries: {
      rank: number
      waitlistEntryId: string
      clientName: string
      preferenceLabel: string
    }[]
  }[]
  total: number
}

function row(over: {
  id: string
  serviceId: string
  serviceName: string
  createdAt: string
  firstName?: string
  lastName?: string
  preferenceType?: string
  timeOfDay?: string | null
}) {
  return {
    id: over.id,
    createdAt: new Date(over.createdAt),
    preferenceType: over.preferenceType ?? 'ANY_TIME',
    specificDate: null,
    timeOfDay: over.timeOfDay ?? null,
    windowStartMin: null,
    windowEndMin: null,
    service: { id: over.serviceId, name: over.serviceName },
    client: {
      firstName: over.firstName ?? 'A',
      lastName: over.lastName ?? 'B',
      avatarUrl: null,
    },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requirePro.mockResolvedValue({ ok: true, professionalId: 'pro-1' })
  // jsonOk returns the payload so we can assert on it directly.
  mocks.jsonOk.mockImplementation((data: unknown) => data)
  mocks.jsonFail.mockImplementation((status: number, error: string) => ({
    ok: false,
    status,
    error,
  }))
})

describe('GET /api/pro/waitlist', () => {
  it('returns the pro auth failure response when not a pro', async () => {
    const failRes = new Response('no', { status: 403 })
    mocks.requirePro.mockResolvedValueOnce({ ok: false, res: failRes })

    const res = await GET()

    expect(res).toBe(failRes)
    expect(mocks.waitlistFindMany).not.toHaveBeenCalled()
  })

  it('groups by service and ranks FIFO (1-based) within each service', async () => {
    // Rows are returned createdAt-ascending (the route's orderBy), interleaved
    // across two services to prove ranks are per-service, not global.
    mocks.waitlistFindMany.mockResolvedValue([
      row({ id: 'w1', serviceId: 's1', serviceName: 'Balayage', createdAt: '2026-06-10T00:00:00Z' }),
      row({ id: 'w2', serviceId: 's2', serviceName: 'Silk Press', createdAt: '2026-06-11T00:00:00Z' }),
      row({ id: 'w3', serviceId: 's1', serviceName: 'Balayage', createdAt: '2026-06-12T00:00:00Z' }),
      row({ id: 'w4', serviceId: 's1', serviceName: 'Balayage', createdAt: '2026-06-13T00:00:00Z' }),
    ])

    const raw: unknown = await GET()
    const payload = raw as Payload

    expect(payload.total).toBe(4)

    const balayage = payload.services.find((s) => s.serviceId === 's1')
    const silk = payload.services.find((s) => s.serviceId === 's2')

    expect(balayage?.entries.map((e) => [e.waitlistEntryId, e.rank])).toEqual([
      ['w1', 1],
      ['w3', 2],
      ['w4', 3],
    ])
    expect(silk?.entries.map((e) => [e.waitlistEntryId, e.rank])).toEqual([
      ['w2', 1],
    ])

    // Query is FIFO + scoped to the authed pro's ACTIVE entries.
    const args = mocks.waitlistFindMany.mock.calls[0]?.[0]
    expect(args?.where).toMatchObject({ professionalId: 'pro-1', status: 'ACTIVE' })
    expect(args?.orderBy).toEqual({ createdAt: 'asc' })
  })

  it('renders the client name and preference label', async () => {
    mocks.waitlistFindMany.mockResolvedValue([
      row({
        id: 'w1',
        serviceId: 's1',
        serviceName: 'Balayage',
        createdAt: '2026-06-10T00:00:00Z',
        firstName: 'Maya',
        lastName: 'Chen',
        preferenceType: 'TIME_OF_DAY',
        timeOfDay: 'MORNING',
      }),
    ])

    const raw: unknown = await GET()
    const payload = raw as Payload
    const entry = payload.services[0]?.entries[0]

    expect(entry?.clientName).toBe('Maya Chen')
    expect(entry?.preferenceLabel).toBe('Morning')
  })

  it('returns a 500 fail payload when the query throws', async () => {
    mocks.waitlistFindMany.mockRejectedValue(new Error('db down'))

    const res = (await GET()) as { ok: boolean; status: number }

    expect(res.status).toBe(500)
    expect(mocks.jsonFail).toHaveBeenCalledWith(500, 'Failed to load waitlist.')
  })
})
