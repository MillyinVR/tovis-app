// lib/notifications/rebookCadenceNotifications.ts
//
// §6.7 cadence-timed rebook prompt — the THIRD live consumer of the §8.1
// re-engagement notification budget (lib/notifications/reEngagementBudget.ts),
// after §8 event countdowns and §6.8 saved-look activation.
//
// A booking is the strongest signal in the personalization hierarchy (spec §2),
// and #606 already surfaces a booked pro's looks in that client's feed. But the
// spec's §6.7 "time for a refresh?" PROMPT stayed unbuilt even though the learned
// data existed: relationshipIntelligence.ts computes per-pair cadenceDays +
// retentionRisk, and each offering carries a static rebookIntervalDays. This
// module reads that cadence for real: a client who is now DUE for a refresh with a
// pro they've visited before — past that pair's cadence, learned from their own
// visit history (falling back to the offering's static rebookIntervalDays) — and
// whose pro has a near-term opening (#604) gets ONE gentle nudge, pooled under the
// weekly re-engagement budget.
//
// Design mirrors savedLookActivation.ts / eventCountdownNotifications.ts: the
// candidate selection + budget allocation is PURE (plain record inputs, no Prisma)
// and unit-tested; the orchestrator maps DB rows to those records, runs the pure
// core, then emits via createClientNotification. Idempotent per (client, pro) per
// cooldown window via a bucketed dedupeKey. Shares the pooled-budget / opt-out /
// dedup / open-pro reads with its siblings via reEngagementLedger.ts.
//
// Priority + arbitration (design decision (a), same as event countdown): this cron
// runs LATER in the day than the countdown (5 10) and saved-look (20 10) crons
// (see vercel.json), so on a day when a client qualifies for several triggers the
// higher-priority ones claim the shared budget first. Rebook cadence has no hard
// deadline, so it is the lowest of the three live tiers (REBOOK_CADENCE, below
// EVENT_COUNTDOWN and AVAILABILITY_OPENED_ON_SAVE). Strict priority arbitration
// happens WITHIN a single scan; the shared NotificationDispatch ledger enforces the
// pooled weekly cap across all three crons. A unified per-user dispatcher that runs
// the priority allocator once across every trigger is the follow-up that fully
// realizes §8.1.

import {
  BookingStatus,
  NotificationEventKey,
  type Prisma,
  type PrismaClient,
} from '@prisma/client'

import { createClientNotification } from '@/lib/notifications/clientNotifications'
import {
  RE_ENGAGEMENT_WEEKLY_CAP,
  allocateBudgetToCandidates,
  reEngagementBudgetWindowStart,
} from '@/lib/notifications/reEngagementBudget'
import {
  loadAlreadyNotifiedDedupeKeys,
  loadMutedClientsForEvent,
  loadOpenProAvailability,
  loadReEngagementBudgetCounts,
} from '@/lib/notifications/reEngagementLedger'
import {
  formatProfessionalPublicDisplayName,
  professionalPublicDisplayNameSelect,
} from '@/lib/privacy/professionalDisplayName'

const DAY_MS = 24 * 60 * 60 * 1000

export const REBOOK_CADENCE = {
  // Only nudge when the pro's next opening is this soon (#604) — "near-term", not
  // some day in the 30-day availability horizon. Mirrors saved-look activation.
  openingHorizonDays: 14,
  // Floor on the cadence used for the "due" test. Guards against a pathologically
  // short learned cadence (e.g. two visits on the same day → cadence < 1 day)
  // firing a nudge almost immediately. A pair with a genuine sub-weekly cadence is
  // still capped by the 30-day cooldown between nudges.
  minCadenceDays: 7,
  // A pair is "due" once daysSinceLastVisit >= cadence; stop nudging past this
  // multiple of the cadence. Beyond ~3× cadence the relationship has effectively
  // churned — that's win-back / reactivation territory, a separate future trigger,
  // not an honest "you're due for your usual refresh" prompt.
  maxOverdueMultiple: 3,
  // At most one nudge per (client, pro) per this many days (bucketed dedupeKey).
  cooldownDays: 30,
  // Bound the per-run completed-visit scan so a busy open pro's history can't make
  // the cron unbounded. Capped scans are logged (never silently dropped).
  maxScanVisits: 20000,
} as const

export const REBOOK_CADENCE_TRIGGER = 'REBOOK_CADENCE' as const

export type RebookCadenceSource = 'learned' | 'offering'

function pairKey(clientId: string, professionalId: string): string {
  return `${clientId}::${professionalId}`
}

/**
 * Stable-per-cooldown-window dedupeKey. The bucket rolls every cooldownDays so a
 * still-unbooked, still-in-window pair can be re-nudged after the cooldown (a
 * fresh identity = fresh dispatch, budget permitting), while re-runs inside a
 * window refresh the same row (no new send). Mirrors buildSavedActivationDedupeKey.
 */
export function buildRebookCadenceDedupeKey(args: {
  clientId: string
  professionalId: string
  now: Date
  cooldownDays?: number
}): string {
  const cooldownDays = args.cooldownDays ?? REBOOK_CADENCE.cooldownDays
  const bucket = Math.floor(args.now.getTime() / (cooldownDays * DAY_MS))
  return `rebook-cadence:${args.clientId}:${args.professionalId}:${bucket}`
}

/**
 * Mean gap between consecutive visits, in whole+fractional days — the learned
 * cadence. Needs at least two visits; returns null otherwise. Same formula as the
 * pro-facing chart's cadenceDays (lib/clients/relationshipIntelligence.ts), here
 * applied per (client, pro) pair in a batch. `instantsMs` need not be sorted.
 */
export function computeMeanCadenceDays(instantsMs: readonly number[]): number | null {
  if (instantsMs.length < 2) return null
  const sorted = [...instantsMs].sort((a, b) => a - b)
  let totalGapMs = 0
  for (let i = 1; i < sorted.length; i += 1) {
    totalGapMs += sorted[i]! - sorted[i - 1]!
  }
  const meanGapMs = totalGapMs / (sorted.length - 1)
  return meanGapMs / DAY_MS
}

// ── pure candidate selection ────────────────────────────────────────────────

export type CompletedVisitRow = {
  clientId: string
  professionalId: string
  /** finishedAt ?? scheduledFor — when the visit effectively happened. */
  visitInstant: Date
  /** The visit's offering rebookIntervalDays, if set — the static fallback. */
  rebookIntervalDays: number | null
}

export type RebookCadenceCandidate = {
  clientId: string
  professionalId: string
  lastVisitAt: Date
  /** Whole days since the last completed visit (drives the "due" test + order). */
  daysSinceLastVisit: number
  /** The effective cadence used (floored at minCadenceDays), in whole days. */
  cadenceDays: number
  /** Whether the cadence was learned from visits or read off the offering. */
  cadenceSource: RebookCadenceSource
  nextOpeningDate: Date
  dedupeKey: string
  trigger: typeof REBOOK_CADENCE_TRIGGER
}

/**
 * Resolve the cadence for one pair's visits: prefer the learned mean gap (≥ 2
 * visits), else the most-recent visit's offering rebookIntervalDays. Returns null
 * when neither exists (a lone visit on an offering with no rebook interval — no
 * cadence signal, so no nudge). `sortedAsc` must be sorted oldest-first. Pure.
 */
function resolveCadence(
  sortedAsc: readonly CompletedVisitRow[],
): { cadenceDays: number; source: RebookCadenceSource } | null {
  const learned = computeMeanCadenceDays(sortedAsc.map((v) => v.visitInstant.getTime()))
  if (learned !== null && learned > 0) {
    return { cadenceDays: learned, source: 'learned' }
  }
  const mostRecent = sortedAsc[sortedAsc.length - 1]
  const staticDays = mostRecent?.rebookIntervalDays ?? null
  if (staticDays !== null && staticDays > 0) {
    return { cadenceDays: staticDays, source: 'offering' }
  }
  return null
}

/**
 * From a client's completed visits (across the scanned open pros) + exclusion sets
 * + the per-pro opening map, produce one candidate per (client, pro) pair that is
 * now DUE for a rebook: past its cadence but not so far past it has churned.
 * Excludes pairs with an upcoming booking, pairs already nudged this cooldown
 * window, and pros without a near-term opening. Pure.
 */
export function selectRebookCadenceCandidates(args: {
  visits: readonly CompletedVisitRow[]
  openingByPro: ReadonlyMap<string, Date>
  upcomingPairs: ReadonlySet<string>
  alreadyNotifiedDedupeKeys: ReadonlySet<string>
  now: Date
  cooldownDays?: number
}): RebookCadenceCandidate[] {
  // Group visits by (client, pro).
  const byPair = new Map<string, CompletedVisitRow[]>()
  for (const visit of args.visits) {
    const key = pairKey(visit.clientId, visit.professionalId)
    const list = byPair.get(key)
    if (list) list.push(visit)
    else byPair.set(key, [visit])
  }

  const candidates: RebookCadenceCandidate[] = []

  for (const [key, visits] of byPair) {
    const first = visits[0]
    if (!first) continue
    const { clientId, professionalId } = first

    const opening = args.openingByPro.get(professionalId)
    if (!opening) continue // pro has no near-term opening
    if (args.upcomingPairs.has(key)) continue // already has something on the books

    const sortedAsc = [...visits].sort(
      (a, b) => a.visitInstant.getTime() - b.visitInstant.getTime(),
    )
    const resolved = resolveCadence(sortedAsc)
    if (!resolved) continue // no cadence signal for this pair

    const cadenceDays = Math.max(resolved.cadenceDays, REBOOK_CADENCE.minCadenceDays)
    const lastVisitAt = sortedAsc[sortedAsc.length - 1]!.visitInstant
    const daysSinceLastVisit = Math.floor(
      (args.now.getTime() - lastVisitAt.getTime()) / DAY_MS,
    )

    // Due window: [cadence, cadence × maxOverdueMultiple]. Below → not due yet;
    // above → churned (out of scope for a cadence prompt).
    if (daysSinceLastVisit < cadenceDays) continue
    if (daysSinceLastVisit > cadenceDays * REBOOK_CADENCE.maxOverdueMultiple) continue

    const dedupeKey = buildRebookCadenceDedupeKey({
      clientId,
      professionalId,
      now: args.now,
      cooldownDays: args.cooldownDays,
    })
    if (args.alreadyNotifiedDedupeKeys.has(dedupeKey)) continue // nudged this window

    candidates.push({
      clientId,
      professionalId,
      lastVisitAt,
      daysSinceLastVisit,
      cadenceDays: Math.round(cadenceDays),
      cadenceSource: resolved.source,
      nextOpeningDate: opening,
      dedupeKey,
      trigger: REBOOK_CADENCE_TRIGGER,
    })
  }

  return candidates
}

// ── pure budget allocation ──────────────────────────────────────────────────

export type RebookCadenceAllocation = {
  granted: RebookCadenceCandidate[]
  /** Candidates dropped because the recipient muted the trigger (opt-out signal). */
  mutedOptOut: number
  /** Candidates dropped because the client is at their pooled weekly budget. */
  budgetBlocked: number
}

/** How overdue a candidate is, in whole days past its cadence (≥ 0). */
function overdueDays(candidate: RebookCadenceCandidate): number {
  return candidate.daysSinceLastVisit - candidate.cadenceDays
}

/**
 * Allocate candidates under the pooled weekly re-engagement budget, per client.
 * Muted recipients (they turned the trigger off — the opt-out signal) are dropped
 * before spending any budget. Each client's candidates are ordered MOST-overdue
 * first — the relationship closest to lapsing wins a scarce slot (the retention
 * analog of the countdown's "soonest event" tie-break). Pure.
 */
export function allocateRebookCadences(args: {
  candidates: readonly RebookCadenceCandidate[]
  sentCountByClient: ReadonlyMap<string, number>
  mutedClients: ReadonlySet<string>
  cap?: number
}): RebookCadenceAllocation {
  const cap = args.cap ?? RE_ENGAGEMENT_WEEKLY_CAP

  const byClient = new Map<string, RebookCadenceCandidate[]>()
  let mutedOptOut = 0

  for (const candidate of args.candidates) {
    if (args.mutedClients.has(candidate.clientId)) {
      mutedOptOut += 1
      continue
    }
    const list = byClient.get(candidate.clientId) ?? []
    list.push(candidate)
    byClient.set(candidate.clientId, list)
  }

  const granted: RebookCadenceCandidate[] = []
  let budgetBlocked = 0

  for (const [clientId, list] of byClient) {
    const ordered = [...list].sort((a, b) => overdueDays(b) - overdueDays(a))
    const { granted: grantedForClient, denied } = allocateBudgetToCandidates({
      candidates: ordered,
      alreadySent: args.sentCountByClient.get(clientId) ?? 0,
      cap,
    })
    granted.push(...grantedForClient)
    budgetBlocked += denied.length
  }

  return { granted, mutedOptOut, budgetBlocked }
}

// ── pure copy ───────────────────────────────────────────────────────────────

export type RebookCadenceCopy = {
  title: string
  body: string
  href: string
  data: Record<string, string>
}

/**
 * White-label-safe, non-urgent copy. Honest: the availability primitive is coarse
 * ("they have an opening", never "booked just for you"), and the nudge points at
 * the pro's public profile — where the real booking flow lives — rather than
 * over-claiming a specific slot. No brand strings; the pro's public name comes
 * from the caller. No "hurry / last chance / now" urgency.
 */
export function composeRebookCadenceCopy(args: {
  proName: string
  candidate: Pick<RebookCadenceCandidate, 'professionalId' | 'nextOpeningDate'>
}): RebookCadenceCopy {
  const proName = args.proName.trim() || 'your pro'
  return {
    title: `Time for a refresh with ${proName}?`,
    body: `It's been a while since your last visit with ${proName}, and they have an opening — book again whenever you're ready.`,
    href: `/professionals/${encodeURIComponent(args.candidate.professionalId)}`,
    data: {
      trigger: REBOOK_CADENCE_TRIGGER,
      professionalId: args.candidate.professionalId,
      nextOpeningDate: args.candidate.nextOpeningDate.toISOString(),
    },
  }
}

// ── impure orchestration ─────────────────────────────────────────────────────

// A future, non-terminal booking means the client already has something on the
// books with this pro → not a "due for a rebook" moment. COMPLETED is the past
// visit that defines the cadence, so it must NOT count as upcoming here.
const UPCOMING_BOOKING_STATUSES: BookingStatus[] = [
  BookingStatus.PENDING,
  BookingStatus.ACCEPTED,
  BookingStatus.IN_PROGRESS,
]

export type RebookCadenceSummary = {
  openPros: number
  completedVisits: number
  scanCapped: boolean
  candidatePairs: number
  learnedCadencePairs: number
  offeringCadencePairs: number
  mutedOptOut: number
  budgetBlocked: number
  sent: number
  computedAt: Date
}

/**
 * Completed visits on the given open pros, newest-first, bounded. Pro-anchored
 * (the open-pro set is small) so the scan is proportional to bookable-soon pros,
 * not the whole Booking table. The pro's public display name + the visit's
 * offering rebookIntervalDays are read through the Booking → professional /
 * offering RELATIONS (never a top-level pro-profile findMany — that trips
 * check:tenant-aware-discovery), so we get names + the static cadence for free.
 */
async function loadCompletedVisits(
  db: PrismaClient,
  args: { openProIds: string[]; take: number },
): Promise<{
  visits: CompletedVisitRow[]
  capped: boolean
  proNames: Map<string, string>
}> {
  if (args.openProIds.length === 0) {
    return { visits: [], capped: false, proNames: new Map() }
  }

  const rows = await db.booking.findMany({
    where: {
      professionalId: { in: args.openProIds },
      status: BookingStatus.COMPLETED,
    },
    select: {
      clientId: true,
      professionalId: true,
      scheduledFor: true,
      finishedAt: true,
      offering: { select: { rebookIntervalDays: true } },
      professional: { select: professionalPublicDisplayNameSelect },
    },
    orderBy: { scheduledFor: 'desc' },
    take: args.take + 1, // +1 to detect capping
  })

  const capped = rows.length > args.take
  const kept = rows.slice(0, args.take)

  const proNames = new Map<string, string>()
  const visits: CompletedVisitRow[] = kept.map((row) => {
    if (!proNames.has(row.professionalId)) {
      proNames.set(
        row.professionalId,
        formatProfessionalPublicDisplayName(row.professional),
      )
    }
    return {
      clientId: row.clientId,
      professionalId: row.professionalId,
      visitInstant: row.finishedAt ?? row.scheduledFor,
      rebookIntervalDays: row.offering?.rebookIntervalDays ?? null,
    }
  })

  return { visits, capped, proNames }
}

/**
 * (client, pro) pairs with a non-terminal FUTURE booking → excluded (already on
 * the books). Over-fetches the in/in cross product, so keep only real candidate
 * pairs. Mirrors savedLookActivation's loadBookedPairs but scoped to upcoming
 * (not any) bookings — a completed past visit is what qualifies the pair, so only
 * a future one disqualifies it.
 */
async function loadUpcomingPairs(
  db: PrismaClient,
  args: {
    clientIds: string[]
    professionalIds: string[]
    wantedPairs: ReadonlySet<string>
    now: Date
  },
): Promise<Set<string>> {
  if (args.clientIds.length === 0 || args.professionalIds.length === 0) {
    return new Set()
  }

  const rows = await db.booking.findMany({
    where: {
      clientId: { in: args.clientIds },
      professionalId: { in: args.professionalIds },
      status: { in: UPCOMING_BOOKING_STATUSES },
      scheduledFor: { gt: args.now },
    },
    select: { clientId: true, professionalId: true },
    distinct: ['clientId', 'professionalId'],
  })

  const upcoming = new Set<string>()
  for (const row of rows) {
    const key = pairKey(row.clientId, row.professionalId)
    if (args.wantedPairs.has(key)) upcoming.add(key)
  }
  return upcoming
}

/**
 * Run one rebook-cadence pass (§6.7). Reads via `db`; sends via
 * createClientNotification (global prisma). Returns a summary for the cron
 * response + observability log.
 */
export async function runRebookCadenceNotifications(
  db: PrismaClient,
  options: { now: Date },
): Promise<RebookCadenceSummary> {
  const now = options.now
  const horizonEnd = new Date(
    now.getTime() + REBOOK_CADENCE.openingHorizonDays * DAY_MS,
  )

  const openingByPro = await loadOpenProAvailability(db, horizonEnd)
  if (openingByPro.size === 0) {
    return {
      openPros: 0,
      completedVisits: 0,
      scanCapped: false,
      candidatePairs: 0,
      learnedCadencePairs: 0,
      offeringCadencePairs: 0,
      mutedOptOut: 0,
      budgetBlocked: 0,
      sent: 0,
      computedAt: now,
    }
  }

  const { visits, capped, proNames } = await loadCompletedVisits(db, {
    openProIds: [...openingByPro.keys()],
    take: REBOOK_CADENCE.maxScanVisits,
  })

  // Due pairs BEFORE the upcoming-booking / already-notified exclusions — their
  // (client, pro) pairs feed the upcoming cross-ref, their dedupeKeys the
  // already-notified check.
  const provisional = selectRebookCadenceCandidates({
    visits,
    openingByPro,
    upcomingPairs: new Set(),
    alreadyNotifiedDedupeKeys: new Set(),
    now,
  })

  const wantedPairs = new Set<string>()
  const clientIdSet = new Set<string>()
  const proIdSet = new Set<string>()
  for (const candidate of provisional) {
    wantedPairs.add(pairKey(candidate.clientId, candidate.professionalId))
    clientIdSet.add(candidate.clientId)
    proIdSet.add(candidate.professionalId)
  }

  const upcomingPairs = await loadUpcomingPairs(db, {
    clientIds: [...clientIdSet],
    professionalIds: [...proIdSet],
    wantedPairs,
    now,
  })

  const alreadyNotifiedDedupeKeys = await loadAlreadyNotifiedDedupeKeys(db, {
    eventKey: NotificationEventKey.REBOOK_CADENCE_DUE,
    dedupeKeys: provisional.map((c) => c.dedupeKey),
  })

  const candidates = selectRebookCadenceCandidates({
    visits,
    openingByPro,
    upcomingPairs,
    alreadyNotifiedDedupeKeys,
    now,
  })

  const candidateClientIds = [...new Set(candidates.map((c) => c.clientId))]
  const [sentCountByClient, mutedClients] = await Promise.all([
    loadReEngagementBudgetCounts(db, {
      clientIds: candidateClientIds,
      windowStart: reEngagementBudgetWindowStart(now),
    }),
    loadMutedClientsForEvent(db, {
      clientIds: candidateClientIds,
      eventKey: NotificationEventKey.REBOOK_CADENCE_DUE,
    }),
  ])

  const allocation = allocateRebookCadences({
    candidates,
    sentCountByClient,
    mutedClients,
  })

  let sent = 0
  for (const candidate of allocation.granted) {
    const copy = composeRebookCadenceCopy({
      proName: proNames.get(candidate.professionalId) ?? '',
      candidate,
    })
    await createClientNotification({
      clientId: candidate.clientId,
      eventKey: NotificationEventKey.REBOOK_CADENCE_DUE,
      title: copy.title,
      body: copy.body,
      href: copy.href,
      data: copy.data as Prisma.InputJsonValue,
      dedupeKey: candidate.dedupeKey,
    })
    sent += 1
  }

  return {
    openPros: openingByPro.size,
    completedVisits: visits.length,
    scanCapped: capped,
    candidatePairs: candidates.length,
    learnedCadencePairs: candidates.filter((c) => c.cadenceSource === 'learned')
      .length,
    offeringCadencePairs: candidates.filter((c) => c.cadenceSource === 'offering')
      .length,
    mutedOptOut: allocation.mutedOptOut,
    budgetBlocked: allocation.budgetBlocked,
    sent,
    computedAt: now,
  }
}
