import { NotificationEventKey } from '@prisma/client'
import { describe, expect, it } from 'vitest'

import { extractEngagementActorUserId } from './leadActor'

describe('extractEngagementActorUserId', () => {
  it('reads the actor id from engagement events', () => {
    for (const eventKey of [
      NotificationEventKey.LOOK_LIKED,
      NotificationEventKey.LOOK_SAVED,
      NotificationEventKey.LOOK_COMMENTED,
      NotificationEventKey.LOOK_COMMENT_REPLIED,
    ]) {
      expect(
        extractEngagementActorUserId(eventKey, { actorUserId: 'user-1' }),
      ).toBe('user-1')
    }
  })

  it('trims surrounding whitespace', () => {
    expect(
      extractEngagementActorUserId(NotificationEventKey.LOOK_LIKED, {
        actorUserId: '  user-2  ',
      }),
    ).toBe('user-2')
  })

  it('ignores non-engagement events even with an actor id', () => {
    expect(
      extractEngagementActorUserId(NotificationEventKey.LOOK_FOLLOWER_NEW, {
        actorUserId: 'user-3',
      }),
    ).toBeNull()
    expect(
      extractEngagementActorUserId(NotificationEventKey.CLIENT_FOLLOW, {
        followerClientId: 'client-9',
      }),
    ).toBeNull()
    expect(
      extractEngagementActorUserId(
        NotificationEventKey.LOOK_MILESTONE_REACHED,
        {},
      ),
    ).toBeNull()
  })

  it('is null-safe for missing or malformed data payloads', () => {
    expect(
      extractEngagementActorUserId(NotificationEventKey.LOOK_LIKED, null),
    ).toBeNull()
    expect(
      extractEngagementActorUserId(NotificationEventKey.LOOK_LIKED, undefined),
    ).toBeNull()
    expect(
      extractEngagementActorUserId(NotificationEventKey.LOOK_LIKED, [
        'not',
        'an',
        'object',
      ]),
    ).toBeNull()
    expect(
      extractEngagementActorUserId(NotificationEventKey.LOOK_LIKED, {
        actorUserId: 42,
      }),
    ).toBeNull()
    expect(
      extractEngagementActorUserId(NotificationEventKey.LOOK_LIKED, {
        actorUserId: '   ',
      }),
    ).toBeNull()
  })
})
