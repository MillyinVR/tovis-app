// lib/jobs/looksSocial/process.ts
import {
  LooksSocialJobStatus,
  LooksSocialJobType,
  Prisma,
} from '@prisma/client'

import { prisma } from '@/lib/prisma'
import {
  recomputeLookPostCounters,
  recomputeLookPostRankScore,
  recomputeLookPostSpotlightScore,
} from '@/lib/looks/counters'
import { enqueueViralRequestApprovalNotifications } from '@/lib/viralRequests'

const DEFAULT_BATCH_SIZE = 100
const MAX_BATCH_SIZE = 250
const RETRY_DELAY_MS = 5 * 60_000

const dueJobSelect = Prisma.validator<Prisma.LooksSocialJobSelect>()({
  id: true,
  type: true,
  payload: true,
  dedupeKey: true,
  runAt: true,
  attemptCount: true,
  maxAttempts: true,
  createdAt: true,
})

type DueLooksSocialJob = Prisma.LooksSocialJobGetPayload<{
  select: typeof dueJobSelect
}>

type ProcessLooksSocialJobOutcome =
  | {
      jobId: string
      type: LooksSocialJobType
      dedupeKey: string
      result: 'COMPLETED'
    }
  | {
      jobId: string
      type: LooksSocialJobType
      dedupeKey: string
      result: 'RETRY_SCHEDULED'
      retryAt: Date
      message: string
    }
  | {
      jobId: string
      type: LooksSocialJobType
      dedupeKey: string
      result: 'FAILED_FINAL'
      message: string
    }

export type ProcessLooksSocialJobsResult = {
  scannedCount: number
  processedCount: number
  completedCount: number
  retryScheduledCount: number
  failedCount: number
  outcomes: ProcessLooksSocialJobOutcome[]
}

function normalizeNow(value: Date | undefined): Date {
  const now = value ?? new Date()

  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    throw new Error('processLooksSocialJobs: invalid now')
  }

  return now
}

function normalizeBatchSize(value: number | undefined): number {
  if (value === undefined) return DEFAULT_BATCH_SIZE
  if (!Number.isFinite(value)) return DEFAULT_BATCH_SIZE

  return Math.max(1, Math.min(MAX_BATCH_SIZE, Math.trunc(value)))
}

function normalizeErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) {
    return 'Unknown job processing error.'
  }

  const message = error.message.trim()
  return message.length > 0 ? message : 'Unknown job processing error.'
}

function isJsonObject(
  value: Prisma.JsonValue,
): value is Record<string, Prisma.JsonValue> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readRequiredString(
  payload: Prisma.JsonValue,
  field: string,
): string {
  if (!isJsonObject(payload)) {
    throw new Error('Job payload must be an object.')
  }

  const value = payload[field]
  if (typeof value !== 'string') {
    throw new Error(`Job payload field ${field} must be a string.`)
  }

  const trimmed = value.trim()
  if (!trimmed) {
    throw new Error(`Job payload field ${field} is required.`)
  }

  return trimmed
}

async function runLooksSocialJob(
  job: DueLooksSocialJob,
  now: Date,
): Promise<void> {
  switch (job.type) {
    case LooksSocialJobType.RECOMPUTE_LOOK_COUNTS:
      await recomputeLookPostCounters(
        prisma,
        readRequiredString(job.payload, 'lookPostId'),
        { now },
      )
      return

    case LooksSocialJobType.RECOMPUTE_LOOK_SPOTLIGHT_SCORE:
      await recomputeLookPostSpotlightScore(
        prisma,
        readRequiredString(job.payload, 'lookPostId'),
        { now },
      )
      return

    case LooksSocialJobType.RECOMPUTE_LOOK_RANK_SCORE:
      await recomputeLookPostRankScore(
        prisma,
        readRequiredString(job.payload, 'lookPostId'),
      )
      return

    case LooksSocialJobType.FAN_OUT_VIRAL_REQUEST_APPROVAL_NOTIFICATIONS:
      await enqueueViralRequestApprovalNotifications(prisma, {
        requestId: readRequiredString(job.payload, 'requestId'),
      })
      return

    case LooksSocialJobType.INDEX_LOOK_POST_DOCUMENT:
      throw new Error(
        'indexLookPostDocument is deferred until the search indexing implementation exists.',
      )

    case LooksSocialJobType.MODERATION_SCAN_LOOK_POST:
      throw new Error(
        'moderationScanLookPost is deferred until the look moderation implementation exists.',
      )

    case LooksSocialJobType.MODERATION_SCAN_COMMENT:
      throw new Error(
        'moderationScanComment is deferred until the comment moderation implementation exists.',
      )
  }
}

async function claimDueJob(
  job: DueLooksSocialJob,
  now: Date,
): Promise<boolean> {
  const claimed = await prisma.looksSocialJob.updateMany({
    where: {
      id: job.id,
      status: LooksSocialJobStatus.PENDING,
      runAt: {
        lte: now,
      },
    },
    data: {
      status: LooksSocialJobStatus.PROCESSING,
      claimedAt: now,
      attemptCount: {
        increment: 1,
      },
    },
  })

  return claimed.count === 1
}

async function markJobCompleted(
  job: DueLooksSocialJob,
  now: Date,
): Promise<void> {
  await prisma.looksSocialJob.update({
    where: { id: job.id },
    data: {
      status: LooksSocialJobStatus.COMPLETED,
      claimedAt: null,
      processedAt: now,
      failedAt: null,
      lastError: null,
    },
    select: { id: true },
  })
}

async function markJobFailure(args: {
  job: DueLooksSocialJob
  now: Date
  message: string
}): Promise<ProcessLooksSocialJobOutcome> {
  const nextAttemptCount = args.job.attemptCount + 1
  const exhausted = nextAttemptCount >= args.job.maxAttempts

  if (exhausted) {
    await prisma.looksSocialJob.update({
      where: { id: args.job.id },
      data: {
        status: LooksSocialJobStatus.FAILED,
        claimedAt: null,
        failedAt: args.now,
        lastError: args.message,
      },
      select: { id: true },
    })

    return {
      jobId: args.job.id,
      type: args.job.type,
      dedupeKey: args.job.dedupeKey,
      result: 'FAILED_FINAL',
      message: args.message,
    }
  }

  const retryAt = new Date(args.now.getTime() + RETRY_DELAY_MS)

  await prisma.looksSocialJob.update({
    where: { id: args.job.id },
    data: {
      status: LooksSocialJobStatus.PENDING,
      claimedAt: null,
      runAt: retryAt,
      lastError: args.message,
    },
    select: { id: true },
  })

  return {
    jobId: args.job.id,
    type: args.job.type,
    dedupeKey: args.job.dedupeKey,
    result: 'RETRY_SCHEDULED',
    retryAt,
    message: args.message,
  }
}

function buildSummary(args: {
  scannedCount: number
  outcomes: ProcessLooksSocialJobOutcome[]
}): ProcessLooksSocialJobsResult {
  let completedCount = 0
  let retryScheduledCount = 0
  let failedCount = 0

  for (const outcome of args.outcomes) {
    switch (outcome.result) {
      case 'COMPLETED':
        completedCount += 1
        break
      case 'RETRY_SCHEDULED':
        retryScheduledCount += 1
        break
      case 'FAILED_FINAL':
        failedCount += 1
        break
    }
  }

  return {
    scannedCount: args.scannedCount,
    processedCount: args.outcomes.length,
    completedCount,
    retryScheduledCount,
    failedCount,
    outcomes: args.outcomes,
  }
}

export async function processLooksSocialJobs(args?: {
  now?: Date
  batchSize?: number
}): Promise<ProcessLooksSocialJobsResult> {
  const now = normalizeNow(args?.now)
  const batchSize = normalizeBatchSize(args?.batchSize)

  const dueJobs = await prisma.looksSocialJob.findMany({
    where: {
      status: LooksSocialJobStatus.PENDING,
      runAt: {
        lte: now,
      },
    },
    orderBy: [{ runAt: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    take: batchSize,
    select: dueJobSelect,
  })

  const outcomes: ProcessLooksSocialJobOutcome[] = []

  for (const job of dueJobs) {
    const claimed = await claimDueJob(job, now)
    if (!claimed) {
      continue
    }

    try {
      await runLooksSocialJob(job, now)
      await markJobCompleted(job, now)

      outcomes.push({
        jobId: job.id,
        type: job.type,
        dedupeKey: job.dedupeKey,
        result: 'COMPLETED',
      })
    } catch (error) {
      outcomes.push(
        await markJobFailure({
          job,
          now,
          message: normalizeErrorMessage(error),
        }),
      )
    }
  }

  return buildSummary({
    scannedCount: dueJobs.length,
    outcomes,
  })
}