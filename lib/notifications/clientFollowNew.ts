import { NotificationEventKey, Prisma } from '@prisma/client'

import {
  createClientNotification,
  type CreateClientNotificationArgs,
} from './clientNotifications'

export type ClientFollowNotificationData = {
  followerClientId: string
}

export type CreateClientFollowNotificationArgs = {
  /** The client being followed — receives this notification. */
  followedClientId: string
  /** The client who started following. */
  followerClientId: string
  tx?: Prisma.TransactionClient
}

function normRequired(value: string, field: string): string {
  const trimmed = value.trim()
  if (!trimmed) {
    throw new Error(`createClientFollowNotification: missing ${field}`)
  }
  return trimmed
}

// Deduped per follower so a follow → unfollow → re-follow refreshes the single
// existing activity row instead of stacking duplicates (and does not re-notify
// on the refresh).
export function buildClientFollowNotificationDedupeKey(
  followerClientId: string,
): string {
  return `client-follow:${normRequired(followerClientId, 'followerClientId')}`
}

/**
 * Records a "started following you" activity-feed notification on the FOLLOWED
 * client's inbox. Name-free by design (matches LOOK_FOLLOWER_NEW): the follower
 * is captured by id only, and the activity feed resolves their public handle at
 * render time — strangers are never shown legal names.
 */
export async function createClientFollowNotification(
  args: CreateClientFollowNotificationArgs,
) {
  const followedClientId = normRequired(args.followedClientId, 'followedClientId')
  const followerClientId = normRequired(args.followerClientId, 'followerClientId')

  const data: ClientFollowNotificationData = { followerClientId }

  const payload: CreateClientNotificationArgs = {
    clientId: followedClientId,
    eventKey: NotificationEventKey.CLIENT_FOLLOW,
    title: 'You have a new follower',
    href: '/client/activity',
    dedupeKey: buildClientFollowNotificationDedupeKey(followerClientId),
    data,
    tx: args.tx,
  }

  return createClientNotification(payload)
}
