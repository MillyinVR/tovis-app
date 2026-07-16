// lib/notifications/hesitationConsultNudge.ts
//
// §6.8 "hesitation" blocker response — the FOURTH consumer of the §8.1
// re-engagement notification budget (lib/notifications/reEngagementBudget.ts),
// after §8 event countdowns, §6.8 saved-look availability-opened, and §6.7 rebook
// cadence.
//
// The §6.8 table lists five likely blockers behind an aging saved-not-booked look
// and a tailored response to each. The saved-look-activation module (#620) shipped
// the "pro booked out → notify on availability" row. This module ships the
// "hesitation (high-commitment) → permission/education, consult nudge, never
// urgency" row:
//
//   A client who saved a look in a KNOWN meaningful-commitment category (permanent
//   makeup, color, extensions, lashes, skin — the HIGH/MEDIUM tiers in
//   lib/looks/badges/commitmentTiers.ts) but never booked that pro is, plausibly,
//   sitting on a big decision. So we send ONE gentle, information-first nudge —
//   "have questions? book a consult when you're ready" — pooled under the weekly
//   re-engagement budget, at the LOWEST live priority (no clock: unlike the three
//   time-sensitive triggers, this yields the last pooled slot to all of them).
//
// The spec's detectable-how column is "commitment tier + long dwell, no booking
// tap". Dwell/scroll isn't captured yet (§2 gap), so we approximate hesitation with
// the strong half of the signal we DO have — a meaningful-commitment category + an
// aged save + no booking. The nudge is honest about that: it never claims urgency
// or scarcity (guardrail #2 / §5.3 — never pressure a body-modification-grade
// decision), it just opens the door to a conversation.
//
// Unlike its availability-gated siblings this scan is NOT anchored on the open-pro
// set (a consult can happen before a near-term opening); it anchors on the small
// consult-worthy-category filter instead, which keeps it bounded.
//
// Design mirrors savedLookActivation.ts: the selection + budget allocation is PURE
// (plain record inputs, no Prisma) and unit-tested; the orchestrator maps DB rows
// to those records, runs the pure core, then emits via createClientNotification.
// Idempotent per (client, pro) per cooldown window via a bucketed dedupeKey. Shares
// the pooled-budget / opt-out / dedup reads with its siblings via
// reEngagementLedger.ts.

import {
  NotificationEventKey,
  type Prisma,
  type PrismaClient,
} from '@prisma/client'

import {
  consultWorthyCommitmentSlugs,
  isConsultWorthyCommitmentSlug,
  resolveCommitmentTier,
  type LookCommitmentTier,
} from '@/lib/looks/badges/commitmentTiers'
import { createClientNotification } from '@/lib/notifications/clientNotifications'
import {
  RE_ENGAGEMENT_WEEKLY_CAP,
  allocateBudgetToCandidates,
  reEngagementBudgetWindowStart,
} from '@/lib/notifications/reEngagementBudget'
import {
  loadAlreadyNotifiedDedupeKeys,
  loadBookedReEngagementPairs,
  loadMutedClientsForEvent,
  loadReEngagementBudgetCounts,
} from '@/lib/notifications/reEngagementLedger'
import {
  formatProfessionalPublicDisplayName,
  professionalPublicDisplayNameSelect,
} from '@/lib/privacy/professionalDisplayName'

const DAY_MS = 24 * 60 * 60 * 1000

export const HESITATION_CONSULT = {
  // A save younger than this hasn't "aged" — a big decision needs a few days of
  // self-consideration before we nudge (a touch longer than the availability
  // trigger's 3, since a consult is a heavier ask).
  minSaveAgeDays: 5,
  // Don't chase saves older than this — intent has gone stale even for a
  // high-commitment decision.
  maxSaveAgeDays: 60,
  // At most one nudge per (client, pro) per this many days (bucketed dedupeKey).
  // Longer than the availability trigger's 30: a consult nudge is a heavier,
  // more considered touch, so we space it further.
  cooldownDays: 45,
  // Bound the per-run scan so a viral high-commitment look's save list can't make
  // the cron unbounded. Capped saves are logged (never silently dropped).
  maxScanSaves: 5000,
} as const

export const HESITATION_CONSULT_TRIGGER = 'HESITATION_CONSULT' as const

function pairKey(clientId: string, professionalId: string): string {
  return `${clientId}::${professionalId}`
}

/**
 * Stable-per-cooldown-window dedupeKey. The bucket rolls every cooldownDays so a
 * still-unbooked pair can be re-nudged after the cooldown (a fresh identity = fresh
 * dispatch, budget permitting), while re-runs inside a window refresh the same row
 * (no new send). Mirrors buildSavedActivationDedupeKey.
 */
export function buildConsultNudgeDedupeKey(args: {
  clientId: string
  professionalId: string
  now: Date
  cooldownDays?: number
}): string {
  const cooldownDays = args.cooldownDays ?? HESITATION_CONSULT.cooldownDays
  const bucket = Math.floor(args.now.getTime() / (cooldownDays * DAY_MS))
  return `saved-consult:${args.clientId}:${args.professionalId}:${bucket}`
}

// ── pure candidate selection ────────────────────────────────────────────────

export type ConsultSaveRow = {
  clientId: string
  professionalId: string
  lookPostId: string
  savedAt: Date
  /** The look's service-category slug (null when uncategorized). */
  categorySlug: string | null
}

export type ConsultNudgeCandidate = {
  clientId: string
  professionalId: string
  /** The most recent aging consult-worthy save for this pair — the nudge's hook. */
  lookPostId: string
  savedAt: Date
  categorySlug: string | null
  commitmentTier: LookCommitmentTier
  dedupeKey: string
  trigger: typeof HESITATION_CONSULT_TRIGGER
}

/**
 * From raw aging saves + exclusion sets, produce one candidate per eligible
 * (client, pro) pair: the most recent aging save on a consult-worthy category is
 * the hook. Excludes saves in a non-consult-worthy category (belt-and-suspenders —
 * the SQL already scopes to those slugs), pairs with an existing booking, and pairs
 * already nudged this cooldown window. Pure.
 */
export function selectConsultNudgeCandidates(args: {
  saves: readonly ConsultSaveRow[]
  bookedPairs: ReadonlySet<string>
  alreadyNotifiedDedupeKeys: ReadonlySet<string>
  now: Date
  cooldownDays?: number
}): ConsultNudgeCandidate[] {
  const byPair = new Map<string, ConsultNudgeCandidate>()

  for (const save of args.saves) {
    // Only known meaningful-commitment categories earn a consult nudge — a routine
    // (LOW) or unknown/uncategorized save is never nudged.
    if (!isConsultWorthyCommitmentSlug(save.categorySlug)) continue

    const key = pairKey(save.clientId, save.professionalId)
    if (args.bookedPairs.has(key)) continue // already booked this pro

    const dedupeKey = buildConsultNudgeDedupeKey({
      clientId: save.clientId,
      professionalId: save.professionalId,
      now: args.now,
      cooldownDays: args.cooldownDays,
    })
    if (args.alreadyNotifiedDedupeKeys.has(dedupeKey)) continue // nudged this window

    const existing = byPair.get(key)
    // Keep the most recent aging save as the hook (freshest intent).
    if (!existing || save.savedAt.getTime() > existing.savedAt.getTime()) {
      byPair.set(key, {
        clientId: save.clientId,
        professionalId: save.professionalId,
        lookPostId: save.lookPostId,
        savedAt: save.savedAt,
        categorySlug: save.categorySlug,
        commitmentTier: resolveCommitmentTier(save.categorySlug),
        dedupeKey,
        trigger: HESITATION_CONSULT_TRIGGER,
      })
    }
  }

  return [...byPair.values()]
}

// ── pure budget allocation ──────────────────────────────────────────────────

export type ConsultNudgeAllocation = {
  granted: ConsultNudgeCandidate[]
  /** Candidates dropped because the recipient muted the trigger (opt-out signal). */
  mutedOptOut: number
  /** Candidates dropped because the client is at their pooled weekly budget. */
  budgetBlocked: number
}

/**
 * Allocate candidates under the pooled weekly re-engagement budget, per client.
 * Muted recipients (they turned the trigger off — the opt-out signal) are dropped
 * before spending any budget. Each client's candidates are ordered FRESHEST-save
 * first — the strongest current intent wins a scarce slot (there is no deadline to
 * rank on). Pure.
 */
export function allocateConsultNudges(args: {
  candidates: readonly ConsultNudgeCandidate[]
  sentCountByClient: ReadonlyMap<string, number>
  mutedClients: ReadonlySet<string>
  cap?: number
}): ConsultNudgeAllocation {
  const cap = args.cap ?? RE_ENGAGEMENT_WEEKLY_CAP

  const byClient = new Map<string, ConsultNudgeCandidate[]>()
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

  const granted: ConsultNudgeCandidate[] = []
  let budgetBlocked = 0

  for (const [clientId, list] of byClient) {
    // Freshest save first — the most current intent wins a scarce slot.
    const ordered = [...list].sort(
      (a, b) => b.savedAt.getTime() - a.savedAt.getTime(),
    )
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

export type ConsultNudgeCopy = {
  title: string
  body: string
  href: string
  data: Record<string, string>
}

/**
 * White-label-safe, information-first copy. A high-commitment decision deserves
 * permission and answers, never urgency or scarcity (guardrail #2 / §5.3): the copy
 * explicitly slows the client down ("no rush"), points at the pro's public profile
 * — where the message/consult + booking flow live — and never frames alternatives
 * as "cheaper" or "faster". No brand strings; the pro's public name comes from the
 * caller.
 */
export function composeConsultNudgeCopy(args: {
  proName: string
  candidate: Pick<
    ConsultNudgeCandidate,
    'lookPostId' | 'professionalId' | 'commitmentTier'
  >
}): ConsultNudgeCopy {
  const proName = args.proName.trim() || 'a pro you saved'
  return {
    title: `Have questions for ${proName}?`,
    body: `That look you saved from ${proName} is a big decision — no rush. Message ${proName} with any questions, or book a consult whenever you're ready.`,
    href: `/professionals/${encodeURIComponent(args.candidate.professionalId)}`,
    data: {
      trigger: HESITATION_CONSULT_TRIGGER,
      professionalId: args.candidate.professionalId,
      lookPostId: args.candidate.lookPostId,
      commitmentTier: args.candidate.commitmentTier,
    },
  }
}

// ── impure orchestration ─────────────────────────────────────────────────────

export type HesitationConsultSummary = {
  agingSaves: number
  scanCapped: boolean
  candidatePairs: number
  mutedOptOut: number
  budgetBlocked: number
  sent: number
  computedAt: Date
}

/**
 * Aging saves on PUBLISHED looks in a consult-worthy (HIGH/MEDIUM commitment)
 * category, newest-first, bounded. Category-anchored (the consult-worthy slug set
 * is small) so the scan is proportional to meaningful-commitment saves, not the
 * whole BoardItem table. The pro's public display name is read through the
 * LookPost→professional RELATION (never a top-level pro-profile findMany — that
 * trips check:tenant-aware-discovery), so we get names for free.
 */
async function loadAgingConsultSaves(
  db: PrismaClient,
  args: { minAgeCutoff: Date; maxAgeCutoff: Date; take: number },
): Promise<{ saves: ConsultSaveRow[]; capped: boolean; proNames: Map<string, string> }> {
  const consultSlugs = consultWorthyCommitmentSlugs()
  if (consultSlugs.length === 0) {
    return { saves: [], capped: false, proNames: new Map() }
  }

  const rows = await db.boardItem.findMany({
    where: {
      createdAt: { lte: args.minAgeCutoff, gte: args.maxAgeCutoff },
      lookPost: {
        status: 'PUBLISHED',
        service: { category: { slug: { in: consultSlugs } } },
      },
    },
    select: {
      lookPostId: true,
      createdAt: true,
      board: { select: { clientId: true } },
      lookPost: {
        select: {
          professionalId: true,
          professional: { select: professionalPublicDisplayNameSelect },
          service: { select: { category: { select: { slug: true } } } },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
    take: args.take + 1, // +1 to detect capping
  })

  const capped = rows.length > args.take
  const kept = rows.slice(0, args.take)

  const proNames = new Map<string, string>()
  const saves: ConsultSaveRow[] = kept.map((row) => {
    if (!proNames.has(row.lookPost.professionalId)) {
      proNames.set(
        row.lookPost.professionalId,
        formatProfessionalPublicDisplayName(row.lookPost.professional),
      )
    }
    return {
      clientId: row.board.clientId,
      professionalId: row.lookPost.professionalId,
      lookPostId: row.lookPostId,
      savedAt: row.createdAt,
      categorySlug: row.lookPost.service?.category?.slug ?? null,
    }
  })

  return { saves, capped, proNames }
}

export type ConsultNudgeGathered = {
  /** Eligible (client, pro) pairs, not yet nudged this window. Ready to allocate. */
  candidates: ConsultNudgeCandidate[]
  /** professionalId → public display name, for the copy (read via the relation). */
  proNames: Map<string, string>
  agingSaves: number
  scanCapped: boolean
}

/**
 * Gather the hesitation-consult candidates (§6.8) for one pass: find aging saves on
 * consult-worthy-category looks, drop already-booked pairs and pairs already nudged
 * this cooldown window. This is the reusable candidate-selection half of the pass —
 * both the per-trigger orchestrator below and the unified re-engagement dispatcher
 * (reEngagementDispatcher.ts) call it, then apply the pooled budget themselves.
 */
export async function gatherConsultNudgeCandidates(
  db: PrismaClient,
  options: { now: Date },
): Promise<ConsultNudgeGathered> {
  const now = options.now
  const minAgeCutoff = new Date(
    now.getTime() - HESITATION_CONSULT.minSaveAgeDays * DAY_MS,
  )
  const maxAgeCutoff = new Date(
    now.getTime() - HESITATION_CONSULT.maxSaveAgeDays * DAY_MS,
  )

  const { saves, capped, proNames } = await loadAgingConsultSaves(db, {
    minAgeCutoff,
    maxAgeCutoff,
    take: HESITATION_CONSULT.maxScanSaves,
  })

  if (saves.length === 0) {
    return { candidates: [], proNames, agingSaves: 0, scanCapped: capped }
  }

  // Distinct candidate pairs (before exclusions) — feeds the booking cross-ref.
  const wantedPairs = new Set<string>()
  const clientIdSet = new Set<string>()
  const proIdSet = new Set<string>()
  for (const save of saves) {
    if (!isConsultWorthyCommitmentSlug(save.categorySlug)) continue
    wantedPairs.add(pairKey(save.clientId, save.professionalId))
    clientIdSet.add(save.clientId)
    proIdSet.add(save.professionalId)
  }

  const bookedPairs = await loadBookedReEngagementPairs(db, {
    clientIds: [...clientIdSet],
    professionalIds: [...proIdSet],
    wantedPairs,
  })

  // Candidate dedupeKeys (post booking-exclusion) for the already-notified check.
  const provisional = selectConsultNudgeCandidates({
    saves,
    bookedPairs,
    alreadyNotifiedDedupeKeys: new Set(),
    now,
  })
  const alreadyNotifiedDedupeKeys = await loadAlreadyNotifiedDedupeKeys(db, {
    eventKey: NotificationEventKey.SAVED_LOOK_CONSULT_NUDGE,
    dedupeKeys: provisional.map((c) => c.dedupeKey),
  })

  const candidates = selectConsultNudgeCandidates({
    saves,
    bookedPairs,
    alreadyNotifiedDedupeKeys,
    now,
  })

  return { candidates, proNames, agingSaves: saves.length, scanCapped: capped }
}

/**
 * Run one hesitation-consult pass (§6.8). Reads via `db`; sends via
 * createClientNotification (global prisma). Returns a summary for the cron response
 * + observability log.
 */
export async function runHesitationConsultNudges(
  db: PrismaClient,
  options: { now: Date },
): Promise<HesitationConsultSummary> {
  const now = options.now

  const { candidates, proNames, agingSaves, scanCapped } =
    await gatherConsultNudgeCandidates(db, { now })

  const candidateClientIds = [...new Set(candidates.map((c) => c.clientId))]
  const [sentCountByClient, mutedClients] = await Promise.all([
    loadReEngagementBudgetCounts(db, {
      clientIds: candidateClientIds,
      windowStart: reEngagementBudgetWindowStart(now),
    }),
    loadMutedClientsForEvent(db, {
      clientIds: candidateClientIds,
      eventKey: NotificationEventKey.SAVED_LOOK_CONSULT_NUDGE,
    }),
  ])

  const allocation = allocateConsultNudges({
    candidates,
    sentCountByClient,
    mutedClients,
  })

  let sent = 0
  for (const candidate of allocation.granted) {
    const copy = composeConsultNudgeCopy({
      proName: proNames.get(candidate.professionalId) ?? '',
      candidate,
    })
    await createClientNotification({
      clientId: candidate.clientId,
      eventKey: NotificationEventKey.SAVED_LOOK_CONSULT_NUDGE,
      title: copy.title,
      body: copy.body,
      href: copy.href,
      data: copy.data as Prisma.InputJsonValue,
      dedupeKey: candidate.dedupeKey,
    })
    sent += 1
  }

  return {
    agingSaves,
    scanCapped,
    candidatePairs: candidates.length,
    mutedOptOut: allocation.mutedOptOut,
    budgetBlocked: allocation.budgetBlocked,
    sent,
    computedAt: now,
  }
}
