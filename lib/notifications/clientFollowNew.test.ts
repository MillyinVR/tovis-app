import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NotificationEventKey } from '@prisma/client'

const mockCreateClientNotification = vi.hoisted(() => vi.fn())

vi.mock('./clientNotifications', () => ({
  createClientNotification: mockCreateClientNotification,
}))

import {
  buildClientFollowNotificationDedupeKey,
  createClientFollowNotification,
} from './clientFollowNew'

describe('lib/notifications/clientFollowNew', () => {
  beforeEach(() => {
    mockCreateClientNotification.mockReset()
    mockCreateClientNotification.mockResolvedValue({ id: 'notif_1' })
  })

  it('builds a stable per-follower dedupe key', () => {
    expect(buildClientFollowNotificationDedupeKey(' client_9 ')).toBe(
      'client-follow:client_9',
    )
  })

  it('records a name-free CLIENT_FOLLOW notification on the followed client', async () => {
    const result = await createClientFollowNotification({
      followedClientId: ' client_1 ',
      followerClientId: ' client_9 ',
    })

    expect(result).toEqual({ id: 'notif_1' })

    expect(mockCreateClientNotification).toHaveBeenCalledWith({
      clientId: 'client_1',
      eventKey: NotificationEventKey.CLIENT_FOLLOW,
      title: 'You have a new follower',
      href: '/client/activity',
      dedupeKey: 'client-follow:client_9',
      data: { followerClientId: 'client_9' },
      tx: undefined,
    })
  })

  it('throws when the followed client id is blank', async () => {
    await expect(
      createClientFollowNotification({
        followedClientId: '   ',
        followerClientId: 'client_9',
      }),
    ).rejects.toThrow('missing followedClientId')
    expect(mockCreateClientNotification).not.toHaveBeenCalled()
  })
})
