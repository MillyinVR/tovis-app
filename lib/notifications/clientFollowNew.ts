import { NotificationEventKey, Prisma } from '@prisma/client'

import {
  createClientNotification,
  type CreateClientNotificationArgs,
} from './clientNotifications'
import { resolveLookActorPublicName } from './social/resolveActorPublicName'

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

  // Personalize with the follower's PUBLIC handle (§12 NC1 #34) — never a legal
  // name; a private/no-handle follower stays anonymous.
  const followerName = await resolveLookActorPublicName(
    { professionalProfileId: null, clientProfileId: followerClientId },
    args.tx,
  )

  const payload: CreateClientNotificationArgs = {
    clientId: followedClientId,
    eventKey: NotificationEventKey.CLIENT_FOLLOW,
    title: followerName
      ? `${followerName} started following you`
      : 'Someone started following you',
    href: '/client/activity',
    dedupeKey: buildClientFollowNotificationDedupeKey(followerClientId),
    data,
    tx: args.tx,
  }

  return createClientNotification(payload)
}
