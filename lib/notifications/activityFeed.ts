// lib/notifications/activityFeed.ts
//
// The client "Activity" feed — the creator-engagement surface (distinct from
// the transactional booking inbox). It reads ClientNotification rows filtered
// to an ENGAGEMENT-event allowlist (the SSOT below) and shapes them into
// presentation items. Follower identity is resolved live from ClientProfile at
// render time (never a denormalized snapshot) so handles/visibility stay
// authoritative and strangers are never shown legal names.
import { NotificationEventKey, Prisma, PrismaClient } from '@prisma/client'

import { normalizeRequiredId } from '@/lib/guards'

type ActivityDb = PrismaClient | Prisma.TransactionClient

/**
 * SSOT: which notification events belong on the activity feed. Booking/payment/
 * referral notifications are intentionally excluded — those live in the inbox.
 * New engagement events (saves, remixes, featured) are added here as they ship.
 */
export const ACTIVITY_FEED_EVENT_KEYS: readonly NotificationEventKey[] = [
  NotificationEventKey.CLIENT_FOLLOW,
  NotificationEventKey.LOOK_COMMENTED,
  NotificationEventKey.LOOK_COMMENT_REPLIED,
]

export type ActivityIconKind =
  | 'follow'
  | 'comment'
  | 'save'
  | 'remix'
  | 'featured'
  | 'milestone'

export type ActivityFollowBack = {
  /** The follower's public handle — addresses /u/[handle] + the follow toggle. */
  handle: string
  /** Whether the viewer already follows this follower back. */
  alreadyFollowing: boolean
}

export type ClientActivityItem = {
  id: string
  iconKind: ActivityIconKind
  who: string
  action: string
  highlight: string | null
  /** ISO timestamp; the client formats it relative. */
  timestamp: string
  unread: boolean
  /** Where the row (and any "View" CTA) links, when applicable. */
  href: string | null
  /** Present for a follow item whose follower is publicly addressable. */
  followBack: ActivityFollowBack | null
}

export type ClientActivityFeed = {
  items: ClientActivityItem[]
  unreadCount: number
}

const DEFAULT_TAKE = 30
const MAX_TAKE = 50

function normalizeTake(value: number | null | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_TAKE
  return Math.min(Math.max(Math.trunc(value), 1), MAX_TAKE)
}

const activityNotificationSelect =
  Prisma.validator<Prisma.ClientNotificationSelect>()({
    id: true,
    eventKey: true,
    data: true,
    // Comment rows carry the (public) comment snippet as the body and the look
    // permalink as the href.
    body: true,
    href: true,
    readAt: true,
    createdAt: true,
  })

type ActivityNotificationRow = Prisma.ClientNotificationGetPayload<{
  select: typeof activityNotificationSelect
}>

const activityFollowerSelect = Prisma.validator<Prisma.ClientProfileSelect>()({
  id: true,
  handle: true,
  isPublicProfile: true,
})

type ActivityFollowerRow = Prisma.ClientProfileGetPayload<{
  select: typeof activityFollowerSelect
}>

/** Safely reads a string field out of a notification's JSON data. */
function readDataString(
  data: Prisma.JsonValue | null,
  field: string,
): string | null {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return null
  }
  const value = data[field]
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

/** Safely reads `followerClientId` out of a CLIENT_FOLLOW notification's JSON. */
function readFollowerClientId(data: Prisma.JsonValue | null): string | null {
  return readDataString(data, 'followerClientId')
}

/** Reads the commenter's client id out of a comment notification's JSON. */
function readActorClientId(data: Prisma.JsonValue | null): string | null {
  return readDataString(data, 'actorClientId')
}

function buildFollowItem(
  row: ActivityNotificationRow,
  ctx: {
    followers: Map<string, ActivityFollowerRow>
    followingBackIds: Set<string>
  },
): ClientActivityItem {
  const followerClientId = readFollowerClientId(row.data)
  const follower = followerClientId
    ? (ctx.followers.get(followerClientId) ?? null)
    : null

  // Only publicly-addressable followers are named/linked; otherwise the row is
  // PII-safe and generic (no legal names, no link to a private account).
  const isPublic = Boolean(follower?.isPublicProfile && follower?.handle)
  const handle = isPublic ? (follower?.handle ?? null) : null

  return {
    id: row.id,
    iconKind: 'follow',
    who: handle ? `@${handle}` : 'Someone',
    action: 'started following you',
    highlight: null,
    timestamp: row.createdAt.toISOString(),
    unread: row.readAt === null,
    href: handle ? `/u/${encodeURIComponent(handle)}` : null,
    followBack:
      handle && follower
        ? {
            handle,
            alreadyFollowing: ctx.followingBackIds.has(follower.id),
          }
        : null,
  }
}

function buildCommentItem(
  row: ActivityNotificationRow,
  ctx: {
    followers: Map<string, ActivityFollowerRow>
  },
): ClientActivityItem {
  const actorClientId = readActorClientId(row.data)
  const actor = actorClientId ? (ctx.followers.get(actorClientId) ?? null) : null

  // Same PII rule as follows: only publicly-addressable commenters are named —
  // everyone else renders as a generic actor.
  const isPublic = Boolean(actor?.isPublicProfile && actor?.handle)
  const handle = isPublic ? (actor?.handle ?? null) : null

  const isReply = row.eventKey === NotificationEventKey.LOOK_COMMENT_REPLIED
  const body = row.body?.trim() ?? ''

  return {
    id: row.id,
    iconKind: 'comment',
    who: handle ? `@${handle}` : 'Someone',
    action: isReply ? 'replied to your comment' : 'commented on your look',
    highlight: body ? `“${body}”` : null,
    timestamp: row.createdAt.toISOString(),
    unread: row.readAt === null,
    href: row.href ?? null,
    followBack: null,
  }
}

function buildActivityItem(
  row: ActivityNotificationRow,
  ctx: {
    followers: Map<string, ActivityFollowerRow>
    followingBackIds: Set<string>
  },
): ClientActivityItem | null {
  switch (row.eventKey) {
    case NotificationEventKey.CLIENT_FOLLOW:
      return buildFollowItem(row, ctx)
    case NotificationEventKey.LOOK_COMMENTED:
    case NotificationEventKey.LOOK_COMMENT_REPLIED:
      return buildCommentItem(row, ctx)
    default:
      // Not an event the feed knows how to present yet — skip it rather than
      // render a half-blank row. (The allowlist already filters the query.)
      return null
  }
}

/** Counts unread activity-feed notifications — reused by the Me-page badge. */
export async function countUnreadClientActivity(
  db: ActivityDb,
  clientId: string,
): Promise<number> {
  return db.clientNotification.count({
    where: {
      clientId: normalizeRequiredId('clientId', clientId),
      readAt: null,
      eventKey: { in: [...ACTIVITY_FEED_EVENT_KEYS] },
    },
  })
}

/**
 * Loads the activity feed for a client: the most recent engagement events plus
 * the unread count. Resolves follower handles/visibility and the viewer's
 * follow-back state in two batched queries (no N+1).
 */
export async function listClientActivity(
  db: ActivityDb,
  args: { clientId: string; take?: number },
): Promise<ClientActivityFeed> {
  const clientId = normalizeRequiredId('clientId', args.clientId)
  const take = normalizeTake(args.take)

  const [rows, unreadCount] = await Promise.all([
    db.clientNotification.findMany({
      where: {
        clientId,
        eventKey: { in: [...ACTIVITY_FEED_EVENT_KEYS] },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take,
      select: activityNotificationSelect,
    }),
    countUnreadClientActivity(db, clientId),
  ])

  // Collect the client ids referenced by rows (followers, comment actors) so
  // handles/visibility resolve in one batch.
  const followerIds = new Set<string>()
  for (const row of rows) {
    if (row.eventKey === NotificationEventKey.CLIENT_FOLLOW) {
      const followerClientId = readFollowerClientId(row.data)
      if (followerClientId) followerIds.add(followerClientId)
      continue
    }
    const actorClientId = readActorClientId(row.data)
    if (actorClientId) followerIds.add(actorClientId)
  }

  const followers = new Map<string, ActivityFollowerRow>()
  const followingBackIds = new Set<string>()

  if (followerIds.size > 0) {
    const ids = [...followerIds]
    const [profiles, followingBack] = await Promise.all([
      db.clientProfile.findMany({
        where: { id: { in: ids } },
        select: activityFollowerSelect,
      }),
      // Which of these followers does the viewer already follow back?
      db.clientFollow.findMany({
        where: {
          followerClientId: clientId,
          followedClientId: { in: ids },
        },
        select: { followedClientId: true },
      }),
    ])

    for (const profile of profiles) followers.set(profile.id, profile)
    for (const edge of followingBack) followingBackIds.add(edge.followedClientId)
  }

  const items: ClientActivityItem[] = []
  for (const row of rows) {
    const item = buildActivityItem(row, { followers, followingBackIds })
    if (item) items.push(item)
  }

  return { items, unreadCount }
}
