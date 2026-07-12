// lib/looks/badges/engine.ts
//
// The Looks badge engine (personalization spec §5): evaluates which badges a
// look has EARNED from live data, filters and orders them by the commitment
// tier of the look's service category (§5.3), applies the viewer-event
// override (§5.4), rotates among the qualifying set on repeat views (§5.5),
// and carves out a permanent measurement holdout (§9) so every badge kind has
// a causal baseline from day one.
//
// Design rules this module enforces:
// - §5.7.1 Badges are computed, never pro-settable: the only inputs are
//   aggregates of real bookings/boards/locations. There is no manual path.
// - §5.7.2 One badge per card. (The spec allows two; we ship one — the
//   cleanest reading of "never a cluttered card". Revisit with real data.)
// - §5.7.4 Time-sensitive badges need a TTL: stat-derived badges DISQUALIFY
//   when their stat row is stale, instead of rendering stale urgency.
// - §5.3 Urgency/trend/event pressure never renders on HIGH-commitment
//   categories — this guard beats even the §5.4 event override.
// - §9 The holdout is sticky per (viewer, look) so repeat exposures don't
//   contaminate the baseline, and deterministic so it costs no storage.
//
// Everything here is pure and deterministic given its inputs (including
// `now`), so the full selection surface is unit-testable.

import { createHash } from 'crypto'

import type { BoardType } from '@prisma/client'
import {
  BOARD_EVENT_NOUNS,
  BOARD_TYPE_FEED_SIGNALS,
  daysUntilEvent,
} from '@/lib/boards/context'
import type { LookBadgeDto, LookBadgeKind, LookBadgeTone } from '@/lib/looks/types'
import {
  resolveCommitmentTier,
  type LookCommitmentTier,
} from '@/lib/looks/badges/commitmentTiers'

// ---------------------------------------------------------------------------
// Tunables

export const LOOK_BADGE_THRESHOLDS = {
  /** "Booking fast": non-cancelled bookings created in the trailing 48h. */
  bookingFastMinRecent: 3,
  /** "Booked N× this week": remix-attributed bookings on THIS look, 7d. */
  lookBookedRecentlyMin: 2,
  /** "N bookings in 30 days": completed bookings, trailing 30d. */
  booked30dMin: 8,
  /** Rebook badge needs a real denominator before a % is honest. */
  rebookMinClients: 5,
  rebookMinRate: 0.6,
  /** "New to {brand}": pro account age, days. */
  newToPlatformMaxDays: 60,
  /** Event countdown renders inside this horizon (and never day-of/past). */
  eventMaxDays: 120,
  /** Distance badge qualifies inside this radius (miles). */
  distanceMaxMiles: 5,
} as const

/**
 * §5.7.4 TTLs, expressed as maximum stat-row age. The urgency window is tight
 * (the signal is "right now"); the slow-moving social-proof counts tolerate a
 * missed cron run.
 */
export const LOOK_BADGE_URGENCY_STAT_MAX_AGE_MS = 6 * 60 * 60 * 1000
export const LOOK_BADGE_STAT_MAX_AGE_MS = 48 * 60 * 60 * 1000

/** §9: fraction of (viewer, look) pairs that never see an earned badge. */
export const LOOK_BADGE_HOLDOUT_RATE = 0.05

// ---------------------------------------------------------------------------
// Types

export type LookBadgeClass =
  | 'URGENCY'
  | 'TREND'
  | 'TRUST'
  | 'EVENT'
  | 'CONVENIENCE'

export const LOOK_BADGE_CLASS_BY_KIND: Record<LookBadgeKind, LookBadgeClass> = {
  BOOKING_FAST: 'URGENCY',
  LOOK_BOOKED_RECENTLY: 'TREND',
  BOOKED_30D: 'TRUST',
  REBOOK_RATE: 'TRUST',
  NEW_TO_PLATFORM: 'TRUST',
  EVENT_COUNTDOWN: 'EVENT',
  DISTANCE: 'CONVENIENCE',
}

const BADGE_TONE_BY_CLASS: Record<LookBadgeClass, LookBadgeTone> = {
  URGENCY: 'warn',
  TREND: 'accent',
  TRUST: 'success',
  EVENT: 'accent',
  CONVENIENCE: 'info',
}

/**
 * §5.3 class priority per commitment tier. A class absent from a tier's list
 * is SUPPRESSED for that tier, not merely deprioritized — that's how HIGH
 * excludes urgency/trend/event pressure outright. Within a class, kind order
 * is fixed (see TRUST_KIND_ORDER).
 */
export const TIER_CLASS_PRIORITY: Record<
  LookCommitmentTier,
  readonly LookBadgeClass[]
> = {
  HIGH: ['TRUST', 'CONVENIENCE'],
  MEDIUM: ['EVENT', 'TRUST', 'TREND', 'CONVENIENCE', 'URGENCY'],
  LOW: ['URGENCY', 'TREND', 'CONVENIENCE', 'EVENT', 'TRUST'],
}

/** Strongest social proof first; "new here" is the honest fallback hook. */
const TRUST_KIND_ORDER: readonly LookBadgeKind[] = [
  'REBOOK_RATE',
  'BOOKED_30D',
  'NEW_TO_PLATFORM',
]

export type ProBadgeSignals = {
  recentBookingCount: number
  completedBookingCount30d: number
  servedClientCount: number
  rebookedClientCount: number
  /** null = no stat row (reads as all-zero + always-stale). */
  statComputedAt: Date | null
  /** The pro's account creation instant (User.createdAt); null = unknown. */
  accountCreatedAt: Date | null
  /** Viewer→pro primary-location distance; null = unknown/not computed. */
  distanceMiles: number | null
}

export type ViewerEventSignal = {
  boardType: BoardType
  /** Strict YYYY-MM-DD, as stored on Board.eventDate. */
  eventYmd: string
}

export type LookBadgeCandidate = {
  lookPostId: string
  professionalId: string | null
  categorySlug: string | null
  tagSlugs: readonly string[]
}

export type LookBadgeEngineContext = {
  /** Stable per-viewer key: userId, or 'anon' for signed-out viewers. */
  viewerKey: string
  now: Date
  /** Tenant brand display name — "New to {brand}" copy (white-label rule). */
  brandName: string
  viewerEvents: readonly ViewerEventSignal[]
  /** Remix-attributed bookings per look over the trailing 7 days. */
  bookedLast7dByLookId: ReadonlyMap<string, number>
  proSignals: ReadonlyMap<string, ProBadgeSignals>
}

export type LookBadgeDecision = {
  badge: LookBadgeDto | null
  /** True when the look earned at least one badge (pre-holdout). */
  eligible: boolean
  /** True when an earned badge was suppressed by the §9 holdout. */
  holdout: boolean
}

type EvaluatedBadge = {
  kind: LookBadgeKind
  badgeClass: LookBadgeClass
  label: string
}

// ---------------------------------------------------------------------------
// Deterministic hashing (rotation + holdout)

function hashToUnitInterval(key: string): number {
  const digest = createHash('sha256').update(key).digest()
  // First 4 bytes → uint32 → [0, 1). Plenty of entropy for bucketing.
  return digest.readUInt32BE(0) / 0x1_0000_0000
}

export function isInBadgeHoldout(viewerKey: string, lookPostId: string): boolean {
  return (
    hashToUnitInterval(`look-badge-holdout:${viewerKey}:${lookPostId}`) <
    LOOK_BADGE_HOLDOUT_RATE
  )
}

function rotationIndex(
  viewerKey: string,
  lookPostId: string,
  now: Date,
  poolSize: number,
): number {
  const utcDay = Math.floor(now.getTime() / (24 * 60 * 60 * 1000))
  return Math.floor(
    hashToUnitInterval(`look-badge-rotation:${viewerKey}:${lookPostId}:${utcDay}`) *
      poolSize,
  )
}

// ---------------------------------------------------------------------------
// Evaluators — each returns a badge the look has EARNED, or null.

function isStatFresh(signals: ProBadgeSignals, now: Date, maxAgeMs: number): boolean {
  if (!signals.statComputedAt) return false
  const age = now.getTime() - signals.statComputedAt.getTime()
  return age >= 0 && age <= maxAgeMs
}

function evaluateBookingFast(
  signals: ProBadgeSignals | null,
  now: Date,
): EvaluatedBadge | null {
  if (!signals) return null
  if (!isStatFresh(signals, now, LOOK_BADGE_URGENCY_STAT_MAX_AGE_MS)) return null
  if (signals.recentBookingCount < LOOK_BADGE_THRESHOLDS.bookingFastMinRecent) {
    return null
  }
  return { kind: 'BOOKING_FAST', badgeClass: 'URGENCY', label: 'Booking fast' }
}

function evaluateLookBookedRecently(
  bookedLast7d: number | undefined,
): EvaluatedBadge | null {
  if (
    typeof bookedLast7d !== 'number' ||
    bookedLast7d < LOOK_BADGE_THRESHOLDS.lookBookedRecentlyMin
  ) {
    return null
  }
  return {
    kind: 'LOOK_BOOKED_RECENTLY',
    badgeClass: 'TREND',
    label: `Booked ${bookedLast7d}× this week`,
  }
}

function evaluateBooked30d(
  signals: ProBadgeSignals | null,
  now: Date,
): EvaluatedBadge | null {
  if (!signals) return null
  if (!isStatFresh(signals, now, LOOK_BADGE_STAT_MAX_AGE_MS)) return null
  if (signals.completedBookingCount30d < LOOK_BADGE_THRESHOLDS.booked30dMin) {
    return null
  }
  return {
    kind: 'BOOKED_30D',
    badgeClass: 'TRUST',
    label: `${signals.completedBookingCount30d} bookings in 30 days`,
  }
}

function evaluateRebookRate(
  signals: ProBadgeSignals | null,
  now: Date,
): EvaluatedBadge | null {
  if (!signals) return null
  if (!isStatFresh(signals, now, LOOK_BADGE_STAT_MAX_AGE_MS)) return null
  if (signals.servedClientCount < LOOK_BADGE_THRESHOLDS.rebookMinClients) {
    return null
  }
  const rate = signals.rebookedClientCount / signals.servedClientCount
  if (!Number.isFinite(rate) || rate < LOOK_BADGE_THRESHOLDS.rebookMinRate) {
    return null
  }
  const percent = Math.min(100, Math.round(rate * 100))
  return {
    kind: 'REBOOK_RATE',
    badgeClass: 'TRUST',
    label: `${percent}% of clients rebook`,
  }
}

function evaluateNewToPlatform(
  signals: ProBadgeSignals | null,
  now: Date,
  brandName: string,
): EvaluatedBadge | null {
  if (!signals?.accountCreatedAt) return null
  const ageMs = now.getTime() - signals.accountCreatedAt.getTime()
  const maxMs = LOOK_BADGE_THRESHOLDS.newToPlatformMaxDays * 24 * 60 * 60 * 1000
  if (ageMs < 0 || ageMs > maxMs) return null
  return {
    kind: 'NEW_TO_PLATFORM',
    badgeClass: 'TRUST',
    label: `New to ${brandName}`,
  }
}

/**
 * §5.4/§8: the viewer's own declared event, counted down on looks that read
 * as that occasion. Matches a board's occasion tag slugs against the look's
 * tags, or its implied category slugs against the look's category — the same
 * best-effort mapping the feed occasion boost uses (BOARD_TYPE_FEED_SIGNALS).
 * The soonest matching future event wins. Never renders day-of or past (the
 * countdown would be pressure, not help), and never beyond the horizon.
 */
function evaluateEventCountdown(
  candidate: LookBadgeCandidate,
  viewerEvents: readonly ViewerEventSignal[],
  now: Date,
): EvaluatedBadge | null {
  let bestDays: number | null = null
  let bestNoun: string | null = null

  for (const event of viewerEvents) {
    const noun = BOARD_EVENT_NOUNS[event.boardType]
    if (!noun) continue

    const days = daysUntilEvent(event.eventYmd, now)
    if (days === null || days < 1 || days > LOOK_BADGE_THRESHOLDS.eventMaxDays) {
      continue
    }

    const signals = BOARD_TYPE_FEED_SIGNALS[event.boardType]
    const tagMatch = signals.tagSlugs.some((slug) =>
      candidate.tagSlugs.includes(slug),
    )
    const categoryMatch =
      candidate.categorySlug !== null &&
      signals.categorySlugs.includes(candidate.categorySlug)
    if (!tagMatch && !categoryMatch) continue

    if (bestDays === null || days < bestDays) {
      bestDays = days
      bestNoun = noun
    }
  }

  if (bestDays === null || bestNoun === null) return null
  return {
    kind: 'EVENT_COUNTDOWN',
    badgeClass: 'EVENT',
    label: `${bestDays} ${bestDays === 1 ? 'day' : 'days'} until ${bestNoun}`,
  }
}

function evaluateDistance(signals: ProBadgeSignals | null): EvaluatedBadge | null {
  const miles = signals?.distanceMiles
  if (typeof miles !== 'number' || !Number.isFinite(miles) || miles < 0) {
    return null
  }
  if (miles > LOOK_BADGE_THRESHOLDS.distanceMaxMiles) return null
  const label =
    miles < 1
      ? 'Under a mile away'
      : `About ${Math.max(1, Math.round(miles))} miles away`
  return { kind: 'DISTANCE', badgeClass: 'CONVENIENCE', label }
}

// ---------------------------------------------------------------------------
// Selection

/**
 * Every badge the look has earned, ordered by the tier's class priority (then
 * the fixed within-class order). Classes outside the tier's list are dropped
 * entirely — that's the §5.3 suppression.
 */
export function evaluateBadgePool(
  candidate: LookBadgeCandidate,
  ctx: LookBadgeEngineContext,
): EvaluatedBadge[] {
  const signals = candidate.professionalId
    ? (ctx.proSignals.get(candidate.professionalId) ?? null)
    : null

  const earned: EvaluatedBadge[] = []

  const push = (badge: EvaluatedBadge | null) => {
    if (badge) earned.push(badge)
  }

  push(evaluateBookingFast(signals, ctx.now))
  push(evaluateLookBookedRecently(ctx.bookedLast7dByLookId.get(candidate.lookPostId)))
  push(evaluateRebookRate(signals, ctx.now))
  push(evaluateBooked30d(signals, ctx.now))
  push(evaluateNewToPlatform(signals, ctx.now, ctx.brandName))
  push(evaluateEventCountdown(candidate, ctx.viewerEvents, ctx.now))
  push(evaluateDistance(signals))

  const tier = resolveCommitmentTier(candidate.categorySlug)
  const classPriority = TIER_CLASS_PRIORITY[tier]

  const classRank = (badgeClass: LookBadgeClass) =>
    classPriority.indexOf(badgeClass)
  const kindRank = (badge: EvaluatedBadge) => {
    const withinClass = TRUST_KIND_ORDER.indexOf(badge.kind)
    return withinClass === -1 ? 0 : withinClass
  }

  return earned
    .filter((badge) => classRank(badge.badgeClass) !== -1)
    .sort(
      (a, b) =>
        classRank(a.badgeClass) - classRank(b.badgeClass) ||
        kindRank(a) - kindRank(b),
    )
}

/**
 * Pick the one badge to render for this (viewer, look) exposure.
 *
 * - Empty pool → no badge, not eligible.
 * - §9 holdout (sticky per viewer-look) → no badge, but counted eligible so
 *   the serve log carries the causal baseline.
 * - §5.4 event override: a qualifying EVENT badge wins outright. (It can only
 *   be in the pool on non-HIGH tiers, so the §5.3 guard still holds; its
 *   label also changes daily, which makes it rotation-proof by construction.)
 * - Otherwise §5.5 rotation: a deterministic per-(viewer, look, UTC-day) pick
 *   across the priority-ordered pool, so a repeat viewer sees the qualifying
 *   set rotate instead of one label going stale.
 */
export function selectLookBadge(
  candidate: LookBadgeCandidate,
  ctx: LookBadgeEngineContext,
): LookBadgeDecision {
  const pool = evaluateBadgePool(candidate, ctx)
  if (pool.length === 0) {
    return { badge: null, eligible: false, holdout: false }
  }

  if (isInBadgeHoldout(ctx.viewerKey, candidate.lookPostId)) {
    return { badge: null, eligible: true, holdout: true }
  }

  const eventBadge = pool.find((badge) => badge.badgeClass === 'EVENT')
  const selected =
    eventBadge ??
    pool[rotationIndex(ctx.viewerKey, candidate.lookPostId, ctx.now, pool.length)] ??
    pool[0]

  if (!selected) {
    return { badge: null, eligible: false, holdout: false }
  }

  return {
    badge: {
      kind: selected.kind,
      label: selected.label,
      tone: BADGE_TONE_BY_CLASS[selected.badgeClass],
    },
    eligible: true,
    holdout: false,
  }
}
