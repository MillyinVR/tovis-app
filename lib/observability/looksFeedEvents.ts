// lib/observability/looksFeedEvents.ts
//
// Crude, log-based instrumentation for the Looks feed so the personalized cohort can
// be compared against the chronological default (B1, phase 1). Real impression
// tracking arrives with B2; until then we emit one structured line per feed
// serve tagged with its cohort, from which dwell/return proxies are derivable
// offline:
//   - time-in-feed proxy: count of serves per (viewerHash, session) — more page
//     fetches ≈ more scrolling ≈ more dwell.
//   - return proxy: distinct days a viewerHash appears, split by cohort.
// The viewer id is hashed (never logged raw) so the lines carry no PII.

import { createHash } from 'crypto'

const APP_NAME = 'tovis-app'
const NAMESPACE = 'looks_feed'

export type LooksFeedCohort =
  | 'personalized'
  | 'board_feed'
  | 'recent'
  | 'spotlight'
  | 'following'
  | 'category'
  | 'search'

export type LooksFeedServeEvent = {
  cohort: LooksFeedCohort
  authed: boolean
  // 'entry' = first page (no cursor); 'more' = a paginated continuation.
  page: 'entry' | 'more'
  itemCount: number
  userId?: string | null
  // personalized assembly detail (null / omitted for other cohorts).
  backboneCount?: number | null
  injectedCount?: number | null
  seenCount?: number | null
  followedCount?: number | null
  affinityCategoryCount?: number | null
  occasionTagCount?: number | null
  // Visual layer (spec §6.0): signals behind the viewer's taste vector and how
  // many candidates on the page had an embedding to score against.
  tasteSignalCount?: number | null
  candidateEmbeddingCount?: number | null
  // §4.2/§4.4 availability_boost: pros on the page with a near-term-opening row
  // (0 = primitive unpopulated or every candidate's pro booked out).
  availabilitySignalCount?: number | null
  // §6.3 in-session responsiveness: fresh same-session like/save embeddings
  // folded into the taste vector for this serve (0 = stored vector unchanged).
  sessionVisualSignalCount?: number | null
  // §2.2 "not for me": hidden looks excluded from this serve and categories
  // currently under decayed suppression. Rising hide rate = personalization
  // degrading — the cheapest early-warning signal (spec §9). Present on the
  // personalized, chronological, and board cohorts for a signed-in viewer.
  hiddenExcludedCount?: number | null
  categorySuppressionCount?: number | null
  // §4.3/§4.3.1/§4.3.2 feed composition (personalized cohort only): the resolved
  // session intent, its lean on the bookable term, the reserved off-graph
  // exploration slice actually placed, and the displayed bookable/inspiration
  // blend — the composition-ratio + diversity metrics (spec §9).
  sessionIntent?: string | null
  availabilityWeightMultiplier?: number | null
  explorationInjectedCount?: number | null
  bookableCount?: number | null
  inspirationCount?: number | null
  // §6.7 post-booking relationship layer (personalized cohort only): pros the
  // viewer has a completed-booking relationship with, and how many of the
  // displayed page's looks came from one — the relationship-working /
  // on-platform rebook-rate metric (spec §9).
  relationshipProCount?: number | null
  relationshipBoostedCount?: number | null
  // §4.2/§4.5 underbooked fairness on-ramp (personalized cohort only): displayed
  // looks lifted by the on-ramp (bookable AND still under-discovered pro) — the
  // "is the fairness floor reaching new/underbooked pros" metric (spec §9).
  underbookedBoostedCount?: number | null
  // Board feed assembly detail (spec §4.4; null / omitted for other cohorts).
  answerTagCount?: number | null
  feasibilityTagCount?: number | null
  savedExcludedCount?: number | null
  // Badge engine detail (spec §5 + the §9 holdout): looks that EARNED a
  // badge, how many rendered, how many were suppressed by the measurement
  // holdout, and the shown mix by kind. eligible = shown + holdout; per-kind
  // causal lift compares booking outcomes of shown vs holdout exposures.
  badgeEligibleCount?: number | null
  badgeShownCount?: number | null
  badgeHoldoutCount?: number | null
  badgeKindCounts?: Record<string, number> | null
}

export function hashViewerId(userId: string | null | undefined): string | null {
  if (typeof userId !== 'string' || userId.trim().length === 0) return null
  return createHash('sha256').update(userId).digest('hex').slice(0, 16)
}

export function logLooksFeedServe(input: LooksFeedServeEvent): void {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    app: APP_NAME,
    namespace: NAMESPACE,
    level: 'info',
    event: 'looks_feed_serve',
    cohort: input.cohort,
    authed: input.authed,
    page: input.page,
    itemCount: input.itemCount,
    viewerHash: hashViewerId(input.userId),
    backboneCount: input.backboneCount ?? null,
    injectedCount: input.injectedCount ?? null,
    seenCount: input.seenCount ?? null,
    followedCount: input.followedCount ?? null,
    affinityCategoryCount: input.affinityCategoryCount ?? null,
    occasionTagCount: input.occasionTagCount ?? null,
    tasteSignalCount: input.tasteSignalCount ?? null,
    candidateEmbeddingCount: input.candidateEmbeddingCount ?? null,
    availabilitySignalCount: input.availabilitySignalCount ?? null,
    sessionVisualSignalCount: input.sessionVisualSignalCount ?? null,
    hiddenExcludedCount: input.hiddenExcludedCount ?? null,
    categorySuppressionCount: input.categorySuppressionCount ?? null,
    sessionIntent: input.sessionIntent ?? null,
    availabilityWeightMultiplier: input.availabilityWeightMultiplier ?? null,
    explorationInjectedCount: input.explorationInjectedCount ?? null,
    bookableCount: input.bookableCount ?? null,
    inspirationCount: input.inspirationCount ?? null,
    relationshipProCount: input.relationshipProCount ?? null,
    relationshipBoostedCount: input.relationshipBoostedCount ?? null,
    underbookedBoostedCount: input.underbookedBoostedCount ?? null,
    answerTagCount: input.answerTagCount ?? null,
    feasibilityTagCount: input.feasibilityTagCount ?? null,
    savedExcludedCount: input.savedExcludedCount ?? null,
    badgeEligibleCount: input.badgeEligibleCount ?? null,
    badgeShownCount: input.badgeShownCount ?? null,
    badgeHoldoutCount: input.badgeHoldoutCount ?? null,
    badgeKindCounts: input.badgeKindCounts ?? null,
  })

  console.info(line)
}
