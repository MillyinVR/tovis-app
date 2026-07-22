import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  recipientFindFirst: vi.fn(),
  recipientFindUnique: vi.fn(),
  recipientUpdateMany: vi.fn(),
  recipientUpdate: vi.fn(),
  recipientUpsert: vi.fn(),
  recipientAggregate: vi.fn(),
  recipientFindMany: vi.fn(),
  openingFindUnique: vi.fn(),
  waitlistFindMany: vi.fn(),
  bookingFindMany: vi.fn(),
  upsertClientNotification: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    lastMinuteRecipient: {
      findFirst: mocks.recipientFindFirst,
      findUnique: mocks.recipientFindUnique,
      findMany: mocks.recipientFindMany,
      updateMany: mocks.recipientUpdateMany,
      update: mocks.recipientUpdate,
      upsert: mocks.recipientUpsert,
      aggregate: mocks.recipientAggregate,
    },
    lastMinuteOpening: {
      findUnique: mocks.openingFindUnique,
    },
    waitlistEntry: {
      findMany: mocks.waitlistFindMany,
    },
    booking: {
      findMany: mocks.bookingFindMany,
    },
  },
}))

vi.mock('@/lib/notifications/clientNotifications', () => ({
  upsertClientNotification: mocks.upsertClientNotification,
}))

import {
  acceptPriorityOffer,
  declinePriorityOffer,
  expireOverduePriorityOffers,
  hasActivePriorityOffer,
  offerNextPriorityClient,
} from './priorityOffer'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.upsertClientNotification.mockResolvedValue({ id: 'notif-1' })
  mocks.recipientUpdate.mockResolvedValue({})
  mocks.recipientUpsert.mockResolvedValue({ id: 'recip-1' })
  mocks.recipientAggregate.mockResolvedValue({ _max: { priorityOrder: 0 } })
})

describe('hasActivePriorityOffer', () => {
  it('returns false when no PRIORITY_OFFERED recipient exists', async () => {
    mocks.recipientFindFirst.mockResolvedValue(null)
    expect(await hasActivePriorityOffer('opening-1')).toBe(false)
  })

  it('returns true when a PRIORITY_OFFERED recipient exists', async () => {
    mocks.recipientFindFirst.mockResolvedValue({ id: 'r1' })
    expect(await hasActivePriorityOffer('opening-1')).toBe(true)
  })
})

describe('expireOverduePriorityOffers', () => {
  it('updates overdue PRIORITY_OFFERED recipients to PRIORITY_EXPIRED', async () => {
    mocks.recipientUpdateMany.mockResolvedValue({ count: 2 })
    const count = await expireOverduePriorityOffers('opening-1')
    expect(count).toBe(2)
    expect(mocks.recipientUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: 'PRIORITY_OFFERED',
        }),
        data: { status: 'PRIORITY_EXPIRED' },
      }),
    )
  })
})

describe('acceptPriorityOffer', () => {
  it('returns not_found when recipient does not exist', async () => {
    mocks.recipientFindUnique.mockResolvedValue(null)
    const result = await acceptPriorityOffer('bad-id')
    expect(result).toEqual({ ok: false, reason: 'not_found' })
  })

  it('returns not_priority when status is not PRIORITY_OFFERED', async () => {
    mocks.recipientFindUnique.mockResolvedValue({
      id: 'r1',
      status: 'ENQUEUED',
      priorityExpiresAt: null,
      openingId: 'o1',
      opening: { status: 'ACTIVE' },
    })
    const result = await acceptPriorityOffer('r1')
    expect(result).toEqual({ ok: false, reason: 'not_priority' })
  })

  it('returns expired and marks PRIORITY_EXPIRED when past deadline', async () => {
    mocks.recipientFindUnique.mockResolvedValue({
      id: 'r1',
      status: 'PRIORITY_OFFERED',
      priorityExpiresAt: new Date('2020-01-01'),
      openingId: 'o1',
      opening: { status: 'ACTIVE' },
    })
    const result = await acceptPriorityOffer('r1')
    expect(result).toEqual({ ok: false, reason: 'expired' })
    expect(mocks.recipientUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { status: 'PRIORITY_EXPIRED' },
      }),
    )
  })

  it('accepts a valid priority offer and sets CLICKED', async () => {
    mocks.recipientFindUnique.mockResolvedValue({
      id: 'r1',
      status: 'PRIORITY_OFFERED',
      priorityExpiresAt: new Date('2099-01-01'),
      openingId: 'o1',
      opening: { status: 'ACTIVE' },
    })
    const result = await acceptPriorityOffer('r1')
    expect(result).toEqual({ ok: true })
    expect(mocks.recipientUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'CLICKED' }),
      }),
    )
  })
})

describe('declinePriorityOffer', () => {
  it('declines a PRIORITY_OFFERED recipient', async () => {
    mocks.recipientFindUnique.mockResolvedValue({
      id: 'r1',
      status: 'PRIORITY_OFFERED',
    })
    const result = await declinePriorityOffer('r1')
    expect(result).toEqual({ ok: true })
    expect(mocks.recipientUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { status: 'PRIORITY_DECLINED' },
      }),
    )
  })
})

describe('the time-overlap audience exclusion is NOT the occupancy status set', () => {
  // ⚠️ Pins the divergence documented on getTimeOverlapClientIds: this query
  // answers "does this CLIENT already have plans in the window" (audience
  // exclusion — conservative, NO_SHOW included), not "is the pro busy"
  // (BOOKING_BLOCKING_STATUSES, which excludes NO_SHOW). "Consolidating" the
  // two sets is a behaviour change, not a cleanup; this fails if you try.
  it('excludes by NOT-CANCELLED (NO_SHOW stays occupying), never by a status allowlist', async () => {
    mocks.openingFindUnique.mockResolvedValue({
      id: 'opening-1',
      status: 'ACTIVE',
      startAt: new Date('2030-05-01T18:00:00.000Z'),
      endAt: new Date('2030-05-01T19:00:00.000Z'),
      timeZone: 'America/Los_Angeles',
      services: [],
    })
    mocks.recipientFindFirst.mockResolvedValue(null)
    mocks.recipientFindMany.mockResolvedValue([])
    mocks.bookingFindMany.mockResolvedValue([])

    const result = await offerNextPriorityClient({
      openingId: 'opening-1',
      professionalId: 'pro-1',
      notificationContent: { title: 't', body: 'b', href: '/x', data: {} },
    })
    expect(result).toEqual({ offered: false, reason: 'no_candidates' })

    expect(mocks.bookingFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          professionalId: 'pro-1',
          NOT: { status: 'CANCELLED' },
        }),
      }),
    )
    // The nearly-made edit this guards against: swapping the NOT for
    // `status: { in: BOOKING_BLOCKING_STATUSES }`, which would silently start
    // offering slots to clients no-showed in that very window.
    const where = mocks.bookingFindMany.mock.calls[0]?.[0]?.where ?? {}
    expect(JSON.stringify(where)).not.toContain('"in"')
  })
})
