import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NotificationEventKey } from '@prisma/client'

const mockCreateProNotification = vi.hoisted(() => vi.fn())

vi.mock('./proNotifications', () => ({
  createProNotification: mockCreateProNotification,
}))

import {
  buildLookFollowerNewProNotificationDedupeKey,
  createLookFollowerNewProNotification,
} from './lookFollowerNew'

describe('lib/notifications/lookFollowerNew', () => {
  beforeEach(() => {
    mockCreateProNotification.mockReset()
    mockCreateProNotification.mockResolvedValue({ id: 'notif_1' })
  })

  it('builds a stable per-follower dedupe key', () => {
    expect(buildLookFollowerNewProNotificationDedupeKey(' user_9 ')).toBe(
      'look-follower:user_9',
    )
  })

  it('routes the event through createProNotification with name-free args', async () => {
    const result = await createLookFollowerNewProNotification({
      professionalId: ' pro_1 ',
      followerUserId: ' user_9 ',
    })

    expect(result).toEqual({ id: 'notif_1' })

    expect(mockCreateProNotification).toHaveBeenCalledWith({
      professionalId: 'pro_1',
      eventKey: NotificationEventKey.LOOK_FOLLOWER_NEW,
      title: 'You have a new follower',
      href: '/pro/profile/public-profile',
      dedupeKey: 'look-follower:user_9',
      data: {
        followerUserId: 'user_9',
      },
      actorUserId: 'user_9',
      tx: undefined,
    })
  })
})
