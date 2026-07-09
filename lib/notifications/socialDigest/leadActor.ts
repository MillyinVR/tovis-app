// lib/notifications/socialDigest/leadActor.ts
//
// PURE helpers for the digest's "lead actor" headline (§12 NC1 #35). The weekly
// social digest headline leads with the newest person who ENGAGED WITH THE
// RECIPIENT'S LOOKS — likes, saves, and comments — resolved to their public
// name. Follows / new-look-from-pro / milestones are intentionally excluded:
// the headline copy is specifically about looks engagement, and those events
// either aren't an engagement with the recipient's own looks (follows) or have
// no single actor (milestones).
//
// Each engagement notification stores the latest actor's User id on its
// structured `data` payload (see lookEngagement.ts / lookComments.ts). This
// module extracts that id; name resolution happens in the orchestrator (which
// has a db) via `resolveUserPublicNames`.
import { NotificationEventKey, Prisma } from '@prisma/client'

/** Digest events that count as "engaged with your looks" for the lead actor. */
export const DIGEST_ENGAGEMENT_LEAD_EVENT_KEYS: ReadonlySet<NotificationEventKey> =
  new Set([
    NotificationEventKey.LOOK_LIKED,
    NotificationEventKey.LOOK_SAVED,
    NotificationEventKey.LOOK_COMMENTED,
    NotificationEventKey.LOOK_COMMENT_REPLIED,
  ])

function asJsonRecord(
  value: Prisma.JsonValue | null | undefined,
): Prisma.JsonObject | null {
  if (value === null || value === undefined) return null
  if (typeof value !== 'object' || Array.isArray(value)) return null
  return value
}

/**
 * The engagement actor's User id for a digest row, or `null` when the row is
 * not a looks-engagement event or carries no actor id. Pure — safe on any
 * shape (defends against legacy rows with a missing/odd `data` payload).
 */
export function extractEngagementActorUserId(
  eventKey: NotificationEventKey,
  data: Prisma.JsonValue | null | undefined,
): string | null {
  if (!DIGEST_ENGAGEMENT_LEAD_EVENT_KEYS.has(eventKey)) return null

  const record = asJsonRecord(data)
  const actorUserId = record?.actorUserId
  return typeof actorUserId === 'string' && actorUserId.trim().length > 0
    ? actorUserId.trim()
    : null
}
