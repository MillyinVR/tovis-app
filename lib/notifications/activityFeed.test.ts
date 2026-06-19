// lib/notifications/activityFeed.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NotificationEventKey, Prisma, PrismaClient } from '@prisma/client'

import {
  ACTIVITY_FEED_EVENT_KEYS,
  countUnreadClientActivity,
  listClientActivity,
} from './activityFeed'

function makeDb() {
  return {
    clientNotification: {
      findMany: vi.fn(),
      count: vi.fn(),
    },
    clientProfile: {
      findMany: vi.fn(),
    },
    clientFollow: {
      findMany: vi.fn(),
    },
  }
}

function asDb(db: ReturnType<typeof makeDb>): PrismaClient {
  return db as unknown as PrismaClient
}

function followRow(
  overrides?: Partial<{
    id: string
    followerClientId: string | null
    readAt: Date | null
    createdAt: Date
  }>,
) {
  return {
    id: overrides?.id ?? 'notif_1',
    eventKey: NotificationEventKey.CLIENT_FOLLOW,
    data:
      overrides && 'followerClientId' in overrides
        ? overrides.followerClientId === null
          ? null
          : { followerClientId: overrides.followerClientId }
        : { followerClientId: 'client_follower' },
    readAt: overrides?.readAt ?? null,
    createdAt: overrides?.createdAt ?? new Date('2026-06-19T12:00:00.000Z'),
  }
}

describe('countUnreadClientActivity', () => {
  it('counts unread rows scoped to the engagement allowlist', async () => {
    const db = makeDb()
    db.clientNotification.count.mockResolvedValue(4)

    const count = await countUnreadClientActivity(asDb(db), 'client_1')

    expect(count).toBe(4)
    expect(db.clientNotification.count).toHaveBeenCalledWith({
      where: {
        clientId: 'client_1',
        readAt: null,
        eventKey: { in: [...ACTIVITY_FEED_EVENT_KEYS] },
      },
    })
  })
})

describe('listClientActivity', () => {
  let db: ReturnType<typeof makeDb>

  beforeEach(() => {
    db = makeDb()
    db.clientNotification.count.mockResolvedValue(0)
    db.clientProfile.findMany.mockResolvedValue([])
    db.clientFollow.findMany.mockResolvedValue([])
  })

  it('queries only the allowlisted engagement events', async () => {
    db.clientNotification.findMany.mockResolvedValue([])

    await listClientActivity(asDb(db), { clientId: 'client_1' })

    expect(db.clientNotification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          clientId: 'client_1',
          eventKey: { in: [...ACTIVITY_FEED_EVENT_KEYS] },
        },
      }),
    )
  })

  it('maps a public follower into a named, linkable follow item', async () => {
    db.clientNotification.findMany.mockResolvedValue([
      followRow({ followerClientId: 'client_follower' }),
    ])
    db.clientProfile.findMany.mockResolvedValue([
      { id: 'client_follower', handle: 'amara', isPublicProfile: true },
    ])
    db.clientNotification.count.mockResolvedValue(1)

    const feed = await listClientActivity(asDb(db), { clientId: 'client_1' })

    expect(feed.unreadCount).toBe(1)
    expect(feed.items).toHaveLength(1)
    expect(feed.items[0]).toEqual({
      id: 'notif_1',
      iconKind: 'follow',
      who: '@amara',
      action: 'started following you',
      highlight: null,
      timestamp: '2026-06-19T12:00:00.000Z',
      unread: true,
      href: '/u/amara',
      followBack: { handle: 'amara', alreadyFollowing: false },
    })
  })

  it('flags alreadyFollowing when the viewer follows the follower back', async () => {
    db.clientNotification.findMany.mockResolvedValue([
      followRow({ followerClientId: 'client_follower' }),
    ])
    db.clientProfile.findMany.mockResolvedValue([
      { id: 'client_follower', handle: 'amara', isPublicProfile: true },
    ])
    db.clientFollow.findMany.mockResolvedValue([
      { followedClientId: 'client_follower' },
    ])

    const feed = await listClientActivity(asDb(db), { clientId: 'client_1' })

    const [item] = feed.items
    expect(item).toBeDefined()
    expect(item?.followBack).toEqual({
      handle: 'amara',
      alreadyFollowing: true,
    })
    expect(db.clientFollow.findMany).toHaveBeenCalledWith({
      where: {
        followerClientId: 'client_1',
        followedClientId: { in: ['client_follower'] },
      },
      select: { followedClientId: true },
    })
  })

  it('renders a PII-safe generic row for a private follower', async () => {
    db.clientNotification.findMany.mockResolvedValue([
      followRow({ followerClientId: 'client_follower' }),
    ])
    db.clientProfile.findMany.mockResolvedValue([
      { id: 'client_follower', handle: 'amara', isPublicProfile: false },
    ])

    const feed = await listClientActivity(asDb(db), { clientId: 'client_1' })

    expect(feed.items[0]).toMatchObject({
      who: 'Someone',
      href: null,
      followBack: null,
    })
  })

  it('falls back to a generic row when the follower id is missing from data', async () => {
    db.clientNotification.findMany.mockResolvedValue([
      followRow({ followerClientId: null }),
    ])

    const feed = await listClientActivity(asDb(db), { clientId: 'client_1' })

    expect(db.clientProfile.findMany).not.toHaveBeenCalled()
    expect(feed.items[0]).toMatchObject({
      who: 'Someone',
      href: null,
      followBack: null,
    })
  })

  it('marks read rows as not unread', async () => {
    db.clientNotification.findMany.mockResolvedValue([
      followRow({
        followerClientId: 'client_follower',
        readAt: new Date('2026-06-19T13:00:00.000Z'),
      }),
    ])
    db.clientProfile.findMany.mockResolvedValue([
      { id: 'client_follower', handle: 'amara', isPublicProfile: true },
    ])

    const feed = await listClientActivity(asDb(db), { clientId: 'client_1' })

    const [item] = feed.items
    expect(item).toBeDefined()
    expect(item?.unread).toBe(false)
  })
})

// Ensures the loader's batch typing stays Prisma-aligned without leaking types.
const _typeCheck: Prisma.ClientNotificationWhereInput = {
  eventKey: { in: [...ACTIVITY_FEED_EVENT_KEYS] },
}
void _typeCheck
