// lib/jobs/looksSocial/mutationEnqueuePolicy.test.ts
import {
  afterAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import { LooksSocialJobType, PrismaClient } from '@prisma/client'

const mocks = vi.hoisted(() => {
  const enqueueRecomputeLookCounts = vi.fn()
  const enqueueRecomputeLookSpotlightScore = vi.fn()
  const enqueueRecomputeLookRankScore = vi.fn()
  const enqueueIndexLookPostDocument = vi.fn()
  const enqueueModerationScanLookPost = vi.fn()

  return {
    enqueueRecomputeLookCounts,
    enqueueRecomputeLookSpotlightScore,
    enqueueRecomputeLookRankScore,
    enqueueIndexLookPostDocument,
    enqueueModerationScanLookPost,
  }
})

vi.mock('./enqueue', () => ({
  enqueueRecomputeLookCounts: mocks.enqueueRecomputeLookCounts,
  enqueueRecomputeLookSpotlightScore:
    mocks.enqueueRecomputeLookSpotlightScore,
  enqueueRecomputeLookRankScore: mocks.enqueueRecomputeLookRankScore,
  enqueueIndexLookPostDocument: mocks.enqueueIndexLookPostDocument,
  enqueueModerationScanLookPost: mocks.enqueueModerationScanLookPost,
}))

import {
  enqueueLookPostMutationPolicy,
  planLookPostMutationJobs,
} from './mutationEnqueuePolicy'

type JobDb = Parameters<typeof enqueueLookPostMutationPolicy>[0]

const testDb = new PrismaClient()

function makeDb(): JobDb {
  return testDb
}

function makeQueuedJob(id: string, dedupeKey: string) {
  return {
    id,
    dedupeKey,
  }
}

describe('lib/jobs/looksSocial/mutationEnqueuePolicy.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mocks.enqueueRecomputeLookCounts.mockResolvedValue(
      makeQueuedJob('job_counts_1', 'looks:counts:look_1'),
    )
    mocks.enqueueRecomputeLookSpotlightScore.mockResolvedValue(
      makeQueuedJob('job_spotlight_1', 'looks:spotlight:look_1'),
    )
    mocks.enqueueRecomputeLookRankScore.mockResolvedValue(
      makeQueuedJob('job_rank_1', 'looks:rank:look_1'),
    )
    mocks.enqueueIndexLookPostDocument.mockResolvedValue(
      makeQueuedJob('job_index_1', 'looks:index:look_1'),
    )
    mocks.enqueueModerationScanLookPost.mockResolvedValue(
      makeQueuedJob('job_moderation_1', 'looks:moderation:look_1'),
    )
  })

  afterAll(async () => {
    await testDb.$disconnect()
  })

  it('plans supported and deferred jobs for a publish-like mutation', () => {
    const planned = planLookPostMutationJobs({
      lookPostId: 'look_1',
      mutation: 'PUBLISH',
      countsChanged: true,
      feedEligibilityChanged: true,
      searchableDocumentChanged: true,
      contentRequiresModerationScan: true,
    })

    expect(planned).toEqual([
      {
        type: LooksSocialJobType.RECOMPUTE_LOOK_COUNTS,
        processorSupport: 'SUPPORTED',
      },
      {
        type: LooksSocialJobType.RECOMPUTE_LOOK_SPOTLIGHT_SCORE,
        processorSupport: 'SUPPORTED',
      },
      {
        type: LooksSocialJobType.RECOMPUTE_LOOK_RANK_SCORE,
        processorSupport: 'SUPPORTED',
      },
      {
        type: LooksSocialJobType.INDEX_LOOK_POST_DOCUMENT,
        processorSupport: 'SUPPORTED',
      },
      {
        type: LooksSocialJobType.MODERATION_SCAN_LOOK_POST,
        processorSupport: 'DEFERRED',
      },
    ])
  })

  it('enqueues supported jobs and gates only deferred moderation scanning by default', async () => {
    const db = makeDb()

    const result = await enqueueLookPostMutationPolicy(db, {
      lookPostId: 'look_1',
      mutation: 'PUBLISH',
      countsChanged: true,
      feedEligibilityChanged: true,
      searchableDocumentChanged: true,
      contentRequiresModerationScan: true,
    })

    expect(mocks.enqueueRecomputeLookCounts).toHaveBeenCalledTimes(1)
    expect(mocks.enqueueRecomputeLookCounts.mock.calls[0]?.[0]).toBe(db)
    expect(mocks.enqueueRecomputeLookCounts.mock.calls[0]?.[1]).toEqual({
      lookPostId: 'look_1',
    })

    expect(mocks.enqueueRecomputeLookSpotlightScore).toHaveBeenCalledTimes(1)
    expect(mocks.enqueueRecomputeLookSpotlightScore.mock.calls[0]?.[0]).toBe(
      db,
    )
    expect(mocks.enqueueRecomputeLookSpotlightScore.mock.calls[0]?.[1]).toEqual(
      {
        lookPostId: 'look_1',
      },
    )

    expect(mocks.enqueueRecomputeLookRankScore).toHaveBeenCalledTimes(1)
    expect(mocks.enqueueRecomputeLookRankScore.mock.calls[0]?.[0]).toBe(db)
    expect(mocks.enqueueRecomputeLookRankScore.mock.calls[0]?.[1]).toEqual({
      lookPostId: 'look_1',
    })

    expect(mocks.enqueueIndexLookPostDocument).toHaveBeenCalledTimes(1)
    expect(mocks.enqueueIndexLookPostDocument.mock.calls[0]?.[0]).toBe(db)
    expect(mocks.enqueueIndexLookPostDocument.mock.calls[0]?.[1]).toEqual({
      lookPostId: 'look_1',
    })

    expect(mocks.enqueueModerationScanLookPost).not.toHaveBeenCalled()

    expect(result).toEqual({
      lookPostId: 'look_1',
      mutation: 'PUBLISH',
      plannedJobs: [
        {
          type: LooksSocialJobType.RECOMPUTE_LOOK_COUNTS,
          processorSupport: 'SUPPORTED',
        },
        {
          type: LooksSocialJobType.RECOMPUTE_LOOK_SPOTLIGHT_SCORE,
          processorSupport: 'SUPPORTED',
        },
        {
          type: LooksSocialJobType.RECOMPUTE_LOOK_RANK_SCORE,
          processorSupport: 'SUPPORTED',
        },
        {
          type: LooksSocialJobType.INDEX_LOOK_POST_DOCUMENT,
          processorSupport: 'SUPPORTED',
        },
        {
          type: LooksSocialJobType.MODERATION_SCAN_LOOK_POST,
          processorSupport: 'DEFERRED',
        },
      ],
      enqueuedJobs: [
        {
          type: LooksSocialJobType.RECOMPUTE_LOOK_COUNTS,
          disposition: 'ENQUEUED',
          processorSupport: 'SUPPORTED',
          jobId: 'job_counts_1',
          dedupeKey: 'looks:counts:look_1',
        },
        {
          type: LooksSocialJobType.RECOMPUTE_LOOK_SPOTLIGHT_SCORE,
          disposition: 'ENQUEUED',
          processorSupport: 'SUPPORTED',
          jobId: 'job_spotlight_1',
          dedupeKey: 'looks:spotlight:look_1',
        },
        {
          type: LooksSocialJobType.RECOMPUTE_LOOK_RANK_SCORE,
          disposition: 'ENQUEUED',
          processorSupport: 'SUPPORTED',
          jobId: 'job_rank_1',
          dedupeKey: 'looks:rank:look_1',
        },
        {
          type: LooksSocialJobType.INDEX_LOOK_POST_DOCUMENT,
          disposition: 'ENQUEUED',
          processorSupport: 'SUPPORTED',
          jobId: 'job_index_1',
          dedupeKey: 'looks:index:look_1',
        },
      ],
      gatedJobs: [
        {
          type: LooksSocialJobType.MODERATION_SCAN_LOOK_POST,
          disposition: 'GATED',
          processorSupport: 'DEFERRED',
          reason: 'MODERATION_SCAN_LOOK_POST_DEFERRED',
          message:
            'moderationScanLookPost is deferred until the look moderation implementation exists.',
        },
      ],
    })
  })

  it('always enqueues supported indexing and only conditionally enqueues deferred moderation scanning', async () => {
    const db = makeDb()

    const result = await enqueueLookPostMutationPolicy(db, {
      lookPostId: 'look_1',
      mutation: 'EDIT',
      searchableDocumentChanged: true,
      contentRequiresModerationScan: true,
      deferredMode: 'ENQUEUE',
    })

    expect(mocks.enqueueIndexLookPostDocument).toHaveBeenCalledTimes(1)
    expect(mocks.enqueueIndexLookPostDocument.mock.calls[0]?.[0]).toBe(db)
    expect(mocks.enqueueIndexLookPostDocument.mock.calls[0]?.[1]).toEqual({
      lookPostId: 'look_1',
    })

    expect(mocks.enqueueModerationScanLookPost).toHaveBeenCalledTimes(1)
    expect(mocks.enqueueModerationScanLookPost.mock.calls[0]?.[0]).toBe(db)
    expect(mocks.enqueueModerationScanLookPost.mock.calls[0]?.[1]).toEqual({
      lookPostId: 'look_1',
    })

    expect(result).toEqual({
      lookPostId: 'look_1',
      mutation: 'EDIT',
      plannedJobs: [
        {
          type: LooksSocialJobType.INDEX_LOOK_POST_DOCUMENT,
          processorSupport: 'SUPPORTED',
        },
        {
          type: LooksSocialJobType.MODERATION_SCAN_LOOK_POST,
          processorSupport: 'DEFERRED',
        },
      ],
      enqueuedJobs: [
        {
          type: LooksSocialJobType.INDEX_LOOK_POST_DOCUMENT,
          disposition: 'ENQUEUED',
          processorSupport: 'SUPPORTED',
          jobId: 'job_index_1',
          dedupeKey: 'looks:index:look_1',
        },
        {
          type: LooksSocialJobType.MODERATION_SCAN_LOOK_POST,
          disposition: 'ENQUEUED',
          processorSupport: 'DEFERRED',
          jobId: 'job_moderation_1',
          dedupeKey: 'looks:moderation:look_1',
        },
      ],
      gatedJobs: [],
    })
  })

  it('plans only ranking jobs when the mutation changes ranking inputs only', () => {
    const planned = planLookPostMutationJobs({
      lookPostId: 'look_1',
      mutation: 'EDIT',
      rankingRelevantChanged: true,
    })

    expect(planned).toEqual([
      {
        type: LooksSocialJobType.RECOMPUTE_LOOK_SPOTLIGHT_SCORE,
        processorSupport: 'SUPPORTED',
      },
      {
        type: LooksSocialJobType.RECOMPUTE_LOOK_RANK_SCORE,
        processorSupport: 'SUPPORTED',
      },
    ])
  })

  it('enqueues indexing for searchable-document-only changes', async () => {
    const db = makeDb()

    const result = await enqueueLookPostMutationPolicy(db, {
      lookPostId: 'look_1',
      mutation: 'EDIT',
      searchableDocumentChanged: true,
    })

    expect(mocks.enqueueIndexLookPostDocument).toHaveBeenCalledTimes(1)
    expect(mocks.enqueueIndexLookPostDocument.mock.calls[0]?.[0]).toBe(db)
    expect(mocks.enqueueIndexLookPostDocument.mock.calls[0]?.[1]).toEqual({
      lookPostId: 'look_1',
    })

    expect(mocks.enqueueRecomputeLookCounts).not.toHaveBeenCalled()
    expect(mocks.enqueueRecomputeLookSpotlightScore).not.toHaveBeenCalled()
    expect(mocks.enqueueRecomputeLookRankScore).not.toHaveBeenCalled()
    expect(mocks.enqueueModerationScanLookPost).not.toHaveBeenCalled()

    expect(result).toEqual({
      lookPostId: 'look_1',
      mutation: 'EDIT',
      plannedJobs: [
        {
          type: LooksSocialJobType.INDEX_LOOK_POST_DOCUMENT,
          processorSupport: 'SUPPORTED',
        },
      ],
      enqueuedJobs: [
        {
          type: LooksSocialJobType.INDEX_LOOK_POST_DOCUMENT,
          disposition: 'ENQUEUED',
          processorSupport: 'SUPPORTED',
          jobId: 'job_index_1',
          dedupeKey: 'looks:index:look_1',
        },
      ],
      gatedJobs: [],
    })
  })

  it('returns no jobs when no async side effects are requested', async () => {
    const db = makeDb()

    const result = await enqueueLookPostMutationPolicy(db, {
      lookPostId: 'look_1',
      mutation: 'EDIT',
    })

    expect(result).toEqual({
      lookPostId: 'look_1',
      mutation: 'EDIT',
      plannedJobs: [],
      enqueuedJobs: [],
      gatedJobs: [],
    })

    expect(mocks.enqueueRecomputeLookCounts).not.toHaveBeenCalled()
    expect(mocks.enqueueRecomputeLookSpotlightScore).not.toHaveBeenCalled()
    expect(mocks.enqueueRecomputeLookRankScore).not.toHaveBeenCalled()
    expect(mocks.enqueueIndexLookPostDocument).not.toHaveBeenCalled()
    expect(mocks.enqueueModerationScanLookPost).not.toHaveBeenCalled()
  })

  it('throws when lookPostId is blank', async () => {
    expect(() =>
      planLookPostMutationJobs({
        lookPostId: '   ',
        mutation: 'EDIT',
      }),
    ).toThrowError('lookPostId is required.')

    await expect(
      enqueueLookPostMutationPolicy(makeDb(), {
        lookPostId: '   ',
        mutation: 'EDIT',
      }),
    ).rejects.toThrowError('lookPostId is required.')
  })
})