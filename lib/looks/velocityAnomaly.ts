// lib/looks/velocityAnomaly.ts
//
// §5.6 anti-gaming velocity-anomaly check — the READER/detector for the
// write-only LookPostImpressionStat capture (personalization spec §5.6; build
// step 14). Once saves/remixes/bookings literally drive visibility AND money
// (the booking-protection fee), someone will try to inflate their own numbers.
// This surfaces looks whose recent engagement looks abusive so a human can
// review the pro — it NEVER auto-penalizes (impressions are best-effort sampled,
// so a flag is a lead for manual review, not a verdict; spec §5.6: "flag …
// engagement … for manual review, rather than bolting this on after abuse").
//
// Two independent, cheap reasons, both computed over a trailing daily window:
//
//   1. RATE_ANOMALY (the signal LookPostImpressionStat exists for): engagement
//      far outrunning its matching impressions. Rate-based scoring (§4.1) makes
//      the classic attack self-defeating — "fake saves without matching
//      impressions produce impossible rates that the anomaly check catches
//      trivially" (§5.6 NEW). You can't save/like a look you never saw, so
//      window engagement materially ABOVE window impressions is the tell.
//
//   2. HISTORICAL_SPIKE: window engagement per day spiking far above the look's
//      OWN pre-window daily rate — "engagement that spikes far outside a … normal
//      historical pattern" (§5.6). Uses the look's lifetime counts as the
//      baseline (no extra query), and requires real prior history so a new
//      look's honest launch burst is never mistaken for a spike.
//
// A finding may trip either or both; severity blends the two normalized
// sub-scores so a look tripping both floats to the top of the review queue.

import {
  LookPostStatus,
  ModerationStatus,
  type PrismaClient,
} from '@prisma/client'

import { platformCrossTenantProVisibilityFilter } from '@/lib/tenant'

// ---------------------------------------------------------------------------
// Tunable constants (exported so the tests + a future admin knob share them).
// ---------------------------------------------------------------------------

/** Default trailing window, in whole UTC days, the check evaluates over. */
export const VELOCITY_ANOMALY_WINDOW_DAYS = 7
/** Clamp bounds for a caller-supplied window (a week is the sweet spot). */
export const VELOCITY_ANOMALY_MIN_WINDOW_DAYS = 1
export const VELOCITY_ANOMALY_MAX_WINDOW_DAYS = 30

/**
 * Minimum weighted window engagement below which nothing is ever flagged — a
 * look with a couple of saves isn't worth a reviewer's time, and tiny samples
 * make every ratio noisy. This is the floor BOTH reasons gate on.
 */
export const VELOCITY_ANOMALY_MIN_ENGAGEMENT = 8

/**
 * RATE_ANOMALY threshold: window (saves + likes) at or above this multiple of
 * window impressions is implausible for honest traffic (each save/like needs an
 * impression to exist, and impressions are per-session-sampled so they normally
 * dwarf engagers). 1.5 = engagement 50% above recorded impressions, generous
 * enough that best-effort undersampling doesn't false-positive an honest look.
 */
export const VELOCITY_ANOMALY_RATE_CEILING = 1.5

/**
 * HISTORICAL_SPIKE threshold: window engagement-per-day at or above this
 * multiple of the look's own pre-window engagement-per-day is a burst worth
 * reviewing.
 */
export const VELOCITY_ANOMALY_SPIKE_MULTIPLE = 5

/**
 * A look must have at least this many days of history BEFORE the window to be
 * spike-eligible — otherwise a brand-new look's honest launch surge would read
 * as a spike against a near-empty baseline.
 */
export const VELOCITY_ANOMALY_SPIKE_MIN_PRIOR_DAYS = 7

/**
 * Reported/severity cap for the spike multiple when the pre-window baseline is
 * very small — the ratio can blow up (tiny prior daily rate), so we cap it for
 * a stable, sortable, displayable number.
 */
export const VELOCITY_ANOMALY_SPIKE_CAP = 999

/** How many top-engaged looks the window scan pulls before evaluation. */
export const VELOCITY_ANOMALY_CANDIDATE_LIMIT = 500
/** Default + max number of findings the reader returns. */
export const VELOCITY_ANOMALY_DEFAULT_LIMIT = 50
export const VELOCITY_ANOMALY_MAX_LIMIT = 200

const MS_PER_DAY = 24 * 60 * 60 * 1000

export type VelocityAnomalyReason = 'RATE_ANOMALY' | 'HISTORICAL_SPIKE'

export type LookVelocityAnomalyMetrics = {
  windowSaves: number
  windowLikes: number
  windowImpressions: number
  /** saves + likes over the window — each a distinct actor who saw the look. */
  windowEngagement: number
  /** windowEngagement / max(windowImpressions, 1). */
  rateRatio: number
  /** windowDailyRate / priorDailyRate; 0 when the look isn't spike-eligible. */
  spikeMultiple: number
}

export type LookVelocityAnomalyEvaluation = LookVelocityAnomalyMetrics & {
  reasons: VelocityAnomalyReason[]
  /** Higher = more suspicious; blends the two normalized sub-scores. */
  severity: number
}

/**
 * Pure detector. Given a look's window aggregates + its lifetime baseline,
 * decide whether it warrants manual review and how badly. Returns `null` when
 * nothing trips (the common case), so the reader keeps only real findings.
 *
 * Deterministic in `now` (injected) — no wall-clock read — so it's fully
 * unit-testable.
 */
export function evaluateLookVelocityAnomaly(input: {
  windowSaves: number
  windowLikes: number
  windowImpressions: number
  lifetimeSaveCount: number
  lifetimeLikeCount: number
  createdAt: Date
  now: Date
  windowDays: number
}): LookVelocityAnomalyEvaluation | null {
  const windowSaves = Math.max(0, Math.trunc(input.windowSaves))
  const windowLikes = Math.max(0, Math.trunc(input.windowLikes))
  const windowImpressions = Math.max(0, Math.trunc(input.windowImpressions))
  const windowEngagement = windowSaves + windowLikes

  // Nothing below the floor is ever a finding — kills tiny-sample noise.
  if (windowEngagement < VELOCITY_ANOMALY_MIN_ENGAGEMENT) return null

  const windowDays = Math.max(1, input.windowDays)

  // --- Reason 1: engagement outrunning impressions (the §4.1/§5.6 rate check).
  const rateRatio = windowEngagement / Math.max(windowImpressions, 1)
  const rateFlagged = rateRatio >= VELOCITY_ANOMALY_RATE_CEILING

  // --- Reason 2: a burst far above the look's own pre-window daily rate.
  const ageDays = Math.max(
    (input.now.getTime() - input.createdAt.getTime()) / MS_PER_DAY,
    0,
  )
  const priorDays = ageDays - windowDays
  const lifetimeEngagement =
    Math.max(0, Math.trunc(input.lifetimeSaveCount)) +
    Math.max(0, Math.trunc(input.lifetimeLikeCount))
  // Subtract the window's own engagement so the baseline is the pattern BEFORE
  // the spike; clamp at 0 (lifetime counters can lag the live event tables).
  const priorEngagement = Math.max(lifetimeEngagement - windowEngagement, 0)

  let spikeMultiple = 0
  let spikeFlagged = false
  // Spike-eligible only with a REAL prior baseline: a look needs both enough
  // history and non-zero prior engagement to have a "normal pattern" it can
  // spike above. A dormant look's sudden burst has no baseline — if that burst
  // is faked, the RATE_ANOMALY (impossible impressions) catches it; if the
  // impressions match, it's honest discovery, not abuse.
  if (priorDays >= VELOCITY_ANOMALY_SPIKE_MIN_PRIOR_DAYS && priorEngagement > 0) {
    const windowDailyRate = windowEngagement / windowDays
    const priorDailyRate = priorEngagement / priorDays
    // Cap for a stable, sortable, displayable number when the baseline is tiny.
    spikeMultiple = Math.min(
      windowDailyRate / priorDailyRate,
      VELOCITY_ANOMALY_SPIKE_CAP,
    )
    spikeFlagged = spikeMultiple >= VELOCITY_ANOMALY_SPIKE_MULTIPLE
  }

  if (!rateFlagged && !spikeFlagged) return null

  const reasons: VelocityAnomalyReason[] = []
  if (rateFlagged) reasons.push('RATE_ANOMALY')
  if (spikeFlagged) reasons.push('HISTORICAL_SPIKE')

  // Normalize each sub-score to >=1 when its reason trips so a two-reason look
  // outranks a one-reason look and magnitude orders within each tier.
  const rateSeverity = rateFlagged
    ? rateRatio / VELOCITY_ANOMALY_RATE_CEILING
    : 0
  // spikeMultiple is already capped at VELOCITY_ANOMALY_SPIKE_CAP above.
  const spikeSeverity = spikeFlagged
    ? spikeMultiple / VELOCITY_ANOMALY_SPIKE_MULTIPLE
    : 0

  return {
    windowSaves,
    windowLikes,
    windowImpressions,
    windowEngagement,
    rateRatio,
    spikeMultiple,
    reasons,
    severity: rateSeverity + spikeSeverity,
  }
}

// ---------------------------------------------------------------------------
// Impure reader — window scan + join + evaluate.
// ---------------------------------------------------------------------------

export type LookVelocityAnomalyFinding = LookVelocityAnomalyEvaluation & {
  lookPostId: string
  professionalId: string
  /** businessName, else handle, else the id — all PUBLIC (never firstName). */
  proLabel: string
  proHandle: string | null
  caption: string | null
  status: LookPostStatus
  moderationStatus: ModerationStatus
  createdAt: string
}

export type DetectLookVelocityAnomaliesResult = {
  generatedAt: string
  windowDays: number
  /** How many candidate looks the window scan evaluated (before flagging). */
  scannedCount: number
  anomalies: LookVelocityAnomalyFinding[]
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.min(max, Math.max(min, Math.trunc(value)))
}

/** UTC-midnight lower bound covering the last `windowDays` whole days. */
function windowStart(now: Date, windowDays: number): Date {
  const midnight = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  )
  return new Date(midnight - (windowDays - 1) * MS_PER_DAY)
}

function proLabelFor(pro: {
  businessName: string | null
  handle: string | null
  id: string
}): string {
  return pro.businessName?.trim() || pro.handle || pro.id
}

/**
 * Detect look-level velocity anomalies over a trailing window, newest-abuse
 * first. Platform-operator surface: reads across ALL tenants via the explicit
 * cross-tenant opt-out (not a discovery leak) — the same posture as the admin
 * Looks moderation queue.
 *
 * Cost: three bounded windowed aggregates (top-engaged saves/likes + their
 * impressions) plus one metadata read over the candidate set. The window scan
 * drives from ENGAGEMENT — a look with impressions but no engagement can't be
 * anomalous — so the candidate set is proportional to actively-engaged looks.
 * Only feed-visible looks (published + approved) are evaluated: an unpublished
 * or removed look can't gain the visibility/money that gaming targets, and
 * that's the same gate the impression writer applies.
 */
export async function detectLookVelocityAnomalies(
  db: PrismaClient,
  opts: { now: Date; windowDays?: number; limit?: number },
): Promise<DetectLookVelocityAnomaliesResult> {
  const windowDays = clampInt(
    opts.windowDays ?? VELOCITY_ANOMALY_WINDOW_DAYS,
    VELOCITY_ANOMALY_MIN_WINDOW_DAYS,
    VELOCITY_ANOMALY_MAX_WINDOW_DAYS,
  )
  const limit = clampInt(
    opts.limit ?? VELOCITY_ANOMALY_DEFAULT_LIMIT,
    1,
    VELOCITY_ANOMALY_MAX_LIMIT,
  )
  const since = windowStart(opts.now, windowDays)

  // Candidate discovery: the top-engaged looks in the window, by saves and by
  // likes. Union bounds the metadata + impression reads to actively-engaged
  // looks (the only ones that CAN be anomalous).
  const [savesGroups, likesGroups] = await Promise.all([
    db.boardItem.groupBy({
      by: ['lookPostId'],
      where: { createdAt: { gte: since } },
      _count: { lookPostId: true },
      orderBy: { _count: { lookPostId: 'desc' } },
      take: VELOCITY_ANOMALY_CANDIDATE_LIMIT,
    }),
    db.lookLike.groupBy({
      by: ['lookPostId'],
      where: { createdAt: { gte: since } },
      _count: { lookPostId: true },
      orderBy: { _count: { lookPostId: 'desc' } },
      take: VELOCITY_ANOMALY_CANDIDATE_LIMIT,
    }),
  ])

  const savesByLook = new Map<string, number>()
  for (const g of savesGroups) savesByLook.set(g.lookPostId, g._count.lookPostId)
  const likesByLook = new Map<string, number>()
  for (const g of likesGroups) likesByLook.set(g.lookPostId, g._count.lookPostId)

  const candidateIds = [
    ...new Set([...savesByLook.keys(), ...likesByLook.keys()]),
  ]
  if (candidateIds.length === 0) {
    return {
      generatedAt: opts.now.toISOString(),
      windowDays,
      scannedCount: 0,
      anomalies: [],
    }
  }

  const [impressionGroups, looks] = await Promise.all([
    db.lookPostImpressionStat.groupBy({
      by: ['lookPostId'],
      where: { lookPostId: { in: candidateIds }, windowDate: { gte: since } },
      _sum: { count: true },
    }),
    // Platform-operator cross-tenant read (the check:tenant-aware-discovery
    // opt-out) — only feed-visible looks, and only PUBLIC label fields.
    db.lookPost.findMany({
      where: {
        id: { in: candidateIds },
        status: LookPostStatus.PUBLISHED,
        moderationStatus: ModerationStatus.APPROVED,
        professional: { ...platformCrossTenantProVisibilityFilter() },
      },
      select: {
        id: true,
        professionalId: true,
        caption: true,
        status: true,
        moderationStatus: true,
        saveCount: true,
        likeCount: true,
        createdAt: true,
        professional: { select: { id: true, businessName: true, handle: true } },
      },
    }),
  ])

  const impressionsByLook = new Map<string, number>()
  for (const g of impressionGroups) {
    impressionsByLook.set(g.lookPostId, g._sum.count ?? 0)
  }

  const anomalies: LookVelocityAnomalyFinding[] = []
  for (const look of looks) {
    const evaluation = evaluateLookVelocityAnomaly({
      windowSaves: savesByLook.get(look.id) ?? 0,
      windowLikes: likesByLook.get(look.id) ?? 0,
      windowImpressions: impressionsByLook.get(look.id) ?? 0,
      lifetimeSaveCount: look.saveCount,
      lifetimeLikeCount: look.likeCount,
      createdAt: look.createdAt,
      now: opts.now,
      windowDays,
    })
    if (!evaluation) continue

    anomalies.push({
      ...evaluation,
      lookPostId: look.id,
      professionalId: look.professionalId,
      proLabel: proLabelFor(look.professional),
      proHandle: look.professional.handle,
      caption: look.caption,
      status: look.status,
      moderationStatus: look.moderationStatus,
      createdAt: look.createdAt.toISOString(),
    })
  }

  anomalies.sort((a, b) => b.severity - a.severity)

  return {
    generatedAt: opts.now.toISOString(),
    windowDays,
    scannedCount: looks.length,
    anomalies: anomalies.slice(0, limit),
  }
}
