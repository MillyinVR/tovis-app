// lib/analytics/proRetentionInsights.ts
//
// "Retention & rebooking" — the implementation behind the `advanced_analytics`
// entitlement (docs/design/membership-value-brief.md §5.1.F / §8.1).
//
// This is the PAID layer ON TOP of the free monthly dashboard, never a re-skin of
// it. The free dashboard answers "what did last month earn"; this answers "who is
// due back, who is slipping away, and is my rebooking getting better or worse".
//
// 🔴 Deliberately adds NO tracking. Every number here is derived from data the
// app already stores:
//   - the rebooking trend reads existing ProfessionalMonthlyAnalytics snapshot
//     rows (futureRebookedClientCount / noFutureRebookClientCount / client mix);
//   - the roster buckets reuse computeRelationshipIntelligence() from
//     lib/clients/relationshipIntelligence.ts — the same tested cadence + lapse
//     maths the client chart already shows per client, rolled up across a roster.
//
// 🔴 It also never FORCES a snapshot recompute. ensureProfessionalMonthlyAnalytics
// has a 60s TTL, so ensuring six months would recompute six months on almost every
// dashboard load. We read whichever rows exist; a month with no row is reported as
// a gap rather than as a zero (cron-populated-signal honesty — an uncomputed month
// is not a month where nobody rebooked).

import 'server-only'

import { Prisma } from '@prisma/client'

import { computeRelationshipIntelligence } from '@/lib/clients/relationshipIntelligence'
import { membershipEnforcementEnabled } from '@/lib/membership/enforcement'
import { prisma } from '@/lib/prisma'
import { hasEntitlement } from '@/lib/pro/entitlements'
import { proClientVisibilityWhere } from '@/lib/clientVisibility'
import {
  DEFAULT_TIME_ZONE,
  formatInTimeZone,
  getZonedParts,
  sanitizeTimeZone,
} from '@/lib/time'

/** How many months of history the rebooking trend looks back over. */
export const RETENTION_TREND_MONTHS = 6

/** How far back the roster scan reads bookings when deriving per-client cadence. */
export const RETENTION_ROSTER_LOOKBACK_MONTHS = 24

/** Roster size ceiling, mirroring /pro/clients. */
export const RETENTION_ROSTER_LIMIT = 500

/** Named clients shown per bucket before it collapses to a count. */
export const RETENTION_BUCKET_PREVIEW = 6

export type ProRetentionStatus = 'ACTION' | 'ATTENTION' | 'GOOD'

export type ProRetentionBucketKey = 'lapsing' | 'due_now' | 'on_the_books'

export type ProRetentionClientRow = {
  clientId: string
  displayName: string
  /** e.g. "9 wks ago" — null when they have never completed a visit with you. */
  lastVisitLabel: string | null
  /** e.g. "~every 6 wks" — null when there is not enough history for a cadence. */
  cadenceLabel: string | null
  completedVisits: number
}

export type ProRetentionBucket = {
  key: ProRetentionBucketKey
  label: string
  hint: string
  status: ProRetentionStatus
  count: number
  /** Up to RETENTION_BUCKET_PREVIEW clients, most overdue first. */
  clients: ProRetentionClientRow[]
}

export type ProRebookTrendPoint = {
  monthKey: string
  /** e.g. "Mar" */
  monthLabel: string
  /**
   * Share of that month's clients who left with a future booking (0–100), or
   * null when the month has no computed snapshot or the pro saw nobody. A null
   * is a GAP, never a zero.
   */
  rebookRatePct: number | null
  clientsSeen: number
  newClients: number
  repeatClients: number
}

export type ProRetentionInsightsDTO =
  /** Enforcement is on and this pro is not entitled — render the upsell. */
  | { state: 'locked' }
  /** Entitled, but there is not yet enough history to say anything true. */
  | { state: 'empty'; reason: string }
  | {
      state: 'ready'
      /** Most recent month with a computed snapshot, oldest→newest overall. */
      trend: ProRebookTrendPoint[]
      /** Latest non-null rebook rate, for the headline. */
      headlineRebookRatePct: number | null
      /** Change in points vs the previous non-null month; null if only one. */
      headlineDeltaPoints: number | null
      buckets: ProRetentionBucket[]
      /**
       * Clients with a single visit, so no cadence exists to judge them by. Held
       * out of the buckets rather than guessed at.
       */
      notEnoughHistoryCount: number
      /**
       * Months in the window showing "—". Counts every unmeasurable month, not
       * just the ones with no snapshot row: a month WITH a row but zero
       * classified clients is equally unmeasurable, and the footnote has to
       * explain exactly as many dashes as the pro can see.
       */
      unmeasuredMonths: number
    }

// ── pure derivations ────────────────────────────────────────────────────────

/** The last `count` month keys ending at `now` in `timeZone`, oldest first. */
export function recentMonthKeys(
  now: Date,
  timeZone: string,
  count: number,
): string[] {
  const parts = getZonedParts(now, timeZone)
  const keys: string[] = []
  let year = parts.year
  let month = parts.month
  for (let i = 0; i < count; i += 1) {
    keys.push(`${year}-${String(month).padStart(2, '0')}`)
    month -= 1
    if (month === 0) {
      month = 12
      year -= 1
    }
  }
  return keys.reverse()
}

/** Snapshot fields the trend needs — a plain shape so this stays unit-testable. */
export type RetentionSnapshotRow = {
  monthKey: string
  uniqueClientCount: number
  newClientCount: number
  repeatClientCount: number
  futureRebookedClientCount: number
  noFutureRebookClientCount: number
}

/**
 * Rebook rate = clients who left with a future booking ÷ clients we can classify.
 *
 * The denominator is `futureRebooked + noFutureRebook`, NOT uniqueClientCount:
 * those two are what the snapshot actually classified, and dividing by a larger
 * client count would silently under-report the rate.
 */
export function rebookRatePct(row: {
  futureRebookedClientCount: number
  noFutureRebookClientCount: number
}): number | null {
  const denominator = row.futureRebookedClientCount + row.noFutureRebookClientCount
  if (denominator <= 0) return null
  return Math.round((row.futureRebookedClientCount / denominator) * 100)
}

export function buildRebookTrend(args: {
  monthKeys: string[]
  rows: RetentionSnapshotRow[]
  timeZone: string
}): ProRebookTrendPoint[] {
  const byKey = new Map(args.rows.map((row) => [row.monthKey, row]))

  return args.monthKeys.map((key) => {
    const row = byKey.get(key)
    return {
      monthKey: key,
      monthLabel: shortMonthLabel(key, args.timeZone),
      rebookRatePct: row ? rebookRatePct(row) : null,
      clientsSeen: row?.uniqueClientCount ?? 0,
      newClients: row?.newClientCount ?? 0,
      repeatClients: row?.repeatClientCount ?? 0,
    }
  })
}

/** "2026-03" → "Mar". Built from a real instant so it honours the pro's zone. */
function shortMonthLabel(key: string, timeZone: string): string {
  const [year, month] = key.split('-')
  const y = Number(year)
  const m = Number(month)
  if (!Number.isFinite(y) || !Number.isFinite(m)) return key
  // Midday UTC on the 15th — far enough from either boundary that no timezone
  // offset can roll the label into a neighbouring month.
  return formatInTimeZone(new Date(Date.UTC(y, m - 1, 15, 12)), timeZone, {
    month: 'short',
  })
}

/** Per-client summary the bucketer needs, already derived from bookings. */
export type RetentionClientSummary = {
  clientId: string
  displayName: string
  completedVisits: number
  cadenceDays: number | null
  daysSinceLastVisit: number | null
  hasUpcoming: boolean
  /** computeRelationshipIntelligence's own lapse verdict — reused, not re-derived. */
  retentionRisk: boolean
}

const BUCKET_META: Record<
  ProRetentionBucketKey,
  { label: string; hint: string; status: ProRetentionStatus }
> = {
  lapsing: {
    label: 'Slipping away',
    hint: 'Well past their usual gap with nothing booked. Reach out first.',
    status: 'ACTION',
  },
  due_now: {
    label: 'Due back now',
    hint: 'They are at their usual rebooking point and have nothing on the books.',
    status: 'ATTENTION',
  },
  on_the_books: {
    label: 'Already rebooked',
    hint: 'They have their next appointment booked with you.',
    status: 'GOOD',
  },
}

/**
 * Sort clients into the three states a pro can actually act on.
 *
 * A client with fewer than two completed visits has NO cadence, so there is no
 * honest way to say whether they are overdue — they are counted separately
 * instead of being quietly filed under "due back".
 */
export function bucketRetentionClients(clients: RetentionClientSummary[]): {
  buckets: ProRetentionBucket[]
  notEnoughHistoryCount: number
} {
  const lapsing: RetentionClientSummary[] = []
  const dueNow: RetentionClientSummary[] = []
  const onTheBooks: RetentionClientSummary[] = []
  let notEnoughHistoryCount = 0

  for (const client of clients) {
    if (client.hasUpcoming) {
      onTheBooks.push(client)
      continue
    }
    if (client.cadenceDays === null || client.daysSinceLastVisit === null) {
      notEnoughHistoryCount += 1
      continue
    }
    if (client.retentionRisk) {
      lapsing.push(client)
      continue
    }
    if (client.daysSinceLastVisit >= client.cadenceDays) {
      dueNow.push(client)
    }
    // Otherwise they are simply not due yet — not a state worth a tile.
  }

  // Most overdue first, so the preview shows the ones worth acting on today.
  const byOverdue = (a: RetentionClientSummary, b: RetentionClientSummary) =>
    (b.daysSinceLastVisit ?? 0) - (a.daysSinceLastVisit ?? 0)
  // Soonest-lapsing first is meaningless for the rebooked bucket; show the
  // longest-standing relationships instead.
  const byVisits = (a: RetentionClientSummary, b: RetentionClientSummary) =>
    b.completedVisits - a.completedVisits

  return {
    buckets: [
      toBucket('lapsing', lapsing.sort(byOverdue)),
      toBucket('due_now', dueNow.sort(byOverdue)),
      toBucket('on_the_books', onTheBooks.sort(byVisits)),
    ],
    notEnoughHistoryCount,
  }
}

function toBucket(
  key: ProRetentionBucketKey,
  clients: RetentionClientSummary[],
): ProRetentionBucket {
  return {
    ...BUCKET_META[key],
    key,
    count: clients.length,
    clients: clients.slice(0, RETENTION_BUCKET_PREVIEW).map(toClientRow),
  }
}

function toClientRow(client: RetentionClientSummary): ProRetentionClientRow {
  return {
    clientId: client.clientId,
    displayName: client.displayName,
    lastVisitLabel: elapsedLabel(client.daysSinceLastVisit),
    cadenceLabel: cadenceLabel(client.cadenceDays),
    completedVisits: client.completedVisits,
  }
}

/** "12 days ago" / "9 wks ago" / "14 mo ago". */
export function elapsedLabel(days: number | null): string | null {
  if (days === null) return null
  if (days <= 0) return 'today'
  if (days < 14) return `${days} day${days === 1 ? '' : 's'} ago`
  if (days < 90) {
    const weeks = Math.round(days / 7)
    return `${weeks} wk${weeks === 1 ? '' : 's'} ago`
  }
  const months = Math.round(days / 30)
  return `${months} mo ago`
}

/** "~every 6 wks" — mirrors formatCadence but always in the roster's voice. */
export function cadenceLabel(cadenceDays: number | null): string | null {
  if (cadenceDays === null) return null
  if (cadenceDays >= 7) {
    const weeks = Math.round(cadenceDays / 7)
    return `usually every ${weeks} wk${weeks === 1 ? '' : 's'}`
  }
  const days = Math.max(1, Math.round(cadenceDays))
  return `usually every ${days} day${days === 1 ? '' : 's'}`
}

/** Latest non-null rate and its change against the previous non-null month. */
export function headlineFromTrend(trend: ProRebookTrendPoint[]): {
  headlineRebookRatePct: number | null
  headlineDeltaPoints: number | null
} {
  const measured = trend.filter(
    (point): point is ProRebookTrendPoint & { rebookRatePct: number } =>
      point.rebookRatePct !== null,
  )
  const latest = measured.at(-1)
  const previous = measured.at(-2)
  if (!latest) return { headlineRebookRatePct: null, headlineDeltaPoints: null }
  return {
    headlineRebookRatePct: latest.rebookRatePct,
    headlineDeltaPoints: previous
      ? latest.rebookRatePct - previous.rebookRatePct
      : null,
  }
}

// ── loader ──────────────────────────────────────────────────────────────────

/**
 * The gated retention section for a pro's dashboard.
 *
 * Gate order matters: when the pro is not entitled we return `locked` BEFORE
 * touching the database, so a free pro's dashboard render costs nothing extra.
 * While ENABLE_MEMBERSHIP_ENFORCEMENT is off, every pro is entitled — same shape
 * as the tax-export gate, so this goes live with the flag rather than needing a
 * second decision later.
 *
 * 🔴 Call this AFTER loadProOverviewPage, not alongside it. That loader is what
 * ensures the current month's snapshot exists; run concurrently, this read races
 * its upsert and the current month renders as "not measured" on a cold cache —
 * which it isn't. Ordering is cheaper than ensuring the month a second time
 * (60s TTL ⇒ a concurrent ensure just recomputes the same month twice).
 */
export async function loadProRetentionInsights(args: {
  professionalId: string
  professionalTimeZone: string | null | undefined
  now: Date
}): Promise<ProRetentionInsightsDTO> {
  if (
    membershipEnforcementEnabled() &&
    !(await hasEntitlement(args.professionalId, 'advanced_analytics'))
  ) {
    return { state: 'locked' }
  }

  const timeZone = sanitizeTimeZone(args.professionalTimeZone, DEFAULT_TIME_ZONE)
  const monthKeys = recentMonthKeys(args.now, timeZone, RETENTION_TREND_MONTHS)

  const rosterCutoff = new Date(args.now)
  rosterCutoff.setUTCMonth(
    rosterCutoff.getUTCMonth() - RETENTION_ROSTER_LOOKBACK_MONTHS,
  )

  // Same visibility rule the /pro/clients roster and the client chart use, so
  // this section can never name a client the pro is no longer allowed to see.
  const visibleBookingWhere: Prisma.BookingWhereInput = {
    professionalId: args.professionalId,
    ...proClientVisibilityWhere(args.now),
  }

  const [snapshotRows, clients] = await Promise.all([
    prisma.professionalMonthlyAnalytics.findMany({
      where: { professionalId: args.professionalId, monthKey: { in: monthKeys } },
      select: {
        monthKey: true,
        uniqueClientCount: true,
        newClientCount: true,
        repeatClientCount: true,
        futureRebookedClientCount: true,
        noFutureRebookClientCount: true,
      },
    }),
    // PII scope: the two name fields the /pro/clients roster already renders,
    // for the same set of clients that roster already shows. No contact details
    // and no birthday are loaded — see the dateOfBirth note further down.
    prisma.clientProfile.findMany({
      where: { bookings: { some: visibleBookingWhere } },
      take: RETENTION_ROSTER_LIMIT,
      select: {
        id: true,
        firstName: true, // pii-plaintext-read-ok: pro reads own visible client name for their retention roll-up, same visibility rule as the /pro/clients roster
        lastName: true, // pii-plaintext-read-ok: pro reads own visible client name for their retention roll-up, same visibility rule as the /pro/clients roster
        bookings: {
          where: {
            professionalId: args.professionalId,
            scheduledFor: { gte: rosterCutoff },
          },
          select: {
            status: true,
            scheduledFor: true,
            createdAt: true,
            finishedAt: true,
            locationTimeZone: true,
          },
        },
      },
    }),
  ])

  const trend = buildRebookTrend({ monthKeys, rows: snapshotRows, timeZone })
  const unmeasuredMonths = trend.filter(
    (point) => point.rebookRatePct === null,
  ).length

  const summaries: RetentionClientSummary[] = clients.map((client) => {
    // Reuses the client chart's tested cadence/lapse maths rather than a second
    // copy of it. Money and PII inputs are deliberately not supplied: this
    // roll-up needs timing only.
    const intel = computeRelationshipIntelligence({
      bookings: client.bookings.map((booking) => ({
        status: booking.status,
        scheduledFor: booking.scheduledFor,
        createdAt: booking.createdAt,
        finishedAt: booking.finishedAt,
        professionalId: args.professionalId,
        amount: null,
        timeZone: sanitizeTimeZone(booking.locationTimeZone, timeZone),
      })),
      proId: args.professionalId,
      now: args.now,
      reviewCount: 0,
      noteCount: 0,
      referredCount: 0,
      wasReferred: false,
      // 🔴 Never loaded here. The roster roll-up needs timing only, and passing
      // null keeps this whole path clear of client PII — no birthday read, no
      // contact method, nothing the pii-plaintext guard has to reason about
      // beyond the name we already render on /pro/clients.
      dateOfBirth: null,
      preferredContactMethod: null,
    })

    return {
      clientId: client.id,
      displayName:
        `${client.firstName} ${client.lastName}`.trim() || 'Client', // pii-plaintext-read-ok: pro reads own visible client name for their own retention roll-up, same rule as the /pro/clients roster
      completedVisits: intel.completedVisitsWithYou,
      cadenceDays: intel.cadenceDays,
      daysSinceLastVisit: intel.daysSinceLastVisit,
      hasUpcoming: intel.hasUpcoming,
      retentionRisk: intel.retentionRisk,
    }
  })

  const { buckets, notEnoughHistoryCount } = bucketRetentionClients(summaries)
  const headline = headlineFromTrend(trend)

  // Nothing measured and nobody to act on: say so plainly instead of drawing an
  // empty chart and three zeroes, which reads as "your retention is zero".
  const hasAnyClientSignal = buckets.some((bucket) => bucket.count > 0)
  if (headline.headlineRebookRatePct === null && !hasAnyClientSignal) {
    return {
      state: 'empty',
      reason:
        'Once you have completed a few appointments, your rebooking rate and who is due back will show up here.',
    }
  }

  return {
    state: 'ready',
    trend,
    ...headline,
    buckets,
    notEnoughHistoryCount,
    unmeasuredMonths,
  }
}
