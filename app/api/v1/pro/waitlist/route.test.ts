// app/api/v1/pro/waitlist/route.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requirePro: vi.fn(),
  jsonOk: vi.fn(),
  jsonFail: vi.fn(),
  waitlistFindMany: vi.fn(),
  offerFindMany: vi.fn(),
  getVisibleClientIdSetForPro: vi.fn(),
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
    waitlistOffer: {
      findMany: mocks.offerFindMany,
    },
  },
}))

// The route resolves each row's client link against the pro's visible-client
// set. Mocked here rather than mocking `prisma` (which this suite deliberately
// does not provide) so the test stays about the payload shape.
vi.mock('@/lib/clientVisibility', () => ({
  getVisibleClientIdSetForPro: mocks.getVisibleClientIdSetForPro,
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
      clientProfileHref: string | null
      preferenceLabel: string
      pendingOffer: { id: string; startsAt: string } | null
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
  clientId?: string
  handle?: string | null
  isPublicProfile?: boolean
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
      id: over.clientId ?? 'cl_1',
      handle: over.handle ?? null,
      isPublicProfile: over.isPublicProfile ?? false,
      firstName: over.firstName ?? 'A',
      lastName: over.lastName ?? 'B',
      avatarUrl: null,
    },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requirePro.mockResolvedValue({ ok: true, professionalId: 'pro-1' })
  mocks.offerFindMany.mockResolvedValue([])
  // Default: no chart access — which is the NORMAL waitlist case. Joining a
  // waitlist auto-creates a thread and nothing else (CONTACT_ONLY), so a
  // waitlist client is almost never in the pro's visible-client set.
  mocks.getVisibleClientIdSetForPro.mockResolvedValue(new Set<string>())
  // jsonOk returns the payload so we can assert on it directly.
  mocks.jsonOk.mockImplementation((data: unknown) => data)
  mocks.jsonFail.mockImplementation((status: number, error: string) => ({
    ok: false,
    status,
    error,
  }))
})

describe('GET /api/v1/pro/waitlist', () => {
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

    // Query is FIFO + scoped to the authed pro. NOTIFIED is listed alongside
    // ACTIVE (F14): sending an offer moves the entry there, so an ACTIVE-only
    // filter made the client vanish from the pro's own waitlist the moment they
    // were offered a — now reserved — time.
    const args = mocks.waitlistFindMany.mock.calls[0]?.[0]
    expect(args?.where).toMatchObject({
      professionalId: 'pro-1',
      status: { in: ['ACTIVE', 'NOTIFIED'] },
    })
    expect(args?.orderBy).toEqual({ createdAt: 'asc' })
  })

  it('attaches a live offer to its entry and leaves the others null', async () => {
    mocks.waitlistFindMany.mockResolvedValue([
      row({ id: 'w1', serviceId: 's1', serviceName: 'Balayage', createdAt: '2026-06-10T00:00:00Z' }),
      row({ id: 'w2', serviceId: 's1', serviceName: 'Balayage', createdAt: '2026-06-11T00:00:00Z' }),
    ])
    mocks.offerFindMany.mockResolvedValue([
      {
        id: 'off_1',
        waitlistEntryId: 'w2',
        startsAt: new Date('2026-08-01T17:00:00Z'),
        locationType: 'SALON',
      },
    ])

    const raw: unknown = await GET()
    const payload = raw as Payload
    const entries = payload.services[0]?.entries ?? []

    expect(entries[0]?.pendingOffer).toBeNull()
    expect(entries[1]?.pendingOffer).toEqual({
      id: 'off_1',
      startsAt: '2026-08-01T17:00:00.000Z',
      locationType: 'SALON',
    })

    // Only the listed entries are queried, and only offers the client can still
    // confirm count — an expired one must stop suppressing the offer action.
    const args = mocks.offerFindMany.mock.calls[0]?.[0]
    expect(args?.where).toMatchObject({
      waitlistEntryId: { in: ['w1', 'w2'] },
      status: 'PENDING',
    })
    expect(args?.where?.OR).toEqual([
      { expiresAt: null },
      { expiresAt: { gt: expect.any(Date) } },
    ])
  })

  it('skips the offer query entirely when nobody is waiting', async () => {
    mocks.waitlistFindMany.mockResolvedValue([])

    const raw: unknown = await GET()
    const payload = raw as Payload

    expect(payload.total).toBe(0)
    expect(mocks.offerFindMany).not.toHaveBeenCalled()
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


// The waitlist row's name was dead text for EVERY client, because the surface
// only ever knew about the chart — and a waitlist client is the one who least
// often has a chart. Both directions matter.
describe('GET /api/v1/pro/waitlist — where the client name links', () => {
  it('links a PUBLIC client to their /u/[handle] page when the chart is closed', async () => {
    mocks.waitlistFindMany.mockResolvedValue([
      row({
        id: 'w1',
        serviceId: 's1',
        serviceName: 'Balayage',
        createdAt: '2026-06-10T00:00:00Z',
        clientId: 'cl_9',
        handle: 'maya',
        isPublicProfile: true,
      }),
    ])

    const raw: unknown = await GET()
    const payload = raw as Payload

    expect(payload.services[0]?.entries[0]?.clientProfileHref).toBe('/u/maya')
  })

  it('prefers the CHART when the pro may open it', async () => {
    mocks.getVisibleClientIdSetForPro.mockResolvedValue(new Set(['cl_9']))
    mocks.waitlistFindMany.mockResolvedValue([
      row({
        id: 'w1',
        serviceId: 's1',
        serviceName: 'Balayage',
        createdAt: '2026-06-10T00:00:00Z',
        clientId: 'cl_9',
        handle: 'maya',
        isPublicProfile: true,
      }),
    ])

    const raw: unknown = await GET()
    const payload = raw as Payload

    expect(payload.services[0]?.entries[0]?.clientProfileHref).toBe(
      '/pro/clients/cl_9',
    )
  })

  it('is NULL for a private client with no chart — no dead link', async () => {
    mocks.waitlistFindMany.mockResolvedValue([
      row({
        id: 'w1',
        serviceId: 's1',
        serviceName: 'Balayage',
        createdAt: '2026-06-10T00:00:00Z',
        clientId: 'cl_9',
        // Handle reserved but never opted in — must NOT publish them.
        handle: 'maya',
        isPublicProfile: false,
      }),
    ])

    const raw: unknown = await GET()
    const payload = raw as Payload

    expect(payload.services[0]?.entries[0]?.clientProfileHref).toBeNull()
  })
})
