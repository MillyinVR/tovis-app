// lib/observability/looksFeedEvents.ts
//
// Crude, log-based instrumentation for the Looks feed so the For You cohort can
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
  | 'for_you'
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
  // For You assembly detail (null / omitted for other cohorts).
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
  })

  console.info(line)
}
