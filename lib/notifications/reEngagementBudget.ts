// lib/notifications/reEngagementBudget.ts
//
// §8.1 Notification Budget — the shared, pooled weekly cap that governs every
// re-engagement trigger the personalization spec sanctions (spec §8.1). These
// triggers are individually honest — an event countdown, an opening on a saved
// pro, a rebook-cadence nudge, a board that just passed its date — but in
// AGGREGATE they can become spam and burn every "knows me" gain. So they share
// ONE budget:
//
//   - Hard cap: max RE_ENGAGEMENT_WEEKLY_CAP notifications per user per rolling
//     week, ALL trigger types pooled.
//   - Priority when competing: event-date countdowns > availability-opened-on-a
//     -save > rebook cadence > everything else (board archive, generic). When
//     more than one trigger wants the last slot in a window, the higher-priority
//     one wins.
//   - Per-trigger-type mute: each trigger is its own NotificationEventKey, so the
//     existing per-(client,eventKey) preference row already gives a one-tap mute
//     (see preferenceCategories.ts). No new mute storage needed.
//
// This module is PURE (no db, no clock beyond injected values): the taxonomy,
// the priority ladder, and the cap arithmetic. The pooled "how many did we send
// this week" count is read from the durable NotificationDispatch ledger by the
// consumer (savedLookActivation.ts) and passed in — there is no separate budget
// table. Each live trigger's emitter calls resolveReEngagementBudget before it
// enqueues; a candidate that loses the budget is simply not sent this run and is
// reconsidered next run (the triggers are recurring scans, not one-shot events).

import { NotificationEventKey } from '@prisma/client'

/**
 * The re-engagement trigger family (spec §8.1). Each value is a *class* of
 * honest re-engagement nudge that draws from the shared weekly budget. The
 * priority order below is the spec's tie-break "when competing".
 *
 * Only the triggers with a live emitter are mapped from a NotificationEventKey
 * in RE_ENGAGEMENT_EVENT_KEY_TRIGGER below; the rest are declared here so the
 * budget policy (and its tests) is complete and ready the moment their emitters
 * land (§6.7 rebook cadence, §8 event countdowns, §7.5 board archive).
 */
export type ReEngagementTrigger =
  | 'EVENT_COUNTDOWN' // §8    — "18 days until prom — here's who still has openings"
  | 'AVAILABILITY_OPENED_ON_SAVE' // §6.8/§5.7.5 — a saved pro just opened up
  | 'REBOOK_CADENCE' // §6.7   — cadence-timed "time for a refresh?"
  | 'BOARD_ARCHIVE' // §7.5   — "how did it go? leave a review?"
  | 'OTHER' // catch-all for future low-priority re-engagement nudges

/**
 * Priority rank — LOWER number = higher priority (wins the last budget slot).
 * Exactly the spec §8.1 ordering:
 *   event-date countdowns > availability-opened-on-a-save > rebook cadence >
 *   everything else.
 */
export const RE_ENGAGEMENT_TRIGGER_PRIORITY: Record<ReEngagementTrigger, number> =
  {
    EVENT_COUNTDOWN: 0,
    AVAILABILITY_OPENED_ON_SAVE: 1,
    REBOOK_CADENCE: 2,
    BOARD_ARCHIVE: 3,
    OTHER: 4,
  }

/**
 * Map from a live NotificationEventKey to the budget trigger it draws from.
 * A key present here is a "re-engagement" notification: it both counts against
 * the pooled weekly budget AND is gated by it before send.
 *
 * Only keys with a shipped emitter appear. The event-countdown / rebook-cadence
 * / board-archive keys are intentionally absent until their emitters land — the
 * budget still reserves their priority tiers above, so when they ship they slot
 * in without recalibrating the cap.
 */
export const RE_ENGAGEMENT_EVENT_KEY_TRIGGER: Partial<
  Record<NotificationEventKey, ReEngagementTrigger>
> = {
  [NotificationEventKey.SAVED_LOOK_AVAILABILITY_OPENED]:
    'AVAILABILITY_OPENED_ON_SAVE',
}

/**
 * The NotificationEventKeys that count toward the pooled budget — i.e. the keys
 * the ledger query filters on when counting a user's recent re-engagement sends.
 */
export const RE_ENGAGEMENT_EVENT_KEYS: readonly NotificationEventKey[] =
  Object.keys(RE_ENGAGEMENT_EVENT_KEY_TRIGGER) as NotificationEventKey[]

/** Hard cap: notifications per user per rolling window, all triggers pooled. */
export const RE_ENGAGEMENT_WEEKLY_CAP = 3

/** The rolling budget window (spec: "per week"). */
export const RE_ENGAGEMENT_BUDGET_WINDOW_DAYS = 7

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Whether a NotificationEventKey is a budgeted re-engagement trigger. Non
 * re-engagement events (bookings, payments, messages, social) are never counted
 * or gated — they are transactional and not subject to the re-engagement budget.
 */
export function isReEngagementEventKey(key: NotificationEventKey): boolean {
  return Object.prototype.hasOwnProperty.call(
    RE_ENGAGEMENT_EVENT_KEY_TRIGGER,
    key,
  )
}

/** The budget trigger for a key, or null when the key is not re-engagement. */
export function reEngagementTriggerForEventKey(
  key: NotificationEventKey,
): ReEngagementTrigger | null {
  return RE_ENGAGEMENT_EVENT_KEY_TRIGGER[key] ?? null
}

/** The trailing-window cutoff instant for the budget count (now − windowDays). */
export function reEngagementBudgetWindowStart(
  now: Date,
  windowDays: number = RE_ENGAGEMENT_BUDGET_WINDOW_DAYS,
): Date {
  return new Date(now.getTime() - windowDays * DAY_MS)
}

export type ReEngagementBudgetDecision = {
  /** True when this send fits under the cap. */
  allowed: boolean
  /** Slots left AFTER this send would be counted (never negative). */
  remaining: number
  /** The cap in force for this decision. */
  cap: number
  /** Why it was blocked, for logging (null when allowed). */
  reason: 'AT_CAP' | null
}

/**
 * The core budget arithmetic (pure). Given how many re-engagement notifications
 * the user has already been sent inside the rolling window (`recentSendCount`,
 * pooled across ALL trigger types), decide whether one more send fits.
 *
 * Priority does not enter here — the cap is priority-blind. Priority governs
 * WHICH candidate is offered to the budget when several compete for the same
 * user in one run (see pickHighestPriorityCandidate / sortByTriggerPriority);
 * the winner is the one that gets to spend the slot.
 */
export function resolveReEngagementBudget(args: {
  recentSendCount: number
  cap?: number
}): ReEngagementBudgetDecision {
  const cap = args.cap ?? RE_ENGAGEMENT_WEEKLY_CAP
  const sent = Math.max(0, Math.trunc(args.recentSendCount))

  const allowed = sent < cap
  const remaining = Math.max(0, cap - sent - (allowed ? 1 : 0))

  return {
    allowed,
    remaining,
    cap,
    reason: allowed ? null : 'AT_CAP',
  }
}

/**
 * Sort re-engagement candidates by priority (highest first) so a scan that
 * surfaces several triggers for one user spends the pooled slots on the most
 * important ones. Stable within a tier — callers pre-sort each tier by their own
 * secondary key (e.g. soonest opening) before calling.
 */
export function sortByTriggerPriority<T extends { trigger: ReEngagementTrigger }>(
  candidates: readonly T[],
): T[] {
  return [...candidates].sort(
    (a, b) =>
      RE_ENGAGEMENT_TRIGGER_PRIORITY[a.trigger] -
      RE_ENGAGEMENT_TRIGGER_PRIORITY[b.trigger],
  )
}

/**
 * Pick the single highest-priority candidate (the spec's "priority when
 * competing"). Returns null for an empty list. Ties resolve to the first in
 * input order, so callers control the secondary tie-break by pre-ordering.
 */
export function pickHighestPriorityCandidate<
  T extends { trigger: ReEngagementTrigger },
>(candidates: readonly T[]): T | null {
  return sortByTriggerPriority(candidates)[0] ?? null
}

/**
 * Spend a fixed pooled budget across a priority-ordered candidate list for ONE
 * user. Returns the candidates that fit under the cap (highest priority first),
 * dropping the rest. `alreadySent` is the user's pooled re-engagement count
 * already in the window before this run.
 *
 * This is the in-run allocator the availability-opened scan uses when a single
 * user has more than one qualifying candidate: it honors both the pooled cap and
 * the priority order, and never lets a low-priority nudge crowd out a slot.
 */
export function allocateBudgetToCandidates<
  T extends { trigger: ReEngagementTrigger },
>(args: {
  candidates: readonly T[]
  alreadySent: number
  cap?: number
}): { granted: T[]; denied: T[] } {
  const cap = args.cap ?? RE_ENGAGEMENT_WEEKLY_CAP
  const ordered = sortByTriggerPriority(args.candidates)

  const granted: T[] = []
  const denied: T[] = []
  let sent = Math.max(0, Math.trunc(args.alreadySent))

  for (const candidate of ordered) {
    if (sent < cap) {
      granted.push(candidate)
      sent += 1
    } else {
      denied.push(candidate)
    }
  }

  return { granted, denied }
}
