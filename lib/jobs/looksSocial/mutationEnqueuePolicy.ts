// lib/jobs/looksSocial/mutationEnqueuePolicy.ts
import {
  LooksSocialJobType,
  Prisma,
  PrismaClient,
} from '@prisma/client'

import {
  enqueueIndexLookPostDocument,
  enqueueModerationScanLookPost,
  enqueueRecomputeLookCounts,
  enqueueRecomputeLookRankScore,
  enqueueRecomputeLookSpotlightScore,
} from './enqueue'

type LooksSocialJobDb = PrismaClient | Prisma.TransactionClient

export type LookPostMutationKind =
  | 'PUBLISH'
  | 'EDIT'
  | 'MODERATION_APPROVE'
  | 'MODERATION_REJECT'
  | 'MODERATION_REMOVE'
  | 'VISIBILITY_CHANGE'

export type DeferredLooksSocialJobMode = 'GATE' | 'ENQUEUE'

export type DeferredLookPostJobReason =
  | 'MODERATION_SCAN_LOOK_POST_DEFERRED'

export type EnqueueLookPostMutationPolicyArgs = {
  lookPostId: string
  mutation: LookPostMutationKind

  /**
   * True when the mutation changed like/comment/save-derived aggregates and the
   * caller wants async counter reconciliation in addition to any synchronous
   * recompute it already performed.
   */
  countsChanged?: boolean

  /**
   * True when inputs used by ranking / spotlight selection changed directly,
   * such as caption/category/service/media metadata that affects sortability or
   * discoverability.
   */
  rankingRelevantChanged?: boolean

  /**
   * True when the mutation changes whether the look should participate in
   * feed/ranking/search at all, such as publish, moderation approve/reject,
   * remove, or visibility changes.
   */
  feedEligibilityChanged?: boolean

  /**
   * True when the document sent to search should be reindexed because
   * searchable fields changed, or because the look should be inserted/removed
   * from search due to publish/moderation/visibility state changes.
   */
  searchableDocumentChanged?: boolean

  /**
   * True when content changed in a way that should trigger automated
   * moderation scanning. This is intentionally separate from admin moderation
   * actions, which are already explicit human review decisions.
   */
  contentRequiresModerationScan?: boolean

  /**
   * Default is GATE because the current worker still explicitly defers
   * MODERATION_SCAN_LOOK_POST.
   * Set to ENQUEUE only if you intentionally want to queue deferred work.
   */
  deferredMode?: DeferredLooksSocialJobMode
}

export type PlannedLookPostMutationJob = {
  type: LooksSocialJobType
  processorSupport: 'SUPPORTED' | 'DEFERRED'
}

export type EnqueuedLookPostMutationJob = {
  type: LooksSocialJobType
  disposition: 'ENQUEUED'
  processorSupport: 'SUPPORTED' | 'DEFERRED'
  jobId: string
  dedupeKey: string
}

export type GatedLookPostMutationJob = {
  type: LooksSocialJobType
  disposition: 'GATED'
  processorSupport: 'DEFERRED'
  reason: DeferredLookPostJobReason
  message: string
}

export type EnqueueLookPostMutationPolicyResult = {
  lookPostId: string
  mutation: LookPostMutationKind
  plannedJobs: PlannedLookPostMutationJob[]
  enqueuedJobs: EnqueuedLookPostMutationJob[]
  gatedJobs: GatedLookPostMutationJob[]
}

const SUPPORTED_LOOK_POST_JOB_TYPES = new Set<LooksSocialJobType>([
  LooksSocialJobType.RECOMPUTE_LOOK_COUNTS,
  LooksSocialJobType.RECOMPUTE_LOOK_SPOTLIGHT_SCORE,
  LooksSocialJobType.RECOMPUTE_LOOK_RANK_SCORE,
  LooksSocialJobType.INDEX_LOOK_POST_DOCUMENT,
])

const DEFERRED_LOOK_POST_JOB_TYPES = new Set<LooksSocialJobType>([
  LooksSocialJobType.MODERATION_SCAN_LOOK_POST,
])

/**
 * Keep these messages aligned with lib/jobs/looksSocial/process.ts so a gated
 * result mirrors what the processor would currently do if the job were queued.
 */
const DEFERRED_LOOK_POST_JOB_MESSAGES: Record<
  DeferredLookPostJobReason,
  string
> = {
  MODERATION_SCAN_LOOK_POST_DEFERRED:
    'moderationScanLookPost is deferred until the look moderation implementation exists.',
}

function normalizeRequiredId(name: string, value: string): string {
  const trimmed = value.trim()

  if (!trimmed) {
    throw new Error(`${name} is required.`)
  }

  return trimmed
}

function isSupportedLookPostJobType(type: LooksSocialJobType): boolean {
  return SUPPORTED_LOOK_POST_JOB_TYPES.has(type)
}

function isDeferredLookPostJobType(type: LooksSocialJobType): boolean {
  return DEFERRED_LOOK_POST_JOB_TYPES.has(type)
}

function getProcessorSupportForJobType(
  type: LooksSocialJobType,
): 'SUPPORTED' | 'DEFERRED' {
  if (isDeferredLookPostJobType(type)) {
    return 'DEFERRED'
  }

  if (isSupportedLookPostJobType(type)) {
    return 'SUPPORTED'
  }

  throw new Error(`Unknown look-post job type: ${type}.`)
}

function getDeferredReasonForJobType(
  type: LooksSocialJobType,
): DeferredLookPostJobReason {
  switch (type) {
    case LooksSocialJobType.MODERATION_SCAN_LOOK_POST:
      return 'MODERATION_SCAN_LOOK_POST_DEFERRED'
    default:
      throw new Error(`Unsupported deferred look-post job type: ${type}.`)
  }
}

function addPlannedJob(
  target: Set<LooksSocialJobType>,
  type: LooksSocialJobType,
): void {
  target.add(type)
}

function buildPlannedLookPostMutationJobTypes(
  args: EnqueueLookPostMutationPolicyArgs,
): LooksSocialJobType[] {
  const jobTypes = new Set<LooksSocialJobType>()

  if (args.countsChanged === true) {
    addPlannedJob(jobTypes, LooksSocialJobType.RECOMPUTE_LOOK_COUNTS)
  }

  if (
    args.rankingRelevantChanged === true ||
    args.feedEligibilityChanged === true
  ) {
    addPlannedJob(jobTypes, LooksSocialJobType.RECOMPUTE_LOOK_SPOTLIGHT_SCORE)
    addPlannedJob(jobTypes, LooksSocialJobType.RECOMPUTE_LOOK_RANK_SCORE)
  }

  if (
    args.searchableDocumentChanged === true ||
    args.feedEligibilityChanged === true
  ) {
    addPlannedJob(jobTypes, LooksSocialJobType.INDEX_LOOK_POST_DOCUMENT)
  }

  if (args.contentRequiresModerationScan === true) {
    addPlannedJob(jobTypes, LooksSocialJobType.MODERATION_SCAN_LOOK_POST)
  }

  return [...jobTypes]
}

export function planLookPostMutationJobs(
  args: EnqueueLookPostMutationPolicyArgs,
): PlannedLookPostMutationJob[] {
  normalizeRequiredId('lookPostId', args.lookPostId)

  return buildPlannedLookPostMutationJobTypes(args).map((type) => ({
    type,
    processorSupport: getProcessorSupportForJobType(type),
  }))
}

async function enqueuePlannedLookPostJob(
  db: LooksSocialJobDb,
  lookPostId: string,
  type: LooksSocialJobType,
): Promise<EnqueuedLookPostMutationJob> {
  switch (type) {
    case LooksSocialJobType.RECOMPUTE_LOOK_COUNTS: {
      const job = await enqueueRecomputeLookCounts(db, { lookPostId })
      return {
        type,
        disposition: 'ENQUEUED',
        processorSupport: 'SUPPORTED',
        jobId: job.id,
        dedupeKey: job.dedupeKey,
      }
    }

    case LooksSocialJobType.RECOMPUTE_LOOK_SPOTLIGHT_SCORE: {
      const job = await enqueueRecomputeLookSpotlightScore(db, {
        lookPostId,
      })
      return {
        type,
        disposition: 'ENQUEUED',
        processorSupport: 'SUPPORTED',
        jobId: job.id,
        dedupeKey: job.dedupeKey,
      }
    }

    case LooksSocialJobType.RECOMPUTE_LOOK_RANK_SCORE: {
      const job = await enqueueRecomputeLookRankScore(db, {
        lookPostId,
      })
      return {
        type,
        disposition: 'ENQUEUED',
        processorSupport: 'SUPPORTED',
        jobId: job.id,
        dedupeKey: job.dedupeKey,
      }
    }

    case LooksSocialJobType.INDEX_LOOK_POST_DOCUMENT: {
      const job = await enqueueIndexLookPostDocument(db, { lookPostId })
      return {
        type,
        disposition: 'ENQUEUED',
        processorSupport: 'SUPPORTED',
        jobId: job.id,
        dedupeKey: job.dedupeKey,
      }
    }

    case LooksSocialJobType.MODERATION_SCAN_LOOK_POST: {
      const job = await enqueueModerationScanLookPost(db, { lookPostId })
      return {
        type,
        disposition: 'ENQUEUED',
        processorSupport: 'DEFERRED',
        jobId: job.id,
        dedupeKey: job.dedupeKey,
      }
    }

    default:
      throw new Error(`Unsupported look-post mutation job type: ${type}.`)
  }
}

function buildGatedLookPostJob(
  type: LooksSocialJobType,
): GatedLookPostMutationJob {
  const reason = getDeferredReasonForJobType(type)

  return {
    type,
    disposition: 'GATED',
    processorSupport: 'DEFERRED',
    reason,
    message: DEFERRED_LOOK_POST_JOB_MESSAGES[reason],
  }
}

/**
 * Central policy helper for look-post mutations that may affect counts,
 * ranking, spotlight, search indexing, or moderation scanning.
 *
 * The caller decides which effects are relevant for the current mutation.
 * This helper decides whether each resulting job should be enqueued now or
 * explicitly gated because the processor support is still deferred.
 */
export async function enqueueLookPostMutationPolicy(
  db: LooksSocialJobDb,
  args: EnqueueLookPostMutationPolicyArgs,
): Promise<EnqueueLookPostMutationPolicyResult> {
  const lookPostId = normalizeRequiredId('lookPostId', args.lookPostId)
  const deferredMode = args.deferredMode ?? 'GATE'

  const plannedJobTypes = buildPlannedLookPostMutationJobTypes({
    ...args,
    lookPostId,
  })

  const enqueuedJobs: EnqueuedLookPostMutationJob[] = []
  const gatedJobs: GatedLookPostMutationJob[] = []

  for (const type of plannedJobTypes) {
    if (isSupportedLookPostJobType(type)) {
      enqueuedJobs.push(
        await enqueuePlannedLookPostJob(db, lookPostId, type),
      )
      continue
    }

    if (isDeferredLookPostJobType(type) && deferredMode === 'GATE') {
      gatedJobs.push(buildGatedLookPostJob(type))
      continue
    }

    if (isDeferredLookPostJobType(type) && deferredMode === 'ENQUEUE') {
      enqueuedJobs.push(
        await enqueuePlannedLookPostJob(db, lookPostId, type),
      )
      continue
    }

    throw new Error(`Unknown look-post job type in policy: ${type}.`)
  }

  return {
    lookPostId,
    mutation: args.mutation,
    plannedJobs: plannedJobTypes.map((type) => ({
      type,
      processorSupport: getProcessorSupportForJobType(type),
    })),
    enqueuedJobs,
    gatedJobs,
  }
}