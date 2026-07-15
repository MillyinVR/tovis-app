// lib/notifications/reEngagementDispatcher.ts
//
// §8.1 UNIFIED re-engagement dispatcher — the capstone of the pooled-budget arc.
//
// We ship three honest re-engagement triggers, each as its own daily cron:
//   - §8   event-date countdown        (highest priority)
//   - §6.8 saved-look availability-opened
//   - §6.7 rebook-cadence               (lowest of the three)
//
// They already share ONE weekly budget (RE_ENGAGEMENT_WEEKLY_CAP, counted from the
// NotificationDispatch ledger), but each cron only arbitrates priority WITHIN its
// own scan. Strict CROSS-trigger priority was approximated by CRON ORDERING (the
// countdown cron runs first and claims the budget, then saved-look, then rebook —
// "design decision (a)"). That approximation is fragile: if a client's higher-
// priority countdown becomes eligible AFTER the rebook cron already spent their last
// slot on the same day, cron ordering can't undo it.
//
// This dispatcher removes the approximation. It GATHERS every trigger's candidates
// (reusing each consumer's pure gather* selection), MERGES them per client, and runs
// the priority-aware allocator (allocateBudgetToCandidates) ONCE per user — so the
// spec's ladder (countdown > availability > rebook) is enforced GLOBALLY, in a single
// pass, regardless of the order candidates were "found". The three per-trigger crons
// stay in place but no-op while the ENABLE_UNIFIED_REENGAGEMENT_DISPATCH flag is on
// (reEngagementDispatchFlag.ts), so the cutover is reversible and — because all four
// crons share the same idempotent dedupeKey ledger — never double-sends.
//
// Design: the merge + allocation is PURE (allocateReEngagementDispatch, plain record
// inputs, no Prisma) and unit-tested; the orchestrator (runReEngagementDispatch) maps
// gathered DB rows to those records, runs the pure core, then emits via
// createClientNotification. Idempotent per (trigger, dedupeKey): a re-run refreshes
// nothing new and never double-spends the budget.

import {
  NotificationEventKey,
  type Prisma,
  type PrismaClient,
} from '@prisma/client'

import { createClientNotification } from '@/lib/notifications/clientNotifications'
import {
  EVENT_COUNTDOWN_TRIGGER,
  composeEventCountdownCopy,
  gatherEventCountdownCandidates,
} from '@/lib/notifications/eventCountdownNotifications'
import {
  RE_ENGAGEMENT_TRIGGER_PRIORITY,
  RE_ENGAGEMENT_WEEKLY_CAP,
  type ReEngagementTrigger,
  allocateBudgetToCandidates,
  reEngagementBudgetWindowStart,
} from '@/lib/notifications/reEngagementBudget'
import {
  loadMutedClientsForEvent,
  loadReEngagementBudgetCounts,
} from '@/lib/notifications/reEngagementLedger'
import {
  REBOOK_CADENCE_TRIGGER,
  composeRebookCadenceCopy,
  gatherRebookCadenceCandidates,
} from '@/lib/notifications/rebookCadenceNotifications'
import {
  SAVED_LOOK_ACTIVATION_TRIGGER,
  composeSavedActivationCopy,
  gatherSavedActivationCandidates,
} from '@/lib/notifications/savedLookActivation'

/** The already-composed, white-label-safe notification copy for a candidate. */
export type ReEngagementDispatchCopy = {
  title: string
  body: string
  href: string
  data: Record<string, string>
}

/**
 * A trigger-agnostic emittable candidate: enough for the pooled allocator to order
 * and spend a slot, plus the eventKey + pre-composed copy needed to emit. Each
 * trigger's gather* output is mapped to one of these.
 */
export type ReEngagementDispatchCandidate = {
  clientId: string
  trigger: ReEngagementTrigger
  eventKey: NotificationEventKey
  dedupeKey: string
  /**
   * Within-tier urgency — LOWER wins a scarce pooled slot. Only compared inside a
   * single trigger tier (cross-tier order is governed by trigger priority), so the
   * scale differs per trigger and that is fine: soonest-event `daysUntil`, soonest
   * opening epoch-ms, and most-overdue `-(daysOverdue)`.
   */
  tierRank: number
  copy: ReEngagementDispatchCopy
}

export type ReEngagementDispatchAllocation = {
  /** Candidates that fit under the pooled cap, in priority order (highest first). */
  granted: ReEngagementDispatchCandidate[]
  /** Dropped because the recipient muted that trigger (the §9 opt-out signal). */
  mutedOptOut: number
  /** Dropped because the client is at their pooled weekly budget. */
  budgetBlocked: number
  grantedByTrigger: Record<ReEngagementTrigger, number>
  mutedByTrigger: Record<ReEngagementTrigger, number>
  budgetBlockedByTrigger: Record<ReEngagementTrigger, number>
}

function zeroTriggerTally(): Record<ReEngagementTrigger, number> {
  return {
    EVENT_COUNTDOWN: 0,
    AVAILABILITY_OPENED_ON_SAVE: 0,
    REBOOK_CADENCE: 0,
    BOARD_ARCHIVE: 0,
    OTHER: 0,
  }
}

/**
 * The heart of the capstone: given every trigger's candidates for a run, allocate
 * the pooled weekly budget ONCE per user under strict global priority. Pure.
 *
 * Steps, per the spec §8.1 ladder:
 *   1. Drop muted candidates PER their own trigger's eventKey — a client can mute
 *      one trigger and still receive another (mute is the opt-out signal).
 *   2. Group the survivors by client.
 *   3. For each client, order by trigger priority, then within a tier by urgency
 *      (tierRank), and spend up to the remaining pooled budget. allocateBudget-
 *      ToCandidates re-sorts by priority (stably), so the composite pre-sort here
 *      fixes the within-tier order it preserves.
 *
 * Because allocation happens once across ALL triggers, a higher-priority countdown
 * always wins a client's last slot over a lower-priority rebook — even when the
 * rebook candidate appeared first in the input (the guarantee cron-ordering could
 * not make).
 */
export function allocateReEngagementDispatch(args: {
  candidates: readonly ReEngagementDispatchCandidate[]
  sentCountByClient: ReadonlyMap<string, number>
  mutedClientsByEventKey: ReadonlyMap<NotificationEventKey, ReadonlySet<string>>
  cap?: number
}): ReEngagementDispatchAllocation {
  const cap = args.cap ?? RE_ENGAGEMENT_WEEKLY_CAP

  const mutedByTrigger = zeroTriggerTally()
  const budgetBlockedByTrigger = zeroTriggerTally()
  const grantedByTrigger = zeroTriggerTally()

  const byClient = new Map<string, ReEngagementDispatchCandidate[]>()
  let mutedOptOut = 0

  for (const candidate of args.candidates) {
    const muted = args.mutedClientsByEventKey
      .get(candidate.eventKey)
      ?.has(candidate.clientId)
    if (muted) {
      mutedOptOut += 1
      mutedByTrigger[candidate.trigger] += 1
      continue
    }
    const list = byClient.get(candidate.clientId) ?? []
    list.push(candidate)
    byClient.set(candidate.clientId, list)
  }

  const granted: ReEngagementDispatchCandidate[] = []
  let budgetBlocked = 0

  for (const [clientId, list] of byClient) {
    const ordered = [...list].sort(
      (a, b) =>
        RE_ENGAGEMENT_TRIGGER_PRIORITY[a.trigger] -
          RE_ENGAGEMENT_TRIGGER_PRIORITY[b.trigger] || a.tierRank - b.tierRank,
    )
    const { granted: grantedForClient, denied } = allocateBudgetToCandidates({
      candidates: ordered,
      alreadySent: args.sentCountByClient.get(clientId) ?? 0,
      cap,
    })
    for (const candidate of grantedForClient) {
      granted.push(candidate)
      grantedByTrigger[candidate.trigger] += 1
    }
    for (const candidate of denied) {
      budgetBlocked += 1
      budgetBlockedByTrigger[candidate.trigger] += 1
    }
  }

  return {
    granted,
    mutedOptOut,
    budgetBlocked,
    grantedByTrigger,
    mutedByTrigger,
    budgetBlockedByTrigger,
  }
}

// ── impure orchestration ─────────────────────────────────────────────────────

export type ReEngagementDispatchSummary = {
  datedBoards: number
  savedOpenPros: number
  savedAgingSaves: number
  rebookOpenPros: number
  rebookCompletedVisits: number
  /** True if any trigger's scan hit its cap (candidates may be incomplete). */
  scanCapped: boolean
  /** Candidates per trigger before the pooled budget was applied. */
  candidatesByTrigger: Record<ReEngagementTrigger, number>
  mutedOptOut: number
  budgetBlocked: number
  /** Notifications actually sent, per trigger (the pooled winners). */
  sentByTrigger: Record<ReEngagementTrigger, number>
  sent: number
  computedAt: Date
}

/**
 * Map each trigger's gathered candidates into the trigger-agnostic dispatch shape,
 * pre-composing the (pure, cheap) copy so the wrapper is a plain data record. The
 * copy for candidates that later lose the budget is discarded — string building is
 * negligible and keeping the wrapper closure-free makes the pure allocator testable.
 */
function buildDispatchCandidates(args: {
  countdown: Awaited<ReturnType<typeof gatherEventCountdownCandidates>>
  saved: Awaited<ReturnType<typeof gatherSavedActivationCandidates>>
  rebook: Awaited<ReturnType<typeof gatherRebookCadenceCandidates>>
}): ReEngagementDispatchCandidate[] {
  const candidates: ReEngagementDispatchCandidate[] = []

  for (const c of args.countdown.candidates) {
    candidates.push({
      clientId: c.clientId,
      trigger: EVENT_COUNTDOWN_TRIGGER,
      eventKey: NotificationEventKey.EVENT_DATE_COUNTDOWN,
      dedupeKey: c.dedupeKey,
      tierRank: c.daysUntil, // soonest event first
      copy: composeEventCountdownCopy({ candidate: c }),
    })
  }

  for (const c of args.saved.candidates) {
    candidates.push({
      clientId: c.clientId,
      trigger: SAVED_LOOK_ACTIVATION_TRIGGER,
      eventKey: NotificationEventKey.SAVED_LOOK_AVAILABILITY_OPENED,
      dedupeKey: c.dedupeKey,
      tierRank: c.nextOpeningDate.getTime(), // soonest opening first
      copy: composeSavedActivationCopy({
        proName: args.saved.proNames.get(c.professionalId) ?? '',
        candidate: c,
      }),
    })
  }

  for (const c of args.rebook.candidates) {
    candidates.push({
      clientId: c.clientId,
      trigger: REBOOK_CADENCE_TRIGGER,
      eventKey: NotificationEventKey.REBOOK_CADENCE_DUE,
      dedupeKey: c.dedupeKey,
      tierRank: -(c.daysSinceLastVisit - c.cadenceDays), // most overdue first
      copy: composeRebookCadenceCopy({
        proName: args.rebook.proNames.get(c.professionalId) ?? '',
        candidate: c,
      }),
    })
  }

  return candidates
}

/**
 * Run one UNIFIED re-engagement pass (§8.1). Gathers all three triggers' candidates,
 * allocates the pooled weekly budget ONCE per user under global priority, then emits
 * the winners. Reads via `db`; sends via createClientNotification (global prisma).
 * Returns a rich summary for the cron response + observability log.
 */
export async function runReEngagementDispatch(
  db: PrismaClient,
  options: { now: Date },
): Promise<ReEngagementDispatchSummary> {
  const now = options.now

  const [countdown, saved, rebook] = await Promise.all([
    gatherEventCountdownCandidates(db, { now }),
    gatherSavedActivationCandidates(db, { now }),
    gatherRebookCadenceCandidates(db, { now }),
  ])

  const candidates = buildDispatchCandidates({ countdown, saved, rebook })
  const candidateClientIds = [...new Set(candidates.map((c) => c.clientId))]

  const [sentCountByClient, mutedCountdown, mutedSaved, mutedRebook] =
    await Promise.all([
      loadReEngagementBudgetCounts(db, {
        clientIds: candidateClientIds,
        windowStart: reEngagementBudgetWindowStart(now),
      }),
      loadMutedClientsForEvent(db, {
        clientIds: candidateClientIds,
        eventKey: NotificationEventKey.EVENT_DATE_COUNTDOWN,
      }),
      loadMutedClientsForEvent(db, {
        clientIds: candidateClientIds,
        eventKey: NotificationEventKey.SAVED_LOOK_AVAILABILITY_OPENED,
      }),
      loadMutedClientsForEvent(db, {
        clientIds: candidateClientIds,
        eventKey: NotificationEventKey.REBOOK_CADENCE_DUE,
      }),
    ])

  const mutedClientsByEventKey = new Map<
    NotificationEventKey,
    ReadonlySet<string>
  >([
    [NotificationEventKey.EVENT_DATE_COUNTDOWN, mutedCountdown],
    [NotificationEventKey.SAVED_LOOK_AVAILABILITY_OPENED, mutedSaved],
    [NotificationEventKey.REBOOK_CADENCE_DUE, mutedRebook],
  ])

  const allocation = allocateReEngagementDispatch({
    candidates,
    sentCountByClient,
    mutedClientsByEventKey,
  })

  let sent = 0
  for (const candidate of allocation.granted) {
    await createClientNotification({
      clientId: candidate.clientId,
      eventKey: candidate.eventKey,
      title: candidate.copy.title,
      body: candidate.copy.body,
      href: candidate.copy.href,
      data: candidate.copy.data as Prisma.InputJsonValue,
      dedupeKey: candidate.dedupeKey,
    })
    sent += 1
  }

  const candidatesByTrigger = zeroTriggerTally()
  for (const candidate of candidates) candidatesByTrigger[candidate.trigger] += 1

  return {
    datedBoards: countdown.datedBoards,
    savedOpenPros: saved.openPros,
    savedAgingSaves: saved.agingSaves,
    rebookOpenPros: rebook.openPros,
    rebookCompletedVisits: rebook.completedVisits,
    scanCapped:
      countdown.scanCapped || saved.scanCapped || rebook.scanCapped,
    candidatesByTrigger,
    mutedOptOut: allocation.mutedOptOut,
    budgetBlocked: allocation.budgetBlocked,
    sentByTrigger: allocation.grantedByTrigger,
    sent,
    computedAt: now,
  }
}
