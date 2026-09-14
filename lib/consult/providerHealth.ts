// lib/consult/providerHealth.ts
//
// "Is the consult's model pipeline actually working?" — answered from the
// meter, once a day, by something other than a person deciding to look.
//
// ## Why this exists
//
// Every paid consult call already records what it cost and whether this repo
// could use the answer (`ConsultProviderCall`). Nothing read it. On 2026-09-13
// a hand audit of that table found `INSPIRATION_READ` at four BAD_OUTPUTs in
// nine calls — a 44% failure rate that had been true for days, had terminally
// failed a real client's consult twice on 09-11, and had never been reported to
// anyone. `ANALYSIS_SUITABILITY` and `FOLLOW_UP_QUESTIONS` were each 0-for-1.
//
// The numbers were all there. The gap was that no job ever asked.
//
// ## What it does NOT do
//
// It does not read a client's consult, her intake, her photos, or any model
// output. It reads counts, costs, and the content-free `failureCheck` names
// this repo's own sanitizers raise. The report is an operational summary, and
// there is no client-facing or pro-facing surface for it.
//
// ## What the failure rate MEANS
//
// 🔴 It measures the MODEL, not the client's experience, and the two have
// diverged since retries landed. A call that fails once and succeeds on the
// retry writes two meter rows — one BAD_OUTPUT, one OK — so it reads here as a
// 50% failure rate even though the client got everything she should have.
//
// That is deliberate, and it is the same rule `providerMeter.ts` states: a
// meter that only counted the calls we liked would under-report exactly the
// failure modes worth seeing. A rising rate on a kind that is being recovered
// by retries is still the early warning that the prompt or schema is drifting.
// Read an alert as "this call is answering badly", never as "this many clients
// were failed".

import 'server-only'

import { ConsultProviderCallKind, ConsultProviderCallOutcome } from '@prisma/client'

import { readOptionalEnv, readPositiveIntEnv } from '@/lib/env'
import { prisma } from '@/lib/prisma'

/** How far back a run looks, unless `AI_CONSULT_HEALTH_WINDOW_HOURS` says otherwise. */
const DEFAULT_WINDOW_HOURS = 24

/**
 * How many calls of one kind must exist in the window before its failure rate
 * is allowed to raise an alert.
 *
 * 🔴 This is the whole difference between a useful signal and a pager that
 * cries on the first bad call of a quiet morning. At today's volumes a single
 * failure is 100% of a one-call sample; four is the smallest number at which a
 * rate means anything at all. Raise it as volume grows.
 */
const DEFAULT_MIN_SAMPLE = 4

/** The failure rate, per kind, that is worth waking someone for. */
const DEFAULT_MAX_FAILURE_RATE = 0.25

export type ConsultProviderHealthThresholds = {
  minSample: number
  maxFailureRate: number
}

export type ConsultProviderHealthKindRow = {
  kind: ConsultProviderCallKind
  totalCalls: number
  okCalls: number
  failedCalls: number
  badOutputCalls: number
  failureRate: number
  costMicroUsd: number
  /** The content-free check names behind the failures, most frequent first. */
  topFailureChecks: { check: string; count: number }[]
}

export type ConsultProviderHealthAlert = {
  kind: ConsultProviderCallKind
  totalCalls: number
  failedCalls: number
  failureRate: number
  topFailureChecks: { check: string; count: number }[]
}

export type ConsultProviderHealthReport = {
  windowHours: number
  since: string
  until: string
  totalCalls: number
  failedCalls: number
  badOutputCalls: number
  costMicroUsd: number
  byKind: ConsultProviderHealthKindRow[]
  alerts: ConsultProviderHealthAlert[]
  thresholds: ConsultProviderHealthThresholds
}

/** A rate env var: a plain decimal in [0, 1]. Anything else falls back. */
function readRateEnv(name: string, fallback: number): number {
  const raw = readOptionalEnv(name)
  if (raw === null) return fallback
  const parsed = Number.parseFloat(raw.trim())
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : fallback
}

export function consultProviderHealthThresholds(): ConsultProviderHealthThresholds {
  return {
    minSample: readPositiveIntEnv('AI_CONSULT_HEALTH_MIN_SAMPLE', DEFAULT_MIN_SAMPLE),
    maxFailureRate: readRateEnv(
      'AI_CONSULT_HEALTH_MAX_FAILURE_RATE',
      DEFAULT_MAX_FAILURE_RATE,
    ),
  }
}

/**
 * Which kinds are unhealthy. Pure, so the threshold rule is testable without a
 * database: rows in, alerts out.
 *
 * A kind alerts on its total FAILURE rate, not on BAD_OUTPUT alone — a call
 * that times out every time is just as broken as one that answers unusably,
 * and the operator wants to hear about both. `badOutputCalls` is carried
 * alongside so the report can say which it was.
 */
export function consultProviderHealthAlerts(
  rows: readonly ConsultProviderHealthKindRow[],
  thresholds: ConsultProviderHealthThresholds,
): ConsultProviderHealthAlert[] {
  return rows
    .filter(
      (row) =>
        row.totalCalls >= thresholds.minSample &&
        row.failureRate >= thresholds.maxFailureRate,
    )
    .map((row) => ({
      kind: row.kind,
      totalCalls: row.totalCalls,
      failedCalls: row.failedCalls,
      failureRate: row.failureRate,
      topFailureChecks: row.topFailureChecks,
    }))
    .sort((a, b) => b.failureRate - a.failureRate)
}

/** Rounded to four places — a rate, not a float with a tail of noise. */
function rate(part: number, whole: number): number {
  return whole === 0 ? 0 : Math.round((part / whole) * 10_000) / 10_000
}

/**
 * Read the window and summarize it.
 *
 * Two grouped queries, no row-by-row read: this runs on a cron against a table
 * that only grows, and the shape has to stay flat as volume rises.
 */
export async function readConsultProviderHealth(args?: {
  now?: Date
  windowHours?: number
}): Promise<ConsultProviderHealthReport> {
  const now = args?.now ?? new Date()
  const windowHours =
    args?.windowHours ??
    readPositiveIntEnv('AI_CONSULT_HEALTH_WINDOW_HOURS', DEFAULT_WINDOW_HOURS)
  const since = new Date(now.getTime() - windowHours * 60 * 60 * 1000)
  const where = { createdAt: { gte: since, lte: now } }

  const [byKindOutcome, byCheck] = await Promise.all([
    prisma.consultProviderCall.groupBy({
      by: ['kind', 'outcome'],
      where,
      _count: { _all: true },
      _sum: { costMicroUsd: true },
    }),
    prisma.consultProviderCall.groupBy({
      by: ['kind', 'failureCheck'],
      where: { ...where, outcome: { not: ConsultProviderCallOutcome.OK } },
      _count: { _all: true },
    }),
  ])

  const checksByKind = new Map<string, { check: string; count: number }[]>()
  for (const row of byCheck) {
    // A failure with no recorded check (an older row, or a kind that does not
    // name its checks yet) is counted in the totals but has nothing to name.
    if (!row.failureCheck) continue
    const list = checksByKind.get(row.kind) ?? []
    list.push({ check: row.failureCheck, count: row._count._all })
    checksByKind.set(row.kind, list)
  }

  const kinds = new Map<ConsultProviderCallKind, ConsultProviderHealthKindRow>()
  for (const row of byKindOutcome) {
    const existing = kinds.get(row.kind) ?? {
      kind: row.kind,
      totalCalls: 0,
      okCalls: 0,
      failedCalls: 0,
      badOutputCalls: 0,
      failureRate: 0,
      costMicroUsd: 0,
      topFailureChecks: [],
    }
    const count = row._count._all
    existing.totalCalls += count
    existing.costMicroUsd += row._sum.costMicroUsd ?? 0
    if (row.outcome === ConsultProviderCallOutcome.OK) {
      existing.okCalls += count
    } else {
      existing.failedCalls += count
      if (row.outcome === ConsultProviderCallOutcome.BAD_OUTPUT) {
        existing.badOutputCalls += count
      }
    }
    kinds.set(row.kind, existing)
  }

  const byKind = [...kinds.values()]
    .map((row) => ({
      ...row,
      failureRate: rate(row.failedCalls, row.totalCalls),
      topFailureChecks: (checksByKind.get(row.kind) ?? [])
        .sort((a, b) => b.count - a.count)
        .slice(0, 5),
    }))
    .sort((a, b) => b.failureRate - a.failureRate || b.totalCalls - a.totalCalls)

  const thresholds = consultProviderHealthThresholds()
  return {
    windowHours,
    since: since.toISOString(),
    until: now.toISOString(),
    totalCalls: byKind.reduce((sum, row) => sum + row.totalCalls, 0),
    failedCalls: byKind.reduce((sum, row) => sum + row.failedCalls, 0),
    badOutputCalls: byKind.reduce((sum, row) => sum + row.badOutputCalls, 0),
    costMicroUsd: byKind.reduce((sum, row) => sum + row.costMicroUsd, 0),
    byKind,
    alerts: consultProviderHealthAlerts(byKind, thresholds),
    thresholds,
  }
}
