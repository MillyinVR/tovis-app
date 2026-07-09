import { NotificationEventKey, Prisma } from '@prisma/client'

import { createClientNotification } from './clientNotifications'
import { createProNotification } from './proNotifications'
import {
  isLookAuthorIdentity,
  lookAuthorRecipient,
  toLookNotificationRecipient,
  type LookNotificationRecipient,
  type LookPartyIdentity,
} from './lookParty'
import { resolveLookActorPublicName } from './social/resolveActorPublicName'

/**
 * Social notifications for Looks comments (social-first plan A1):
 *  - LOOK_COMMENTED       → the look's author (pro, or client author)
 *  - LOOK_COMMENT_REPLIED → the parent comment's author (pro or client)
 *
 * Titles are intentionally name-free (matches LOOK_FOLLOWER_NEW /
 * CLIENT_FOLLOW): the actor is captured by id only and surfaces resolve a
 * public identity at render time. The comment text itself is public content on
 * the look, so a short snippet rides along as the body.
 */

const MAX_SNIPPET = 140

/** Whichever identity should receive the notification (pro or client inbox). */
export type LookCommentNotificationRecipient = LookNotificationRecipient

export type LookCommentNotificationData = {
  lookPostId: string
  commentId: string
  actorUserId: string
  /** The commenter's client profile id, when they have one — lets the client
   * activity feed resolve a public handle at render time. */
  actorClientId?: string
}

export type CreateLookCommentNotificationArgs = {
  recipient: LookCommentNotificationRecipient
  lookPostId: string
  commentId: string
  commentBody: string
  actorUserId: string
  actorClientId?: string | null
  /** The commenter's resolved PUBLIC name (§12 NC1 #30/#31), or null → the
   * name-free title. Resolved once in notifyLookCommentCreated. */
  actorName?: string | null
  tx?: Prisma.TransactionClient
}

function normRequired(value: string, field: string): string {
  const trimmed = value.trim()
  if (!trimmed) {
    throw new Error(`lookComments notification: missing ${field}`)
  }
  return trimmed
}

/** Collapses whitespace and truncates the (public) comment text for the body. */
function toSnippet(body: string): string {
  const collapsed = body.replace(/\s+/g, ' ').trim()
  if (collapsed.length <= MAX_SNIPPET) return collapsed
  return `${collapsed.slice(0, MAX_SNIPPET - 1).trimEnd()}…`
}

// Deduped per comment: each comment notifies once, and a retried request
// refreshes the same inbox row instead of stacking duplicates.
export function buildLookCommentNotificationDedupeKey(
  eventKey:
    | typeof NotificationEventKey.LOOK_COMMENTED
    | typeof NotificationEventKey.LOOK_COMMENT_REPLIED,
  commentId: string,
): string {
  const prefix =
    eventKey === NotificationEventKey.LOOK_COMMENTED
      ? 'look-comment'
      : 'look-comment-reply'
  return `${prefix}:${normRequired(commentId, 'commentId')}`
}

function buildCommentTitle(
  eventKey:
    | typeof NotificationEventKey.LOOK_COMMENTED
    | typeof NotificationEventKey.LOOK_COMMENT_REPLIED,
  actorName: string | null,
): string {
  const isReply = eventKey === NotificationEventKey.LOOK_COMMENT_REPLIED
  if (actorName) {
    return isReply ? `${actorName} replied` : `${actorName} commented`
  }
  return isReply ? 'New reply to your comment' : 'New comment on your look'
}

async function createForRecipient(
  eventKey:
    | typeof NotificationEventKey.LOOK_COMMENTED
    | typeof NotificationEventKey.LOOK_COMMENT_REPLIED,
  args: CreateLookCommentNotificationArgs,
): Promise<void> {
  const lookPostId = normRequired(args.lookPostId, 'lookPostId')
  const commentId = normRequired(args.commentId, 'commentId')
  const actorUserId = normRequired(args.actorUserId, 'actorUserId')
  const actorClientId = args.actorClientId?.trim() || undefined

  const data: LookCommentNotificationData = {
    lookPostId,
    commentId,
    actorUserId,
    ...(actorClientId ? { actorClientId } : {}),
  }

  const shared = {
    eventKey,
    title: buildCommentTitle(eventKey, args.actorName?.trim() || null),
    body: toSnippet(args.commentBody),
    href: `/looks/${encodeURIComponent(lookPostId)}`,
    dedupeKey: buildLookCommentNotificationDedupeKey(eventKey, commentId),
    data,
    tx: args.tx,
  }

  if (args.recipient.kind === 'pro') {
    await createProNotification({
      ...shared,
      professionalId: normRequired(args.recipient.professionalId, 'professionalId'),
      actorUserId,
    })
    return
  }

  await createClientNotification({
    ...shared,
    clientId: normRequired(args.recipient.clientId, 'clientId'),
  })
}

/** "{name} commented" / "New comment on your look" → the look's author. */
export async function createLookCommentedNotification(
  args: CreateLookCommentNotificationArgs,
): Promise<void> {
  await createForRecipient(NotificationEventKey.LOOK_COMMENTED, args)
}

/** "{name} replied" / "New reply to your comment" → the parent comment's author. */
export async function createLookCommentRepliedNotification(
  args: CreateLookCommentNotificationArgs,
): Promise<void> {
  await createForRecipient(NotificationEventKey.LOOK_COMMENT_REPLIED, args)
}

/** A user identity as both inbox routes see it (either profile may be absent). */
export type LookCommentPartyIdentity = LookPartyIdentity

export type NotifyLookCommentCreatedArgs = {
  lookPostId: string
  look: {
    professionalId: string
    /** Set for client-shared looks — the client, not the pro, is the author. */
    clientAuthorId: string | null
  }
  comment: {
    id: string
    body: string
  }
  /** The comment being replied to (the one the commenter targeted), if any. */
  parent: LookCommentPartyIdentity | null
  actor: LookCommentPartyIdentity
  tx?: Prisma.TransactionClient
}

/**
 * Emits the notifications one new comment produces:
 *  - a reply → LOOK_COMMENT_REPLIED to the parent comment's author (skip self)
 *  - every comment → LOOK_COMMENTED to the look's author (skip self, and skip
 *    when the parent author IS the look author — one action, one notification)
 *
 * Callers invoke this OUTSIDE the comment write tx, best-effort: the comment is
 * already committed, so a notify failure must never fail the request.
 */
export async function notifyLookCommentCreated(
  args: NotifyLookCommentCreatedArgs,
): Promise<void> {
  const actorName = await resolveLookActorPublicName(args.actor, args.tx)

  const shared = {
    lookPostId: args.lookPostId,
    commentId: args.comment.id,
    commentBody: args.comment.body,
    actorUserId: args.actor.userId,
    actorClientId: args.actor.clientProfileId,
    actorName,
    tx: args.tx,
  }

  let parentNotifiedIsLookAuthor = false

  if (args.parent && args.parent.userId !== args.actor.userId) {
    const parentRecipient = toLookNotificationRecipient(args.parent)
    if (parentRecipient) {
      await createLookCommentRepliedNotification({
        ...shared,
        recipient: parentRecipient,
      })
      parentNotifiedIsLookAuthor = isLookAuthorIdentity(args.parent, args.look)
    }
  }

  const actorIsLookAuthor = isLookAuthorIdentity(args.actor, args.look)

  if (!actorIsLookAuthor && !parentNotifiedIsLookAuthor) {
    await createLookCommentedNotification({
      ...shared,
      recipient: lookAuthorRecipient(args.look),
    })
  }
}
