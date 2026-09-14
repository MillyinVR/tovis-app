// lib/notifications/stalledConsultNudge.ts
//
// One gentle reminder for a consult the client STARTED and never finished —
// the sixth consumer of the §8.1 pooled re-engagement budget
// (lib/notifications/reEngagementBudget.ts).
//
// ## Why this exists
//
// Every consult notification in the product requires a COMPLETED consult AND a
// live booking: `lookBriefReminders` and `consultPrepReminders` both gate on
// `status = 'COMPLETED'` plus a PENDING/ACCEPTED booking, the hesitation nudge
// is about a saved LOOK rather than a consult, and the stale-session job has no
// consult scope at all. So an unfinished consult was, literally, unreachable —
// on 2026-09-13 six of the seven consults ever started in production were
// sitting in a pre-completion status, some for weeks, and nothing would ever
// touch them again.
//
// ## The two rules that make this honest rather than nagging
//
// 🔴 1. ONLY when the next move is HERS. `CONSULT_CLIENT_ACTION_STATUSES`
// (lib/consult/stallFunnel.ts) draws that line once, and the complement —
// `ANALYSIS_PENDING` and `ANALYZING` — is never nudged. Those mean the system
// owes HER work: the run is queued, or it is running and failing. One real
// client on 2026-09-11 started four analysis runs, each exhausting its three
// attempts, and got nothing. Telling her to "finish her consult" would have
// blamed her for our bug. The funnel counter still counts them, because a pile
// of them is an operational alarm.
//
// 🔴 2. ONLY when picking it up is actually possible. `resolveConsultInputWindow`
// is the repo's own answer to "may anything more be added to this consult?" and
// it is reused here rather than re-derived — a nudge for a consult whose
// appointment has already started, or whose booking fell outside the pilot
// window, is a link to a door that will refuse her.
//
// ## The photo, which is the trap
//
// A consult's raw captures expire on a ~1h TTL (`rawExpiresAt`), extended to
// the appointment plus 14 days only when she opted into chart copy. The
// analysis loader refuses anything past it outright
// (`analysisContract.ts` — `purgedAt: null, rawExpiresAt: { gt: now }`), so for
// most stalled consults her photos are simply gone by the time this runs.
//
// Copy that says "pick up where you left off" would then be sending her to a
// dead end, which is worse than silence. So the live-capture count is MEASURED
// per candidate and the copy follows it: resume, retake, or start. It is never
// assumed from the elapsed time.
//
// Design mirrors hesitationConsultNudge.ts: selection + allocation are PURE
// (plain records, no Prisma) and unit-tested; the orchestrator maps DB rows to
// those records, runs the pure core, then emits via createClientNotification.
// Idempotent per consult per cooldown window via a bucketed dedupeKey, sharing
// the pooled-budget / opt-out / dedup reads with its siblings through
// reEngagementLedger.ts.

import {
  ConsultCaptureStatus,
  ConsultSessionStatus,
  NotificationEventKey,
  type Prisma,
  type PrismaClient,
} from '@prisma/client'

import { CONSULT_CLIENT_ACTION_STATUSES } from '@/lib/consult/stallFunnel'
import {
  CONSULT_OPEN_WINDOW_SELECT,
  resolveConsultInputWindow,
} from '@/lib/consult/openWindow'
import { createClientNotification } from '@/lib/notifications/clientNotifications'
import { consultPrepReminderHref } from '@/lib/notifications/consultPrepReminders'
import {
  RE_ENGAGEMENT_WEEKLY_CAP,
  allocateBudgetToCandidates,
  reEngagementBudgetWindowStart,
} from '@/lib/notifications/reEngagementBudget'
import {
  loadAlreadyNotifiedDedupeKeys,
  loadMutedClientsForEvent,
  loadReEngagementBudgetCounts,
} from '@/lib/notifications/reEngagementLedger'
import {
  formatProfessionalPublicDisplayName,
  professionalPublicDisplayNameSelect,
} from '@/lib/privacy/professionalDisplayName'

const DAY_MS = 24 * 60 * 60 * 1000

export const STALLED_CONSULT = {
  // A consult she touched yesterday is not abandoned — she may simply be
  // taking her photos in daylight, which the product itself asks her to do
  // (the daylight break, Tori 2026-09-12). Three days is the first point at
  // which silence means something.
  minIdleDays: 3,
  // Past this, intent is gone and a reminder is an intrusion rather than a
  // help. Shorter than the hesitation nudge's 60: a half-finished consult goes
  // stale much faster than a saved look, because her photos are already gone.
  maxIdleDays: 30,
  // At most one nudge per consult per this many days (bucketed dedupeKey).
  // Long, because this is a single honest reminder and not a campaign.
  cooldownDays: 45,
  // Bound the per-run scan. Capped scans are reported, never silently dropped.
  maxScanSessions: 2000,
} as const

export const STALLED_CONSULT_TRIGGER = 'UNFINISHED_CONSULT' as const

/**
 * Stable-per-cooldown-window dedupeKey. The bucket rolls every cooldownDays so a
 * still-unfinished consult could be reminded again after the cooldown (budget
 * permitting), while re-runs inside a window refresh the same row and send
 * nothing new. Mirrors buildConsultNudgeDedupeKey.
 */
export function buildStalledConsultDedupeKey(args: {
  consultSessionId: string
  now: Date
  cooldownDays?: number
}): string {
  const cooldownDays = args.cooldownDays ?? STALLED_CONSULT.cooldownDays
  const bucket = Math.floor(args.now.getTime() / (cooldownDays * DAY_MS))
  return `stalled-consult:${args.consultSessionId}:${bucket}`
}

// ── pure candidate selection ────────────────────────────────────────────────

/**
 * What the copy has to be honest about: whether the photos she already took are
 * still usable.
 *
 * `RESUME` — at least one ACCEPTED capture is still within its raw TTL.
 * `RETAKE` — she had accepted photos and every one has expired or been purged.
 * `START`  — she never got as far as a photo the gate accepted.
 */
export type StalledConsultPhotoState = 'RESUME' | 'RETAKE' | 'START'

export type StalledConsultRow = {
  consultSessionId: string
  clientId: string
  professionalId: string
  status: ConsultSessionStatus
  /** Last time anything about the consult changed. */
  idleSince: Date
  /** ACCEPTED captures that are still analysable right now. */
  liveCaptures: number
  /** ACCEPTED captures on this consult, still usable or not. */
  everCaptures: number
  /** False when `resolveConsultInputWindow` says nothing more may be added. */
  inputOpen: boolean
}

export type StalledConsultCandidate = {
  clientId: string
  professionalId: string
  consultSessionId: string
  status: ConsultSessionStatus
  idleSince: Date
  photoState: StalledConsultPhotoState
  dedupeKey: string
  trigger: typeof STALLED_CONSULT_TRIGGER
}

export function resolveStalledConsultPhotoState(
  row: Pick<StalledConsultRow, 'liveCaptures' | 'everCaptures'>,
): StalledConsultPhotoState {
  if (row.liveCaptures > 0) return 'RESUME'
  return row.everCaptures > 0 ? 'RETAKE' : 'START'
}

/**
 * One candidate per eligible consult. Pure.
 *
 * Excludes, in order: a status where the next move is not hers (belt and
 * braces — the SQL already scopes to those), a consult that can no longer be
 * added to, one outside the idle window, and one already nudged this cooldown
 * window.
 *
 * At most ONE candidate per client survives — the consult she touched most
 * recently. Two reminders about two half-finished consults in one message-poor
 * budget is a campaign, not a reminder.
 */
export function selectStalledConsultCandidates(args: {
  sessions: readonly StalledConsultRow[]
  alreadyNotifiedDedupeKeys: ReadonlySet<string>
  now: Date
  cooldownDays?: number
}): StalledConsultCandidate[] {
  const byClient = new Map<string, StalledConsultCandidate>()
  const minIdleBefore = new Date(
    args.now.getTime() - STALLED_CONSULT.minIdleDays * DAY_MS,
  )
  const maxIdleAfter = new Date(
    args.now.getTime() - STALLED_CONSULT.maxIdleDays * DAY_MS,
  )

  for (const row of args.sessions) {
    if (!CONSULT_CLIENT_ACTION_STATUSES.includes(row.status)) continue
    // A consult that will refuse her next write is a dead end, and a link to
    // one is worse than no message at all.
    if (!row.inputOpen) continue
    if (row.idleSince.getTime() > minIdleBefore.getTime()) continue
    if (row.idleSince.getTime() < maxIdleAfter.getTime()) continue

    const dedupeKey = buildStalledConsultDedupeKey({
      consultSessionId: row.consultSessionId,
      now: args.now,
      cooldownDays: args.cooldownDays,
    })
    if (args.alreadyNotifiedDedupeKeys.has(dedupeKey)) continue

    const existing = byClient.get(row.clientId)
    // The one she touched most recently — the freshest intent, and the one she
    // is most likely to remember starting.
    if (!existing || row.idleSince.getTime() > existing.idleSince.getTime()) {
      byClient.set(row.clientId, {
        clientId: row.clientId,
        professionalId: row.professionalId,
        consultSessionId: row.consultSessionId,
        status: row.status,
        idleSince: row.idleSince,
        photoState: resolveStalledConsultPhotoState(row),
        dedupeKey,
        trigger: STALLED_CONSULT_TRIGGER,
      })
    }
  }

  return [...byClient.values()]
}

// ── pure budget allocation ──────────────────────────────────────────────────

export type StalledConsultAllocation = {
  granted: StalledConsultCandidate[]
  mutedOptOut: number
  budgetBlocked: number
}

/**
 * Allocate under the pooled weekly budget, per client. Muted recipients are
 * dropped before any budget is spent. Pure.
 */
export function allocateStalledConsultNudges(args: {
  candidates: readonly StalledConsultCandidate[]
  sentCountByClient: ReadonlyMap<string, number>
  mutedClients: ReadonlySet<string>
  cap?: number
}): StalledConsultAllocation {
  const cap = args.cap ?? RE_ENGAGEMENT_WEEKLY_CAP

  const byClient = new Map<string, StalledConsultCandidate[]>()
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

  const granted: StalledConsultCandidate[] = []
  let budgetBlocked = 0

  for (const [clientId, list] of byClient) {
    const ordered = [...list].sort(
      (a, b) => b.idleSince.getTime() - a.idleSince.getTime(),
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

export type StalledConsultCopy = {
  title: string
  body: string
  href: string
  data: Record<string, string>
}

/**
 * Information-first, no urgency, and — the part that matters — HONEST about the
 * photo.
 *
 * 🔴 `RETAKE` says outright that a new photo is needed. Her uploaded ones
 * expired on the raw TTL and the analysis loader will not accept them, so
 * "pick up where you left off" would be an invitation to a refusal. Being told
 * the cost up front is the difference between a reminder and a trap.
 *
 * Never says what she will get, only that she can finish; nothing here promises
 * a plan, a price, or an appointment. No brand strings — the pro's public name
 * comes from the caller.
 */
export function composeStalledConsultCopy(args: {
  proName: string
  candidate: Pick<
    StalledConsultCandidate,
    'consultSessionId' | 'professionalId' | 'status' | 'photoState'
  >
}): StalledConsultCopy {
  const proName = args.proName.trim() || 'your pro'
  const body =
    args.candidate.photoState === 'RETAKE'
      ? `You started a consult with ${proName} and didn't finish it. The photos you uploaded have since expired, so you'd need to take a fresh one — no rush, it's there whenever you want it.`
      : args.candidate.photoState === 'RESUME'
        ? `You started a consult with ${proName} and didn't finish it. Everything you've added so far is still there — pick it up whenever you like.`
        : `You started a consult with ${proName} and didn't finish it. It's still there whenever you want to carry on — no rush.`
  return {
    title: `Want to finish your consult with ${proName}?`,
    body,
    // The client's own consult page, via the helper the prep reminder already
    // owns — one definition of this link, not two.
    href: consultPrepReminderHref(args.candidate.consultSessionId),
    data: {
      trigger: STALLED_CONSULT_TRIGGER,
      consultSessionId: args.candidate.consultSessionId,
      professionalId: args.candidate.professionalId,
      consultStatus: args.candidate.status,
      photoState: args.candidate.photoState,
    },
  }
}

// ── impure orchestration ─────────────────────────────────────────────────────

export type StalledConsultSummary = {
  idleSessions: number
  scanCapped: boolean
  candidates: number
  mutedOptOut: number
  budgetBlocked: number
  sent: number
  computedAt: Date
}

const STALLED_CONSULT_SELECT = {
  ...CONSULT_OPEN_WINDOW_SELECT,
  id: true,
  clientId: true,
  professionalId: true,
  status: true,
  updatedAt: true,
  professional: { select: professionalPublicDisplayNameSelect },
} satisfies Prisma.ConsultSessionSelect

/**
 * Consults idle inside the window, in a status whose next move is the client's.
 *
 * Scoped by status and idle time in SQL, so the scan is proportional to stalled
 * consults rather than to the whole table. The input-window rule is applied in
 * memory because it is the repo's own function and re-expressing it as a Prisma
 * filter would be a second, drifting copy of a rule about appointments, pilot
 * windows and anchors.
 *
 * Live-capture counts come from one grouped query over the surviving sessions
 * rather than a per-session read, so the shape stays flat as volume rises.
 */
export async function gatherStalledConsultCandidates(
  db: PrismaClient,
  options: { now: Date },
): Promise<{
  candidates: StalledConsultCandidate[]
  proNames: Map<string, string>
  idleSessions: number
  scanCapped: boolean
}> {
  const now = options.now
  const idleBefore = new Date(now.getTime() - STALLED_CONSULT.minIdleDays * DAY_MS)
  const idleAfter = new Date(now.getTime() - STALLED_CONSULT.maxIdleDays * DAY_MS)

  const sessions = await db.consultSession.findMany({
    where: {
      status: { in: [...CONSULT_CLIENT_ACTION_STATUSES] },
      updatedAt: { lt: idleBefore, gte: idleAfter },
    },
    select: STALLED_CONSULT_SELECT,
    orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
    take: STALLED_CONSULT.maxScanSessions,
  })

  const open = sessions.filter(
    (session) => resolveConsultInputWindow(session, now).open,
  )

  // The two numbers the copy's honesty depends on: accepted captures still
  // analysable right now, and accepted captures however old.
  //
  // 🔴 BOTH are scoped to ACCEPTED, because that is what the analysis loader
  // requires (`status: ACCEPTED, purgedAt: null, rawExpiresAt: { gt: now }` in
  // analysisContract.ts). Counting a REJECTED capture as a photo she has would
  // tell her "everything you've added is still there" about a photo the
  // pipeline will refuse — and counting one as a photo she TOOK would tell her
  // it "expired" when it was actually turned down. She gets the neutral copy
  // in that case, which is the only true one.
  const sessionIds = open.map((session) => session.id)
  const [liveGroups, everGroups] = await Promise.all([
    sessionIds.length === 0
      ? []
      : db.consultCapture.groupBy({
          by: ['consultSessionId'],
          where: {
            consultSessionId: { in: sessionIds },
            status: ConsultCaptureStatus.ACCEPTED,
            purgedAt: null,
            rawExpiresAt: { gt: now },
          },
          _count: { _all: true },
        }),
    sessionIds.length === 0
      ? []
      : db.consultCapture.groupBy({
          by: ['consultSessionId'],
          where: {
            consultSessionId: { in: sessionIds },
            status: ConsultCaptureStatus.ACCEPTED,
          },
          _count: { _all: true },
        }),
  ])
  const liveBySession = new Map(
    liveGroups.map((row) => [row.consultSessionId, row._count._all] as const),
  )
  const everBySession = new Map(
    everGroups.map((row) => [row.consultSessionId, row._count._all] as const),
  )

  const rows: StalledConsultRow[] = open.map((session) => ({
    consultSessionId: session.id,
    clientId: session.clientId,
    professionalId: session.professionalId,
    status: session.status,
    idleSince: session.updatedAt,
    liveCaptures: liveBySession.get(session.id) ?? 0,
    everCaptures: everBySession.get(session.id) ?? 0,
    inputOpen: true,
  }))

  const dedupeKeys = rows.map((row) =>
    buildStalledConsultDedupeKey({ consultSessionId: row.consultSessionId, now }),
  )
  const alreadyNotifiedDedupeKeys = await loadAlreadyNotifiedDedupeKeys(db, {
    eventKey: NotificationEventKey.CONSULT_STALLED_NUDGE,
    dedupeKeys,
  })

  const candidates = selectStalledConsultCandidates({
    sessions: rows,
    alreadyNotifiedDedupeKeys,
    now,
  })

  const proNames = new Map<string, string>()
  for (const session of open) {
    proNames.set(
      session.professionalId,
      formatProfessionalPublicDisplayName(session.professional),
    )
  }

  return {
    candidates,
    proNames,
    idleSessions: sessions.length,
    scanCapped: sessions.length >= STALLED_CONSULT.maxScanSessions,
  }
}

/**
 * Run one standalone pass. The unified dispatcher
 * (lib/notifications/reEngagementDispatcher.ts) is the normal path — this stays
 * for the per-trigger cron and for manual runs, exactly like its siblings.
 */
export async function runStalledConsultNudges(
  db: PrismaClient,
  options: { now: Date },
): Promise<StalledConsultSummary> {
  const now = options.now
  const gathered = await gatherStalledConsultCandidates(db, { now })
  const clientIds = [...new Set(gathered.candidates.map((c) => c.clientId))]

  const [sentCountByClient, mutedClients] = await Promise.all([
    loadReEngagementBudgetCounts(db, {
      clientIds,
      windowStart: reEngagementBudgetWindowStart(now),
    }),
    loadMutedClientsForEvent(db, {
      clientIds,
      eventKey: NotificationEventKey.CONSULT_STALLED_NUDGE,
    }),
  ])

  const allocation = allocateStalledConsultNudges({
    candidates: gathered.candidates,
    sentCountByClient,
    mutedClients,
  })

  let sent = 0
  for (const candidate of allocation.granted) {
    const copy = composeStalledConsultCopy({
      proName: gathered.proNames.get(candidate.professionalId) ?? '',
      candidate,
    })
    await createClientNotification({
      clientId: candidate.clientId,
      eventKey: NotificationEventKey.CONSULT_STALLED_NUDGE,
      title: copy.title,
      body: copy.body,
      href: copy.href,
      data: copy.data as Prisma.InputJsonValue,
      dedupeKey: candidate.dedupeKey,
    })
    sent += 1
  }

  return {
    idleSessions: gathered.idleSessions,
    scanCapped: gathered.scanCapped,
    candidates: gathered.candidates.length,
    mutedOptOut: allocation.mutedOptOut,
    budgetBlocked: allocation.budgetBlocked,
    sent,
    computedAt: now,
  }
}
