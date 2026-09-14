// lib/consult/stallFunnel.ts
//
// "How many consults are stuck, and WHERE do they get stuck?" — answered from
// the sessions table, once a day, alongside the provider-health report.
//
// ## Why this exists
//
// On 2026-09-13 an audit of production found that of every consult ever
// started, exactly one had ever reached `COMPLETED`. The other six were spread
// across four pre-completion statuses, some for weeks. Nothing in the product
// knew that, because every consult notification requires a COMPLETED consult
// and a live booking (`lookBriefReminders`, `consultPrepReminders`), and the
// stale-session job has no consult scope at all.
//
// So the funnel was invisible, and "the consult pipeline works" was an
// assumption nobody could have checked. This is the counter that makes the
// shape of the drop-off readable before anyone designs a fix for it — and it
// is the ONLY way to tell afterwards whether the fix worked.
//
// ## The line this draws, and why it is the important one
//
// 🔴 A stalled consult is not one thing. Two of these statuses mean the SYSTEM
// owes her work — the run is queued, or it is running and failing — and the
// rest mean the next move is hers. That distinction is what decides who may be
// nudged: chasing a client because our own pipeline is mid-flight, or because
// it refused her four times in a row (which is exactly what happened to one
// real client on 2026-09-11), is not a re-engagement, it is blaming her for a
// bug. `awaitingClient` is computed here, once, so the counter and the nudge
// cannot disagree about it.
//
// ## What it does NOT do
//
// It reads counts and ages. No intake, no photo, no model output, no client
// identity — the report is operational and has no client-facing or pro-facing
// surface. It writes nothing.

import 'server-only'

import { ConsultSessionStatus } from '@prisma/client'

import { readPositiveIntEnv } from '@/lib/env'
import { prisma } from '@/lib/prisma'

/** How old, with no activity, before a consult counts as stalled. */
const DEFAULT_MIN_AGE_HOURS = 24

/**
 * Every status a consult can sit in that is neither finished nor over.
 *
 * `COMPLETED` is the goal. `CANCELLED` and `CONSENT_REVOKED` are terminal by
 * the client's own decision — counting those as "stuck" would turn her
 * withdrawing consent into a funnel leak, and nudging one would be worse.
 */
export const CONSULT_STALL_STATUSES: readonly ConsultSessionStatus[] = [
  ConsultSessionStatus.CONSENT_REQUIRED,
  ConsultSessionStatus.EARLY_PHOTO_READY,
  ConsultSessionStatus.INTAKE_READY,
  ConsultSessionStatus.INTAKE_IN_PROGRESS,
  ConsultSessionStatus.MEDIA_READY,
  ConsultSessionStatus.ANALYSIS_PENDING,
  ConsultSessionStatus.ANALYZING,
]

/**
 * The statuses where the next move is HERS.
 *
 * 🔴 The complement — `ANALYSIS_PENDING` and `ANALYZING` — is the system's own
 * queue. A run that is pending is waiting on a cron; a run that is ANALYZING
 * with a FAILED attempt is retryable and she already has a retry button
 * (`analysisRun.ts` sets `retryable`). Neither is a thing she can fix by being
 * reminded, so neither is ever nudged. They are still COUNTED, because a pile
 * of them is the operator's problem and the counter is how it becomes visible.
 */
export const CONSULT_CLIENT_ACTION_STATUSES: readonly ConsultSessionStatus[] = [
  ConsultSessionStatus.CONSENT_REQUIRED,
  ConsultSessionStatus.EARLY_PHOTO_READY,
  ConsultSessionStatus.INTAKE_READY,
  ConsultSessionStatus.INTAKE_IN_PROGRESS,
  ConsultSessionStatus.MEDIA_READY,
]

export function isConsultAwaitingClient(status: ConsultSessionStatus): boolean {
  return CONSULT_CLIENT_ACTION_STATUSES.includes(status)
}

export type ConsultStallFunnelRow = {
  status: ConsultSessionStatus
  sessions: number
  /** True when the next move is the client's — see the constant above. */
  awaitingClient: boolean
  /** Age of the LONGEST-stalled session in this status, in whole hours. */
  oldestAgeHours: number
}

export type ConsultStallFunnelReport = {
  minAgeHours: number
  until: string
  totalStalled: number
  /** Of `totalStalled`, how many are waiting on HER. */
  awaitingClient: number
  /** Of `totalStalled`, how many are waiting on US. */
  awaitingSystem: number
  byStatus: ConsultStallFunnelRow[]
}

function wholeHoursSince(from: Date, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - from.getTime()) / (60 * 60 * 1000)))
}

/**
 * Count the consults that have gone quiet, by status.
 *
 * One grouped query. This runs on a cron against a table that only grows, so
 * the shape has to stay flat as volume rises — no per-session read, ever.
 *
 * Age is measured from `updatedAt`, which is the last time anything about the
 * consult changed. A consult she touched an hour ago is not stalled no matter
 * how old it is, and one created weeks ago and abandoned the same day is.
 */
export async function readConsultStallFunnel(args?: {
  now?: Date
  minAgeHours?: number
}): Promise<ConsultStallFunnelReport> {
  const now = args?.now ?? new Date()
  const minAgeHours =
    args?.minAgeHours ??
    readPositiveIntEnv('AI_CONSULT_STALL_MIN_AGE_HOURS', DEFAULT_MIN_AGE_HOURS)
  const before = new Date(now.getTime() - minAgeHours * 60 * 60 * 1000)

  const grouped = await prisma.consultSession.groupBy({
    by: ['status'],
    where: {
      status: { in: [...CONSULT_STALL_STATUSES] },
      updatedAt: { lt: before },
    },
    _count: { _all: true },
    _min: { updatedAt: true },
  })

  const byStatus = grouped
    .map((row): ConsultStallFunnelRow => ({
      status: row.status,
      sessions: row._count._all,
      awaitingClient: isConsultAwaitingClient(row.status),
      oldestAgeHours: row._min.updatedAt
        ? wholeHoursSince(row._min.updatedAt, now)
        : 0,
    }))
    .sort((a, b) => b.sessions - a.sessions || b.oldestAgeHours - a.oldestAgeHours)

  return {
    minAgeHours,
    until: now.toISOString(),
    totalStalled: byStatus.reduce((sum, row) => sum + row.sessions, 0),
    awaitingClient: byStatus
      .filter((row) => row.awaitingClient)
      .reduce((sum, row) => sum + row.sessions, 0),
    awaitingSystem: byStatus
      .filter((row) => !row.awaitingClient)
      .reduce((sum, row) => sum + row.sessions, 0),
    byStatus,
  }
}
