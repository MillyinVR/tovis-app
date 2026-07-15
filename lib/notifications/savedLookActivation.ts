// lib/notifications/savedLookActivation.ts
//
// §6.8 "Activating saved_not_booked" — the FIRST live consumer of the §8.1
// re-engagement notification budget (lib/notifications/reEngagementBudget.ts).
//
// v1 flags saved-not-booked as the key metric to watch but defines no mechanism.
// The spec's §6.8 table lists five likely blockers per aging save; this module
// ships the top row — "pro booked out → notify when availability opens" (also
// sanctioned by §5.7.5) — using the #604 per-pro availability primitive
// (ProfessionalAvailabilityStat.nextOpeningDate). A client who saved a pro's
// look but never booked, and whose pro now has a near-term opening, gets ONE
// gentle nudge — pooled under the weekly re-engagement budget.
//
// Deliberately deferred to later increments (all now unblocked by the budget):
//   - the other §6.8 blocker responses (too-far → closer similar looks;
//     price → in-band similar looks; hesitation → education/consult nudge;
//     just-dreaming → leave alone);
//   - a save-time calendar snapshot to tell "reopened" from "always open" — the
//     availability primitive is coarse, so the copy is honest ("has an opening"),
//     never "reopened just for you";
//   - §6.7 rebook-cadence prompts + §8 event countdowns (higher-priority budget
//     triggers whose emitters land next).
//
// Design: the selection + budget allocation is PURE (plain record inputs, no
// Prisma) and unit-tested; the orchestrator maps DB rows to those records, runs
// the pure core, then emits via createClientNotification. It is idempotent per
// (client, pro) per cooldown window via a bucketed dedupeKey — a re-run refreshes
// nothing new and never double-spends the budget.

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

export const SAVED_LOOK_ACTIVATION = {
  // A save younger than this hasn't "aged" yet — give the client room to book on
  // their own before we nudge.
  minSaveAgeDays: 3,
  // Don't chase saves older than this — intent has gone stale.
  maxSaveAgeDays: 60,
  // Only nudge when the pro's next opening is this soon — "near-term", not "some
  // day in the 30-day horizon". Reads ProfessionalAvailabilityStat.nextOpeningDate.
  openingHorizonDays: 14,
  // At most one nudge per (client, pro) per this many days (bucketed dedupeKey).
  cooldownDays: 30,
  // Bound the per-run scan so a hot pro's save list can't make the cron unbounded.
  // Capped saves are logged (never silently dropped).
  maxScanSaves: 5000,
} as const

export const SAVED_LOOK_ACTIVATION_TRIGGER = 'AVAILABILITY_OPENED_ON_SAVE' as const

function pairKey(clientId: string, professionalId: string): string {
  return `${clientId}::${professionalId}`
}

/**
 * Stable-per-cooldown-window dedupeKey. The bucket rolls every cooldownDays so a
 * still-unbooked pair can be re-nudged after the cooldown (a fresh identity =
 * fresh dispatch, budget permitting), while re-runs inside a window refresh the
 * same row (no new send).
 */
export function buildSavedActivationDedupeKey(args: {
  clientId: string
  professionalId: string
  now: Date
  cooldownDays?: number
}): string {
  const cooldownDays = args.cooldownDays ?? SAVED_LOOK_ACTIVATION.cooldownDays
  const bucket = Math.floor(args.now.getTime() / (cooldownDays * DAY_MS))
  return `saved-activation:${args.clientId}:${args.professionalId}:${bucket}`
}

// ── pure candidate selection ────────────────────────────────────────────────

export type AgingSaveRow = {
  clientId: string
  professionalId: string
  lookPostId: string
  savedAt: Date
}

export type SavedActivationCandidate = {
  clientId: string
  professionalId: string
  /** The most recent aging save for this pair — the look the nudge hooks on. */
  lookPostId: string
  savedAt: Date
  nextOpeningDate: Date
  dedupeKey: string
  trigger: typeof SAVED_LOOK_ACTIVATION_TRIGGER
}

/**
 * From raw aging saves + exclusion sets + the per-pro opening map, produce one
 * candidate per eligible (client, pro) pair: the most recent aging save is the
 * hook. Excludes pairs with an existing booking, pairs already notified this
 * cooldown window, and pros without a near-term opening. Pure.
 */
export function selectSavedActivationCandidates(args: {
  saves: readonly AgingSaveRow[]
  openingByPro: ReadonlyMap<string, Date>
  bookedPairs: ReadonlySet<string>
  alreadyNotifiedDedupeKeys: ReadonlySet<string>
  now: Date
  cooldownDays?: number
}): SavedActivationCandidate[] {
  const byPair = new Map<string, SavedActivationCandidate>()

  for (const save of args.saves) {
    const opening = args.openingByPro.get(save.professionalId)
    if (!opening) continue // pro has no near-term opening

    const key = pairKey(save.clientId, save.professionalId)
    if (args.bookedPairs.has(key)) continue // already booked this pro

    const dedupeKey = buildSavedActivationDedupeKey({
      clientId: save.clientId,
      professionalId: save.professionalId,
      now: args.now,
      cooldownDays: args.cooldownDays,
    })
    if (args.alreadyNotifiedDedupeKeys.has(dedupeKey)) continue // nudged this window

    const existing = byPair.get(key)
    // Keep the most recent aging save as the hook.
    if (!existing || save.savedAt.getTime() > existing.savedAt.getTime()) {
      byPair.set(key, {
        clientId: save.clientId,
        professionalId: save.professionalId,
        lookPostId: save.lookPostId,
        savedAt: save.savedAt,
        nextOpeningDate: opening,
        dedupeKey,
        trigger: SAVED_LOOK_ACTIVATION_TRIGGER,
      })
    }
  }

  return [...byPair.values()]
}

// ── pure budget allocation ──────────────────────────────────────────────────

export type SavedActivationAllocation = {
  granted: SavedActivationCandidate[]
  /** Candidates dropped because the recipient muted the trigger (opt-out signal). */
  mutedOptOut: number
  /** Candidates dropped because the client is at their pooled weekly budget. */
  budgetBlocked: number
}

/**
 * Allocate candidates under the pooled weekly re-engagement budget, per client.
 * Muted recipients (they turned the trigger off — the opt-out signal) are dropped
 * before spending any budget. Each client's candidates are ordered soonest-opening
 * first, then filled up to their remaining budget. Pure.
 */
export function allocateSavedActivations(args: {
  candidates: readonly SavedActivationCandidate[]
  sentCountByClient: ReadonlyMap<string, number>
  mutedClients: ReadonlySet<string>
  cap?: number
}): SavedActivationAllocation {
  const cap = args.cap ?? RE_ENGAGEMENT_WEEKLY_CAP

  const byClient = new Map<string, SavedActivationCandidate[]>()
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

  const granted: SavedActivationCandidate[] = []
  let budgetBlocked = 0

  for (const [clientId, list] of byClient) {
    // Soonest opening first — the most compelling nudge wins a scarce slot.
    const ordered = [...list].sort(
      (a, b) => a.nextOpeningDate.getTime() - b.nextOpeningDate.getTime(),
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

export type SavedActivationCopy = {
  title: string
  body: string
  href: string
  data: Record<string, string>
}

/**
 * White-label-safe, non-urgent copy (guardrail: a soft signal must stay honest —
 * "has an opening", never "reopened just for you"; the availability primitive is
 * coarse and not a booking guarantee). No brand strings; the pro's public name
 * comes from the caller.
 */
export function composeSavedActivationCopy(args: {
  proName: string
  candidate: Pick<
    SavedActivationCandidate,
    'lookPostId' | 'professionalId' | 'nextOpeningDate'
  >
}): SavedActivationCopy {
  const proName = args.proName.trim() || 'A pro you saved'
  return {
    title: `${proName} has an opening`,
    body: `That look you saved from ${proName}? They have new availability — book whenever you're ready.`,
    href: `/looks/${encodeURIComponent(args.candidate.lookPostId)}`,
    data: {
      trigger: SAVED_LOOK_ACTIVATION_TRIGGER,
      professionalId: args.candidate.professionalId,
      lookPostId: args.candidate.lookPostId,
      nextOpeningDate: args.candidate.nextOpeningDate.toISOString(),
    },
  }
}

// ── impure orchestration ─────────────────────────────────────────────────────

// Bookings that mean the client already engaged this pro — any status counts as
// "not a saved_not_booked pair" (they converted, tried, or have a relationship;
// §6.7 owns rebooking). Includes terminal states on purpose.
const ANY_BOOKING_STATUSES: BookingStatus[] = [
  BookingStatus.PENDING,
  BookingStatus.ACCEPTED,
  BookingStatus.IN_PROGRESS,
  BookingStatus.COMPLETED,
  BookingStatus.CANCELLED,
  BookingStatus.NO_SHOW,
]

export type SavedLookActivationSummary = {
  openPros: number
  agingSaves: number
  scanCapped: boolean
  candidatePairs: number
  mutedOptOut: number
  budgetBlocked: number
  sent: number
  computedAt: Date
}

/**
 * Aging saves on the given open pros' PUBLISHED looks, newest-first, bounded.
 * Pro-anchored (the open-pro set is small) so the scan is proportional to
 * bookable-soon pros, not the whole BoardItem table. The pro's public display
 * name is read through the LookPost→professional RELATION (never a top-level
 * pro-profile findMany — that trips check:tenant-aware-discovery), so we get
 * names for free without a second query.
 */
async function loadAgingSaves(
  db: PrismaClient,
  args: { openProIds: string[]; minAgeCutoff: Date; maxAgeCutoff: Date; take: number },
): Promise<{ saves: AgingSaveRow[]; capped: boolean; proNames: Map<string, string> }> {
  if (args.openProIds.length === 0) {
    return { saves: [], capped: false, proNames: new Map() }
  }

  const rows = await db.boardItem.findMany({
    where: {
      createdAt: { lte: args.minAgeCutoff, gte: args.maxAgeCutoff },
      lookPost: {
        professionalId: { in: args.openProIds },
        status: 'PUBLISHED',
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
        },
      },
    },
    orderBy: { createdAt: 'desc' },
    take: args.take + 1, // +1 to detect capping
  })

  const capped = rows.length > args.take
  const kept = rows.slice(0, args.take)

  const proNames = new Map<string, string>()
  const saves: AgingSaveRow[] = kept.map((row) => {
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
    }
  })

  return { saves, capped, proNames }
}

/** (client, pro) pairs that already have ANY booking → excluded from nudging. */
async function loadBookedPairs(
  db: PrismaClient,
  args: { clientIds: string[]; professionalIds: string[]; wantedPairs: ReadonlySet<string> },
): Promise<Set<string>> {
  if (args.clientIds.length === 0 || args.professionalIds.length === 0) {
    return new Set()
  }

  const rows = await db.booking.findMany({
    where: {
      clientId: { in: args.clientIds },
      professionalId: { in: args.professionalIds },
      status: { in: ANY_BOOKING_STATUSES },
    },
    select: { clientId: true, professionalId: true },
    distinct: ['clientId', 'professionalId'],
  })

  const booked = new Set<string>()
  for (const row of rows) {
    const key = pairKey(row.clientId, row.professionalId)
    // The in/in query over-fetches the cross product; keep only real candidate pairs.
    if (args.wantedPairs.has(key)) booked.add(key)
  }
  return booked
}

export type SavedActivationGathered = {
  /** Eligible (client, pro) pairs, not yet nudged this window. Ready to allocate. */
  candidates: SavedActivationCandidate[]
  /** professionalId → public display name, for the copy (read via the relation). */
  proNames: Map<string, string>
  openPros: number
  agingSaves: number
  scanCapped: boolean
}

/**
 * Gather the saved-look activation candidates (§6.8) for one pass: find pros with
 * a near-term opening, their aging unbooked saves, drop already-booked pairs and
 * pairs already nudged this cooldown window. This is the reusable candidate-
 * selection half of the pass — both the per-trigger orchestrator below and the
 * unified re-engagement dispatcher (reEngagementDispatcher.ts) call it, then apply
 * the pooled budget themselves.
 */
export async function gatherSavedActivationCandidates(
  db: PrismaClient,
  options: { now: Date },
): Promise<SavedActivationGathered> {
  const now = options.now
  const horizonEnd = new Date(
    now.getTime() + SAVED_LOOK_ACTIVATION.openingHorizonDays * DAY_MS,
  )
  const minAgeCutoff = new Date(
    now.getTime() - SAVED_LOOK_ACTIVATION.minSaveAgeDays * DAY_MS,
  )
  const maxAgeCutoff = new Date(
    now.getTime() - SAVED_LOOK_ACTIVATION.maxSaveAgeDays * DAY_MS,
  )

  const openingByPro = await loadOpenProAvailability(db, horizonEnd)
  if (openingByPro.size === 0) {
    return {
      candidates: [],
      proNames: new Map(),
      openPros: 0,
      agingSaves: 0,
      scanCapped: false,
    }
  }

  const { saves, capped, proNames } = await loadAgingSaves(db, {
    openProIds: [...openingByPro.keys()],
    minAgeCutoff,
    maxAgeCutoff,
    take: SAVED_LOOK_ACTIVATION.maxScanSaves,
  })

  // Distinct candidate pairs (before exclusions) — feeds the booking cross-ref.
  const wantedPairs = new Set<string>()
  const clientIdSet = new Set<string>()
  const proIdSet = new Set<string>()
  for (const save of saves) {
    wantedPairs.add(pairKey(save.clientId, save.professionalId))
    clientIdSet.add(save.clientId)
    proIdSet.add(save.professionalId)
  }

  const bookedPairs = await loadBookedPairs(db, {
    clientIds: [...clientIdSet],
    professionalIds: [...proIdSet],
    wantedPairs,
  })

  // Candidate dedupeKeys (post booking-exclusion) for the already-notified check.
  const provisional = selectSavedActivationCandidates({
    saves,
    openingByPro,
    bookedPairs,
    alreadyNotifiedDedupeKeys: new Set(),
    now,
  })
  const alreadyNotifiedDedupeKeys = await loadAlreadyNotifiedDedupeKeys(db, {
    eventKey: NotificationEventKey.SAVED_LOOK_AVAILABILITY_OPENED,
    dedupeKeys: provisional.map((c) => c.dedupeKey),
  })

  const candidates = selectSavedActivationCandidates({
    saves,
    openingByPro,
    bookedPairs,
    alreadyNotifiedDedupeKeys,
    now,
  })

  return {
    candidates,
    proNames,
    openPros: openingByPro.size,
    agingSaves: saves.length,
    scanCapped: capped,
  }
}

/**
 * Run one saved-not-booked activation pass (§6.8). Reads via `db`; sends via
 * createClientNotification (global prisma). Returns a summary for the cron
 * response + observability log.
 */
export async function runSavedLookActivation(
  db: PrismaClient,
  options: { now: Date },
): Promise<SavedLookActivationSummary> {
  const now = options.now

  const { candidates, proNames, openPros, agingSaves, scanCapped } =
    await gatherSavedActivationCandidates(db, { now })

  const candidateClientIds = [...new Set(candidates.map((c) => c.clientId))]
  const [sentCountByClient, mutedClients] = await Promise.all([
    loadReEngagementBudgetCounts(db, {
      clientIds: candidateClientIds,
      windowStart: reEngagementBudgetWindowStart(now),
    }),
    loadMutedClientsForEvent(db, {
      clientIds: candidateClientIds,
      eventKey: NotificationEventKey.SAVED_LOOK_AVAILABILITY_OPENED,
    }),
  ])

  const allocation = allocateSavedActivations({
    candidates,
    sentCountByClient,
    mutedClients,
  })

  let sent = 0
  for (const candidate of allocation.granted) {
    const copy = composeSavedActivationCopy({
      proName: proNames.get(candidate.professionalId) ?? '',
      candidate,
    })
    await createClientNotification({
      clientId: candidate.clientId,
      eventKey: NotificationEventKey.SAVED_LOOK_AVAILABILITY_OPENED,
      title: copy.title,
      body: copy.body,
      href: copy.href,
      data: copy.data as Prisma.InputJsonValue,
      dedupeKey: candidate.dedupeKey,
    })
    sent += 1
  }

  return {
    openPros,
    agingSaves,
    scanCapped,
    candidatePairs: candidates.length,
    mutedOptOut: allocation.mutedOptOut,
    budgetBlocked: allocation.budgetBlocked,
    sent,
    computedAt: now,
  }
}
