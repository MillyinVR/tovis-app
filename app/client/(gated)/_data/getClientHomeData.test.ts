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
}))

/**
 * Every other read this loader fans out is irrelevant here, so they all resolve
 * empty; only `lastMinuteRecipient.findMany` returns rows.
 */
vi.mock('@/lib/prisma', () => {
  const empty = () => vi.fn().mockResolvedValue([])
  return {
    prisma: {
      booking: { findFirst: vi.fn().mockResolvedValue(null), count: vi.fn().mockResolvedValue(0) },
      aftercareSummary: { findFirst: vi.fn().mockResolvedValue(null) },
      lastMinuteRecipient: { findMany: mocks.inviteFindMany },
      waitlistEntry: { findMany: empty() },
      professionalFavorite: { findMany: empty() },
      serviceFavorite: { findMany: empty() },
      viralServiceOffer: { findMany: empty() },
      viralServiceRequest: { findMany: empty() },
    },
  }
})

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
