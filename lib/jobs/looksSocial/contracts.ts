// lib/jobs/looksSocial/contracts.ts
import { LookImpressionSource, LooksSocialJobType } from '@prisma/client'

export const LOOKS_SOCIAL_JOB_TYPES = [
  LooksSocialJobType.RECOMPUTE_LOOK_COUNTS,
  LooksSocialJobType.RECOMPUTE_LOOK_SPOTLIGHT_SCORE,
  LooksSocialJobType.RECOMPUTE_LOOK_RANK_SCORE,
  LooksSocialJobType.FAN_OUT_VIRAL_REQUEST_APPROVAL_NOTIFICATIONS,
  LooksSocialJobType.FAN_OUT_NEW_LOOK_NOTIFICATIONS,
  LooksSocialJobType.INDEX_LOOK_POST_DOCUMENT,
  LooksSocialJobType.MODERATION_SCAN_LOOK_POST,
  LooksSocialJobType.MODERATION_SCAN_COMMENT,
  LooksSocialJobType.APPLY_LOOK_VIEWS,
  LooksSocialJobType.EMBED_LOOK_POST_IMAGE,
] as const

export type RecomputeLookCountsJobPayload = {
  lookPostId: string
}

export type RecomputeLookSpotlightScoreJobPayload = {
  lookPostId: string
}

export type RecomputeLookRankScoreJobPayload = {
  lookPostId: string
}

export type FanOutViralRequestApprovalNotificationsJobPayload = {
  requestId: string
}

export type FanOutNewLookNotificationsJobPayload = {
  lookPostId: string
}

export type IndexLookPostDocumentJobPayload = {
  lookPostId: string
}

export type ModerationScanLookPostJobPayload = {
  lookPostId: string
}

export type ModerationScanCommentJobPayload = {
  commentId: string
}

// A single sampled view impression: the look plus where it was surfaced
// (spec §5.6). Source drives the per-source, per-day windowed aggregate that
// backs the anti-gaming velocity check.
export type LookViewImpression = {
  lookPostId: string
  source: LookImpressionSource
}

export type ApplyLookViewsJobPayload = {
  // Source-tagged impressions since the last flush (web feed→FEED, detail→
  // DETAIL). Each (look, source) pair counts once per flush — the client already
  // dedupes per session — so repeats collapse; see buildApplyLookViewsUpdate.
  impressions?: LookViewImpression[]
  // Legacy unsourced list (iOS + pre-§5.6 web, plus jobs already queued at
  // deploy time). Read as FEED-sourced impressions for back-compat.
  lookPostIds?: string[]
}

export type EmbedLookPostImageJobPayload = {
  lookPostId: string
}

export type LooksSocialJobPayloadByType = {
  [LooksSocialJobType.RECOMPUTE_LOOK_COUNTS]: RecomputeLookCountsJobPayload
  [LooksSocialJobType.RECOMPUTE_LOOK_SPOTLIGHT_SCORE]: RecomputeLookSpotlightScoreJobPayload
  [LooksSocialJobType.RECOMPUTE_LOOK_RANK_SCORE]: RecomputeLookRankScoreJobPayload
  [LooksSocialJobType.FAN_OUT_VIRAL_REQUEST_APPROVAL_NOTIFICATIONS]: FanOutViralRequestApprovalNotificationsJobPayload
  [LooksSocialJobType.FAN_OUT_NEW_LOOK_NOTIFICATIONS]: FanOutNewLookNotificationsJobPayload
  [LooksSocialJobType.INDEX_LOOK_POST_DOCUMENT]: IndexLookPostDocumentJobPayload
  [LooksSocialJobType.MODERATION_SCAN_LOOK_POST]: ModerationScanLookPostJobPayload
  [LooksSocialJobType.MODERATION_SCAN_COMMENT]: ModerationScanCommentJobPayload
  [LooksSocialJobType.APPLY_LOOK_VIEWS]: ApplyLookViewsJobPayload
  [LooksSocialJobType.EMBED_LOOK_POST_IMAGE]: EmbedLookPostImageJobPayload
}

export type LooksSocialJobRequest<
  TType extends LooksSocialJobType = LooksSocialJobType,
> = {
  type: TType
  payload: LooksSocialJobPayloadByType[TType]
  runAt?: Date
  maxAttempts?: number
}

export type LooksSocialJobBatchCounts = {
  scannedCount: number
  processedCount: number
  completedCount: number
  retryScheduledCount: number
  failedCount: number
}

export type LooksSocialJobPerTypeCounts = Record<
  LooksSocialJobType,
  LooksSocialJobBatchCounts
>

export function makeEmptyLooksSocialJobBatchCounts(): LooksSocialJobBatchCounts {
  return {
    scannedCount: 0,
    processedCount: 0,
    completedCount: 0,
    retryScheduledCount: 0,
    failedCount: 0,
  }
}

export function makeEmptyLooksSocialJobPerTypeCounts(): LooksSocialJobPerTypeCounts {
  return {
    [LooksSocialJobType.RECOMPUTE_LOOK_COUNTS]:
      makeEmptyLooksSocialJobBatchCounts(),
    [LooksSocialJobType.RECOMPUTE_LOOK_SPOTLIGHT_SCORE]:
      makeEmptyLooksSocialJobBatchCounts(),
    [LooksSocialJobType.RECOMPUTE_LOOK_RANK_SCORE]:
      makeEmptyLooksSocialJobBatchCounts(),
    [LooksSocialJobType.FAN_OUT_VIRAL_REQUEST_APPROVAL_NOTIFICATIONS]:
      makeEmptyLooksSocialJobBatchCounts(),
    [LooksSocialJobType.FAN_OUT_NEW_LOOK_NOTIFICATIONS]:
      makeEmptyLooksSocialJobBatchCounts(),
    [LooksSocialJobType.INDEX_LOOK_POST_DOCUMENT]:
      makeEmptyLooksSocialJobBatchCounts(),
    [LooksSocialJobType.MODERATION_SCAN_LOOK_POST]:
      makeEmptyLooksSocialJobBatchCounts(),
    [LooksSocialJobType.MODERATION_SCAN_COMMENT]:
      makeEmptyLooksSocialJobBatchCounts(),
    [LooksSocialJobType.APPLY_LOOK_VIEWS]:
      makeEmptyLooksSocialJobBatchCounts(),
    [LooksSocialJobType.EMBED_LOOK_POST_IMAGE]:
      makeEmptyLooksSocialJobBatchCounts(),
  }
}