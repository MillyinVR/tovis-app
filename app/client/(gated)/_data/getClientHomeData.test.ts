// app/client/(gated)/_data/getClientHomeData.test.ts
//
// F15 wiring for the client home invites. This loader backs BOTH the web home
// page and GET /api/v1/client/home (which iOS reads), so it is one filter for
// two surfaces — and the invites it returns are the same stored opening times
// /api/v1/client/openings serves.
//
// The schedule check itself runs against real Postgres in
// tests/integration/opening-liveness.test.ts.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ServiceLocationType } from '@prisma/client'

const mocks = vi.hoisted(() => ({
  inviteFindMany: vi.fn(),
  filterStillOpenRows: vi.fn(),
  // Every other read the loader fans out, held so `beforeEach` can re-stub them.
  // 🔴 Vitest runs with `mockReset: true`, which drops every implementation
  // between tests — including the "resolves empty" ones set at mock-definition
  // time. An unstubbed read then returns `undefined`, which passes for an empty
  // list right up until something maps over it.
  clientProfileFindUnique: vi.fn(),
  bookingFindFirst: vi.fn(),
  bookingCount: vi.fn(),
  aftercareFindFirst: vi.fn(),
  waitlistFindMany: vi.fn(),
  favoriteProFindMany: vi.fn(),
  favoriteServiceFindMany: vi.fn(),
  viralFindMany: vi.fn(),
  reviewAggregate: vi.fn(),
}))

/**
 * Every other read this loader fans out is irrelevant here, so they all resolve
 * empty; only `lastMinuteRecipient.findMany` returns rows.
 */
vi.mock('@/lib/prisma', () => ({
  prisma: {
    clientProfile: { findUnique: mocks.clientProfileFindUnique },
    booking: { findFirst: mocks.bookingFindFirst, count: mocks.bookingCount },
    aftercareSummary: { findFirst: mocks.aftercareFindFirst },
    lastMinuteRecipient: { findMany: mocks.inviteFindMany },
    // Two reads hit this model — the viewer's own entries, then their peers for
    // the FIFO rank. One mock serves both; both are empty here.
    waitlistEntry: { findMany: mocks.waitlistFindMany },
    professionalFavorite: { findMany: mocks.favoriteProFindMany },
    serviceFavorite: { findMany: mocks.favoriteServiceFindMany },
    viralServiceRequest: { findMany: mocks.viralFindMany },
    review: { aggregate: mocks.reviewAggregate },
  },
}))

vi.mock('@/lib/media/bookingBeforeAfter', () => ({
  loadBookingBeforeAfterThumbsFor: vi.fn().mockResolvedValue(null),
}))

vi.mock('@/lib/booking/storedSlotLiveness', () => ({
  filterStillOpenRows: mocks.filterStillOpenRows,
}))

import { getClientHomeData } from './getClientHomeData'

function inviteRow(openingId: string) {
  return {
    id: `recip_${openingId}`,
    opening: {
      id: openingId,
      professionalId: 'pro_1',
      startAt: new Date('2026-07-25T20:00:00.000Z'),
      locationId: 'loc_1',
      locationType: ServiceLocationType.SALON,
      professional: { timeZone: 'America/Los_Angeles' },
      services: [
        {
          service: { defaultDurationMinutes: 60 },
          offering: { salonDurationMinutes: 90, mobileDurationMinutes: null },
        },
      ],
    },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.clientProfileFindUnique.mockResolvedValue(null)
  mocks.bookingFindFirst.mockResolvedValue(null)
  mocks.bookingCount.mockResolvedValue(0)
  mocks.aftercareFindFirst.mockResolvedValue(null)
  mocks.waitlistFindMany.mockResolvedValue([])
  mocks.favoriteProFindMany.mockResolvedValue([])
  mocks.favoriteServiceFindMany.mockResolvedValue([])
  mocks.viralFindMany.mockResolvedValue([])
  mocks.reviewAggregate.mockResolvedValue({
    _avg: { rating: null },
    _count: { _all: 0 },
  })
  mocks.inviteFindMany.mockResolvedValue([inviteRow('opening_1')])
  mocks.filterStillOpenRows.mockImplementation(
    async (args: { rows: unknown[] }) => args.rows,
  )
})

describe('getClientHomeData — last-minute invites', () => {
  it('returns the invites the pro’s schedule can still serve', async () => {
    const data = await getClientHomeData({ clientId: 'client_1', userId: 'user_1' })

    expect(data.invites).toHaveLength(1)
  })

  it('drops an invite whose slot the pro can no longer serve', async () => {
    mocks.inviteFindMany.mockResolvedValue([
      inviteRow('opening_1'),
      inviteRow('opening_2'),
    ])
    mocks.filterStillOpenRows.mockImplementation(
      async (args: { rows: { opening: { id: string } }[] }) =>
        args.rows.filter((row) => row.opening.id === 'opening_1'),
    )

    const data = await getClientHomeData({ clientId: 'client_1', userId: 'user_1' })

    expect(data.invites.map((invite) => invite.opening.id)).toEqual(['opening_1'])
  })

  it('asks about the opening as the CLIENT hold path will claim it', async () => {
    await getClientHomeData({ clientId: 'client_1', userId: 'user_1' })

    const [args] = mocks.filterStillOpenRows.mock.calls[0]!
    const call = args as {
      viewerClientId: string
      onUncheckable: string
      toCandidate: (row: ReturnType<typeof inviteRow>) => Record<string, unknown> | null
    }

    expect(call.viewerClientId).toBe('client_1')
    expect(call.onUncheckable).toBe('drop')
    expect(call.toCandidate(inviteRow('opening_1'))).toMatchObject({
      key: 'opening_1',
      professionalId: 'pro_1',
      durationMinutes: 90,
      commitGate: 'CLIENT_HOLD',
      releasedHoldId: null,
    })
  })
})
