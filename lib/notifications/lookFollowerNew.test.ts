import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NotificationEventKey } from '@prisma/client'

const mockCreateProNotification = vi.hoisted(() => vi.fn())
const mockResolveUserActorPublicName = vi.hoisted(() => vi.fn())

vi.mock('./proNotifications', () => ({
  createProNotification: mockCreateProNotification,
}))

vi.mock('./social/resolveActorPublicName', () => ({
  resolveUserActorPublicName: mockResolveUserActorPublicName,
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
