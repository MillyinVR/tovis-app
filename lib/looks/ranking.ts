// lib/looks/ranking.ts
import { LookPostStatus, ModerationStatus } from '@prisma/client'

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Per-signal weights for a Look's engagement, ordered by the funnel-intent
 * hierarchy in the personalization spec (§2). A save ("I want this") is a
 * stronger booking-intent signal than a share ("this is cool"), which beats a
 * comment, which beats a like. Booking and remix sit above save in the full
 * hierarchy but are not tracked as Look engagement counts yet, so they don't
 * appear here.
 */
export const LOOK_POST_RANK_WEIGHTS = {
  like: 1,
  comment: 2,
  share: 3,
  save: 5,
} as const

export const LOOK_POST_RANK_RECENCY_HALF_LIFE_DAYS = 7

/**
 * Rate-based scoring (spec §4.1). A Look is scored on weighted engagement PER
 * IMPRESSION, not on raw counts — so 3 saves on 10 impressions does not outrank
 * 300 saves on 2,000. Thin-evidence Looks are Bayesian-smoothed toward a typical
 * rate so a lucky early spike regresses to the mean instead of winning forever;
 * this is what breaks the rich-get-richer loop that raw counts create.
 *
 * - `rate`     — the weighted-engagement-per-impression a "typical" Look earns;
 *   smoothing pulls thin-evidence Looks toward this value.
 * - `strength` — pseudo-impressions of prior evidence (the Bayesian K). A Look
 *   needs materially more than `strength` real impressions before its own
 *   observed rate dominates the prior.
 *
 * NOTE: `rate` is a single GLOBAL constant for now. The spec's per-category
 * prior (regress to "typical for THIS service category") is a later epoch step;
 * both values are tunable and overridable per call for tests.
 */
export const LOOK_POST_RANK_PRIOR: LookPostRankPrior = {
  rate: 0.08,
  strength: 50,
}

/**
 * The smoothed rate typically lives in [0, 1] and is hard-bounded below the
 * max signal weight (5) by the impression floor, so scores stay strictly
 * under SCALE × 5 = 1000 — beneath personalizedRanking's seen-penalty. `rankScore`
 * is consumed alongside the additive per-viewer boosts in
 * `lib/looks/personalizedRanking.ts` (follow / category affinity / freshness),
 * which are calibrated against a tens-to-hundreds band. Scale the rate into
 * that band so the engagement backbone stays comparable to those boosts
 * instead of being buried by them.
 */
export const LOOK_POST_RANK_SCORE_SCALE = 200

/**
 * Cold-start visibility floor (spec §2.1). The Bayesian prior stops a
 * zero-impression Look from scoring zero, but prior × scale (~16 at publish)
 * still sits below every moderately-performing Look — so brand-new content
 * would never earn the impressions the rate formula needs. This additive boost
 * lifts a new Look into the competitive band until it has earned real
 * evidence, then gets out of the way:
 *
 *   boost = maxBoost
 *         × (1 − impressions / impressionFloor)   // gone once evidence exists
 *         × (1 − ageDays / windowDays)            // gone once the intro window ends
 *
 * (both factors clamped to [0, 1]; impressions use the same engagement-floored
 * denominator as the smoothed rate, so an old pre-view-tracking Look with real
 * engagement never reads as "cold").
 *
 * - `maxBoost`        — at publish, a zero-impression Look scores
 *   prior×scale + maxBoost ≈ 61: above the typical-rate band (~40) so it gets
 *   shown, below hot content (80+) so it can't bury proven Looks, and far
 *   below personalizedRanking's seen-penalty (1000).
 * - `impressionFloor` — the guaranteed-impression target; set equal to the
 *   prior's pseudo-impression `strength` so support ends exactly when the
 *   Look's real evidence matches the prior's synthetic evidence.
 * - `windowDays`      — the spec's "first N days"; after this the Look
 *   competes purely on its rate even if it never reached the floor.
 *
 * The boost re-evaluates whenever the score is recomputed — every engagement
 * event and every APPLY_LOOK_VIEWS batch — so accruing impressions organically
 * decays it. A Look that gets NO views keeps its publish-time boost, which is
 * the point: it still needs its floor.
 */
export const LOOK_POST_RANK_COLD_START: LookPostRankColdStart = {
  maxBoost: 45,
  impressionFloor: 50,
  windowDays: 14,
}

export type LookPostRankPrior = {
  rate: number
  strength: number
}

export type LookPostRankColdStart = {
  maxBoost: number
  impressionFloor: number
  windowDays: number
}

export type LookPostRankScoreInput = {
  status: LookPostStatus
  moderationStatus: ModerationStatus
  publishedAt: Date | null
  likeCount: number
  commentCount: number
  saveCount: number
  shareCount: number
  // The impression denominator (spec §4.1). Session-deduped feed impressions +
  // detail opens, maintained by the APPLY_LOOK_VIEWS job.
  viewCount: number
}

export type LookPostRankEligibleInput = LookPostRankScoreInput & {
  publishedAt: Date
}

export type LookPostRankScoreOptions = {
  now?: Date
  // Override the Bayesian prior (per-category priors, tests).
  prior?: LookPostRankPrior
  // Override the cold-start visibility floor (tuning, tests).
  coldStart?: LookPostRankColdStart
}

/**
 * Global persisted Look rank scores each Look on stable, per-look signals:
 * publish/moderation state, publishedAt, the engagement counts, and the
 * impression count (the rate denominator).
 *
 * Intentionally deferred from this persisted score:
 * - local relevance
 * - category relevance
 * - follow affinity
 * - viewer-specific personalization
 * (all layered per-viewer at query time in personalizedRanking.ts)
 */
function normalizeCount(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(Math.trunc(value), 0)
}

function normalizeNow(value: Date | undefined): Date {
  const now = value ?? new Date()

  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    throw new Error('rank now must be a valid Date.')
  }

  return now
}

function roundScore(value: number): number {
  return Math.round(value * 10_000) / 10_000
}

function normalizePrior(prior: LookPostRankPrior | undefined): LookPostRankPrior {
  const source = prior ?? LOOK_POST_RANK_PRIOR
  const rate = Number.isFinite(source.rate) ? Math.max(source.rate, 0) : 0
  // Strength must stay strictly positive so the smoothed rate never divides by
  // zero for a zero-impression Look.
  const strength =
    Number.isFinite(source.strength) && source.strength > 0
      ? source.strength
      : LOOK_POST_RANK_PRIOR.strength

  return { rate, strength }
}

function normalizeColdStart(
  coldStart: LookPostRankColdStart | undefined,
): LookPostRankColdStart {
  const source = coldStart ?? LOOK_POST_RANK_COLD_START
  const maxBoost =
    Number.isFinite(source.maxBoost) && source.maxBoost > 0
      ? source.maxBoost
      : 0
  // Floor and window must stay strictly positive so the taper fractions never
  // divide by zero; non-positive overrides mean "no cold-start support".
  const impressionFloor =
    Number.isFinite(source.impressionFloor) && source.impressionFloor > 0
      ? source.impressionFloor
      : 0
  const windowDays =
    Number.isFinite(source.windowDays) && source.windowDays > 0
      ? source.windowDays
      : 0

  return { maxBoost, impressionFloor, windowDays }
}

export function isLookPostRankEligible(
  input: Pick<
    LookPostRankScoreInput,
    'status' | 'moderationStatus' | 'publishedAt'
  >,
): input is LookPostRankEligibleInput {
  return (
    input.status === LookPostStatus.PUBLISHED &&
    input.moderationStatus === ModerationStatus.APPROVED &&
    input.publishedAt instanceof Date
  )
}

/**
 * The intent-weighted sum of a Look's engagement counts (the numerator of the
 * per-impression rate). Not a score on its own — see computeLookPostRankScore.
 */
export function computeLookPostRankWeightedEngagement(
  input: Pick<
    LookPostRankScoreInput,
    'likeCount' | 'commentCount' | 'saveCount' | 'shareCount'
  >,
): number {
  const likeCount = normalizeCount(input.likeCount)
  const commentCount = normalizeCount(input.commentCount)
  const saveCount = normalizeCount(input.saveCount)
  const shareCount = normalizeCount(input.shareCount)

  return (
    likeCount * LOOK_POST_RANK_WEIGHTS.like +
    commentCount * LOOK_POST_RANK_WEIGHTS.comment +
    saveCount * LOOK_POST_RANK_WEIGHTS.save +
    shareCount * LOOK_POST_RANK_WEIGHTS.share
  )
}

/**
 * Bayesian-smoothed weighted engagement per impression (spec §4.1). With zero
 * real impressions the result is exactly the prior rate; as impressions grow the
 * Look's own observed rate takes over. Regresses thin evidence to the mean.
 *
 * The impression denominator is floored at the raw engagement total: every
 * like/comment/save/share implies at least one impression, so a recorded
 * viewCount below that is an undercount, not a signal. This protects looks
 * whose engagement predates view tracking (undercounted denominators would
 * otherwise inflate their rates) and makes engagement-without-impressions an
 * impossible-rate anomaly for the anti-gaming check (spec §5.6).
 */
export function computeLookPostRankImpressions(
  input: Pick<
    LookPostRankScoreInput,
    'likeCount' | 'commentCount' | 'saveCount' | 'shareCount' | 'viewCount'
  >,
): number {
  const rawEngagementCount =
    normalizeCount(input.likeCount) +
    normalizeCount(input.commentCount) +
    normalizeCount(input.saveCount) +
    normalizeCount(input.shareCount)

  return Math.max(normalizeCount(input.viewCount), rawEngagementCount)
}

export function computeLookPostRankSmoothedRate(
  input: Pick<
    LookPostRankScoreInput,
    'likeCount' | 'commentCount' | 'saveCount' | 'shareCount' | 'viewCount'
  >,
  prior?: LookPostRankPrior,
): number {
  const weightedEngagement = computeLookPostRankWeightedEngagement(input)
  const impressions = computeLookPostRankImpressions(input)
  const { rate, strength } = normalizePrior(prior)

  return (weightedEngagement + rate * strength) / (impressions + strength)
}

export function computeLookPostRankRecencyMultiplier(
  publishedAt: Date,
  options?: LookPostRankScoreOptions,
): number {
  const now = normalizeNow(options?.now)
  const ageMs = Math.max(0, now.getTime() - publishedAt.getTime())
  const ageDays = ageMs / DAY_MS

  return 1 / (1 + ageDays / LOOK_POST_RANK_RECENCY_HALF_LIFE_DAYS)
}

/**
 * Cold-start visibility boost (spec §2.1) — see LOOK_POST_RANK_COLD_START for
 * the shape and rationale. Returns 0 once the Look has earned its impression
 * floor OR aged past the intro window, and tapers linearly toward both edges.
 */
export function computeLookPostRankColdStartBoost(
  input: Pick<
    LookPostRankScoreInput,
    | 'likeCount'
    | 'commentCount'
    | 'saveCount'
    | 'shareCount'
    | 'viewCount'
    | 'publishedAt'
  >,
  options?: LookPostRankScoreOptions,
): number {
  if (
    !(input.publishedAt instanceof Date) ||
    Number.isNaN(input.publishedAt.getTime())
  ) {
    return 0
  }

  const { maxBoost, impressionFloor, windowDays } = normalizeColdStart(
    options?.coldStart,
  )
  if (maxBoost <= 0 || impressionFloor <= 0 || windowDays <= 0) return 0

  const impressions = computeLookPostRankImpressions(input)
  const evidenceRemaining = Math.max(0, 1 - impressions / impressionFloor)
  if (evidenceRemaining <= 0) return 0

  const now = normalizeNow(options?.now)
  const ageDays =
    Math.max(0, now.getTime() - input.publishedAt.getTime()) / DAY_MS
  const windowRemaining = Math.max(0, 1 - ageDays / windowDays)
  if (windowRemaining <= 0) return 0

  return maxBoost * evidenceRemaining * windowRemaining
}

export function computeLookPostRankScore(
  input: LookPostRankScoreInput,
  options?: LookPostRankScoreOptions,
): number {
  if (!isLookPostRankEligible(input)) return 0

  const smoothedRate = computeLookPostRankSmoothedRate(input, options?.prior)
  const recencyMultiplier = computeLookPostRankRecencyMultiplier(
    input.publishedAt,
    options,
  )
  const coldStartBoost = computeLookPostRankColdStartBoost(input, options)

  return roundScore(
    smoothedRate * recencyMultiplier * LOOK_POST_RANK_SCORE_SCALE +
      coldStartBoost,
  )
}
