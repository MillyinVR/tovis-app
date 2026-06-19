// lib/creator/creatorProfileStats.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { LookPostStatus, Prisma, PrismaClient } from '@prisma/client'

import {
  getClientCreatorStats,
  listClientLookRemixes,
} from './creatorProfileStats'

function makeDb() {
  return {
    clientFollow: { count: vi.fn() },
    lookPost: { aggregate: vi.fn(), count: vi.fn() },
    booking: { count: vi.fn(), findMany: vi.fn() },
  }
}

function asDb(db: ReturnType<typeof makeDb>): PrismaClient {
  return db as unknown as PrismaClient
}

describe('getClientCreatorStats', () => {
  let db: ReturnType<typeof makeDb>

  beforeEach(() => {
    db = makeDb()
    db.clientFollow.count.mockResolvedValue(312)
    db.lookPost.aggregate.mockResolvedValue({ _sum: { saveCount: 2100 } })
    db.booking.count.mockResolvedValue(9)
    db.lookPost.count.mockResolvedValue(4)
  })

  it('aggregates real creator metrics from Prisma', async () => {
    const stats = await getClientCreatorStats(asDb(db), 'client_1')

    expect(stats).toEqual({
      followers: 312,
      savesOnYourLooks: 2100,
      bookedFromYou: 9,
      authoredLooksCount: 4,
    })
  })

  it('counts only this client’s PUBLISHED authored looks for saves', async () => {
    await getClientCreatorStats(asDb(db), 'client_1')

    expect(db.lookPost.aggregate).toHaveBeenCalledWith({
      where: { clientAuthorId: 'client_1', status: LookPostStatus.PUBLISHED },
      _sum: { saveCount: true },
    })
  })

  it('counts remix bookings: others’ bookings from this client’s looks', async () => {
    await getClientCreatorStats(asDb(db), 'client_1')

    expect(db.booking.count).toHaveBeenCalledWith({
      where: {
        sourceLookPost: { clientAuthorId: 'client_1' },
        clientId: { not: 'client_1' },
      },
    })
  })

  it('treats a null saveCount sum as zero', async () => {
    db.lookPost.aggregate.mockResolvedValue({ _sum: { saveCount: null } })

    const stats = await getClientCreatorStats(asDb(db), 'client_1')

    expect(stats.savesOnYourLooks).toBe(0)
  })
})

describe('listClientLookRemixes', () => {
  let db: ReturnType<typeof makeDb>

  beforeEach(() => {
    db = makeDb()
  })

  it('maps a public booker to a handle and resolves look + pro names', async () => {
    db.booking.findMany.mockResolvedValue([
      {
        id: 'booking_1',
        createdAt: new Date('2026-06-19T12:00:00.000Z'),
        client: { handle: 'jade', isPublicProfile: true },
        professional: { businessName: 'Studio Noor' },
        sourceLookPost: { caption: 'Lived-in blonde\nsofter at the ends' },
      },
    ])

    const items = await listClientLookRemixes(asDb(db), { clientId: 'client_1' })

    expect(items).toEqual([
      {
        id: 'booking_1',
        who: '@jade',
        lookName: 'Lived-in blonde',
        proName: 'Studio Noor',
        bookedAt: '2026-06-19T12:00:00.000Z',
      },
    ])
  })

  it('renders a PII-safe generic booker when the client is private', async () => {
    db.booking.findMany.mockResolvedValue([
      {
        id: 'booking_2',
        createdAt: new Date('2026-06-18T12:00:00.000Z'),
        client: { handle: 'jade', isPublicProfile: false },
        professional: { businessName: 'Studio Noor' },
        sourceLookPost: { caption: 'Balayage' },
      },
    ])

    const items = await listClientLookRemixes(asDb(db), { clientId: 'client_1' })

    expect(items[0]?.who).toBe('Someone')
  })

  it('scopes the query to this client’s looks, excluding self-bookings', async () => {
    db.booking.findMany.mockResolvedValue([])

    await listClientLookRemixes(asDb(db), { clientId: 'client_1', take: 5 })

    expect(db.booking.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          sourceLookPost: { clientAuthorId: 'client_1' },
          clientId: { not: 'client_1' },
        },
        take: 5,
      }),
    )
  })
})

// Keeps the remix filter aligned with the Prisma schema without leaking types.
const _typeCheck: Prisma.BookingWhereInput = {
  sourceLookPost: { clientAuthorId: 'x' },
}
void _typeCheck
