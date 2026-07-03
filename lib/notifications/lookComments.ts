import { NotificationEventKey, Prisma } from '@prisma/client'

import { createClientNotification } from './clientNotifications'
import { createProNotification } from './proNotifications'

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
export type LookCommentNotificationRecipient =
  | { kind: 'pro'; professionalId: string }
  | { kind: 'client'; clientId: string }

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

async function createForRecipient(
  eventKey:
    | typeof NotificationEventKey.LOOK_COMMENTED
    | typeof NotificationEventKey.LOOK_COMMENT_REPLIED,
  title: string,
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
    title,
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

/** "New comment on your look" → the look's author. */
export async function createLookCommentedNotification(
  args: CreateLookCommentNotificationArgs,
): Promise<void> {
  await createForRecipient(
    NotificationEventKey.LOOK_COMMENTED,
    'New comment on your look',
    args,
  )
}

/** "New reply to your comment" → the parent comment's author. */
export async function createLookCommentRepliedNotification(
  args: CreateLookCommentNotificationArgs,
): Promise<void> {
  await createForRecipient(
    NotificationEventKey.LOOK_COMMENT_REPLIED,
    'New reply to your comment',
    args,
  )
}

/** A user identity as both inbox routes see it (either profile may be absent). */
export type LookCommentPartyIdentity = {
  userId: string
  clientProfileId: string | null
  professionalProfileId: string | null
}

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

function isLookAuthorIdentity(
  identity: LookCommentPartyIdentity,
  look: NotifyLookCommentCreatedArgs['look'],
): boolean {
  return look.clientAuthorId
    ? identity.clientProfileId === look.clientAuthorId
    : identity.professionalProfileId === look.professionalId
}

/** Routes a party to whichever inbox it can receive (pro-first). */
function toRecipient(
  identity: LookCommentPartyIdentity,
): LookCommentNotificationRecipient | null {
  if (identity.professionalProfileId) {
    return { kind: 'pro', professionalId: identity.professionalProfileId }
  }
  if (identity.clientProfileId) {
    return { kind: 'client', clientId: identity.clientProfileId }
  }
  return null
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
  const shared = {
    lookPostId: args.lookPostId,
    commentId: args.comment.id,
    commentBody: args.comment.body,
    actorUserId: args.actor.userId,
    actorClientId: args.actor.clientProfileId,
    tx: args.tx,
  }

  let parentNotifiedIsLookAuthor = false

  if (args.parent && args.parent.userId !== args.actor.userId) {
    const parentRecipient = toRecipient(args.parent)
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
      recipient: args.look.clientAuthorId
        ? { kind: 'client', clientId: args.look.clientAuthorId }
        : { kind: 'pro', professionalId: args.look.professionalId },
    })
  }
}
