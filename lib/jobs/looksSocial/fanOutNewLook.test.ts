// lib/jobs/looksSocial/fanOutNewLook.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  LookPostStatus,
  LookPostVisibility,
  ModerationStatus,
  NotificationEventKey,
} from '@prisma/client'

const mockCreateClientNotification = vi.hoisted(() => vi.fn())

vi.mock('@/lib/notifications/clientNotifications', () => ({
  createClientNotification: mockCreateClientNotification,
}))

import {
  buildNewLookClientNotificationArgs,
  isFanOutEligibleLook,
  processFanOutNewLookNotifications,
} from './fanOutNewLook'

const ELIGIBLE = {
  status: LookPostStatus.PUBLISHED,
  moderationStatus: ModerationStatus.APPROVED,
  publishedAt: new Date('2026-07-03T12:00:00.000Z'),
  removedAt: null,
  visibility: LookPostVisibility.PUBLIC,
}

describe('isFanOutEligibleLook', () => {
  it('accepts a published, approved, public look', () => {
    expect(isFanOutEligibleLook(ELIGIBLE)).toBe(true)
  })

  it('accepts FOLLOWERS_ONLY (recipients are followers)', () => {
    expect(
      isFanOutEligibleLook({
        ...ELIGIBLE,
        visibility: LookPostVisibility.FOLLOWERS_ONLY,
      }),
    ).toBe(true)
  })

  it('rejects unlisted, unpublished, removed, and unapproved looks', () => {
    expect(
      isFanOutEligibleLook({
        ...ELIGIBLE,
        visibility: LookPostVisibility.UNLISTED,
      }),
    ).toBe(false)
    expect(
      isFanOutEligibleLook({ ...ELIGIBLE, status: LookPostStatus.DRAFT }),
    ).toBe(false)
    expect(
      isFanOutEligibleLook({ ...ELIGIBLE, publishedAt: null }),
    ).toBe(false)
    expect(
      isFanOutEligibleLook({
        ...ELIGIBLE,
        removedAt: new Date('2026-07-03T13:00:00.000Z'),
      }),
    ).toBe(false)
    expect(
      isFanOutEligibleLook({
        ...ELIGIBLE,
        moderationStatus: ModerationStatus.PENDING_REVIEW,
      }),
    ).toBe(false)
  })
})

describe('buildNewLookClientNotificationArgs', () => {
  it('builds a name-free notification with a per-look dedupe key', () => {
    const args = buildNewLookClientNotificationArgs({
      clientId: 'client_1',
      look: {
        id: 'look_1',
        professionalId: 'pro_1',
        caption: 'Fresh balayage for summer',
      },
    })

    expect(args).toEqual({
      clientId: 'client_1',
      eventKey: NotificationEventKey.LOOK_NEW_FROM_FOLLOWED_PRO,
      title: 'New look from a pro you follow',
      body: 'Fresh balayage for summer',
      href: '/looks/look_1',
      dedupeKey: 'look:look_1:new-look',
      data: {
        lookPostId: 'look_1',
        professionalId: 'pro_1',
      },
    })
  })

  it('collapses whitespace and truncates a long caption', () => {
    const args = buildNewLookClientNotificationArgs({
      clientId: 'client_1',
      look: {
        id: 'look_1',
        professionalId: 'pro_1',
        caption: `  ${'very '.repeat(40)}long  \n caption  `,
      },
    })

    expect(args.body ? args.body.length : 0).toBeLessThanOrEqual(140)
    expect(args.body?.endsWith('…')).toBe(true)
    expect(args.body?.includes('\n')).toBe(false)
  })

  it('omits the body when the caption is empty', () => {
    const args = buildNewLookClientNotificationArgs({
      clientId: 'client_1',
      look: { id: 'look_1', professionalId: 'pro_1', caption: null },
    })

    expect(args.body).toBeNull()
  })

  it('throws on a blank look id', () => {
    expect(() =>
      buildNewLookClientNotificationArgs({
        clientId: 'client_1',
        look: { id: '  ', professionalId: 'pro_1', caption: null },
      }),
    ).toThrowError()
  })
})

describe('processFanOutNewLookNotifications — the block guard', () => {
  const PRO_USER = 'user_pro'
  const LOOK = {
    id: 'look_1',
    professionalId: 'pro_1',
    clientAuthorId: null,
    caption: 'New set',
    status: LookPostStatus.PUBLISHED,
    moderationStatus: ModerationStatus.APPROVED,
    publishedAt: new Date('2026-07-03T12:00:00.000Z'),
    removedAt: null,
    visibility: LookPostVisibility.PUBLIC,
    professional: {
      userId: PRO_USER,
      handle: 'pro-one',
      user: { clientProfile: null },
    },
  }

  /** Minimal db double: one look, two followers, and a block list. */
  function db(args: {
    followers: Array<{ clientId: string; userId: string | null }>
    blocks: Array<{ blockerUserId: string; blockedUserId: string }>
  }) {
    return {
      lookPost: { findUnique: vi.fn().mockResolvedValue(LOOK) },
      proFollow: {
        findMany: vi.fn().mockResolvedValue(
          args.followers.map((f) => ({
            clientId: f.clientId,
            client: { userId: f.userId },
          })),
        ),
      },
      userBlock: { findMany: vi.fn().mockResolvedValue(args.blocks) },
    }
  }

  beforeEach(() => {
    mockCreateClientNotification.mockReset()
    mockCreateClientNotification.mockResolvedValue({ id: 'n1' })
  })

  it('notifies every follower when nobody is blocked', async () => {
    const result = await processFanOutNewLookNotifications(
      // @ts-expect-error — a minimal stand-in for the Prisma client.
      db({
        followers: [
          { clientId: 'client_a', userId: 'user_a' },
          { clientId: 'client_b', userId: 'user_b' },
        ],
        blocks: [],
      }),
      { lookPostId: 'look_1' },
    )

    expect(result.notifiedCount).toBe(2)
    expect(result.skippedBlockedCount).toBe(0)
    expect(mockCreateClientNotification).toHaveBeenCalledTimes(2)
  })

  it('skips a follower the pro has blocked', async () => {
    const result = await processFanOutNewLookNotifications(
      // @ts-expect-error — a minimal stand-in for the Prisma client.
      db({
        followers: [
          { clientId: 'client_a', userId: 'user_a' },
          { clientId: 'client_b', userId: 'user_b' },
        ],
        blocks: [{ blockerUserId: PRO_USER, blockedUserId: 'user_a' }],
      }),
      { lookPostId: 'look_1' },
    )

    expect(result.notifiedCount).toBe(1)
    // Counted, not silently dropped.
    expect(result.skippedBlockedCount).toBe(1)
    expect(mockCreateClientNotification).toHaveBeenCalledTimes(1)
    expect(mockCreateClientNotification).toHaveBeenCalledWith(
      expect.objectContaining({ clientId: 'client_b' }),
    )
  })

  it('skips a follower who blocked the PRO — the direction that matters most', async () => {
    // The blocked party must be silenced as well as hidden: you blocked them,
    // so their new look must not push to your phone with their name on it.
    const result = await processFanOutNewLookNotifications(
      // @ts-expect-error — a minimal stand-in for the Prisma client.
      db({
        followers: [{ clientId: 'client_a', userId: 'user_a' }],
        blocks: [{ blockerUserId: 'user_a', blockedUserId: PRO_USER }],
      }),
      { lookPostId: 'look_1' },
    )

    expect(result.notifiedCount).toBe(0)
    expect(result.skippedBlockedCount).toBe(1)
    expect(mockCreateClientNotification).not.toHaveBeenCalled()
  })

  it('still notifies a follower whose client record has no User account', async () => {
    // ClientProfile.userId is NULLABLE. Such a record can never be party to a
    // block, so dropping it would silently lose an unrelated notification.
    const result = await processFanOutNewLookNotifications(
      // @ts-expect-error — a minimal stand-in for the Prisma client.
      db({
        followers: [{ clientId: 'client_a', userId: null }],
        blocks: [{ blockerUserId: PRO_USER, blockedUserId: 'user_a' }],
      }),
      { lookPostId: 'look_1' },
    )

    expect(result.notifiedCount).toBe(1)
    expect(result.skippedBlockedCount).toBe(0)
  })

  it('reads the block list ONCE for the whole fan-out, not once per follower', async () => {
    const client = db({
      followers: Array.from({ length: 5 }, (_, i) => ({
        clientId: `client_${i}`,
        userId: `user_${i}`,
      })),
      blocks: [],
    })

    // @ts-expect-error — a minimal stand-in for the Prisma client.
    await processFanOutNewLookNotifications(client, { lookPostId: 'look_1' })

    expect(client.userBlock.findMany).toHaveBeenCalledTimes(1)
  })
})
