// lib/looks/badges/attach.test.ts
import { describe, expect, it, vi } from 'vitest'

import {
  attachLookBadges,
  type LookBadgeAttachDb,
  type LookBadgeSourceRow,
} from '@/lib/looks/badges/attach'
import { isInBadgeHoldout } from '@/lib/looks/badges/engine'

const NOW = new Date('2026-07-12T12:00:00Z')
const HOUR_MS = 60 * 60 * 1000

/** A viewer key that is NOT in the holdout for the given look ids. */
function pickShownViewerKey(lookIds: string[]): string {
  let candidate = 'viewer_shown'
  let suffix = 0
  while (lookIds.some((id) => isInBadgeHoldout(candidate, id))) {
    suffix += 1
    candidate = `viewer_shown_${suffix}`
  }
  return candidate
}

type FakeDbOptions = {
  statRows?: Awaited<
    ReturnType<LookBadgeAttachDb['professionalBadgeStat']['findMany']>
  >
  locationRows?: Awaited<
    ReturnType<LookBadgeAttachDb['professionalLocation']['findMany']>
  >
  boardRows?: Awaited<ReturnType<LookBadgeAttachDb['board']['findMany']>>
  bookedRows?: Array<{ lookPostId: string; count: number }>
}

function makeFakeDb(options: FakeDbOptions = {}) {
  const statFindMany = vi.fn(async () => options.statRows ?? [])
  const locationFindMany = vi.fn(async () => options.locationRows ?? [])
  const boardFindMany = vi.fn(async () => options.boardRows ?? [])
  const queryRaw = vi.fn(
    async () => options.bookedRows ?? [],
  ) as LookBadgeAttachDb['$queryRaw']

  const db: LookBadgeAttachDb = {
    professionalBadgeStat: { findMany: statFindMany },
    professionalLocation: { findMany: locationFindMany },
    board: { findMany: boardFindMany },
    $queryRaw: queryRaw,
  }

  return {
    db,
    statFindMany,
    locationFindMany,
    boardFindMany,
    queryRaw,
  }
}

const OLD_ACCOUNT = new Date('2024-01-01T00:00:00Z')

function makeRow(overrides: Partial<LookBadgeSourceRow> = {}): LookBadgeSourceRow {
  return {
    id: 'look_1',
    professionalId: 'pro_a',
    professional: { user: { createdAt: OLD_ACCOUNT } },
    service: { category: { slug: 'nails' } },
    tags: [],
    ...overrides,
  }
}

describe('attachLookBadges', () => {
  it('returns an empty map without querying when the page is empty', async () => {
    const fake = makeFakeDb()

    const result = await attachLookBadges({
      db: fake.db,
      rows: [],
      viewer: { userId: 'user_1', clientId: null, lat: null, lng: null },
      brandName: 'BrandCo',
      now: NOW,
    })

    expect(result.badges.size).toBe(0)
    expect(result.meta).toEqual({
      eligibleCount: 0,
      shownCount: 0,
      holdoutCount: 0,
      kindCounts: {},
    })
    expect(fake.statFindMany).not.toHaveBeenCalled()
    expect(fake.queryRaw).not.toHaveBeenCalled()
  })

  it('skips the location query without viewer coords and the boards query without a client', async () => {
    const fake = makeFakeDb()

    await attachLookBadges({
      db: fake.db,
      rows: [makeRow()],
      viewer: { userId: 'user_1', clientId: null, lat: null, lng: null },
      brandName: 'BrandCo',
      now: NOW,
    })

    expect(fake.locationFindMany).not.toHaveBeenCalled()
    expect(fake.boardFindMany).not.toHaveBeenCalled()
    expect(fake.statFindMany).toHaveBeenCalledTimes(1)
    expect(fake.queryRaw).toHaveBeenCalledTimes(1)
  })

  it('reads the pro account age off the feed row for the new-to-platform badge', async () => {
    const viewerKey = pickShownViewerKey(['look_1'])
    const fake = makeFakeDb()

    const result = await attachLookBadges({
      db: fake.db,
      rows: [
        makeRow({
          professional: {
            user: { createdAt: new Date(NOW.getTime() - 10 * 24 * HOUR_MS) },
          },
        }),
      ],
      viewer: { userId: viewerKey, clientId: null, lat: null, lng: null },
      brandName: 'BrandCo',
      now: NOW,
    })

    const badge = result.badges.get('look_1')
    expect(badge?.kind).toBe('NEW_TO_PLATFORM')
    expect(badge?.label).toBe('New to BrandCo')
  })

  it('attaches stat-derived badges and reports serve-log meta', async () => {
    const rows = [makeRow(), makeRow({ id: 'look_2', professionalId: 'pro_b' })]
    const viewerKey = pickShownViewerKey(['look_1', 'look_2'])

    const fake = makeFakeDb({
      statRows: [
        {
          professionalId: 'pro_a',
          recentBookingCount: 5,
          completedBookingCount30d: 0,
          servedClientCount: 0,
          rebookedClientCount: 0,
          computedAt: new Date(NOW.getTime() - HOUR_MS),
        },
      ],
    })

    const result = await attachLookBadges({
      db: fake.db,
      rows,
      viewer: { userId: viewerKey, clientId: null, lat: null, lng: null },
      brandName: 'BrandCo',
      now: NOW,
    })

    // look_1's pro is booking fast (LOW tier nails → urgency leads or rotates
    // with nothing else — it's the only earned badge, so it renders).
    expect(result.badges.get('look_1')?.kind).toBe('BOOKING_FAST')
    // look_2's pro has no stats and an old account → nothing earned.
    expect(result.badges.get('look_2')).toBeNull()

    expect(result.meta.eligibleCount).toBe(1)
    expect(result.meta.shownCount).toBe(1)
    expect(result.meta.holdoutCount).toBe(0)
    expect(result.meta.kindCounts).toEqual({ BOOKING_FAST: 1 })
  })

  it('computes viewer distance from the primary location (coercing decimals)', async () => {
    const viewerKey = pickShownViewerKey(['look_1'])

    const fake = makeFakeDb({
      // Decimal-shaped coords arrive as strings from the driver — the
      // attacher must coerce them, ~1.4mi north of the viewer.
      locationRows: [
        { professionalId: 'pro_a', lat: '45.5405', lng: '-122.6673' },
      ],
    })

    const result = await attachLookBadges({
      db: fake.db,
      rows: [makeRow()],
      viewer: {
        userId: viewerKey,
        clientId: null,
        lat: 45.5202,
        lng: -122.6742,
      },
      brandName: 'BrandCo',
      now: NOW,
    })

    expect(fake.locationFindMany).toHaveBeenCalledTimes(1)
    expect(result.badges.get('look_1')?.kind).toBe('DISTANCE')
  })

  it('loads viewer board events for a client and renders the countdown', async () => {
    const viewerKey = pickShownViewerKey(['look_1'])

    const fake = makeFakeDb({
      boardRows: [
        // 42 days after NOW; Board.eventDate is a UTC-midnight @db.Date.
        { type: 'BRIDAL', eventDate: new Date('2026-08-23T00:00:00Z') },
      ],
    })

    const result = await attachLookBadges({
      db: fake.db,
      rows: [makeRow({ tags: [{ slug: 'bridal' }] })],
      viewer: {
        userId: viewerKey,
        clientId: 'client_1',
        lat: null,
        lng: null,
      },
      brandName: 'BrandCo',
      now: NOW,
    })

    expect(fake.boardFindMany).toHaveBeenCalledTimes(1)
    const badge = result.badges.get('look_1')
    expect(badge?.kind).toBe('EVENT_COUNTDOWN')
    expect(badge?.label).toBe('42 days until your wedding')
  })
})
