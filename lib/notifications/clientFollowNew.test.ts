import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NotificationEventKey } from '@prisma/client'

const mockCreateClientNotification = vi.hoisted(() => vi.fn())
const mockResolveLookActorPublicName = vi.hoisted(() => vi.fn())
const mockIsBlockedNotificationParty = vi.hoisted(() => vi.fn())

vi.mock('./clientNotifications', () => ({
  createClientNotification: mockCreateClientNotification,
}))

vi.mock('./social/resolveActorPublicName', () => ({
  resolveLookActorPublicName: mockResolveLookActorPublicName,
}))

vi.mock('./social/blockedNotificationParty', () => ({
  isBlockedNotificationParty: mockIsBlockedNotificationParty,
}))

import {
  buildClientFollowNotificationDedupeKey,
  createClientFollowNotification,
} from './clientFollowNew'

describe('lib/notifications/clientFollowNew', () => {
  beforeEach(() => {
    mockCreateClientNotification.mockReset()
    mockCreateClientNotification.mockResolvedValue({ id: 'notif_1' })
    mockResolveLookActorPublicName.mockReset()
    mockResolveLookActorPublicName.mockResolvedValue(null)
    mockIsBlockedNotificationParty.mockReset()
    // Default: no block between the two clients.
    mockIsBlockedNotificationParty.mockResolvedValue(false)
  })

  it('builds a stable per-follower dedupe key', () => {
    expect(buildClientFollowNotificationDedupeKey(' client_9 ')).toBe(
      'client-follow:client_9',
    )
  })

  it('records a name-free CLIENT_FOLLOW notification when the follower has no public handle', async () => {
    const result = await createClientFollowNotification({
      followedClientId: ' client_1 ',
      followerClientId: ' client_9 ',
    })

    expect(result).toEqual({ id: 'notif_1' })

    expect(mockCreateClientNotification).toHaveBeenCalledWith({
      clientId: 'client_1',
      eventKey: NotificationEventKey.CLIENT_FOLLOW,
      title: 'Someone started following you',
      href: '/client/activity',
      dedupeKey: 'client-follow:client_9',
      data: { followerClientId: 'client_9' },
      tx: undefined,
    })
  })

  it('personalizes the title with the follower public handle when available', async () => {
    mockResolveLookActorPublicName.mockResolvedValue('@amy')

    await createClientFollowNotification({
      followedClientId: 'client_1',
      followerClientId: 'client_9',
    })

    expect(mockCreateClientNotification.mock.calls[0]?.[0].title).toBe(
      '@amy started following you',
    )
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

describe('lib/notifications/clientFollowNew — the block guard', () => {
  beforeEach(() => {
    mockCreateClientNotification.mockReset()
    mockCreateClientNotification.mockResolvedValue({ id: 'notif_1' })
    mockResolveLookActorPublicName.mockReset()
    mockResolveLookActorPublicName.mockResolvedValue(null)
    mockIsBlockedNotificationParty.mockReset()
    mockIsBlockedNotificationParty.mockResolvedValue(false)
  })

  it('creates NOTHING when the two clients have blocked each other', async () => {
    mockIsBlockedNotificationParty.mockResolvedValue(true)

    await expect(
      createClientFollowNotification({
        followedClientId: 'client_1',
        followerClientId: 'client_9',
      }),
    ).resolves.toBeNull()

    // ClientNotification carries no actor column — the actor is inside its data
    // Json — so creation time is the only place this can be stopped cheaply.
    expect(mockCreateClientNotification).not.toHaveBeenCalled()
  })

  it('names BOTH parties by client inbox id, on the trimmed values', async () => {
    await createClientFollowNotification({
      followedClientId: ' client_1 ',
      followerClientId: ' client_9 ',
    })

    expect(mockIsBlockedNotificationParty).toHaveBeenCalledWith({
      actor: { kind: 'client', clientId: 'client_9' },
      recipient: { kind: 'client', clientId: 'client_1' },
      db: undefined,
    })
  })

  it('does not resolve a public handle once suppressed', async () => {
    mockIsBlockedNotificationParty.mockResolvedValue(true)

    await createClientFollowNotification({
      followedClientId: 'client_1',
      followerClientId: 'client_9',
    })

    expect(mockResolveLookActorPublicName).not.toHaveBeenCalled()
  })
})
