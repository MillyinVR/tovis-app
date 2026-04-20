// lib/jobs/looksSocial/enqueue.ts
import {
  LooksSocialJobStatus,
  LooksSocialJobType,
  Prisma,
  PrismaClient,
} from '@prisma/client'

import type {
  FanOutViralRequestApprovalNotificationsJobPayload,
  IndexLookPostDocumentJobPayload,
  ModerationScanCommentJobPayload,
  ModerationScanLookPostJobPayload,
  RecomputeLookCountsJobPayload,
  RecomputeLookRankScoreJobPayload,
  RecomputeLookSpotlightScoreJobPayload,
} from './contracts'

type LooksSocialJobDb = PrismaClient | Prisma.TransactionClient

type EnqueuedLooksSocialJob = {
  id: string
  type: LooksSocialJobType
  dedupeKey: string
  status: LooksSocialJobStatus
  runAt: Date
  attemptCount: number
  maxAttempts: number
}

type PersistLooksSocialJobArgs = {
  type: LooksSocialJobType
  dedupeKey: string
  payload: Prisma.InputJsonValue
  runAt?: Date
  maxAttempts?: number
}

const DEFAULT_MAX_ATTEMPTS = 5

function normalizeRequiredId(name: string, value: string): string {
  const trimmed = value.trim()

  if (!trimmed) {
    throw new Error(`${name} is required.`)
  }

  return trimmed
}

function normalizeRunAt(value: Date | undefined): Date {
  const runAt = value ?? new Date()

  if (!(runAt instanceof Date) || Number.isNaN(runAt.getTime())) {
    throw new Error('runAt must be a valid Date.')
  }

  return runAt
}

function normalizeMaxAttempts(value: number | undefined): number {
  if (value === undefined) return DEFAULT_MAX_ATTEMPTS
  if (!Number.isFinite(value)) {
    throw new Error('maxAttempts must be a finite number.')
  }

  return Math.max(1, Math.trunc(value))
}

/**
 * Single source of truth for persisting Looks/social jobs.
 *
 * Callers must provide an already-normalized dedupeKey + payload.
 * Typed wrapper helpers below are the public API for each job type.
 */
export async function enqueueLooksSocialJob(
  db: LooksSocialJobDb,
  args: PersistLooksSocialJobArgs,
): Promise<EnqueuedLooksSocialJob> {
  const dedupeKey = normalizeRequiredId('dedupeKey', args.dedupeKey)
  const runAt = normalizeRunAt(args.runAt)
  const maxAttempts = normalizeMaxAttempts(args.maxAttempts)

  return db.looksSocialJob.upsert({
    where: { dedupeKey },
    update: {
      type: args.type,
      payload: args.payload,
      status: LooksSocialJobStatus.PENDING,
      runAt,
      claimedAt: null,
      processedAt: null,
      failedAt: null,
      attemptCount: 0,
      maxAttempts,
      lastError: null,
    },
    create: {
      type: args.type,
      dedupeKey,
      payload: args.payload,
      status: LooksSocialJobStatus.PENDING,
      runAt,
      maxAttempts,
    },
    select: {
      id: true,
      type: true,
      dedupeKey: true,
      status: true,
      runAt: true,
      attemptCount: true,
      maxAttempts: true,
    },
  })
}

export function enqueueRecomputeLookCounts(
  db: LooksSocialJobDb,
  payload: RecomputeLookCountsJobPayload,
) {
  const lookPostId = normalizeRequiredId('lookPostId', payload.lookPostId)

  return enqueueLooksSocialJob(db, {
    type: LooksSocialJobType.RECOMPUTE_LOOK_COUNTS,
    dedupeKey: `look:${lookPostId}:recompute-counts`,
    payload: { lookPostId },
  })
}

export function enqueueRecomputeLookSpotlightScore(
  db: LooksSocialJobDb,
  payload: RecomputeLookSpotlightScoreJobPayload,
) {
  const lookPostId = normalizeRequiredId('lookPostId', payload.lookPostId)

  return enqueueLooksSocialJob(db, {
    type: LooksSocialJobType.RECOMPUTE_LOOK_SPOTLIGHT_SCORE,
    dedupeKey: `look:${lookPostId}:recompute-spotlight-score`,
    payload: { lookPostId },
  })
}

export function enqueueRecomputeLookRankScore(
  db: LooksSocialJobDb,
  payload: RecomputeLookRankScoreJobPayload,
) {
  const lookPostId = normalizeRequiredId('lookPostId', payload.lookPostId)

  return enqueueLooksSocialJob(db, {
    type: LooksSocialJobType.RECOMPUTE_LOOK_RANK_SCORE,
    dedupeKey: `look:${lookPostId}:recompute-rank-score`,
    payload: { lookPostId },
  })
}

export function enqueueFanOutViralRequestApprovalNotifications(
  db: LooksSocialJobDb,
  payload: FanOutViralRequestApprovalNotificationsJobPayload,
) {
  const requestId = normalizeRequiredId('requestId', payload.requestId)

  return enqueueLooksSocialJob(db, {
    type: LooksSocialJobType.FAN_OUT_VIRAL_REQUEST_APPROVAL_NOTIFICATIONS,
    dedupeKey: `viral-request:${requestId}:fan-out-approval-notifications`,
    payload: { requestId },
  })
}

export function enqueueIndexLookPostDocument(
  db: LooksSocialJobDb,
  payload: IndexLookPostDocumentJobPayload,
) {
  const lookPostId = normalizeRequiredId('lookPostId', payload.lookPostId)

  return enqueueLooksSocialJob(db, {
    type: LooksSocialJobType.INDEX_LOOK_POST_DOCUMENT,
    dedupeKey: `look:${lookPostId}:index-document`,
    payload: { lookPostId },
  })
}

export function enqueueModerationScanLookPost(
  db: LooksSocialJobDb,
  payload: ModerationScanLookPostJobPayload,
) {
  const lookPostId = normalizeRequiredId('lookPostId', payload.lookPostId)

  return enqueueLooksSocialJob(db, {
    type: LooksSocialJobType.MODERATION_SCAN_LOOK_POST,
    dedupeKey: `look:${lookPostId}:moderation-scan`,
    payload: { lookPostId },
  })
}

export function enqueueModerationScanComment(
  db: LooksSocialJobDb,
  payload: ModerationScanCommentJobPayload,
) {
  const commentId = normalizeRequiredId('commentId', payload.commentId)

  return enqueueLooksSocialJob(db, {
    type: LooksSocialJobType.MODERATION_SCAN_COMMENT,
    dedupeKey: `look-comment:${commentId}:moderation-scan`,
    payload: { commentId },
  })
}