// lib/looks/publication/contracts.ts
import {
  LookPostStatus,
  LookPostVisibility,
  LooksSocialJobType,
  ModerationStatus,
  Prisma,
} from '@prisma/client'

export const PRO_LOOK_MUTATION_ACTIONS = [
  'create_draft',
  'publish',
  'update',
  'archive',
  'unpublish',
] as const

export const PRO_LOOK_STATE_ACTIONS = [
  'publish',
  'archive',
  'unpublish',
] as const

export type ProLookMutationAction =
  (typeof PRO_LOOK_MUTATION_ACTIONS)[number]

export type ProLookStateAction = (typeof PRO_LOOK_STATE_ACTIONS)[number]

export type CreateProLookRequestDto = {
  mediaAssetId: string
  primaryServiceId?: string | null
  caption?: string | null
  priceStartingAt?: string | null
  visibility?: LookPostVisibility
  publish?: boolean
}

export type UpdateProLookRequestDto = {
  caption?: string | null
  primaryServiceId?: string | null
  priceStartingAt?: string | null
  visibility?: LookPostVisibility
  stateAction?: ProLookStateAction
}

export type ProLookPublicationTargetDto = {
  kind: 'LOOK_POST'
  id: string
  professionalId: string
  primaryMediaAssetId: string
}

export type ProLookPublicationStateDto = {
  id: string
  professionalId: string
  primaryMediaAssetId: string
  serviceId: string | null
  caption: string | null
  priceStartingAt: string | null

  status: LookPostStatus
  visibility: LookPostVisibility
  moderationStatus: ModerationStatus

  publishedAt: string | null
  archivedAt: string | null
  removedAt: string | null

  reviewedAt: string | null
  reviewedByUserId: string | null
  adminNotes: string | null
  reportCount: number

  likeCount: number
  commentCount: number
  saveCount: number
  shareCount: number

  spotlightScore: number
  rankScore: number

  createdAt: string
  updatedAt: string
}

export type LookPublicationPlannedJobDto = {
  type: LooksSocialJobType
  processorSupport: 'SUPPORTED' | 'DEFERRED'
}

export type LookPublicationEnqueuedJobDto = {
  type: LooksSocialJobType
  disposition: 'ENQUEUED'
  processorSupport: 'SUPPORTED' | 'DEFERRED'
  jobId: string
  dedupeKey: string
}

export type LookPublicationGatedJobReason =
  | 'INDEX_LOOK_POST_DOCUMENT_DEFERRED'
  | 'MODERATION_SCAN_LOOK_POST_DEFERRED'

export type LookPublicationGatedJobDto = {
  type: LooksSocialJobType
  disposition: 'GATED'
  processorSupport: 'DEFERRED'
  reason: LookPublicationGatedJobReason
  message: string
}

export type LookPublicationAsyncEffectsDto = {
  plannedJobs: LookPublicationPlannedJobDto[]
  enqueuedJobs: LookPublicationEnqueuedJobDto[]
  gatedJobs: LookPublicationGatedJobDto[]
}

export type ProLookPublicationResultDto = {
  target: ProLookPublicationTargetDto
  action: ProLookMutationAction
  result: ProLookPublicationStateDto
  asyncEffects: LookPublicationAsyncEffectsDto
}

function toIso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null
}

function requireNonEmptyString(name: string, value: string): string {
  const trimmed = value.trim()

  if (!trimmed) {
    throw new Error(`${name} is required.`)
  }

  return trimmed
}

function isOneOf<T extends string>(
  value: unknown,
  options: readonly T[],
): value is T {
  return typeof value === 'string' && options.includes(value as T)
}

function toNullableDecimalString(
  value: Prisma.Decimal | string | number | null | undefined,
): string | null {
  if (value === null || value === undefined) {
    return null
  }

  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed.length > 0 ? trimmed : null
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value.toString() : null
  }

  return value.toString()
}

export function isProLookMutationAction(
  value: unknown,
): value is ProLookMutationAction {
  return isOneOf(value, PRO_LOOK_MUTATION_ACTIONS)
}

export function isProLookStateAction(
  value: unknown,
): value is ProLookStateAction {
  return isOneOf(value, PRO_LOOK_STATE_ACTIONS)
}

export function isLookPostVisibility(
  value: unknown,
): value is LookPostVisibility {
  return (
    value === LookPostVisibility.PUBLIC ||
    value === LookPostVisibility.FOLLOWERS_ONLY ||
    value === LookPostVisibility.UNLISTED
  )
}

export function toLookPublicationAsyncEffectsDto(args?: {
  plannedJobs?: readonly LookPublicationPlannedJobDto[]
  enqueuedJobs?: readonly LookPublicationEnqueuedJobDto[]
  gatedJobs?: readonly LookPublicationGatedJobDto[]
}): LookPublicationAsyncEffectsDto {
  return {
    plannedJobs: [...(args?.plannedJobs ?? [])],
    enqueuedJobs: [...(args?.enqueuedJobs ?? [])],
    gatedJobs: [...(args?.gatedJobs ?? [])],
  }
}

export function toProLookPublicationResultDto(args: {
  action: ProLookMutationAction
  lookPost: {
    id: string
    professionalId: string
    primaryMediaAssetId: string
    serviceId: string | null
    caption: string | null
    priceStartingAt: Prisma.Decimal | string | number | null

    status: LookPostStatus
    visibility: LookPostVisibility
    moderationStatus: ModerationStatus

    publishedAt: Date | null
    archivedAt: Date | null
    removedAt: Date | null

    reviewedAt: Date | null
    reviewedByUserId: string | null
    adminNotes: string | null
    reportCount: number

    likeCount: number
    commentCount: number
    saveCount: number
    shareCount: number

    spotlightScore: number
    rankScore: number

    createdAt: Date
    updatedAt: Date
  }
  asyncEffects?: {
    plannedJobs?: readonly LookPublicationPlannedJobDto[]
    enqueuedJobs?: readonly LookPublicationEnqueuedJobDto[]
    gatedJobs?: readonly LookPublicationGatedJobDto[]
  }
}): ProLookPublicationResultDto {
  const lookPostId = requireNonEmptyString('lookPost.id', args.lookPost.id)
  const professionalId = requireNonEmptyString(
    'lookPost.professionalId',
    args.lookPost.professionalId,
  )
  const primaryMediaAssetId = requireNonEmptyString(
    'lookPost.primaryMediaAssetId',
    args.lookPost.primaryMediaAssetId,
  )

  return {
    target: {
      kind: 'LOOK_POST',
      id: lookPostId,
      professionalId,
      primaryMediaAssetId,
    },
    action: args.action,
    result: {
      id: lookPostId,
      professionalId,
      primaryMediaAssetId,
      serviceId: args.lookPost.serviceId,
      caption: args.lookPost.caption,
      priceStartingAt: toNullableDecimalString(args.lookPost.priceStartingAt),

      status: args.lookPost.status,
      visibility: args.lookPost.visibility,
      moderationStatus: args.lookPost.moderationStatus,

      publishedAt: toIso(args.lookPost.publishedAt),
      archivedAt: toIso(args.lookPost.archivedAt),
      removedAt: toIso(args.lookPost.removedAt),

      reviewedAt: toIso(args.lookPost.reviewedAt),
      reviewedByUserId: args.lookPost.reviewedByUserId,
      adminNotes: args.lookPost.adminNotes,
      reportCount: args.lookPost.reportCount,

      likeCount: args.lookPost.likeCount,
      commentCount: args.lookPost.commentCount,
      saveCount: args.lookPost.saveCount,
      shareCount: args.lookPost.shareCount,

      spotlightScore: args.lookPost.spotlightScore,
      rankScore: args.lookPost.rankScore,

      createdAt: args.lookPost.createdAt.toISOString(),
      updatedAt: args.lookPost.updatedAt.toISOString(),
    },
    asyncEffects: toLookPublicationAsyncEffectsDto(args.asyncEffects),
  }
}