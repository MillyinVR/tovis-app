// app/api/v1/pro/openings/route.test.ts
//
// F16's blast radius, which is the part no badge test covers: the visibility
// check runs inside three handlers, and two of them have ALREADY WRITTEN by the
// time they map their response. POST has created the opening; PATCH has saved
// the note or cancelled. A schedule query that fails there must not turn a
// succeeded write into a 500 the pro will retry.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { OpeningStatus } from '@prisma/client'

const mocks = vi.hoisted(() => ({
  requirePro: vi.fn(),
  resolveProOpeningVisibility: vi.fn(),
  findMany: vi.fn(),
  findFirst: vi.fn(),
  openingUpdateMany: vi.fn(),
  tierPlanUpdateMany: vi.fn(),
  recipientUpdateMany: vi.fn(),
  createLastMinuteOpening: vi.fn(),
}))

vi.mock('@/app/api/_utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/app/api/_utils')>()
  return { ...actual, requirePro: mocks.requirePro }
})

vi.mock('@/lib/lastMinute/proOpeningVisibility', () => ({
  resolveProOpeningVisibility: mocks.resolveProOpeningVisibility,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    lastMinuteOpening: {
      findMany: mocks.findMany,
      findFirst: mocks.findFirst,
    },
    $transaction: (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        lastMinuteOpening: { updateMany: mocks.openingUpdateMany },
        lastMinuteTierPlan: { updateMany: mocks.tierPlanUpdateMany },
        lastMinuteRecipient: { updateMany: mocks.recipientUpdateMany },
      }),
  },
}))

vi.mock('@/lib/lastMinute/commands/createLastMinuteOpening', () => ({
  createLastMinuteOpening: mocks.createLastMinuteOpening,
  CreateLastMinuteOpeningError: class extends Error {},
}))

import { DELETE, GET, POST } from './route'

function openingRow() {
  return {
    id: 'opening_1',
    professionalId: 'pro_1',
    locationType: 'SALON',
    locationId: 'loc_1',
    timeZone: 'America/Los_Angeles',
    startAt: new Date('2026-08-01T20:00:00.000Z'),
    endAt: new Date('2026-08-01T21:00:00.000Z'),
    status: OpeningStatus.ACTIVE,
    visibilityMode: 'PUBLIC_AT_DISCOVERY',
    launchAt: null,
    expiresAt: null,
    publicVisibleFrom: null,
    publicVisibleUntil: null,
    bookedAt: null,
    cancelledAt: null,
    note: null,
    createdAt: new Date('2026-07-30T00:00:00.000Z'),
    updatedAt: new Date('2026-07-30T00:00:00.000Z'),
    location: null,
    services: [],
    tierPlans: [],
    professional: { timeZone: 'America/Los_Angeles' },
    _count: { recipients: 0 },
  }
}

async function readOpenings(res: Response) {
  const body = await res.json()
  return body.openings as Array<{ id: string; clientVisibility: string }>
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requirePro.mockResolvedValue({ ok: true, professionalId: 'pro_1' })
  mocks.findMany.mockResolvedValue([openingRow()])
  mocks.createLastMinuteOpening.mockResolvedValue(openingRow())
  mocks.resolveProOpeningVisibility.mockResolvedValue(
    new Map([['opening_1', 'TIME_BOOKED']]),
  )
})

describe('DELETE /api/v1/pro/openings (cancel vs. claim race)', () => {
  // The pre-cancel guards run on a read taken OUTSIDE the transaction, and a
  // last-minute claim commits `status: BOOKED` under the professional's
  // advisory lock — which cancel does not take. So the cancel write itself
  // must be conditional: when the claim wins the race, the guarded updateMany
  // matches nothing and the pro gets a 409, instead of CANCELLED being
  // stamped over a booked opening whose Booking row survives.
  it('refuses when a claim booked the opening between the read and the write', async () => {
    // Pre-read still sees ACTIVE (the stale world) …
    mocks.findFirst.mockResolvedValueOnce({
      id: 'opening_1',
      status: OpeningStatus.ACTIVE,
      cancelledAt: null,
      bookedAt: null,
    })
    // … but the guarded write matches nothing (the claim committed first) …
    mocks.openingUpdateMany.mockResolvedValue({ count: 0 })
    // … and the re-read shows what actually happened.
    mocks.findFirst.mockResolvedValueOnce({
      id: 'opening_1',
      status: OpeningStatus.BOOKED,
      cancelledAt: null,
      bookedAt: new Date('2026-08-01T19:59:59.000Z'),
    })

    const res = await DELETE(
      new Request('http://t/api/v1/pro/openings?id=opening_1', {
        method: 'DELETE',
      }),
    )

    expect(res.status).toBe(409)
    // The cancel must have been attempted ONLY as a guarded write — one that
    // cannot match a row the claim already consumed.
    expect(mocks.openingUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'opening_1',
          status: { notIn: [OpeningStatus.BOOKED, OpeningStatus.CANCELLED] },
          bookedAt: null,
          cancelledAt: null,
        }),
      }),
    )
    // Nothing downstream of a failed cancel may fire.
    expect(mocks.tierPlanUpdateMany).not.toHaveBeenCalled()
    expect(mocks.recipientUpdateMany).not.toHaveBeenCalled()
  })

  // ALLOW case: an uncontended cancel still lands, and still sweeps the
  // outreach plans/recipients.
  it('cancels an unclaimed opening and sweeps its outreach rows', async () => {
    mocks.findFirst.mockResolvedValueOnce({
      id: 'opening_1',
      status: OpeningStatus.ACTIVE,
      cancelledAt: null,
      bookedAt: null,
    })
    mocks.openingUpdateMany.mockResolvedValue({ count: 1 })
    mocks.tierPlanUpdateMany.mockResolvedValue({ count: 2 })
    mocks.recipientUpdateMany.mockResolvedValue({ count: 3 })

    const res = await DELETE(
      new Request('http://t/api/v1/pro/openings?id=opening_1', {
        method: 'DELETE',
      }),
    )

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({
      ok: true,
      id: 'opening_1',
      alreadyCancelled: false,
    })
    expect(mocks.tierPlanUpdateMany).toHaveBeenCalled()
    expect(mocks.recipientUpdateMany).toHaveBeenCalled()
  })
})

describe('GET /api/v1/pro/openings', () => {
  it('puts the verdict on the wire', async () => {
    const res = await GET(new Request('http://t/api/v1/pro/openings'))

    expect(res.status).toBe(200)
    expect(await readOpenings(res)).toEqual([
      expect.objectContaining({ id: 'opening_1', clientVisibility: 'TIME_BOOKED' }),
    ])
  })

  // The pro must not lose their whole list — the only surface they can cancel a
  // dead opening from — because a badge could not be computed.
  it('still serves the list when the visibility check throws', async () => {
    mocks.resolveProOpeningVisibility.mockRejectedValue(new Error('db down'))

    const res = await GET(new Request('http://t/api/v1/pro/openings'))

    expect(res.status).toBe(200)
    expect(await readOpenings(res)).toEqual([
      expect.objectContaining({ id: 'opening_1', clientVisibility: 'NOT_CHECKED' }),
    ])
  })

  it('never reports an unanswered row as visible', async () => {
    mocks.resolveProOpeningVisibility.mockResolvedValue(new Map())

    const res = await GET(new Request('http://t/api/v1/pro/openings'))

    expect((await readOpenings(res))[0]?.clientVisibility).toBe('NOT_CHECKED')
  })
})

describe('POST /api/v1/pro/openings', () => {
  function createRequest() {
    return new Request('http://t/api/v1/pro/openings', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        offeringIds: ['off_1'],
        startAt: '2026-08-01T20:00:00.000Z',
        locationType: 'SALON',
        tierPlans: [],
      }),
    })
  }

  it('reports the new opening as visible when it is', async () => {
    mocks.resolveProOpeningVisibility.mockResolvedValue(
      new Map([['opening_1', 'VISIBLE']]),
    )

    const res = await POST(createRequest())
    const body = await res.json()

    expect(res.status).toBe(201)
    expect(body.opening.clientVisibility).toBe('VISIBLE')
  })

  // The opening HAS been created by this point. A display concern that failed
  // here would tell the pro their opening failed, and they would make another.
  it('still returns 201 when the visibility check throws after the write', async () => {
    mocks.resolveProOpeningVisibility.mockRejectedValue(new Error('db down'))

    const res = await POST(createRequest())
    const body = await res.json()

    expect(mocks.createLastMinuteOpening).toHaveBeenCalledTimes(1)
    expect(res.status).toBe(201)
    expect(body.opening.id).toBe('opening_1')
    expect(body.opening.clientVisibility).toBe('NOT_CHECKED')
  })
})
