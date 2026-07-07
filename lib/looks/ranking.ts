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
 * The smoothed rate lives in a small ~[0, 1] band. `rankScore` is consumed
 * alongside the additive per-viewer boosts in `lib/looks/forYouRanking.ts`
 * (follow / category affinity / freshness), which are calibrated against a
 * tens-to-hundreds band. Scale the rate into that band so the engagement
 * backbone stays comparable to those boosts instead of being buried by them.
 */
export const LOOK_POST_RANK_SCORE_SCALE = 200

export type LookPostRankPrior = {
  rate: number
  strength: number
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
 * (all layered per-viewer at query time in forYouRanking.ts)
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
 */
export function computeLookPostRankSmoothedRate(
  input: Pick<
    LookPostRankScoreInput,
    'likeCount' | 'commentCount' | 'saveCount' | 'shareCount' | 'viewCount'
  >,
  prior?: LookPostRankPrior,
): number {
  const weightedEngagement = computeLookPostRankWeightedEngagement(input)
  const impressions = normalizeCount(input.viewCount)
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

  return roundScore(
    smoothedRate * recencyMultiplier * LOOK_POST_RANK_SCORE_SCALE,
  )
}
