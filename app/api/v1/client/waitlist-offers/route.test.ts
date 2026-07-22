// app/api/v1/client/waitlist-offers/route.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireClient: vi.fn(),
  jsonOk: vi.fn(),
  offerFindMany: vi.fn(),
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
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireClient.mockResolvedValue({ ok: true, clientId: 'client-1' })
  mocks.jsonOk.mockImplementation((data: unknown) => data)
  mocks.offerFindMany.mockResolvedValue([offerRow()])
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
})
