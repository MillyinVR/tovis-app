import { NotificationEventKey, Prisma } from '@prisma/client'

import {
  createProNotification,
  type ProNotificationCreateResult,
} from './proNotifications'

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

  // Title is intentionally name-free: pro notifications don't embed client PII
  // (matches the "New booking request" pattern). The actor id is captured for
  // attribution; the pro can see who via their followers list.
  return createProNotification({
    professionalId,
    eventKey: NotificationEventKey.LOOK_FOLLOWER_NEW,
    title: 'You have a new follower',
    href: '/pro/profile/public-profile',
    dedupeKey: buildLookFollowerNewProNotificationDedupeKey(followerUserId),
    data,
    actorUserId: followerUserId,
    tx: args.tx,
  })
}
