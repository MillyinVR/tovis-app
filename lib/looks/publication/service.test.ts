// lib/looks/publication/service.test.ts
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import {
  LookPostStatus,
  LookPostVisibility,
  LooksSocialJobType,
  MediaVisibility,
  ModerationStatus,
  Prisma,
} from '@prisma/client'

const FIXED_DATE_ISO = '2026-04-20T00:00:00.000Z'
const FIXED_DATE = new Date(FIXED_DATE_ISO)

const mocks = vi.hoisted(() => {
  const mediaAssetFindUnique = vi.fn()
  const lookPostFindUnique = vi.fn()
  const lookPostCreate = vi.fn()
  const lookPostUpdate = vi.fn()

  const tx = {
    mediaAsset: {
      findUnique: mediaAssetFindUnique,
    },
    lookPost: {
      findUnique: lookPostFindUnique,
      create: lookPostCreate,
      update: lookPostUpdate,
    },
  }

  type PublicationTransactionCallback = (
    db: typeof tx,
  ) => Promise<unknown> | unknown

  const prisma = {
    mediaAsset: tx.mediaAsset,
    lookPost: tx.lookPost,
    $transaction: vi.fn(async (callback: PublicationTransactionCallback) => {
      return await callback(tx)
    }),
  }

  const recomputeLookPostScores = vi.fn()
  const enqueueLookPostMutationPolicy = vi.fn()

  return {
    mediaAssetFindUnique,
    lookPostFindUnique,
    lookPostCreate,
    lookPostUpdate,
    tx,
    prisma,
    recomputeLookPostScores,
    enqueueLookPostMutationPolicy,
  }
})

vi.mock('@/lib/looks/counters', () => ({
  recomputeLookPostScores: mocks.recomputeLookPostScores,
}))

vi.mock('@/lib/jobs/looksSocial/mutationEnqueuePolicy', () => ({
  enqueueLookPostMutationPolicy: mocks.enqueueLookPostMutationPolicy,
}))

import {
  createOrUpdateProLookFromMediaAsset,
  getProLookPublicationById,
  updateProLookPublication,
} from './service'

type PublicationDb = Parameters<typeof createOrUpdateProLookFromMediaAsset>[0]

function makeDb(): PublicationDb {
  return mocks.prisma as unknown as PublicationDb
}

function makePrimaryMediaAsset(
  overrides?: Partial<{
    id: string
    professionalId: string
    caption: string | null
    visibility: MediaVisibility
    isEligibleForLooks: boolean
    services: Array<{ serviceId: string }>
  }>,
) {
  return {
    id: 'media_1',
    professionalId: 'pro_1',
    caption: 'Media caption',
    visibility: MediaVisibility.PUBLIC,
    isEligibleForLooks: true,
    services: [{ serviceId: 'service_1' }],
    ...overrides,
  }
}

function makeMediaRow(
  overrides?: Partial<{
    id: string
    professionalId: string
    caption: string | null
    visibility: MediaVisibility
    isEligibleForLooks: boolean
    mediaType: string
    createdAt: Date
    services: Array<{ serviceId: string }>
  }>,
) {
  return {
    id: 'media_1',
    professionalId: 'pro_1',
    caption: 'Media caption',
    visibility: MediaVisibility.PUBLIC,
    isEligibleForLooks: true,
    mediaType: 'IMAGE',
    createdAt: FIXED_DATE,
    services: [{ serviceId: 'service_1' }],
    ...overrides,
  }
}

function makeLookRow(
  overrides?: Partial<{
    id: string
    professionalId: string
    primaryMediaAssetId: string
    serviceId: string | null
    caption: string | null
    priceStartingAt: Prisma.Decimal | null
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
    primaryMediaAsset: ReturnType<typeof makePrimaryMediaAsset>
  }>,
) {
  return {
    id: 'look_1',
    professionalId: 'pro_1',
    primaryMediaAssetId: 'media_1',
    serviceId: 'service_1',
    caption: 'Look caption',
    priceStartingAt: new Prisma.Decimal('45.00'),
    status: LookPostStatus.DRAFT,
    visibility: LookPostVisibility.PUBLIC,
    moderationStatus: ModerationStatus.PENDING_REVIEW,
    publishedAt: null,
    archivedAt: null,
    removedAt: null,
    reviewedAt: null,
    reviewedByUserId: null,
    adminNotes: null,
    reportCount: 0,
    likeCount: 0,
    commentCount: 0,
    saveCount: 0,
    shareCount: 0,
    spotlightScore: 11,
    rankScore: 22,
    createdAt: FIXED_DATE,
    updatedAt: FIXED_DATE,
    primaryMediaAsset: makePrimaryMediaAsset(),
    ...overrides,
  }
}

function makeAsyncEffects(
  overrides?: Partial<{
    lookPostId: string
    mutation:
      | 'PUBLISH'
      | 'EDIT'
      | 'MODERATION_APPROVE'
      | 'MODERATION_REJECT'
      | 'MODERATION_REMOVE'
      | 'VISIBILITY_CHANGE'
    plannedJobs: Array<{
      type: LooksSocialJobType
      processorSupport: 'SUPPORTED' | 'DEFERRED'
    }>
    enqueuedJobs: Array<{
      type: LooksSocialJobType
      disposition: 'ENQUEUED'
      processorSupport: 'SUPPORTED' | 'DEFERRED'
      jobId: string
      dedupeKey: string
    }>
    gatedJobs: Array<{
      type: LooksSocialJobType
      disposition: 'GATED'
      processorSupport: 'DEFERRED'
      reason: 'MODERATION_SCAN_LOOK_POST_DEFERRED'
      message: string
    }>
  }>,
) {
  return {
    lookPostId: 'look_1',
    mutation: 'PUBLISH' as const,
    plannedJobs: [
      {
        type: LooksSocialJobType.RECOMPUTE_LOOK_SPOTLIGHT_SCORE,
        processorSupport: 'SUPPORTED' as const,
      },
      {
        type: LooksSocialJobType.RECOMPUTE_LOOK_RANK_SCORE,
        processorSupport: 'SUPPORTED' as const,
      },
      {
        type: LooksSocialJobType.INDEX_LOOK_POST_DOCUMENT,
        processorSupport: 'SUPPORTED' as const,
      },
      {
        type: LooksSocialJobType.MODERATION_SCAN_LOOK_POST,
        processorSupport: 'DEFERRED' as const,
      },
    ],
    enqueuedJobs: [
      {
        type: LooksSocialJobType.RECOMPUTE_LOOK_SPOTLIGHT_SCORE,
        disposition: 'ENQUEUED' as const,
        processorSupport: 'SUPPORTED' as const,
        jobId: 'job_spotlight_1',
        dedupeKey: 'look:look_1:spotlight',
      },
      {
        type: LooksSocialJobType.RECOMPUTE_LOOK_RANK_SCORE,
        disposition: 'ENQUEUED' as const,
        processorSupport: 'SUPPORTED' as const,
        jobId: 'job_rank_1',
        dedupeKey: 'look:look_1:rank',
      },
      {
        type: LooksSocialJobType.INDEX_LOOK_POST_DOCUMENT,
        disposition: 'ENQUEUED' as const,
        processorSupport: 'SUPPORTED' as const,
        jobId: 'job_index_1',
        dedupeKey: 'look:look_1:index',
      },
    ],
    gatedJobs: [
      {
        type: LooksSocialJobType.MODERATION_SCAN_LOOK_POST,
        disposition: 'GATED' as const,
        processorSupport: 'DEFERRED' as const,
        reason: 'MODERATION_SCAN_LOOK_POST_DEFERRED' as const,
        message:
          'moderationScanLookPost is deferred until the look moderation implementation exists.',
      },
    ],
    ...overrides,
  }
}

function makeExpectedPublicationResult(args: {
  action:
    | 'create_draft'
    | 'publish'
    | 'update'
    | 'archive'
    | 'unpublish'
  row: ReturnType<typeof makeLookRow>
  asyncEffects?: {
    plannedJobs?: Array<{
      type: LooksSocialJobType
      processorSupport: 'SUPPORTED' | 'DEFERRED'
    }>
    enqueuedJobs?: Array<{
      type: LooksSocialJobType
      disposition: 'ENQUEUED'
      processorSupport: 'SUPPORTED' | 'DEFERRED'
      jobId: string
      dedupeKey: string
    }>
    gatedJobs?: Array<{
      type: LooksSocialJobType
      disposition: 'GATED'
      processorSupport: 'DEFERRED'
      reason: 'MODERATION_SCAN_LOOK_POST_DEFERRED'
      message: string
    }>
  }
}) {
  return {
    target: {
      kind: 'LOOK_POST' as const,
      id: args.row.id,
      professionalId: args.row.professionalId,
      primaryMediaAssetId: args.row.primaryMediaAssetId,
    },
    action: args.action,
    result: {
      id: args.row.id,
      professionalId: args.row.professionalId,
      primaryMediaAssetId: args.row.primaryMediaAssetId,
      serviceId: args.row.serviceId,
      caption: args.row.caption,
      priceStartingAt:
        args.row.priceStartingAt === null
          ? null
          : args.row.priceStartingAt.toString(),
      status: args.row.status,
      visibility: args.row.visibility,
      moderationStatus: args.row.moderationStatus,
      publishedAt: args.row.publishedAt?.toISOString() ?? null,
      archivedAt: args.row.archivedAt?.toISOString() ?? null,
      removedAt: args.row.removedAt?.toISOString() ?? null,
      reviewedAt: args.row.reviewedAt?.toISOString() ?? null,
      reviewedByUserId: args.row.reviewedByUserId,
      adminNotes: args.row.adminNotes,
      reportCount: args.row.reportCount,
      likeCount: args.row.likeCount,
      commentCount: args.row.commentCount,
      saveCount: args.row.saveCount,
      shareCount: args.row.shareCount,
      spotlightScore: args.row.spotlightScore,
      rankScore: args.row.rankScore,
      createdAt: args.row.createdAt.toISOString(),
      updatedAt: args.row.updatedAt.toISOString(),
    },
    asyncEffects: {
      plannedJobs: [...(args.asyncEffects?.plannedJobs ?? [])],
      enqueuedJobs: [...(args.asyncEffects?.enqueuedJobs ?? [])],
      gatedJobs: [...(args.asyncEffects?.gatedJobs ?? [])],
    },
  }
}

describe('lib/looks/publication/service.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(FIXED_DATE)

    mocks.recomputeLookPostScores.mockResolvedValue({
      spotlightScore: 11,
      rankScore: 22,
    })

    mocks.enqueueLookPostMutationPolicy.mockResolvedValue(
      makeAsyncEffects(),
    )
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('creates a draft from a public media asset and returns empty async effects', async () => {
    const createdRow = makeLookRow({
      status: LookPostStatus.DRAFT,
      moderationStatus: ModerationStatus.PENDING_REVIEW,
      publishedAt: null,
      archivedAt: null,
    })

    mocks.mediaAssetFindUnique.mockResolvedValue(makeMediaRow())
    mocks.lookPostFindUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(createdRow)
    mocks.lookPostCreate.mockResolvedValue(createdRow)

    const result = await createOrUpdateProLookFromMediaAsset(makeDb(), {
      professionalId: 'pro_1',
      request: {
        mediaAssetId: 'media_1',
        primaryServiceId: 'service_1',
        caption: 'Draft caption',
        priceStartingAt: '45.00',
        visibility: LookPostVisibility.PUBLIC,
        publish: false,
      },
    })

    expect(mocks.prisma.$transaction).toHaveBeenCalledTimes(1)

    expect(mocks.mediaAssetFindUnique).toHaveBeenCalledWith({
      where: { id: 'media_1' },
      select: expect.objectContaining({
        id: true,
        professionalId: true,
        caption: true,
        visibility: true,
        isEligibleForLooks: true,
      }),
    })

    expect(mocks.lookPostFindUnique).toHaveBeenNthCalledWith(1, {
      where: {
        primaryMediaAssetId: 'media_1',
      },
      select: expect.objectContaining({
        id: true,
        professionalId: true,
        primaryMediaAssetId: true,
      }),
    })

    expect(mocks.lookPostCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        professionalId: 'pro_1',
        primaryMediaAssetId: 'media_1',
        serviceId: 'service_1',
        caption: 'Draft caption',
        priceStartingAt: new Prisma.Decimal('45.00'),
        visibility: LookPostVisibility.PUBLIC,
        status: LookPostStatus.DRAFT,
        publishedAt: null,
        archivedAt: null,
        removedAt: null,
      }),
      select: expect.objectContaining({
        id: true,
        professionalId: true,
        primaryMediaAssetId: true,
      }),
    })

    expect(mocks.recomputeLookPostScores).toHaveBeenCalledWith(
      mocks.tx,
      'look_1',
    )

    expect(mocks.enqueueLookPostMutationPolicy).not.toHaveBeenCalled()

    expect(result).toEqual(
      makeExpectedPublicationResult({
        action: 'create_draft',
        row: createdRow,
      }),
    )
  })

  it('publishes a new look, recomputes scores, delegates async work to the policy, and returns those async effects', async () => {
    const publishedRow = makeLookRow({
      status: LookPostStatus.PUBLISHED,
      moderationStatus: ModerationStatus.PENDING_REVIEW,
      publishedAt: FIXED_DATE,
      archivedAt: null,
      caption: 'Published caption',
    })

    const asyncEffects = makeAsyncEffects({
      mutation: 'PUBLISH',
    })

    mocks.mediaAssetFindUnique.mockResolvedValue(makeMediaRow())
    mocks.lookPostFindUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(publishedRow)
    mocks.lookPostCreate.mockResolvedValue(publishedRow)
    mocks.enqueueLookPostMutationPolicy.mockResolvedValue(asyncEffects)

    const result = await createOrUpdateProLookFromMediaAsset(makeDb(), {
      professionalId: 'pro_1',
      request: {
        mediaAssetId: 'media_1',
        primaryServiceId: 'service_1',
        caption: 'Published caption',
        priceStartingAt: '45.00',
        visibility: LookPostVisibility.PUBLIC,
        publish: true,
      },
    })

    expect(mocks.lookPostCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        professionalId: 'pro_1',
        primaryMediaAssetId: 'media_1',
        serviceId: 'service_1',
        caption: 'Published caption',
        priceStartingAt: new Prisma.Decimal('45.00'),
        visibility: LookPostVisibility.PUBLIC,
        status: LookPostStatus.PUBLISHED,
        publishedAt: FIXED_DATE,
        archivedAt: null,
        removedAt: null,
      }),
      select: expect.objectContaining({
        id: true,
        professionalId: true,
        primaryMediaAssetId: true,
      }),
    })

    expect(mocks.recomputeLookPostScores).toHaveBeenCalledWith(
      mocks.tx,
      'look_1',
    )

    expect(mocks.enqueueLookPostMutationPolicy).toHaveBeenCalledWith(
      mocks.tx,
      {
        lookPostId: 'look_1',
        mutation: 'PUBLISH',
        feedEligibilityChanged: true,
        rankingRelevantChanged: true,
        searchableDocumentChanged: true,
        contentRequiresModerationScan: true,
      },
    )

    expect(result).toEqual(
      makeExpectedPublicationResult({
        action: 'publish',
        row: publishedRow,
        asyncEffects,
      }),
    )
  })

  it('updates a published look caption, then asks the policy for searchable-document and moderation-scan effects', async () => {
    const existingRow = makeLookRow({
      status: LookPostStatus.PUBLISHED,
      moderationStatus: ModerationStatus.APPROVED,
      publishedAt: FIXED_DATE,
      caption: 'Old caption',
      visibility: LookPostVisibility.PUBLIC,
    })

    const updatedRow = makeLookRow({
      status: LookPostStatus.PUBLISHED,
      moderationStatus: ModerationStatus.APPROVED,
      publishedAt: FIXED_DATE,
      caption: 'New caption',
      visibility: LookPostVisibility.PUBLIC,
    })

    const asyncEffects = makeAsyncEffects({
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
          dedupeKey: 'look:look_1:index',
        },
      ],
    })

    mocks.lookPostFindUnique
      .mockResolvedValueOnce(existingRow)
      .mockResolvedValueOnce(updatedRow)
    mocks.lookPostUpdate.mockResolvedValue(updatedRow)
    mocks.enqueueLookPostMutationPolicy.mockResolvedValue(asyncEffects)

    const result = await updateProLookPublication(makeDb(), {
      professionalId: 'pro_1',
      lookPostId: 'look_1',
      request: {
        caption: 'New caption',
      },
    })

    expect(mocks.lookPostUpdate).toHaveBeenCalledWith({
      where: { id: 'look_1' },
      data: {
        caption: 'New caption',
        serviceId: 'service_1',
        priceStartingAt: existingRow.priceStartingAt,
        visibility: LookPostVisibility.PUBLIC,
      },
      select: expect.objectContaining({
        id: true,
        professionalId: true,
        primaryMediaAssetId: true,
      }),
    })

    expect(mocks.recomputeLookPostScores).toHaveBeenCalledWith(
      mocks.tx,
      'look_1',
    )

    expect(mocks.enqueueLookPostMutationPolicy).toHaveBeenCalledWith(
      mocks.tx,
      {
        lookPostId: 'look_1',
        mutation: 'EDIT',
        feedEligibilityChanged: false,
        rankingRelevantChanged: false,
        searchableDocumentChanged: true,
        contentRequiresModerationScan: true,
      },
    )

    expect(result).toEqual(
      makeExpectedPublicationResult({
        action: 'update',
        row: updatedRow,
        asyncEffects,
      }),
    )
  })

  it('updates a published look primary service and delegates ranking plus indexing work to the policy', async () => {
    const existingRow = makeLookRow({
      status: LookPostStatus.PUBLISHED,
      moderationStatus: ModerationStatus.APPROVED,
      publishedAt: FIXED_DATE,
      serviceId: 'service_1',
      primaryMediaAsset: makePrimaryMediaAsset({
        services: [{ serviceId: 'service_1' }, { serviceId: 'service_2' }],
      }),
    })

    const updatedRow = makeLookRow({
      status: LookPostStatus.PUBLISHED,
      moderationStatus: ModerationStatus.APPROVED,
      publishedAt: FIXED_DATE,
      serviceId: 'service_2',
      primaryMediaAsset: makePrimaryMediaAsset({
        services: [{ serviceId: 'service_1' }, { serviceId: 'service_2' }],
      }),
    })

    const asyncEffects = makeAsyncEffects({
      mutation: 'EDIT',
      plannedJobs: [
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
      ],
      enqueuedJobs: [
        {
          type: LooksSocialJobType.RECOMPUTE_LOOK_SPOTLIGHT_SCORE,
          disposition: 'ENQUEUED',
          processorSupport: 'SUPPORTED',
          jobId: 'job_spotlight_1',
          dedupeKey: 'look:look_1:spotlight',
        },
        {
          type: LooksSocialJobType.RECOMPUTE_LOOK_RANK_SCORE,
          disposition: 'ENQUEUED',
          processorSupport: 'SUPPORTED',
          jobId: 'job_rank_1',
          dedupeKey: 'look:look_1:rank',
        },
        {
          type: LooksSocialJobType.INDEX_LOOK_POST_DOCUMENT,
          disposition: 'ENQUEUED',
          processorSupport: 'SUPPORTED',
          jobId: 'job_index_1',
          dedupeKey: 'look:look_1:index',
        },
      ],
      gatedJobs: [],
    })

    mocks.lookPostFindUnique
      .mockResolvedValueOnce(existingRow)
      .mockResolvedValueOnce(updatedRow)
    mocks.lookPostUpdate.mockResolvedValue(updatedRow)
    mocks.enqueueLookPostMutationPolicy.mockResolvedValue(asyncEffects)

    const result = await updateProLookPublication(makeDb(), {
      professionalId: 'pro_1',
      lookPostId: 'look_1',
      request: {
        primaryServiceId: 'service_2',
      },
    })

    expect(mocks.lookPostUpdate).toHaveBeenCalledWith({
      where: { id: 'look_1' },
      data: {
        caption: existingRow.caption,
        serviceId: 'service_2',
        priceStartingAt: existingRow.priceStartingAt,
        visibility: existingRow.visibility,
      },
      select: expect.objectContaining({
        id: true,
        professionalId: true,
        primaryMediaAssetId: true,
      }),
    })

    expect(mocks.enqueueLookPostMutationPolicy).toHaveBeenCalledWith(
      mocks.tx,
      {
        lookPostId: 'look_1',
        mutation: 'EDIT',
        feedEligibilityChanged: false,
        rankingRelevantChanged: true,
        searchableDocumentChanged: true,
        contentRequiresModerationScan: false,
      },
    )

    expect(result).toEqual(
      makeExpectedPublicationResult({
        action: 'update',
        row: updatedRow,
        asyncEffects,
      }),
    )
  })

  it('updates published visibility from public to followers-only and delegates search eligibility work as a visibility change', async () => {
    const existingRow = makeLookRow({
      status: LookPostStatus.PUBLISHED,
      moderationStatus: ModerationStatus.APPROVED,
      publishedAt: FIXED_DATE,
      visibility: LookPostVisibility.PUBLIC,
    })

    const updatedRow = makeLookRow({
      status: LookPostStatus.PUBLISHED,
      moderationStatus: ModerationStatus.APPROVED,
      publishedAt: FIXED_DATE,
      visibility: LookPostVisibility.FOLLOWERS_ONLY,
    })

    const asyncEffects = makeAsyncEffects({
      mutation: 'VISIBILITY_CHANGE',
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
          dedupeKey: 'look:look_1:index',
        },
      ],
      gatedJobs: [],
    })

    mocks.lookPostFindUnique
      .mockResolvedValueOnce(existingRow)
      .mockResolvedValueOnce(updatedRow)
    mocks.lookPostUpdate.mockResolvedValue(updatedRow)
    mocks.enqueueLookPostMutationPolicy.mockResolvedValue(asyncEffects)

    const result = await updateProLookPublication(makeDb(), {
      professionalId: 'pro_1',
      lookPostId: 'look_1',
      request: {
        visibility: LookPostVisibility.FOLLOWERS_ONLY,
      },
    })

    expect(mocks.enqueueLookPostMutationPolicy).toHaveBeenCalledWith(
      mocks.tx,
      {
        lookPostId: 'look_1',
        mutation: 'VISIBILITY_CHANGE',
        feedEligibilityChanged: false,
        rankingRelevantChanged: false,
        searchableDocumentChanged: true,
        contentRequiresModerationScan: false,
      },
    )

    expect(result).toEqual(
      makeExpectedPublicationResult({
        action: 'update',
        row: updatedRow,
        asyncEffects,
      }),
    )
  })

  it('archives a published look and delegates visibility-change async work to the policy', async () => {
    const existingRow = makeLookRow({
      status: LookPostStatus.PUBLISHED,
      moderationStatus: ModerationStatus.APPROVED,
      publishedAt: FIXED_DATE,
      archivedAt: null,
      visibility: LookPostVisibility.PUBLIC,
    })

    const archivedRow = makeLookRow({
      status: LookPostStatus.ARCHIVED,
      moderationStatus: ModerationStatus.APPROVED,
      publishedAt: FIXED_DATE,
      archivedAt: FIXED_DATE,
      visibility: LookPostVisibility.PUBLIC,
    })

    const asyncEffects = makeAsyncEffects({
      mutation: 'VISIBILITY_CHANGE',
      plannedJobs: [
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
      ],
      enqueuedJobs: [
        {
          type: LooksSocialJobType.RECOMPUTE_LOOK_SPOTLIGHT_SCORE,
          disposition: 'ENQUEUED',
          processorSupport: 'SUPPORTED',
          jobId: 'job_spotlight_1',
          dedupeKey: 'look:look_1:spotlight',
        },
        {
          type: LooksSocialJobType.RECOMPUTE_LOOK_RANK_SCORE,
          disposition: 'ENQUEUED',
          processorSupport: 'SUPPORTED',
          jobId: 'job_rank_1',
          dedupeKey: 'look:look_1:rank',
        },
        {
          type: LooksSocialJobType.INDEX_LOOK_POST_DOCUMENT,
          disposition: 'ENQUEUED',
          processorSupport: 'SUPPORTED',
          jobId: 'job_index_1',
          dedupeKey: 'look:look_1:index',
        },
      ],
      gatedJobs: [],
    })

    mocks.lookPostFindUnique
      .mockResolvedValueOnce(existingRow)
      .mockResolvedValueOnce(archivedRow)
    mocks.lookPostUpdate.mockResolvedValue(archivedRow)
    mocks.enqueueLookPostMutationPolicy.mockResolvedValue(asyncEffects)

    const result = await updateProLookPublication(makeDb(), {
      professionalId: 'pro_1',
      lookPostId: 'look_1',
      request: {
        stateAction: 'archive',
      },
    })

    expect(mocks.lookPostUpdate).toHaveBeenCalledWith({
      where: { id: 'look_1' },
      data: {
        caption: existingRow.caption,
        serviceId: existingRow.serviceId,
        priceStartingAt: existingRow.priceStartingAt,
        visibility: existingRow.visibility,
        status: LookPostStatus.ARCHIVED,
        archivedAt: FIXED_DATE,
      },
      select: expect.objectContaining({
        id: true,
        professionalId: true,
        primaryMediaAssetId: true,
      }),
    })

    expect(mocks.enqueueLookPostMutationPolicy).toHaveBeenCalledWith(
      mocks.tx,
      {
        lookPostId: 'look_1',
        mutation: 'VISIBILITY_CHANGE',
        feedEligibilityChanged: true,
        rankingRelevantChanged: true,
        searchableDocumentChanged: true,
      },
    )

    expect(result).toEqual(
      makeExpectedPublicationResult({
        action: 'archive',
        row: archivedRow,
        asyncEffects,
      }),
    )
  })

  it('returns empty async effects when an update changes nothing enqueue-relevant', async () => {
    const existingRow = makeLookRow({
      status: LookPostStatus.PUBLISHED,
      moderationStatus: ModerationStatus.APPROVED,
      publishedAt: FIXED_DATE,
      visibility: LookPostVisibility.PUBLIC,
      caption: 'Stable caption',
    })

    const refreshedRow = makeLookRow({
      status: LookPostStatus.PUBLISHED,
      moderationStatus: ModerationStatus.APPROVED,
      publishedAt: FIXED_DATE,
      visibility: LookPostVisibility.PUBLIC,
      caption: 'Stable caption',
    })

    mocks.lookPostFindUnique
      .mockResolvedValueOnce(existingRow)
      .mockResolvedValueOnce(refreshedRow)
    mocks.lookPostUpdate.mockResolvedValue(refreshedRow)

    const result = await updateProLookPublication(makeDb(), {
      professionalId: 'pro_1',
      lookPostId: 'look_1',
      request: {},
    })

    expect(mocks.recomputeLookPostScores).toHaveBeenCalledWith(
      mocks.tx,
      'look_1',
    )
    expect(mocks.enqueueLookPostMutationPolicy).not.toHaveBeenCalled()

    expect(result).toEqual(
      makeExpectedPublicationResult({
        action: 'update',
        row: refreshedRow,
      }),
    )
  })

  it('loads a publication by id without recompute or enqueue side effects', async () => {
    const lookRow = makeLookRow({
      status: LookPostStatus.PUBLISHED,
      moderationStatus: ModerationStatus.APPROVED,
      publishedAt: FIXED_DATE,
      visibility: LookPostVisibility.PUBLIC,
      caption: 'Already live',
    })

    mocks.lookPostFindUnique.mockResolvedValue(lookRow)

    const result = await getProLookPublicationById(makeDb(), {
      professionalId: 'pro_1',
      lookPostId: 'look_1',
    })

    expect(mocks.lookPostFindUnique).toHaveBeenCalledWith({
      where: { id: 'look_1' },
      select: expect.objectContaining({
        id: true,
        professionalId: true,
        primaryMediaAssetId: true,
      }),
    })

    expect(mocks.recomputeLookPostScores).not.toHaveBeenCalled()
    expect(mocks.enqueueLookPostMutationPolicy).not.toHaveBeenCalled()

    expect(result).toEqual(
      makeExpectedPublicationResult({
        action: 'update',
        row: lookRow,
      }),
    )
  })
})