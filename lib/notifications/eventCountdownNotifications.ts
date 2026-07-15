// lib/notifications/eventCountdownNotifications.ts
//
// §8 event-date countdown — the FLAGSHIP re-engagement trigger and the
// HIGHEST-priority tier under the §8.1 budget (lib/notifications/reEngagementBudget.ts).
//
// A client who created a dated board (a bridal/prom board with Board.eventDate,
// live since #511 / lib/boards/context.ts) has told us, in context, that they
// have a real deadline. As that date approaches we send a gentle, milestone-timed
// nudge — "18 days until prom — here's who still has openings" — that links back
// to the board (whose "Recommended for this board" feed already surfaces pros with
// near-term availability via the #604 primitive, §4.4). It fires at a few
// MILESTONE thresholds (30 / 14 / 7 / 3 days out), at most once per (board,
// milestone), pooled under the weekly re-engagement cap and OUT-RANKING every
// other trigger when they compete for a client's last slot.
//
// Design mirrors savedLookActivation.ts (the first §8.1 consumer): the candidate
// selection + budget allocation is PURE (plain record inputs, no Prisma) and
// unit-tested; the orchestrator maps DB rows to those records, runs the pure core,
// then emits via createClientNotification. Idempotent per (board, milestone) via a
// stable dedupeKey.
//
// Priority arbitration note (design decision (a), documented in the PR): this cron
// runs EARLIER in the day than the §6.8 availability cron (see vercel.json), so on
// a day when a client qualifies for both, the countdown claims the shared budget
// first. Strict priority arbitration only happens WITHIN a single scan; the shared
// NotificationDispatch ledger enforces the pooled weekly cap across both crons. A
// unified re-engagement dispatcher that gathers every trigger's candidates and runs
// the priority allocator once per user is the follow-up that fully realizes §8.1.

import {
  NotificationEventKey,
  type BoardType,
  type Prisma,
  type PrismaClient,
} from '@prisma/client'

import { BOARD_EVENT_NOUNS, boardEventDateToYmd } from '@/lib/boards/context'
import { createClientNotification } from '@/lib/notifications/clientNotifications'
import {
  RE_ENGAGEMENT_EVENT_KEYS,
  RE_ENGAGEMENT_WEEKLY_CAP,
  allocateBudgetToCandidates,
  reEngagementBudgetWindowStart,
} from '@/lib/notifications/reEngagementBudget'

const DAY_MS = 24 * 60 * 60 * 1000

export const EVENT_COUNTDOWN = {
  // The milestone thresholds (days before the event) at which we nudge, largest
  // first. Each is a one-time crossing per board: a board is nudged at most once
  // per milestone over its life (dedupeKey keyed by board + milestone), so a board
  // seen continuously earns at most MILESTONE_DAYS.length nudges total.
  milestoneDays: [30, 14, 7, 3] as const,
  // Never nudge day-of or after the event — a countdown that says "0 days" or
  // counts a passed date is noise, not help.
  minDaysUntil: 1,
  // Bound the per-run scan so a surge of dated boards can't make the cron
  // unbounded. Capped boards are logged (never silently dropped).
  maxScanBoards: 5000,
} as const

/** The largest milestone we look ahead to — the SQL scan horizon. */
const MAX_MILESTONE_DAYS = Math.max(...EVENT_COUNTDOWN.milestoneDays)

export const EVENT_COUNTDOWN_TRIGGER = 'EVENT_COUNTDOWN' as const

/**
 * Whole calendar days from `now` to `eventDate`, both floored to a UTC day index
 * (matching computeBoardEventProximity in lib/boards/context.ts). `eventDate` is a
 * `@db.Date` (UTC midnight) so day-level precision is exact and DST/timezone can't
 * skew the count. Negative = the event has passed. Pure.
 */
export function daysUntilEventDate(eventDate: Date, now: Date): number {
  const eventDay = Math.floor(eventDate.getTime() / DAY_MS)
  const nowDay = Math.floor(now.getTime() / DAY_MS)
  return eventDay - nowDay
}

/**
 * The active milestone bucket for a board `daysUntil` days out, or null when it's
 * outside every window (too far out, day-of, or past). The bucket is the TIGHTEST
 * milestone the event has crossed into — the smallest milestone ≥ daysUntil — so a
 * board sitting between two milestones dedupes to the same bucket until it crosses
 * the next one. Pure.
 */
export function resolveCountdownMilestone(daysUntil: number): number | null {
  if (daysUntil < EVENT_COUNTDOWN.minDaysUntil) return null // day-of or past
  const eligible = EVENT_COUNTDOWN.milestoneDays.filter((m) => m >= daysUntil)
  if (eligible.length === 0) return null // beyond the furthest milestone
  return Math.min(...eligible)
}

/**
 * Stable dedupeKey per (board, milestone). A milestone is a one-time crossing and
 * the event happens once, so the key is not time-bucketed: once the 14-day nudge
 * for a board is sent, a re-run never re-sends it. Different milestones for the
 * same board are distinct keys, so the board still earns each threshold's nudge.
 */
export function buildEventCountdownDedupeKey(args: {
  boardId: string
  milestone: number
}): string {
  return `event-countdown:${args.boardId}:${args.milestone}`
}

// ── pure candidate selection ────────────────────────────────────────────────

export type DatedBoardRow = {
  boardId: string
  clientId: string
  boardType: BoardType
  eventDate: Date
}

export type EventCountdownCandidate = {
  clientId: string
  boardId: string
  boardType: BoardType
  eventDate: Date
  /** Whole days from `now` to the event (≥ minDaysUntil). Drives the copy. */
  daysUntil: number
  /** The milestone bucket this candidate belongs to (dedupe identity). */
  milestone: number
  dedupeKey: string
  trigger: typeof EVENT_COUNTDOWN_TRIGGER
}

/**
 * From dated boards + the already-notified set, produce one candidate per board
 * currently inside a milestone window (excluding boards already nudged for their
 * current milestone). Pure.
 */
export function selectEventCountdownCandidates(args: {
  boards: readonly DatedBoardRow[]
  alreadyNotifiedDedupeKeys: ReadonlySet<string>
  now: Date
}): EventCountdownCandidate[] {
  const candidates: EventCountdownCandidate[] = []

  for (const board of args.boards) {
    const daysUntil = daysUntilEventDate(board.eventDate, args.now)
    const milestone = resolveCountdownMilestone(daysUntil)
    if (milestone === null) continue // outside every milestone window

    const dedupeKey = buildEventCountdownDedupeKey({
      boardId: board.boardId,
      milestone,
    })
    if (args.alreadyNotifiedDedupeKeys.has(dedupeKey)) continue // nudged already

    candidates.push({
      clientId: board.clientId,
      boardId: board.boardId,
      boardType: board.boardType,
      eventDate: board.eventDate,
      daysUntil,
      milestone,
      dedupeKey,
      trigger: EVENT_COUNTDOWN_TRIGGER,
    })
  }

  return candidates
}

// ── pure budget allocation ──────────────────────────────────────────────────

export type EventCountdownAllocation = {
  granted: EventCountdownCandidate[]
  /** Candidates dropped because the recipient muted the trigger (opt-out signal). */
  mutedOptOut: number
  /** Candidates dropped because the client is at their pooled weekly budget. */
  budgetBlocked: number
}

/**
 * Allocate candidates under the pooled weekly re-engagement budget, per client.
 * Muted recipients (they turned the trigger off — the opt-out signal) are dropped
 * before spending any budget. Each client's candidates are ordered soonest-event
 * first (the most time-sensitive countdown wins a scarce slot). Pure.
 */
export function allocateEventCountdowns(args: {
  candidates: readonly EventCountdownCandidate[]
  sentCountByClient: ReadonlyMap<string, number>
  mutedClients: ReadonlySet<string>
  cap?: number
}): EventCountdownAllocation {
  const cap = args.cap ?? RE_ENGAGEMENT_WEEKLY_CAP

  const byClient = new Map<string, EventCountdownCandidate[]>()
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

  const granted: EventCountdownCandidate[] = []
  let budgetBlocked = 0

  for (const [clientId, list] of byClient) {
    // Soonest event first — the most urgent deadline wins a scarce slot.
    const ordered = [...list].sort((a, b) => a.daysUntil - b.daysUntil)
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

export type EventCountdownCopy = {
  title: string
  body: string
  href: string
  data: Record<string, string>
}

/** "your wedding" / "prom" / generic fallback — never a brand string. */
function eventNoun(boardType: BoardType): string {
  return BOARD_EVENT_NOUNS[boardType] ?? 'your event'
}

function daysPhrase(days: number): string {
  return days === 1 ? '1 day' : `${days} days`
}

/**
 * White-label-safe, non-urgent copy. The days count is honest (real UTC-day math,
 * never day-of), and the nudge points at the board — where "Recommended for this
 * board" already surfaces pros with openings (§4.4) — rather than over-claiming a
 * specific slot. No brand strings; no "hurry / last chance" urgency. The event date
 * is a `@db.Date`, serialized via boardEventDateToYmd — never a raw toLocale* call.
 */
export function composeEventCountdownCopy(args: {
  candidate: Pick<
    EventCountdownCandidate,
    'boardId' | 'boardType' | 'eventDate' | 'daysUntil' | 'milestone'
  >
}): EventCountdownCopy {
  const noun = eventNoun(args.candidate.boardType)
  const days = daysPhrase(args.candidate.daysUntil)

  return {
    title: `${days} until ${noun}`,
    body: `Your ${noun === 'your event' ? 'event' : noun} is coming up. There's still time — open your board to browse looks and book a pro who has an opening.`,
    href: `/client/boards/${encodeURIComponent(args.candidate.boardId)}`,
    data: {
      trigger: EVENT_COUNTDOWN_TRIGGER,
      boardId: args.candidate.boardId,
      milestone: String(args.candidate.milestone),
      daysUntil: String(args.candidate.daysUntil),
      eventDate: boardEventDateToYmd(args.candidate.eventDate),
    },
  }
}

// ── impure orchestration ─────────────────────────────────────────────────────

export type EventCountdownSummary = {
  datedBoards: number
  scanCapped: boolean
  candidateBoards: number
  mutedOptOut: number
  budgetBlocked: number
  sent: number
  computedAt: Date
}

/**
 * Dated boards whose event falls inside the milestone horizon, soonest first,
 * bounded. `eventDate` is a `@db.Date` (UTC midnight); the SQL bounds are generous
 * (the pure `resolveCountdownMilestone` enforces the exact [minDaysUntil,
 * MAX_MILESTONE_DAYS] window) so a board exactly on a boundary is never missed.
 */
async function loadDatedBoards(
  db: PrismaClient,
  args: { now: Date; take: number },
): Promise<{ boards: DatedBoardRow[]; capped: boolean }> {
  // Include yesterday..(horizon + 1d) so DATE-vs-instant boundary rounding can't
  // drop a board the pure filter would keep.
  const gte = new Date(args.now.getTime() - DAY_MS)
  const lte = new Date(args.now.getTime() + (MAX_MILESTONE_DAYS + 1) * DAY_MS)

  const rows = await db.board.findMany({
    where: {
      eventDate: { not: null, gte, lte },
      // A hidden/moderated board shouldn't drive re-engagement.
      hiddenAt: null,
    },
    select: { id: true, clientId: true, type: true, eventDate: true },
    orderBy: { eventDate: 'asc' },
    take: args.take + 1, // +1 to detect capping
  })

  const capped = rows.length > args.take
  const kept = rows.slice(0, args.take)

  const boards: DatedBoardRow[] = []
  for (const row of kept) {
    if (!row.eventDate) continue // narrow the nullable column
    boards.push({
      boardId: row.id,
      clientId: row.clientId,
      boardType: row.type,
      eventDate: row.eventDate,
    })
  }

  return { boards, capped }
}

/** dedupeKeys already used → don't re-nudge that (board, milestone). */
async function loadAlreadyNotified(
  db: PrismaClient,
  dedupeKeys: string[],
): Promise<Set<string>> {
  if (dedupeKeys.length === 0) return new Set()

  const rows = await db.clientNotification.findMany({
    where: {
      eventKey: NotificationEventKey.EVENT_DATE_COUNTDOWN,
      dedupeKey: { in: dedupeKeys },
    },
    select: { dedupeKey: true },
  })

  const seen = new Set<string>()
  for (const row of rows) {
    if (row.dedupeKey) seen.add(row.dedupeKey)
  }
  return seen
}

/** Pooled re-engagement send counts per client inside the budget window. */
async function loadBudgetCounts(
  db: PrismaClient,
  args: { clientIds: string[]; windowStart: Date },
): Promise<Map<string, number>> {
  if (args.clientIds.length === 0) return new Map()

  const grouped = await db.notificationDispatch.groupBy({
    by: ['clientId'],
    where: {
      clientId: { in: args.clientIds },
      eventKey: { in: [...RE_ENGAGEMENT_EVENT_KEYS] },
      createdAt: { gte: args.windowStart },
      cancelledAt: null,
    },
    _count: { _all: true },
  })

  const counts = new Map<string, number>()
  for (const group of grouped) {
    if (group.clientId) counts.set(group.clientId, group._count._all)
  }
  return counts
}

/** Clients who muted the trigger (all supported channels off) → opt-out, skip. */
async function loadMutedClients(
  db: PrismaClient,
  clientIds: string[],
): Promise<Set<string>> {
  if (clientIds.length === 0) return new Set()

  const prefs = await db.clientNotificationPreference.findMany({
    where: {
      clientId: { in: clientIds },
      eventKey: NotificationEventKey.EVENT_DATE_COUNTDOWN,
    },
    select: {
      clientId: true,
      inAppEnabled: true,
      emailEnabled: true,
      pushEnabled: true,
    },
  })

  const muted = new Set<string>()
  for (const pref of prefs) {
    // The trigger's channels are IN_APP + EMAIL + PUSH (no SMS). All three off
    // = the recipient opted out of this trigger entirely.
    if (!pref.inAppEnabled && !pref.emailEnabled && !pref.pushEnabled) {
      muted.add(pref.clientId)
    }
  }
  return muted
}

/**
 * Run one event-countdown pass (§8). Reads via `db`; sends via
 * createClientNotification (global prisma). Returns a summary for the cron
 * response + observability log.
 */
export async function runEventCountdownNotifications(
  db: PrismaClient,
  options: { now: Date },
): Promise<EventCountdownSummary> {
  const now = options.now

  const { boards, capped } = await loadDatedBoards(db, {
    now,
    take: EVENT_COUNTDOWN.maxScanBoards,
  })

  if (boards.length === 0) {
    return {
      datedBoards: 0,
      scanCapped: capped,
      candidateBoards: 0,
      mutedOptOut: 0,
      budgetBlocked: 0,
      sent: 0,
      computedAt: now,
    }
  }

  // Provisional candidates (pre already-notified) → dedupeKeys for the check.
  const provisional = selectEventCountdownCandidates({
    boards,
    alreadyNotifiedDedupeKeys: new Set(),
    now,
  })
  const alreadyNotifiedDedupeKeys = await loadAlreadyNotified(
    db,
    provisional.map((c) => c.dedupeKey),
  )

  const candidates = selectEventCountdownCandidates({
    boards,
    alreadyNotifiedDedupeKeys,
    now,
  })

  const candidateClientIds = [...new Set(candidates.map((c) => c.clientId))]
  const [sentCountByClient, mutedClients] = await Promise.all([
    loadBudgetCounts(db, {
      clientIds: candidateClientIds,
      windowStart: reEngagementBudgetWindowStart(now),
    }),
    loadMutedClients(db, candidateClientIds),
  ])

  const allocation = allocateEventCountdowns({
    candidates,
    sentCountByClient,
    mutedClients,
  })

  let sent = 0
  for (const candidate of allocation.granted) {
    const copy = composeEventCountdownCopy({ candidate })
    await createClientNotification({
      clientId: candidate.clientId,
      eventKey: NotificationEventKey.EVENT_DATE_COUNTDOWN,
      title: copy.title,
      body: copy.body,
      href: copy.href,
      data: copy.data as Prisma.InputJsonValue,
      dedupeKey: candidate.dedupeKey,
    })
    sent += 1
  }

  return {
    datedBoards: boards.length,
    scanCapped: capped,
    candidateBoards: candidates.length,
    mutedOptOut: allocation.mutedOptOut,
    budgetBlocked: allocation.budgetBlocked,
    sent,
    computedAt: now,
  }
}
