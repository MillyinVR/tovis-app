// lib/looks/ranking.ts
import { LookPostStatus, ModerationStatus } from '@prisma/client'

const DAY_MS = 24 * 60 * 60 * 1000

export const LOOK_POST_RANK_WEIGHTS = {
  like: 1,
  comment: 2,
  save: 4,
} as const

export const LOOK_POST_RANK_RECENCY_HALF_LIFE_DAYS = 7

export type LookPostRankScoreInput = {
  status: LookPostStatus
  moderationStatus: ModerationStatus
  publishedAt: Date | null
  likeCount: number
  commentCount: number
  saveCount: number
}

export type LookPostRankEligibleInput = LookPostRankScoreInput & {
  publishedAt: Date
}

export type LookPostRankScoreOptions = {
  now?: Date
}

/**
 * Global persisted Look rank uses only stable, per-look signals:
 * - publish state
 * - moderation state
 * - publishedAt
 * - likeCount
 * - commentCount
 * - saveCount
 *
 * Intentionally deferred from this persisted score:
 * - local relevance
 * - category relevance
 * - follow affinity
 * - viewer-specific personalization
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

export function computeLookPostRankBaseEngagement(
  input: Pick<
    LookPostRankScoreInput,
    'likeCount' | 'commentCount' | 'saveCount'
  >,
): number {
  const likeCount = normalizeCount(input.likeCount)
  const commentCount = normalizeCount(input.commentCount)
  const saveCount = normalizeCount(input.saveCount)

  return (
    likeCount * LOOK_POST_RANK_WEIGHTS.like +
    commentCount * LOOK_POST_RANK_WEIGHTS.comment +
    saveCount * LOOK_POST_RANK_WEIGHTS.save
  )
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

  const baseEngagement = computeLookPostRankBaseEngagement(input)
  const recencyMultiplier = computeLookPostRankRecencyMultiplier(
    input.publishedAt,
    options,
  )

  return roundScore(baseEngagement * recencyMultiplier)
}