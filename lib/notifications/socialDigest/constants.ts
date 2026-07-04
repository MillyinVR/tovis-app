// lib/notifications/socialDigest/constants.ts
//
// Shared constants for the weekly social digest email (social-first C3). The
// digest batches each recipient's UNREAD social notifications — the exact
// engagement set the in-app activity feed shows — into one Postmark email so a
// quiet inbox still pulls people back to scroll.
import { NotificationEventKey } from '@prisma/client'

import { ACTIVITY_FEED_EVENT_KEYS } from '@/lib/notifications/activityFeed'

/**
 * SSOT for which events the digest batches. Deliberately the SAME allowlist the
 * activity feed reads (`ACTIVITY_FEED_EVENT_KEYS`) — the digest is the emailed
 * mirror of that surface, so the two never drift. Booking/payment/referral
 * notifications are transactional and are intentionally excluded.
 */
export const SOCIAL_DIGEST_EVENT_KEYS: readonly NotificationEventKey[] =
  ACTIVITY_FEED_EVENT_KEYS

export type SocialDigestGroupKey =
  | 'likes'
  | 'comments'
  | 'saves'
  | 'followers'
  | 'new-looks'
  | 'milestones'

export type SocialDigestGroupDef = {
  key: SocialDigestGroupKey
  emoji: string
  /** Noun used when the group has exactly one item. */
  singular: string
  /** Noun used when the group has two or more items (count is prefixed). */
  plural: string
  eventKeys: readonly NotificationEventKey[]
}

/**
 * Display grouping for the summary line. Order here is the render order. Each
 * group counts UNREAD notification rows (a batched-like row already means "your
 * look was liked", so a row is the honest unit — we never re-derive people
 * counts from the cumulative `data.count`).
 */
export const SOCIAL_DIGEST_GROUPS: readonly SocialDigestGroupDef[] = [
  {
    key: 'likes',
    emoji: '❤️',
    singular: 'new like',
    plural: 'new likes',
    eventKeys: [NotificationEventKey.LOOK_LIKED],
  },
  {
    key: 'comments',
    emoji: '💬',
    singular: 'new comment',
    plural: 'new comments',
    eventKeys: [
      NotificationEventKey.LOOK_COMMENTED,
      NotificationEventKey.LOOK_COMMENT_REPLIED,
    ],
  },
  {
    key: 'saves',
    emoji: '🔖',
    singular: 'new save',
    plural: 'new saves',
    eventKeys: [NotificationEventKey.LOOK_SAVED],
  },
  {
    key: 'followers',
    emoji: '👤',
    singular: 'new follower',
    plural: 'new followers',
    eventKeys: [NotificationEventKey.CLIENT_FOLLOW],
  },
  {
    key: 'new-looks',
    emoji: '✨',
    singular: 'new look from a pro you follow',
    plural: 'new looks from pros you follow',
    eventKeys: [NotificationEventKey.LOOK_NEW_FROM_FOLLOWED_PRO],
  },
  {
    key: 'milestones',
    emoji: '🎉',
    singular: 'look milestone',
    plural: 'look milestones',
    eventKeys: [NotificationEventKey.LOOK_MILESTONE_REACHED],
  },
]

const GROUP_BY_EVENT_KEY: ReadonlyMap<NotificationEventKey, SocialDigestGroupKey> =
  new Map(
    SOCIAL_DIGEST_GROUPS.flatMap((group) =>
      group.eventKeys.map((eventKey) => [eventKey, group.key] as const),
    ),
  )

/** The display group an event belongs to, or null when it isn't digested. */
export function digestGroupForEventKey(
  eventKey: NotificationEventKey,
): SocialDigestGroupKey | null {
  return GROUP_BY_EVENT_KEY.get(eventKey) ?? null
}

/** Weekly cadence — the digest looks back one window and no further. */
export const DEFAULT_DIGEST_WINDOW_DAYS = 7
export const MIN_DIGEST_WINDOW_DAYS = 1
export const MAX_DIGEST_WINDOW_DAYS = 30

/** How many recipients (per audience) a single run will email. */
export const DEFAULT_DIGEST_MAX_RECIPIENTS = 500
export const MAX_DIGEST_MAX_RECIPIENTS = 5000

/** Unread rows loaded per recipient to build their summary. */
export const MAX_DIGEST_ROWS_PER_RECIPIENT = 100

/** "Top looks this week" tiles + recent-activity lines in the email body. */
export const DEFAULT_DIGEST_TOP_LOOKS = 4
export const MAX_DIGEST_RECENT_ITEMS = 6
