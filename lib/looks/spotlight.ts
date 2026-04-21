// lib/looks/spotlight.ts
import {
  LookPostStatus,
  ModerationStatus,
  Prisma,
} from '@prisma/client'

const DAY_MS = 24 * 60 * 60 * 1000

export const LOOK_POST_SPOTLIGHT_MIN_INTERACTIONS = 5
export const LOOK_POST_SPOTLIGHT_MIN_SAVE_COUNT = 1
export const LOOK_POST_SPOTLIGHT_RECENCY_HALF_LIFE_DAYS = 14

export type LookPostSpotlightScoreInput = {
  status: LookPostStatus
  moderationStatus: ModerationStatus
  publishedAt: Date | null
  likeCount: number
  commentCount: number
  saveCount: number
}

export type LookPostSpotlightEligibleInput = LookPostSpotlightScoreInput & {
  publishedAt: Date
}

export type LookPostSpotlightScoreOptions = {
  now?: Date
}

function normalizeCount(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(Math.trunc(value), 0)
}

function normalizeNow(value: Date | undefined): Date {
  const now = value ?? new Date()

  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    throw new Error('spotlight now must be a valid Date.')
  }

  return now
}

function roundScore(value: number): number {
  return Math.round(value * 10_000) / 10_000
}

export function getLookPostSpotlightInteractionCount(
  input: Pick<
    LookPostSpotlightScoreInput,
    'likeCount' | 'commentCount' | 'saveCount'
  >,
): number {
  return (
    normalizeCount(input.likeCount) +
    normalizeCount(input.commentCount) +
    normalizeCount(input.saveCount)
  )
}

export function computeLookPostSpotlightSaveRate(
  input: Pick<
    LookPostSpotlightScoreInput,
    'likeCount' | 'commentCount' | 'saveCount'
  >,
): number {
  const interactionCount = getLookPostSpotlightInteractionCount(input)
  if (interactionCount === 0) return 0

  return normalizeCount(input.saveCount) / interactionCount
}

export function computeLookPostSpotlightRecencyMultiplier(
  publishedAt: Date,
  options?: LookPostSpotlightScoreOptions,
): number {
  const now = normalizeNow(options?.now)
  const ageMs = Math.max(0, now.getTime() - publishedAt.getTime())
  const ageDays = ageMs / DAY_MS

  return 1 / (1 + ageDays / LOOK_POST_SPOTLIGHT_RECENCY_HALF_LIFE_DAYS)
}

export function isLookPostSpotlightEligible(
  input: LookPostSpotlightScoreInput,
): input is LookPostSpotlightEligibleInput {
  if (input.status !== LookPostStatus.PUBLISHED) return false
  if (input.moderationStatus !== ModerationStatus.APPROVED) return false
  if (!(input.publishedAt instanceof Date)) return false

  const interactionCount = getLookPostSpotlightInteractionCount(input)
  const saveCount = normalizeCount(input.saveCount)

  if (interactionCount < LOOK_POST_SPOTLIGHT_MIN_INTERACTIONS) return false
  if (saveCount < LOOK_POST_SPOTLIGHT_MIN_SAVE_COUNT) return false

  return true
}

export function computeLookPostSpotlightScore(
  input: LookPostSpotlightScoreInput,
  options?: LookPostSpotlightScoreOptions,
): number {
  if (!isLookPostSpotlightEligible(input)) return 0

  const likeCount = normalizeCount(input.likeCount)
  const commentCount = normalizeCount(input.commentCount)
  const saveCount = normalizeCount(input.saveCount)

  const weightedEngagement =
    likeCount +
    commentCount * 2 +
    saveCount * 4

  const saveRate = computeLookPostSpotlightSaveRate(input)
  const recencyMultiplier = computeLookPostSpotlightRecencyMultiplier(
    input.publishedAt,
    options,
  )

  return roundScore(
    weightedEngagement * (1 + saveRate) * recencyMultiplier,
  )
}

export function buildLookPostSpotlightEligibilityWhere(): Prisma.LookPostWhereInput {
  return {
    spotlightScore: {
      gt: 0,
    },
  }
}