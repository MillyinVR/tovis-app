// lib/jobs/looksSocial/contracts.ts
import { LooksSocialJobType } from '@prisma/client'

export const LOOKS_SOCIAL_JOB_TYPES = [
  LooksSocialJobType.RECOMPUTE_LOOK_COUNTS,
  LooksSocialJobType.RECOMPUTE_LOOK_SPOTLIGHT_SCORE,
  LooksSocialJobType.RECOMPUTE_LOOK_RANK_SCORE,
  LooksSocialJobType.FAN_OUT_VIRAL_REQUEST_APPROVAL_NOTIFICATIONS,
  LooksSocialJobType.INDEX_LOOK_POST_DOCUMENT,
  LooksSocialJobType.MODERATION_SCAN_LOOK_POST,
  LooksSocialJobType.MODERATION_SCAN_COMMENT,
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

export type IndexLookPostDocumentJobPayload = {
  lookPostId: string
}

export type ModerationScanLookPostJobPayload = {
  lookPostId: string
}

export type ModerationScanCommentJobPayload = {
  commentId: string
}

export type LooksSocialJobPayloadByType = {
  [LooksSocialJobType.RECOMPUTE_LOOK_COUNTS]: RecomputeLookCountsJobPayload
  [LooksSocialJobType.RECOMPUTE_LOOK_SPOTLIGHT_SCORE]: RecomputeLookSpotlightScoreJobPayload
  [LooksSocialJobType.RECOMPUTE_LOOK_RANK_SCORE]: RecomputeLookRankScoreJobPayload
  [LooksSocialJobType.FAN_OUT_VIRAL_REQUEST_APPROVAL_NOTIFICATIONS]: FanOutViralRequestApprovalNotificationsJobPayload
  [LooksSocialJobType.INDEX_LOOK_POST_DOCUMENT]: IndexLookPostDocumentJobPayload
  [LooksSocialJobType.MODERATION_SCAN_LOOK_POST]: ModerationScanLookPostJobPayload
  [LooksSocialJobType.MODERATION_SCAN_COMMENT]: ModerationScanCommentJobPayload
}

export type LooksSocialJobRequest<
  TType extends LooksSocialJobType = LooksSocialJobType,
> = {
  type: TType
  payload: LooksSocialJobPayloadByType[TType]
  runAt?: Date
  maxAttempts?: number
}