import { NotificationEventKey, Prisma } from '@prisma/client'

import { normalizeRequiredId } from '@/lib/guards'
import { createClientNotification } from './clientNotifications'
import { createProNotification } from './proNotifications'
import { lookAuthorRecipient, type LookAuthorRef } from './lookParty'

/**
 * Milestone nudges for Looks (social-first plan C2): "Your look hit 50 likes" /
 * "Your look hit 10 saves" → the look's author (pro, or client author). These
 * double as supply-side posting nudges — the "your content is performing, post
 * more" signal.
 *
 * Each threshold fires exactly once per look via a permanent (unwindowed)
 * dedupeKey — `look:<id>:milestone:<metric>:<threshold>`. Detection is a RANGE
 * crossing (`previous < T <= current`), never equality: the like/save counts are
 * recomputed by full re-count and can jump under concurrency, so a milestone can
 * be reached without the count ever equalling the threshold exactly. Only upward
 * crossings emit (an unlike/unsave that drops back below a threshold never
 * re-notifies, and re-crossing later is suppressed by the permanent dedupeKey).
 */

export type LookMilestoneMetric = 'likes' | 'saves'

export const LOOK_LIKE_MILESTONES: readonly number[] = [10, 50, 100]
export const LOOK_SAVE_MILESTONES: readonly number[] = [10, 50]

export function milestonesForMetric(
  metric: LookMilestoneMetric,
): readonly number[] {
  return metric === 'likes' ? LOOK_LIKE_MILESTONES : LOOK_SAVE_MILESTONES
}

/**
 * The thresholds crossed by moving a count from `previous` to `current`. Upward
 * only; returns them in ascending order. Pure — unit-tested directly.
 */
export function crossedLookMilestones(
  previous: number,
  current: number,
  thresholds: readonly number[],
): number[] {
  if (!Number.isFinite(previous) || !Number.isFinite(current)) return []
  if (current <= previous) return []
  return thresholds.filter(
    (threshold) => previous < threshold && threshold <= current,
  )
}

export function buildLookMilestoneDedupeKey(
  metric: LookMilestoneMetric,
  lookPostId: string,
  threshold: number,
): string {
  return `look:${normalizeRequiredId('lookPostId', lookPostId)}:milestone:${metric}:${threshold}`
}

function buildTitle(metric: LookMilestoneMetric, threshold: number): string {
  return metric === 'likes'
    ? `Your look hit ${threshold} likes`
    : `Your look hit ${threshold} saves`
}

export type LookMilestoneNotificationData = {
  lookPostId: string
  metric: LookMilestoneMetric
  threshold: number
  /** The count at the moment the milestone was crossed. */
  count: number
}

export type NotifyLookMilestonesArgs = {
  lookPostId: string
  look: LookAuthorRef
  metric: LookMilestoneMetric
  /** Count before the mutation that may have crossed a threshold. */
  previous: number
  /** Count after the mutation (as recomputed by the calling route). */
  current: number
  tx?: Prisma.TransactionClient
}

/**
 * Emit a milestone notification for each like/save threshold newly crossed. A
 * no-op when no threshold was crossed. Callers invoke this OUTSIDE the mutation
 * tx, best-effort (a notify failure must never fail the request).
 */
export async function notifyLookMilestones(
  args: NotifyLookMilestonesArgs,
): Promise<void> {
  const lookPostId = normalizeRequiredId('lookPostId', args.lookPostId)
  const thresholds = milestonesForMetric(args.metric)
  const crossed = crossedLookMilestones(args.previous, args.current, thresholds)
  if (crossed.length === 0) return

  const recipient = lookAuthorRecipient(args.look)
  const href = `/looks/${encodeURIComponent(lookPostId)}`

  for (const threshold of crossed) {
    const data: LookMilestoneNotificationData = {
      lookPostId,
      metric: args.metric,
      threshold,
      count: Math.max(threshold, Math.trunc(args.current)),
    }

    const shared = {
      eventKey: NotificationEventKey.LOOK_MILESTONE_REACHED,
      title: buildTitle(args.metric, threshold),
      href,
      dedupeKey: buildLookMilestoneDedupeKey(args.metric, lookPostId, threshold),
      data,
      tx: args.tx,
    }

    if (recipient.kind === 'pro') {
      await createProNotification({
        ...shared,
        professionalId: recipient.professionalId,
      })
    } else {
      await createClientNotification({
        ...shared,
        clientId: recipient.clientId,
      })
    }
  }
}
