import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NotificationEventKey } from '@prisma/client'

const mockCreateProNotification = vi.hoisted(() => vi.fn())
const mockResolveUserActorPublicName = vi.hoisted(() => vi.fn())
const mockIsBlockedNotificationParty = vi.hoisted(() => vi.fn())

vi.mock('./proNotifications', () => ({
  createProNotification: mockCreateProNotification,
}))

vi.mock('./social/resolveActorPublicName', () => ({
  resolveUserActorPublicName: mockResolveUserActorPublicName,
}))

vi.mock('./social/blockedNotificationParty', () => ({
  isBlockedNotificationParty: mockIsBlockedNotificationParty,
}))

import {
  buildLookFollowerNewProNotificationDedupeKey,
  createLookFollowerNewProNotification,
} from './lookFollowerNew'

describe('lib/notifications/lookFollowerNew', () => {
  beforeEach(() => {
    mockCreateProNotification.mockReset()
    mockCreateProNotification.mockResolvedValue({ id: 'notif_1' })
    mockResolveUserActorPublicName.mockReset()
    mockResolveUserActorPublicName.mockResolvedValue(null)
    mockIsBlockedNotificationParty.mockReset()
    // Default: no block between follower and pro.
    mockIsBlockedNotificationParty.mockResolvedValue(false)
  })

  it('builds a stable per-follower dedupe key', () => {
    expect(buildLookFollowerNewProNotificationDedupeKey(' user_9 ')).toBe(
      'look-follower:user_9',
    )
  })

  it('routes the event through createProNotification with a name-free title when the follower has no public identity', async () => {
    const result = await createLookFollowerNewProNotification({
      professionalId: ' pro_1 ',
      followerUserId: ' user_9 ',
    })

    expect(result).toEqual({ id: 'notif_1' })

    expect(mockCreateProNotification).toHaveBeenCalledWith({
      professionalId: 'pro_1',
      eventKey: NotificationEventKey.LOOK_FOLLOWER_NEW,
      title: 'Someone started following you',
      href: '/pro/profile/public-profile',
      dedupeKey: 'look-follower:user_9',
      data: {
        followerUserId: 'user_9',
      },
      actorUserId: 'user_9',
      tx: undefined,
    })
  })

  it('personalizes the title with the follower public name when available', async () => {
    mockResolveUserActorPublicName.mockResolvedValue('@amy')

    await createLookFollowerNewProNotification({
      professionalId: 'pro_1',
      followerUserId: 'user_9',
    })

    expect(mockCreateProNotification.mock.calls[0]?.[0].title).toBe(
      '@amy started following you',
    )
  })
})

describe('lib/notifications/lookFollowerNew — the block guard', () => {
  beforeEach(() => {
    mockCreateProNotification.mockReset()
    mockCreateProNotification.mockResolvedValue({ id: 'notif_1' })
    mockResolveUserActorPublicName.mockReset()
    mockResolveUserActorPublicName.mockResolvedValue(null)
    mockIsBlockedNotificationParty.mockReset()
    mockIsBlockedNotificationParty.mockResolvedValue(false)
  })

  it('creates NOTHING when the follower and the pro have blocked each other', async () => {
    mockIsBlockedNotificationParty.mockResolvedValue(true)

    await expect(
      createLookFollowerNewProNotification({
        professionalId: 'pro_1',
        followerUserId: 'user_9',
      }),
    ).resolves.toBeNull()

    // No row AND no push. A blocked person following you is exactly the buzz
    // the block is supposed to stop.
    expect(mockCreateProNotification).not.toHaveBeenCalled()
  })

  it('names the pro by INBOX id and the follower by USER id, on the trimmed values', async () => {
    await createLookFollowerNewProNotification({
      professionalId: ' pro_1 ',
      followerUserId: ' user_9 ',
    })

    // professionalId !== userId — the guard resolves the pro to its User.
    expect(mockIsBlockedNotificationParty).toHaveBeenCalledWith({
      actor: { kind: 'user', userId: 'user_9' },
      recipient: { kind: 'pro', professionalId: 'pro_1' },
      db: undefined,
    })
  })

  it('does not resolve a public name once suppressed', async () => {
    mockIsBlockedNotificationParty.mockResolvedValue(true)

    await createLookFollowerNewProNotification({
      professionalId: 'pro_1',
      followerUserId: 'user_9',
    })

    expect(mockResolveUserActorPublicName).not.toHaveBeenCalled()
  })
})
