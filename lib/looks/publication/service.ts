// lib/looks/publication/service.ts
import {
  LookPostStatus,
  LookPostVisibility,
  MediaVisibility,
  ModerationStatus,
  Prisma,
  PrismaClient,
} from '@prisma/client'

import {
  toLookPublicationAsyncEffectsDto,
  toProLookPublicationResultDto,
  type CreateProLookRequestDto,
  type LookPublicationAsyncEffectsDto,
  type ProLookMutationAction,
  type ProLookPublicationResultDto,
  type ProLookStateAction,
  type UpdateProLookRequestDto,
} from './contracts'
import { recomputeLookPostScores } from '@/lib/looks/counters'
import {
  enqueueLookPostMutationPolicy,
  type EnqueueLookPostMutationPolicyArgs,
  type EnqueueLookPostMutationPolicyResult,
} from '@/lib/jobs/looksSocial/mutationEnqueuePolicy'

export type LookPublicationDb = PrismaClient | Prisma.TransactionClient

export type CreateOrUpdateProLookFromMediaAssetArgs = {
  professionalId: string
  request: CreateProLookRequestDto
}

export type UpdateProLookPublicationArgs = {
  professionalId: string
  lookPostId: string
  request: UpdateProLookRequestDto
}

const MAX_CAPTION_LENGTH = 300

const mediaAssetPublicationSelect =
  Prisma.validator<Prisma.MediaAssetSelect>()({
    id: true,
    professionalId: true,
    caption: true,
    visibility: true,
    isEligibleForLooks: true,
    mediaType: true,
    createdAt: true,
    services: {
      select: {
        serviceId: true,
      },
      orderBy: [{ serviceId: 'asc' }],
    },
  })

type MediaAssetPublicationRow = Prisma.MediaAssetGetPayload<{
  select: typeof mediaAssetPublicationSelect
}>

const proLookPublicationSelect =
  Prisma.validator<Prisma.LookPostSelect>()({
    id: true,
    professionalId: true,
    primaryMediaAssetId: true,
    serviceId: true,
    caption: true,
    priceStartingAt: true,

    status: true,
    visibility: true,
    moderationStatus: true,

    publishedAt: true,
    archivedAt: true,
    removedAt: true,

    reviewedAt: true,
    reviewedByUserId: true,
    adminNotes: true,
    reportCount: true,

    likeCount: true,
    commentCount: true,
    saveCount: true,
    shareCount: true,

    spotlightScore: true,
    rankScore: true,

    createdAt: true,
    updatedAt: true,

    primaryMediaAsset: {
      select: {
        id: true,
        professionalId: true,
        caption: true,
        visibility: true,
        isEligibleForLooks: true,
        services: {
          select: {
            serviceId: true,
          },
          orderBy: [{ serviceId: 'asc' }],
        },
      },
    },
  })

type ProLookPublicationRow = Prisma.LookPostGetPayload<{
  select: typeof proLookPublicationSelect
}>

type CreatePublicationMutationPlan = {
  kind: 'create'
  action: Extract<ProLookMutationAction, 'create_draft' | 'publish'>
  data: Prisma.LookPostUncheckedCreateInput
}

type UpdatePublicationMutationPlan = {
  kind: 'update'
  action: Exclude<ProLookMutationAction, 'create_draft'>
  data: Prisma.LookPostUncheckedUpdateInput
}

type PublicationMutationPlan =
  | CreatePublicationMutationPlan
  | UpdatePublicationMutationPlan

function normalizeRequiredId(name: string, value: string): string {
  const trimmed = value.trim()

  if (!trimmed) {
    throw new Error(`${name} is required.`)
  }

  return trimmed
}

function normalizeOptionalId(
  value: string | null | undefined,
): string | null {
  if (typeof value !== 'string') return null

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function normalizeOptionalCaption(
  value: string | null | undefined,
): string | null {
  if (typeof value !== 'string') return null

  const trimmed = value.trim()
  if (!trimmed) return null

  if (trimmed.length > MAX_CAPTION_LENGTH) {
    throw new Error(
      `caption must be ${MAX_CAPTION_LENGTH} characters or fewer.`,
    )
  }

  return trimmed
}

function normalizeOptionalDecimal(
  value: string | null | undefined,
  name: string,
): Prisma.Decimal | null {
  if (typeof value !== 'string') return null

  const trimmed = value.trim()
  if (!trimmed) return null

  let decimal: Prisma.Decimal
  try {
    decimal = new Prisma.Decimal(trimmed)
  } catch {
    throw new Error(`${name} must be a valid decimal string.`)
  }

  if (decimal.isNegative()) {
    throw new Error(`${name} must be zero or greater.`)
  }

  return decimal
}

function normalizeVisibility(
  value: LookPostVisibility | null | undefined,
  fallback: LookPostVisibility,
): LookPostVisibility {
  if (value === null || value === undefined) {
    return fallback
  }

  if (
    value !== LookPostVisibility.PUBLIC &&
    value !== LookPostVisibility.FOLLOWERS_ONLY &&
    value !== LookPostVisibility.UNLISTED
  ) {
    throw new Error('visibility is invalid.')
  }

  return value
}

function requireMediaAssetServiceId(
  media: Pick<MediaAssetPublicationRow, 'services'>,
  requestedServiceId: string | null,
): string {
  const serviceId = normalizeOptionalId(requestedServiceId)

  if (!serviceId) {
    throw new Error('primaryServiceId is required.')
  }

  const taggedServiceIds = new Set(
    media.services.map((service) => service.serviceId),
  )

  if (!taggedServiceIds.has(serviceId)) {
    throw new Error(
      'primaryServiceId must be one of the media asset service tags.',
    )
  }

  return serviceId
}

function canUseRootTransaction(
  db: LookPublicationDb,
): db is PrismaClient {
  return '$transaction' in db
}

async function withPublicationTx<T>(
  db: LookPublicationDb,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  if (canUseRootTransaction(db)) {
    return db.$transaction(fn)
  }

  return fn(db)
}

async function getMediaAssetForPublicationOrThrow(
  db: LookPublicationDb,
  args: {
    professionalId: string
    mediaAssetId: string
  },
): Promise<MediaAssetPublicationRow> {
  const professionalId = normalizeRequiredId(
    'professionalId',
    args.professionalId,
  )
  const mediaAssetId = normalizeRequiredId(
    'mediaAssetId',
    args.mediaAssetId,
  )

  const media = await db.mediaAsset.findUnique({
    where: { id: mediaAssetId },
    select: mediaAssetPublicationSelect,
  })

  if (!media) {
    throw new Error('Media asset not found.')
  }

  if (media.professionalId !== professionalId) {
    throw new Error('Not allowed to publish this media asset.')
  }

  return media
}

async function getProLookByIdOrThrow(
  db: LookPublicationDb,
  args: {
    professionalId: string
    lookPostId: string
  },
): Promise<ProLookPublicationRow> {
  const professionalId = normalizeRequiredId(
    'professionalId',
    args.professionalId,
  )
  const lookPostId = normalizeRequiredId('lookPostId', args.lookPostId)

  const lookPost = await db.lookPost.findUnique({
    where: { id: lookPostId },
    select: proLookPublicationSelect,
  })

  if (!lookPost) {
    throw new Error('Look post not found.')
  }

  if (lookPost.professionalId !== professionalId) {
    throw new Error('Not allowed to manage this look post.')
  }

  return lookPost
}

function assertMediaAssetCanBackLooks(
  media: Pick<
    MediaAssetPublicationRow,
    'visibility' | 'isEligibleForLooks'
  >,
): void {
  if (media.visibility !== MediaVisibility.PUBLIC) {
    throw new Error('Looks publication requires a public media asset.')
  }

  if (!media.isEligibleForLooks) {
    throw new Error(
      'Media asset must be marked eligible for Looks before publication.',
    )
  }
}

function assertLookPostIsMutable(
  lookPost: Pick<ProLookPublicationRow, 'status' | 'removedAt'>,
): void {
  if (
    lookPost.status === LookPostStatus.REMOVED ||
    lookPost.removedAt !== null
  ) {
    throw new Error('Removed look posts cannot be edited by professionals.')
  }
}

function isLookFeedEligible(
  row: Pick<
    ProLookPublicationRow,
    'status' | 'moderationStatus' | 'publishedAt' | 'removedAt' | 'visibility'
  >,
): boolean {
  return (
    row.status === LookPostStatus.PUBLISHED &&
    row.moderationStatus === ModerationStatus.APPROVED &&
    row.publishedAt !== null &&
    row.removedAt === null &&
    row.visibility !== LookPostVisibility.UNLISTED
  )
}

function isLookSearchEligible(
  row: Pick<
    ProLookPublicationRow,
    'status' | 'moderationStatus' | 'publishedAt' | 'removedAt' | 'visibility'
  >,
): boolean {
  return (
    row.status === LookPostStatus.PUBLISHED &&
    row.moderationStatus === ModerationStatus.APPROVED &&
    row.publishedAt !== null &&
    row.removedAt === null &&
    row.visibility === LookPostVisibility.PUBLIC
  )
}

function didSearchableFieldsChange(args: {
  previous: Pick<ProLookPublicationRow, 'caption' | 'serviceId'>
  next: Pick<ProLookPublicationRow, 'caption' | 'serviceId'>
}): boolean {
  return (
    (args.previous.caption ?? null) !== (args.next.caption ?? null) ||
    (args.previous.serviceId ?? null) !== (args.next.serviceId ?? null)
  )
}

function didRankingRelevantFieldsChange(args: {
  previous: Pick<ProLookPublicationRow, 'serviceId'>
  next: Pick<ProLookPublicationRow, 'serviceId'>
}): boolean {
  return (args.previous.serviceId ?? null) !== (args.next.serviceId ?? null)
}

function shouldModerationScanLook(args: {
  previous: Pick<
    ProLookPublicationRow,
    'caption' | 'status' | 'publishedAt' | 'removedAt'
  > | null
  next: Pick<
    ProLookPublicationRow,
    'caption' | 'status' | 'publishedAt' | 'removedAt'
  >
  action: ProLookMutationAction
}): boolean {
  if (args.action === 'publish') {
    return true
  }

  if (args.action !== 'update') {
    return false
  }

  if (!args.previous) {
    return false
  }

  const wasPublished =
    args.previous.status === LookPostStatus.PUBLISHED &&
    args.previous.publishedAt !== null &&
    args.previous.removedAt === null

  const isPublished =
    args.next.status === LookPostStatus.PUBLISHED &&
    args.next.publishedAt !== null &&
    args.next.removedAt === null

  return (
    wasPublished &&
    isPublished &&
    (args.previous.caption ?? null) !== (args.next.caption ?? null)
  )
}

function buildMutationPolicyArgs(args: {
  lookPostId: string
  action: ProLookMutationAction
  previous: ProLookPublicationRow | null
  next: ProLookPublicationRow
}): EnqueueLookPostMutationPolicyArgs | null {
  if (args.action === 'create_draft') {
    return null
  }

  if (args.action === 'archive' || args.action === 'unpublish') {
    return {
      lookPostId: args.lookPostId,
      mutation: 'VISIBILITY_CHANGE',
      feedEligibilityChanged: true,
      rankingRelevantChanged: true,
      searchableDocumentChanged: true,
    }
  }

  if (args.action === 'publish') {
    return {
      lookPostId: args.lookPostId,
      mutation: 'PUBLISH',
      feedEligibilityChanged: true,
      rankingRelevantChanged: true,
      searchableDocumentChanged: true,
      contentRequiresModerationScan: true,
    }
  }

  const previous = args.previous
  if (!previous) {
    return null
  }

  const feedEligibilityChanged =
    isLookFeedEligible(previous) !== isLookFeedEligible(args.next)

  const searchEligibilityChanged =
    isLookSearchEligible(previous) !== isLookSearchEligible(args.next)

  const searchableFieldsChanged = didSearchableFieldsChange({
    previous,
    next: args.next,
  })

  const rankingRelevantFieldsChanged = didRankingRelevantFieldsChange({
    previous,
    next: args.next,
  })

  const visibilityChanged = previous.visibility !== args.next.visibility

  const searchableDocumentChanged =
    searchableFieldsChanged || searchEligibilityChanged

  const contentRequiresModerationScan = shouldModerationScanLook({
    previous,
    next: args.next,
    action: args.action,
  })

  const rankingRelevantChanged =
    feedEligibilityChanged || rankingRelevantFieldsChanged

  if (
    !feedEligibilityChanged &&
    !searchableDocumentChanged &&
    !visibilityChanged &&
    !contentRequiresModerationScan &&
    !rankingRelevantChanged
  ) {
    return null
  }

  return {
    lookPostId: args.lookPostId,
    mutation: visibilityChanged ? 'VISIBILITY_CHANGE' : 'EDIT',
    feedEligibilityChanged,
    rankingRelevantChanged,
    searchableDocumentChanged,
    contentRequiresModerationScan,
  }
}

function buildLookPostCreatePlan(args: {
  professionalId: string
  media: MediaAssetPublicationRow
  request: CreateProLookRequestDto
}): CreatePublicationMutationPlan {
  const publish = args.request.publish === true
  const caption =
    normalizeOptionalCaption(args.request.caption) ??
    normalizeOptionalCaption(args.media.caption) ??
    null
  const serviceId = requireMediaAssetServiceId(
    args.media,
    args.request.primaryServiceId ?? null,
  )
  const priceStartingAt = normalizeOptionalDecimal(
    args.request.priceStartingAt,
    'priceStartingAt',
  )
  const visibility = normalizeVisibility(
    args.request.visibility,
    LookPostVisibility.PUBLIC,
  )
  const now = new Date()

  if (publish) {
    assertMediaAssetCanBackLooks(args.media)
  }

  return {
    kind: 'create',
    action: publish ? 'publish' : 'create_draft',
    data: {
      professionalId: normalizeRequiredId(
        'professionalId',
        args.professionalId,
      ),
      primaryMediaAssetId: args.media.id,
      serviceId,
      caption,
      priceStartingAt,
      visibility,
      status: publish ? LookPostStatus.PUBLISHED : LookPostStatus.DRAFT,
      publishedAt: publish ? now : null,
      archivedAt: null,
      removedAt: null,
    },
  }
}

function buildLookPostUpdatePlanFromCreateRequest(args: {
  media: MediaAssetPublicationRow
  existing: ProLookPublicationRow
  request: CreateProLookRequestDto
}): UpdatePublicationMutationPlan {
  assertLookPostIsMutable(args.existing)

  const publish = args.request.publish === true
  const caption =
    normalizeOptionalCaption(args.request.caption) ??
    normalizeOptionalCaption(args.media.caption) ??
    args.existing.caption
  const serviceId = requireMediaAssetServiceId(
    args.media,
    args.request.primaryServiceId ?? args.existing.serviceId ?? null,
  )
  const priceStartingAt =
    normalizeOptionalDecimal(
      args.request.priceStartingAt,
      'priceStartingAt',
    ) ?? args.existing.priceStartingAt
  const visibility = normalizeVisibility(
    args.request.visibility,
    args.existing.visibility,
  )

  if (publish) {
    assertMediaAssetCanBackLooks(args.media)
  }

  const now = new Date()
  const shouldPublish =
    publish && args.existing.status !== LookPostStatus.PUBLISHED

  return {
    kind: 'update',
    action: shouldPublish ? 'publish' : 'update',
    data: {
      caption,
      serviceId,
      priceStartingAt,
      visibility,
      ...(shouldPublish
        ? {
            status: LookPostStatus.PUBLISHED,
            publishedAt: args.existing.publishedAt ?? now,
            archivedAt: null,
          }
        : {}),
    },
  }
}

function buildLookPostUpdatePlan(args: {
  existing: ProLookPublicationRow
  request: UpdateProLookRequestDto
}): UpdatePublicationMutationPlan {
  assertLookPostIsMutable(args.existing)

  const caption =
    args.request.caption !== undefined
      ? normalizeOptionalCaption(args.request.caption)
      : args.existing.caption

  const serviceId =
    args.request.primaryServiceId !== undefined
      ? requireMediaAssetServiceId(
          args.existing.primaryMediaAsset,
          args.request.primaryServiceId,
        )
      : args.existing.serviceId

  if (serviceId === null) {
    throw new Error('primaryServiceId is required.')
  }

  const priceStartingAt =
    args.request.priceStartingAt !== undefined
      ? normalizeOptionalDecimal(
          args.request.priceStartingAt,
          'priceStartingAt',
        )
      : args.existing.priceStartingAt

  const visibility = normalizeVisibility(
    args.request.visibility,
    args.existing.visibility,
  )

  const stateAction: ProLookStateAction | undefined =
    args.request.stateAction
  const now = new Date()

  if (stateAction === 'publish') {
    assertMediaAssetCanBackLooks(args.existing.primaryMediaAsset)

    return {
      kind: 'update',
      action: 'publish',
      data: {
        caption,
        serviceId,
        priceStartingAt,
        visibility,
        status: LookPostStatus.PUBLISHED,
        publishedAt: args.existing.publishedAt ?? now,
        archivedAt: null,
      },
    }
  }

  if (stateAction === 'archive') {
    return {
      kind: 'update',
      action: 'archive',
      data: {
        caption,
        serviceId,
        priceStartingAt,
        visibility,
        status: LookPostStatus.ARCHIVED,
        archivedAt: now,
      },
    }
  }

  if (stateAction === 'unpublish') {
    return {
      kind: 'update',
      action: 'unpublish',
      data: {
        caption,
        serviceId,
        priceStartingAt,
        visibility,
        status: LookPostStatus.DRAFT,
        publishedAt: null,
        archivedAt: null,
      },
    }
  }

  return {
    kind: 'update',
    action: 'update',
    data: {
      caption,
      serviceId,
      priceStartingAt,
      visibility,
    },
  }
}

function toPublicationAsyncEffects(
  result?: EnqueueLookPostMutationPolicyResult,
): LookPublicationAsyncEffectsDto {
  if (!result) {
    return toLookPublicationAsyncEffectsDto()
  }

  return toLookPublicationAsyncEffectsDto({
    plannedJobs: result.plannedJobs,
    enqueuedJobs: result.enqueuedJobs,
    gatedJobs: result.gatedJobs,
  })
}

/**
 * Creates a new LookPost from a public MediaAsset, or updates the existing
 * one for that same primary media asset. This is the bridge from media upload
 * into the public Looks system.
 */
export async function createOrUpdateProLookFromMediaAsset(
  db: LookPublicationDb,
  args: CreateOrUpdateProLookFromMediaAssetArgs,
): Promise<ProLookPublicationResultDto> {
  return withPublicationTx(db, async (tx) => {
    const media = await getMediaAssetForPublicationOrThrow(tx, {
      professionalId: args.professionalId,
      mediaAssetId: args.request.mediaAssetId,
    })

    const existing = await tx.lookPost.findUnique({
      where: {
        primaryMediaAssetId: media.id,
      },
      select: proLookPublicationSelect,
    })

    let plan: PublicationMutationPlan
    let saved: ProLookPublicationRow

    if (existing) {
      const updatePlan = buildLookPostUpdatePlanFromCreateRequest({
        media,
        existing,
        request: args.request,
      })

      plan = updatePlan

      saved = await tx.lookPost.update({
        where: { id: existing.id },
        data: updatePlan.data,
        select: proLookPublicationSelect,
      })
    } else {
      const createPlan = buildLookPostCreatePlan({
        professionalId: args.professionalId,
        media,
        request: args.request,
      })

      plan = createPlan

      saved = await tx.lookPost.create({
        data: createPlan.data,
        select: proLookPublicationSelect,
      })
    }

    await recomputeLookPostScores(tx, saved.id)

    const refreshed = await tx.lookPost.findUnique({
      where: { id: saved.id },
      select: proLookPublicationSelect,
    })

    if (!refreshed) {
      throw new Error('Look post not found after save.')
    }

    const policyArgs = buildMutationPolicyArgs({
      lookPostId: refreshed.id,
      action: plan.action,
      previous: existing,
      next: refreshed,
    })

    const enqueueResult = policyArgs
      ? await enqueueLookPostMutationPolicy(tx, policyArgs)
      : undefined

    return toProLookPublicationResultDto({
      action: plan.action,
      lookPost: refreshed,
      asyncEffects: toPublicationAsyncEffects(enqueueResult),
    })
  })
}

/**
 * Updates an existing professional-owned LookPost, including state changes
 * such as publish, archive, and unpublish.
 */
export async function updateProLookPublication(
  db: LookPublicationDb,
  args: UpdateProLookPublicationArgs,
): Promise<ProLookPublicationResultDto> {
  return withPublicationTx(db, async (tx) => {
    const existing = await getProLookByIdOrThrow(tx, {
      professionalId: args.professionalId,
      lookPostId: args.lookPostId,
    })

    const plan = buildLookPostUpdatePlan({
      existing,
      request: args.request,
    })

    const updated = await tx.lookPost.update({
      where: { id: existing.id },
      data: plan.data,
      select: proLookPublicationSelect,
    })

    await recomputeLookPostScores(tx, updated.id)

    const refreshed = await tx.lookPost.findUnique({
      where: { id: updated.id },
      select: proLookPublicationSelect,
    })

    if (!refreshed) {
      throw new Error('Look post not found after update.')
    }

    const policyArgs = buildMutationPolicyArgs({
      lookPostId: refreshed.id,
      action: plan.action,
      previous: existing,
      next: refreshed,
    })

    const enqueueResult = policyArgs
      ? await enqueueLookPostMutationPolicy(tx, policyArgs)
      : undefined

    return toProLookPublicationResultDto({
      action: plan.action,
      lookPost: refreshed,
      asyncEffects: toPublicationAsyncEffects(enqueueResult),
    })
  })
}

export async function getProLookPublicationById(
  db: LookPublicationDb,
  args: {
    professionalId: string
    lookPostId: string
  },
): Promise<ProLookPublicationResultDto> {
  const lookPost = await getProLookByIdOrThrow(db, args)

  return toProLookPublicationResultDto({
    action: 'update',
    lookPost,
    asyncEffects: toLookPublicationAsyncEffectsDto(),
  })
}