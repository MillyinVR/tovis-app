import { NotificationEventKey, Prisma } from '@prisma/client'

import { createClientNotification } from './clientNotifications'
import { createProNotification } from './proNotifications'
import {
  isLookAuthorIdentity,
  lookAuthorRecipient,
  type LookAuthorRef,
  type LookPartyIdentity,
} from './lookParty'

/**
 * Batched social notifications for Looks engagement (social-first plan A2):
 *  - LOOK_LIKED → the look's author (pro, or client author)
 *  - LOOK_SAVED → the look's author
 *
 * These are high-volume events, so there is ONE inbox row per look per UTC day
 * instead of one per action: the dedupeKey carries the day window, and the
 * create-notification helpers' dedupe contract turns every subsequent action
 * into a refresh of that row — updated count in the title/data, unread state
 * reset, no second delivery cycle. Titles are name-free (the count IS the
 * message); the latest actor rides along by id only so surfaces can resolve a
 * public identity at render time when the count is 1.
 */

export type LookEngagementKind = 'liked' | 'saved'

export type LookEngagementNotificationData = {
  lookPostId: string
  /** Running total at emit time (likeCount for liked, saveCount for saved). */
  count: number
  actorUserId: string
  /** The latest actor's client profile id, when they have one — lets the
   * activity feed name a single actor at render time. */
  actorClientId?: string
}

export type NotifyLookEngagementArgs = {
  lookPostId: string
  look: LookAuthorRef
  actor: LookPartyIdentity
  /** Current total (likeCount / saveCount) as recomputed by the calling route. */
  count: number
  /** Injectable clock for tests; defaults to now. */
  now?: Date
  tx?: Prisma.TransactionClient
}

function normRequired(value: string, field: string): string {
  const trimmed = value.trim()
  if (!trimmed) {
    throw new Error(`lookEngagement notification: missing ${field}`)
  }
  return trimmed
}

function normCount(value: number): number {
  if (!Number.isFinite(value)) return 1
  return Math.max(1, Math.trunc(value))
}

/**
 * One row per look per UTC day. A day bucket (rather than a single unwindowed
 * key) keeps a like months later from refreshing a row buried deep in the
 * inbox — each day's engagement gets a fresh, correctly-ordered row.
 */
export function buildLookEngagementDedupeKey(
  kind: LookEngagementKind,
  lookPostId: string,
  when: Date,
): string {
  const day = when.toISOString().slice(0, 10)
  return `look:${normRequired(lookPostId, 'lookPostId')}:${kind}:${day}`
}

function buildTitle(kind: LookEngagementKind, count: number): string {
  if (kind === 'liked') {
    return count > 1
      ? `${count} people liked your look`
      : 'Someone liked your look'
  }
  return count > 1
    ? `Your look was saved ${count} times`
    : 'Someone saved your look'
}

async function notifyLookEngagement(
  kind: LookEngagementKind,
  args: NotifyLookEngagementArgs,
): Promise<void> {
  // Self-engagement never notifies (liking/saving your own look).
  if (isLookAuthorIdentity(args.actor, args.look)) return

  const lookPostId = normRequired(args.lookPostId, 'lookPostId')
  const actorUserId = normRequired(args.actor.userId, 'actorUserId')
  const actorClientId = args.actor.clientProfileId?.trim() || undefined
  const count = normCount(args.count)
  const now = args.now ?? new Date()

  const data: LookEngagementNotificationData = {
    lookPostId,
    count,
    actorUserId,
    ...(actorClientId ? { actorClientId } : {}),
  }

  const shared = {
    eventKey:
      kind === 'liked'
        ? NotificationEventKey.LOOK_LIKED
        : NotificationEventKey.LOOK_SAVED,
    title: buildTitle(kind, count),
    href: `/looks/${encodeURIComponent(lookPostId)}`,
    dedupeKey: buildLookEngagementDedupeKey(kind, lookPostId, now),
    data,
    tx: args.tx,
  }

  const recipient = lookAuthorRecipient(args.look)

  if (recipient.kind === 'pro') {
    await createProNotification({
      ...shared,
      professionalId: recipient.professionalId,
      actorUserId,
    })
    return
  }

  await createClientNotification({
    ...shared,
    clientId: recipient.clientId,
  })
}

/**
 * "Someone liked your look" / "N people liked your look" → the look's author.
 * Callers invoke this OUTSIDE the like write tx, best-effort.
 */
export async function notifyLookLiked(
  args: NotifyLookEngagementArgs,
): Promise<void> {
  await notifyLookEngagement('liked', args)
}

/**
 * "Someone saved your look" / "Your look was saved N times" → the look's
 * author. Callers invoke this OUTSIDE the save write tx, best-effort.
 */
export async function notifyLookSaved(
  args: NotifyLookEngagementArgs,
): Promise<void> {
  await notifyLookEngagement('saved', args)
}
