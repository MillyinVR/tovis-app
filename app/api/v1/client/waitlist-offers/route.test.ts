// app/api/v1/client/waitlist-offers/route.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireClient: vi.fn(),
  jsonOk: vi.fn(),
  offerFindMany: vi.fn(),
  filterStillOpenRows: vi.fn(),
}))

vi.mock('@/app/api/_utils', () => ({
  requireClient: mocks.requireClient,
  jsonOk: mocks.jsonOk,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    waitlistOffer: { findMany: mocks.offerFindMany },
  },
}))

// The filter itself is driven against real Postgres in
// tests/integration/waitlist-offer.test.ts. What matters HERE is the candidate
// this route hands it: both of its knobs are silently wrong in both directions.
vi.mock('@/lib/booking/storedSlotLiveness', () => ({
  filterStillOpenRows: mocks.filterStillOpenRows,
}))

import { GET } from './route'

type Payload = {
  offers: { offerId: string; expiresAt: string | null }[]
}

function offerRow(over?: { id?: string; expiresAt?: Date | null }) {
  return {
    id: over?.id ?? 'off_1',
    status: 'PENDING',
    startsAt: new Date('2026-08-01T17:00:00Z'),
    endsAt: new Date('2026-08-01T18:00:00Z'),
    locationType: 'SALON',
    locationId: 'loc_1',
    durationMinutes: 60,
    professionalId: 'pro_1',
    // `??` would swallow an explicit null, which is the pre-F14 row this
    // fixture exists to reproduce.
    expiresAt:
      over && 'expiresAt' in over
        ? over.expiresAt
        : new Date('2026-08-01T05:00:00Z'),
    professional: {
      id: 'pro_1',
      firstName: 'Ada',
      lastName: 'Lovelace',
      businessName: 'HTTP Studio',
      handle: 'ada',
      avatarUrl: null,
      timeZone: 'America/Los_Angeles',
    },
    offering: { service: { name: 'Balayage' } },
    location: { timeZone: 'America/Los_Angeles' },
    hold: { id: 'hold_1' },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireClient.mockResolvedValue({ ok: true, clientId: 'client-1' })
  mocks.jsonOk.mockImplementation((data: unknown) => data)
  mocks.offerFindMany.mockResolvedValue([offerRow()])
  mocks.filterStillOpenRows.mockImplementation(
    async (args: { rows: unknown[] }) => args.rows,
  )
})

describe('GET /api/v1/client/waitlist-offers', () => {
  it('returns the client auth failure response when not a client', async () => {
    const failRes = new Response('no', { status: 401 })
    mocks.requireClient.mockResolvedValueOnce({ ok: false, res: failRes })

    expect(await GET()).toBe(failRes)
    expect(mocks.offerFindMany).not.toHaveBeenCalled()
  })

  // F14 gave offers a real expiry. `assertConfirmableWaitlistOffer` refuses a
  // lapsed one, so a feed that still listed it would render a live-looking
  // Confirm button whose only outcome is "This offer has expired." — the exact
  // shape of unconfirmable card F5 existed to remove.
  it('asks only for offers the confirm would still accept', async () => {
    await GET()

    const where = mocks.offerFindMany.mock.calls[0]?.[0]?.where
    expect(where).toMatchObject({ clientId: 'client-1', status: 'PENDING' })
    expect(where?.OR).toEqual([
      { expiresAt: null },
      { expiresAt: { gt: expect.any(Date) } },
    ])
  })

  it('serializes the offer, carrying its expiry to the client', async () => {
    const raw: unknown = await GET()
    const payload = raw as Payload

    expect(payload.offers).toHaveLength(1)
    expect(payload.offers[0]?.offerId).toBe('off_1')
    expect(payload.offers[0]?.expiresAt).toBe('2026-08-01T05:00:00.000Z')
  })

  it('keeps a pre-F14 offer with no expiry', async () => {
    mocks.offerFindMany.mockResolvedValue([offerRow({ expiresAt: null })])

    const raw: unknown = await GET()
    const payload = raw as Payload
    expect(payload.offers[0]?.expiresAt).toBeNull()
  })

  // F15. The two knobs below decide whether the read agrees with the confirm,
  // and both are invisible when wrong:
  //
  // - `releasedHoldId` must be the offer's OWN reservation (F14). Without it the
  //   feed asks "is this slot free?" about a slot the offer itself is holding,
  //   and every offer hides itself the moment it is made.
  // - `commitGate` must be PRO_CREATE: the confirm books through
  //   `performLockedCreateProBooking`, which does not enforce the step (the PRO
  //   picked the minute, F4) and does not sweep the client's own holds.
  //   CLIENT_HOLD here would hide an offer the confirm would take.
  it('asks the schedule about the offer with the confirm gate its confirm runs', async () => {
    await GET()

    const [args] = mocks.filterStillOpenRows.mock.calls[0]!
    const call = args as {
      viewerClientId: string
      onUncheckable: string
      toCandidate: (row: ReturnType<typeof offerRow>) => Record<string, unknown>
    }

    expect(call.viewerClientId).toBe('client-1')
    expect(call.onUncheckable).toBe('drop')

    expect(call.toCandidate(offerRow())).toMatchObject({
      key: 'off_1',
      professionalId: 'pro_1',
      professionalTimeZone: 'America/Los_Angeles',
      locationId: 'loc_1',
      locationType: 'SALON',
      startUtc: new Date('2026-08-01T17:00:00Z'),
      durationMinutes: 60,
      commitGate: 'PRO_CREATE',
      releasedHoldId: 'hold_1',
    })
  })

  it('carries a null releasedHoldId for a pre-F14 offer that reserved nothing', async () => {
    await GET()

    const [args] = mocks.filterStillOpenRows.mock.calls[0]!
    const { toCandidate } = args as {
      toCandidate: (row: unknown) => { releasedHoldId: string | null }
    }

    expect(toCandidate({ ...offerRow(), hold: null }).releasedHoldId).toBeNull()
  })
})
