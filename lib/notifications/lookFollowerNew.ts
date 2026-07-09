import { NotificationEventKey, Prisma } from '@prisma/client'

import {
  createProNotification,
  type ProNotificationCreateResult,
} from './proNotifications'
import { resolveUserActorPublicName } from './social/resolveActorPublicName'

export type LookFollowerNewNotificationData = {
  followerUserId: string
}

export type CreateLookFollowerNewProNotificationArgs = {
  professionalId: string
  followerUserId: string
  tx?: Prisma.TransactionClient
}

function normRequired(value: string, field: string): string {
  const trimmed = value.trim()

  if (!trimmed) {
    throw new Error(`createLookFollowerNewProNotification: missing ${field}`)
  }

  return trimmed
}

// Deduped per follower so a follow → unfollow → re-follow refreshes one inbox
// row instead of stacking duplicates (and does not re-notify on the refresh).
export function buildLookFollowerNewProNotificationDedupeKey(
  followerUserId: string,
): string {
  return `look-follower:${normRequired(followerUserId, 'followerUserId')}`
}

export async function createLookFollowerNewProNotification(
  args: CreateLookFollowerNewProNotificationArgs,
): Promise<ProNotificationCreateResult> {
  const professionalId = normRequired(args.professionalId, 'professionalId')
  const followerUserId = normRequired(args.followerUserId, 'followerUserId')

  const data: LookFollowerNewNotificationData = {
    followerUserId,
  }

  // Personalize with the follower's PUBLIC name (§12 NC1 #33) — a pro's opted-in
  // display name, or a client's public @handle. Never a legal name: a private /
  // no-handle follower falls back to the name-free copy.
  const followerName = await resolveUserActorPublicName(followerUserId, args.tx)

  return createProNotification({
    professionalId,
    eventKey: NotificationEventKey.LOOK_FOLLOWER_NEW,
    title: followerName
      ? `${followerName} started following you`
      : 'Someone started following you',
    href: '/pro/profile/public-profile',
    dedupeKey: buildLookFollowerNewProNotificationDedupeKey(followerUserId),
    data,
    actorUserId: followerUserId,
    tx: args.tx,
  })
}
