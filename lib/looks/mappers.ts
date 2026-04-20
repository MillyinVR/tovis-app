// lib/looks/mappers.ts
import {
  LookPostStatus,
  LookPostVisibility,
  MediaType,
  MediaVisibility,
  ModerationStatus,
  ProfessionType,
  Role,
  VerificationStatus,
} from '@prisma/client'
import { renderMediaUrls } from '@/lib/media/renderUrls'
import type {
  LooksBoardDetailRow,
  LooksBoardPreviewRow,
  LooksDetailRow,
  LooksFeedRow,
  LooksProProfilePreviewRow,
} from '@/lib/looks/selects'
import type {
  LooksBoardDetailDto,
  LooksBoardPreviewDto,
  LooksBoardPreviewPrimaryMediaDto,
  LooksCommentDto,
  LooksDetailAdminDto,
  LooksDetailAssetDto,
  LooksDetailItemDto,
  LooksDetailMediaDto,
  LooksDetailReviewDto,
  LooksDetailServiceDto,
  LooksFeedItemDto,
  LooksFeedResponseDto,
  LooksPortfolioTileDto,
  LooksProProfilePreviewDto,
  LooksRenderedMediaDto,
} from '@/lib/looks/types'

type MediaCommentUserShape = {
  id: string
  clientProfile: {
    firstName: string
    lastName: string
    avatarUrl: string | null
  } | null
  professionalProfile: {
    businessName: string | null
    avatarUrl: string | null
  } | null
}

type MediaCommentRowShape = {
  id: string
  body: string
  createdAt: Date
  user: MediaCommentUserShape
}

type StoredMediaShape = {
  id: string
  url: string | null
  thumbUrl: string | null
  storageBucket: string | null
  storagePath: string | null
  thumbBucket: string | null
  thumbPath: string | null
  mediaType: MediaType
  caption: string | null
  createdAt: Date
}

type FeedPrimaryMediaShape = StoredMediaShape & {
  uploadedByRole?: Role | null
  reviewId?: string | null
  review?: {
    helpfulCount: number
    rating: number
    headline: string | null
  } | null
}

type RenderableStoredMedia<T extends StoredMediaShape> = T & {
  renderUrl: string
  renderThumbUrl: string | null
}

type LooksDetailAssetRow = LooksDetailRow['assets'][number]

export type LooksRenderableDetailMedia = Omit<
  LooksDetailRow,
  'primaryMediaAsset' | 'assets'
> & {
  primaryMediaAsset: RenderableStoredMedia<LooksDetailRow['primaryMediaAsset']>
  assets: Array<
    Omit<LooksDetailAssetRow, 'mediaAsset'> & {
      mediaAsset: RenderableStoredMedia<LooksDetailAssetRow['mediaAsset']>
    }
  >
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNonNull<T>(value: T | null): value is T {
  return value !== null
}

function pickString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : null
}

function pickNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function pickBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null
}

function isRole(value: unknown): value is Role {
  return (
    value === Role.CLIENT ||
    value === Role.PRO ||
    value === Role.ADMIN
  )
}

function isProfessionType(value: unknown): value is ProfessionType {
  return (
    value === ProfessionType.COSMETOLOGIST ||
    value === ProfessionType.BARBER ||
    value === ProfessionType.ESTHETICIAN ||
    value === ProfessionType.MANICURIST ||
    value === ProfessionType.HAIRSTYLIST ||
    value === ProfessionType.ELECTROLOGIST ||
    value === ProfessionType.MASSAGE_THERAPIST ||
    value === ProfessionType.MAKEUP_ARTIST
  )
}

function hasStoragePointers(input: {
  storageBucket: string | null
  storagePath: string | null
}): input is {
  storageBucket: string
  storagePath: string
} {
  return Boolean(input.storageBucket && input.storagePath)
}

function pickLegacyServiceIds(
  services:
    | Array<{
        serviceId?: string
        service?: {
          id: string
        } | null
      }>
    | null
    | undefined,
): string[] {
  const ids = new Set<string>()

  for (const serviceTag of services ?? []) {
    const explicitId = pickString(serviceTag.serviceId)
    if (explicitId) {
      ids.add(explicitId)
      continue
    }

    const nestedId = pickString(serviceTag.service?.id)
    if (nestedId) {
      ids.add(nestedId)
    }
  }

  return [...ids]
}

function pickLookPostServiceSummary(
  service:
    | {
        id: string
        name: string
        category: {
          name: string
          slug: string
        } | null
      }
    | null
    | undefined,
  explicitServiceId: string | null | undefined,
) {
  const id = service?.id ?? pickString(explicitServiceId)
  if (!id) return null

  return {
    id,
    name: service?.name ?? null,
    category: service?.category?.name ?? null,
    categorySlug: service?.category?.slug ?? null,
  }
}

function pickLookPostServiceIds(args: {
  serviceId: string | null | undefined
  service:
    | {
        id: string
      }
    | null
    | undefined
}): string[] {
  const ids = new Set<string>()

  const explicitId = pickString(args.serviceId)
  if (explicitId) ids.add(explicitId)

  const nestedId = pickString(args.service?.id)
  if (nestedId) ids.add(nestedId)

  return [...ids]
}

function normalizeCommentUser(user: MediaCommentUserShape): {
  id: string
  displayName: string
  avatarUrl: string | null
} {
  const clientFirst = user.clientProfile?.firstName?.trim() ?? ''
  const clientLast = user.clientProfile?.lastName?.trim() ?? ''
  const clientFullName = [clientFirst, clientLast].filter(Boolean).join(' ')
  const professionalName = user.professionalProfile?.businessName?.trim() ?? ''

  return {
    id: user.id,
    displayName: clientFullName || professionalName || 'User',
    avatarUrl:
      user.clientProfile?.avatarUrl ??
      user.professionalProfile?.avatarUrl ??
      null,
  }
}

async function renderAssetUrls(input: {
  storageBucket: string | null
  storagePath: string | null
  thumbBucket: string | null
  thumbPath: string | null
  url: string | null
  thumbUrl: string | null
}): Promise<{
  url: string | null
  thumbUrl: string | null
}> {
  let renderUrl = pickString(input.url)
  let renderThumbUrl = pickString(input.thumbUrl)

  if ((!renderUrl || !renderThumbUrl) && hasStoragePointers(input)) {
    const rendered = await renderMediaUrls({
      storageBucket: input.storageBucket,
      storagePath: input.storagePath,
      thumbBucket: input.thumbBucket ?? null,
      thumbPath: input.thumbPath ?? null,
      url: input.url ?? null,
      thumbUrl: input.thumbUrl ?? null,
    })

    renderUrl = pickString(rendered.renderUrl) ?? renderUrl
    renderThumbUrl = pickString(rendered.renderThumbUrl) ?? renderThumbUrl
  }

  return {
    url: renderUrl,
    thumbUrl: renderThumbUrl,
  }
}

async function mapStoredMediaToRenderable<T extends StoredMediaShape>(
  item: T,
): Promise<RenderableStoredMedia<T> | null> {
  const rendered = await renderAssetUrls({
    storageBucket: item.storageBucket,
    storagePath: item.storagePath,
    thumbBucket: item.thumbBucket,
    thumbPath: item.thumbPath,
    url: item.url,
    thumbUrl: item.thumbUrl,
  })

  if (!rendered.url) return null

  return {
    ...item,
    renderUrl: rendered.url,
    renderThumbUrl: rendered.thumbUrl,
  }
}

async function mapStoredMediaToPreviewDto(
  item: StoredMediaShape,
): Promise<LooksBoardPreviewPrimaryMediaDto | null> {
  const rendered = await renderAssetUrls({
    storageBucket: item.storageBucket,
    storagePath: item.storagePath,
    thumbBucket: item.thumbBucket,
    thumbPath: item.thumbPath,
    url: item.url,
    thumbUrl: item.thumbUrl,
  })

  if (!rendered.url) return null

  return {
    id: item.id,
    url: rendered.url,
    thumbUrl: rendered.thumbUrl,
    mediaType: item.mediaType,
  }
}

export async function mapLooksFeedMediaToDto(args: {
  item: LooksFeedRow
  viewerLiked: boolean
}): Promise<LooksFeedItemDto | null> {
  const { item, viewerLiked } = args
  const primaryMedia: FeedPrimaryMediaShape = item.primaryMediaAsset

  const rendered = await renderAssetUrls({
    storageBucket: primaryMedia.storageBucket,
    storagePath: primaryMedia.storagePath,
    thumbBucket: primaryMedia.thumbBucket,
    thumbPath: primaryMedia.thumbPath,
    url: primaryMedia.url,
    thumbUrl: primaryMedia.thumbUrl,
  })

  if (!rendered.url) return null

  const primaryService = pickLookPostServiceSummary(item.service, item.serviceId)
  const serviceIds = pickLookPostServiceIds({
    serviceId: item.serviceId,
    service: item.service,
  })

  return {
    id: item.id,
    url: rendered.url,
    thumbUrl: rendered.thumbUrl,
    mediaType: primaryMedia.mediaType,
    caption: item.caption ?? primaryMedia.caption ?? null,
    createdAt: (item.publishedAt ?? item.createdAt).toISOString(),

    professional: item.professional
      ? {
          id: item.professional.id,
          businessName: item.professional.businessName ?? null,
          handle: item.professional.handle ?? null,
          professionType: item.professional.professionType ?? null,
          avatarUrl: item.professional.avatarUrl ?? null,
          location: item.professional.location ?? null,
        }
      : null,

    _count: {
      likes: item.likeCount,
      comments: item.commentCount,
    },
    viewerLiked,

    serviceId: primaryService?.id ?? null,
    serviceName: primaryService?.name ?? null,
    category: primaryService?.category ?? null,
    serviceIds,

    uploadedByRole: primaryMedia.uploadedByRole ?? null,
    reviewId: primaryMedia.reviewId ?? null,
    reviewHelpfulCount: primaryMedia.review?.helpfulCount ?? null,
    reviewRating: primaryMedia.review?.rating ?? null,
    reviewHeadline: primaryMedia.review?.headline ?? null,
  }
}

export function mapLooksCommentToDto(
  comment: MediaCommentRowShape,
): LooksCommentDto {
  return {
    id: comment.id,
    body: comment.body,
    createdAt: comment.createdAt.toISOString(),
    user: normalizeCommentUser(comment.user),
  }
}

export async function mapReviewMediaAssetToDto(input: {
  id: string
  mediaType: MediaType
  isFeaturedInPortfolio: boolean
  storageBucket: string | null
  storagePath: string | null
  thumbBucket: string | null
  thumbPath: string | null
  url: string | null
  thumbUrl: string | null
}): Promise<LooksRenderedMediaDto | null> {
  const rendered = await renderAssetUrls({
    storageBucket: input.storageBucket,
    storagePath: input.storagePath,
    thumbBucket: input.thumbBucket,
    thumbPath: input.thumbPath,
    url: input.url,
    thumbUrl: input.thumbUrl,
  })

  if (!rendered.url) return null

  return {
    id: input.id,
    url: rendered.url,
    thumbUrl: rendered.thumbUrl,
    mediaType: input.mediaType,
    isFeaturedInPortfolio: input.isFeaturedInPortfolio,
  }
}

export async function mapPortfolioTileToDto(input: {
  id: string
  caption: string | null
  visibility: MediaVisibility
  isEligibleForLooks: boolean
  isFeaturedInPortfolio: boolean
  mediaType: MediaType
  storageBucket: string | null
  storagePath: string | null
  thumbBucket: string | null
  thumbPath: string | null
  url: string | null
  thumbUrl: string | null
  services?: Array<{
    serviceId?: string
    service?: {
      id: string
    } | null
  }> | null
}): Promise<LooksPortfolioTileDto | null> {
  const rendered = await renderAssetUrls({
    storageBucket: input.storageBucket,
    storagePath: input.storagePath,
    thumbBucket: input.thumbBucket,
    thumbPath: input.thumbPath,
    url: input.url,
    thumbUrl: input.thumbUrl,
  })

  const src = rendered.thumbUrl ?? rendered.url
  if (!src) return null

  return {
    id: input.id,
    caption: input.caption ?? null,
    visibility: input.visibility,
    isEligibleForLooks: input.isEligibleForLooks,
    isFeaturedInPortfolio: input.isFeaturedInPortfolio,
    src,
    serviceIds: pickLegacyServiceIds(input.services),
    isVideo: input.mediaType === MediaType.VIDEO,
    mediaType: input.mediaType,
  }
}

export async function mapLooksDetailMediaToRenderable(
  item: LooksDetailRow,
): Promise<LooksRenderableDetailMedia | null> {
  const primaryMediaAsset = await mapStoredMediaToRenderable(
    item.primaryMediaAsset,
  )

  if (!primaryMediaAsset) return null

  const assets = await Promise.all(
    item.assets.map(async (asset) => {
      const mediaAsset = await mapStoredMediaToRenderable(asset.mediaAsset)
      if (!mediaAsset) return null

      return {
        ...asset,
        mediaAsset,
      }
    }),
  )

  return {
    ...item,
    primaryMediaAsset,
    assets: assets.filter(isNonNull),
  }
}

function mapLooksDetailReviewToDto(input: {
  id: string
  rating: number
  headline: string | null
  helpfulCount: number
} | null): LooksDetailReviewDto | null {
  if (!input) return null

  return {
    id: input.id,
    rating: input.rating,
    headline: input.headline ?? null,
    helpfulCount: input.helpfulCount,
  }
}

function mapRenderableLooksDetailMediaToDto(input: {
  id: string
  renderUrl: string
  renderThumbUrl: string | null
  mediaType: MediaType
  caption: string | null
  createdAt: Date
  review: {
    id: string
    rating: number
    headline: string | null
    helpfulCount: number
    body: string | null
  } | null
}): LooksDetailMediaDto {
  return {
    id: input.id,
    url: input.renderUrl,
    thumbUrl: input.renderThumbUrl,
    mediaType: input.mediaType,
    caption: input.caption ?? null,
    createdAt: input.createdAt.toISOString(),
    review: mapLooksDetailReviewToDto(input.review),
  }
}

export function mapLooksDetailToDto(args: {
  item: LooksRenderableDetailMedia
  viewerContext: {
    isAuthenticated: boolean
    viewerLiked: boolean
    canComment: boolean
    canSave: boolean
    isOwner: boolean
    canModerate: boolean
  }
}): LooksDetailItemDto {
  const { item, viewerContext } = args

  return {
    id: item.id,
    caption: item.caption ?? item.primaryMediaAsset.caption ?? null,
    status: item.status,
    visibility: item.visibility,
    moderationStatus: item.moderationStatus,
    publishedAt: item.publishedAt?.toISOString() ?? null,
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),

    professional: mapLooksProProfilePreviewToDto(item.professional),

    service: item.service
      ? {
          id: item.service.id,
          name: item.service.name,
          category: item.service.category
            ? {
                name: item.service.category.name,
                slug: item.service.category.slug,
              }
            : null,
        }
      : null,

    primaryMedia: mapRenderableLooksDetailMediaToDto(item.primaryMediaAsset),

    assets: item.assets.map((asset) => ({
      id: asset.id,
      sortOrder: asset.sortOrder,
      mediaAssetId: asset.mediaAssetId,
      media: mapRenderableLooksDetailMediaToDto(asset.mediaAsset),
    })),

    _count: {
      likes: item.likeCount,
      comments: item.commentCount,
      saves: item.saveCount,
      shares: item.shareCount,
    },

    viewerContext: {
      isAuthenticated: viewerContext.isAuthenticated,
      viewerLiked: viewerContext.viewerLiked,
      canComment: viewerContext.canComment,
      canSave: viewerContext.canSave,
      isOwner: viewerContext.isOwner,
    },

    ...(viewerContext.canModerate
      ? {
          admin: {
            canModerate: true,
            archivedAt: item.archivedAt?.toISOString() ?? null,
            removedAt: item.removedAt?.toISOString() ?? null,
            primaryMediaAssetId: item.primaryMediaAssetId,
            primaryMedia: {
              visibility: item.primaryMediaAsset.visibility,
              isEligibleForLooks: item.primaryMediaAsset.isEligibleForLooks,
              isFeaturedInPortfolio:
                item.primaryMediaAsset.isFeaturedInPortfolio,
              reviewBody: item.primaryMediaAsset.review?.body ?? null,
            },
          },
        }
      : {}),
  }
}

export async function mapLooksBoardPreviewToDto(
  board: LooksBoardPreviewRow,
): Promise<LooksBoardPreviewDto> {
  const items = await Promise.all(
    board.items.map(async (item) => {
      const lookPost = item.lookPost

      if (!lookPost) {
        return {
          id: item.id,
          createdAt: item.createdAt.toISOString(),
          lookPostId: item.lookPostId,
          lookPost: null,
        }
      }

      const primaryMedia = await mapStoredMediaToPreviewDto(
        lookPost.primaryMediaAsset,
      )

      return {
        id: item.id,
        createdAt: item.createdAt.toISOString(),
        lookPostId: item.lookPostId,
        lookPost: {
          id: lookPost.id,
          caption: lookPost.caption ?? null,
          status: lookPost.status,
          visibility: lookPost.visibility,
          moderationStatus: lookPost.moderationStatus,
          publishedAt: lookPost.publishedAt?.toISOString() ?? null,
          primaryMedia,
        },
      }
    }),
  )

  return {
    id: board.id,
    clientId: board.clientId,
    name: board.name,
    visibility: board.visibility,
    createdAt: board.createdAt.toISOString(),
    updatedAt: board.updatedAt.toISOString(),
    itemCount: board._count.items,
    items,
  }
}

export async function mapLooksBoardDetailToDto(
  board: LooksBoardDetailRow,
): Promise<LooksBoardDetailDto> {
  const items = await Promise.all(
    board.items.map(async (item) => {
      const lookPost = item.lookPost

      if (!lookPost) {
        return {
          id: item.id,
          createdAt: item.createdAt.toISOString(),
          lookPostId: item.lookPostId,
          lookPost: null,
        }
      }

      const primaryMedia = await mapStoredMediaToPreviewDto(
        lookPost.primaryMediaAsset,
      )

      return {
        id: item.id,
        createdAt: item.createdAt.toISOString(),
        lookPostId: item.lookPostId,
        lookPost: {
          id: lookPost.id,
          caption: lookPost.caption ?? null,
          status: lookPost.status,
          visibility: lookPost.visibility,
          moderationStatus: lookPost.moderationStatus,
          publishedAt: lookPost.publishedAt?.toISOString() ?? null,
          primaryMedia,
        },
      }
    }),
  )

  return {
    id: board.id,
    clientId: board.clientId,
    name: board.name,
    visibility: board.visibility,
    createdAt: board.createdAt.toISOString(),
    updatedAt: board.updatedAt.toISOString(),
    itemCount: board._count.items,
    items,
  }
}

export function mapLooksProProfilePreviewToDto(
  profile: LooksProProfilePreviewRow,
): LooksProProfilePreviewDto {
  return {
    id: profile.id,
    businessName: profile.businessName ?? null,
    handle: profile.handle ?? null,
    avatarUrl: profile.avatarUrl ?? null,
    professionType: profile.professionType ?? null,
    location: profile.location ?? null,
    verificationStatus: profile.verificationStatus,
    isPremium: profile.isPremium,
  }
}

export function parseLooksFeedEnvelope(
  raw: unknown,
): LooksFeedResponseDto {
  const items = parseLooksFeedResponse(raw)

  if (!isRecord(raw)) {
    return {
      items,
      nextCursor: null,
    }
  }

  const viewerContextRaw = isRecord(raw.viewerContext)
    ? raw.viewerContext
    : null

  const viewerContext =
    viewerContextRaw &&
    typeof viewerContextRaw.isAuthenticated === 'boolean'
      ? {
          isAuthenticated: viewerContextRaw.isAuthenticated,
        }
      : undefined

  return {
    items,
    nextCursor: pickString(raw.nextCursor),
    ...(viewerContext ? { viewerContext } : {}),
  }
}

export function parseLooksFeedResponse(raw: unknown): LooksFeedItemDto[] {
  if (!isRecord(raw)) return []

  const items = raw.items
  if (!Array.isArray(items)) return []

  const parsed: LooksFeedItemDto[] = []

  for (const item of items) {
    if (!isRecord(item)) continue

    const id = pickString(item.id)
    const url = pickString(item.url)
    const createdAt = pickString(item.createdAt)
    const thumbUrl = pickString(item.thumbUrl)
    const caption = pickString(item.caption)
    const viewerLiked = pickBoolean(item.viewerLiked)

    const mediaType =
      item.mediaType === MediaType.IMAGE || item.mediaType === MediaType.VIDEO
        ? item.mediaType
        : null

    const countsRaw = isRecord(item._count) ? item._count : null
    const likeCount = countsRaw ? pickNumber(countsRaw.likes) : null
    const commentCount = countsRaw ? pickNumber(countsRaw.comments) : null

    if (
      !id ||
      !url ||
      !createdAt ||
      viewerLiked === null ||
      mediaType === null ||
      likeCount === null ||
      commentCount === null
    ) {
      continue
    }

    const professionalRaw = isRecord(item.professional)
      ? item.professional
      : null

    let professional: LooksFeedItemDto['professional'] = null
    if (professionalRaw) {
      const professionalId = pickString(professionalRaw.id)

      if (professionalId) {
        const professionTypeRaw = professionalRaw.professionType
        professional = {
          id: professionalId,
          businessName: pickString(professionalRaw.businessName),
          handle: pickString(professionalRaw.handle),
          professionType: isProfessionType(professionTypeRaw)
            ? professionTypeRaw
            : null,
          avatarUrl: pickString(professionalRaw.avatarUrl),
          location: pickString(professionalRaw.location),
        }
      }
    }

    const uploadedByRoleRaw = item.uploadedByRole

    parsed.push({
      id,
      url,
      thumbUrl,
      mediaType,
      caption,
      createdAt,

      professional,

      _count: {
        likes: likeCount,
        comments: commentCount,
      },
      viewerLiked,

      serviceId: pickString(item.serviceId),
      serviceName: pickString(item.serviceName),
      category: pickString(item.category),
      serviceIds: Array.isArray(item.serviceIds)
        ? item.serviceIds
            .map((value) => pickString(value))
            .filter((value): value is string => value !== null)
        : [],

      uploadedByRole: isRole(uploadedByRoleRaw) ? uploadedByRoleRaw : null,
      reviewId: pickString(item.reviewId),
      reviewHelpfulCount: pickNumber(item.reviewHelpfulCount),
      reviewRating: pickNumber(item.reviewRating),
      reviewHeadline: pickString(item.reviewHeadline),
    })
  }

  return parsed
}

export function parseLooksCommentsResponse(raw: unknown): LooksCommentDto[] {
  if (!isRecord(raw)) return []

  const comments = raw.comments
  if (!Array.isArray(comments)) return []

  const parsed: LooksCommentDto[] = []

  for (const comment of comments) {
    if (!isRecord(comment)) continue

    const id = pickString(comment.id)
    const body = pickString(comment.body)
    const createdAt = pickString(comment.createdAt)
    const userRaw = isRecord(comment.user) ? comment.user : null

    if (!id || !body || !createdAt || !userRaw) continue

    const userId = pickString(userRaw.id)
    const displayName = pickString(userRaw.displayName)

    if (!userId || !displayName) continue

    parsed.push({
      id,
      body,
      createdAt,
      user: {
        id: userId,
        displayName,
        avatarUrl: pickString(userRaw.avatarUrl),
      },
    })
  }

  return parsed
}

function isLookPostStatus(value: unknown): value is LookPostStatus {
  return (
    value === LookPostStatus.DRAFT ||
    value === LookPostStatus.PUBLISHED ||
    value === LookPostStatus.ARCHIVED ||
    value === LookPostStatus.REMOVED
  )
}

function isLookPostVisibility(value: unknown): value is LookPostVisibility {
  return (
    value === LookPostVisibility.PUBLIC ||
    value === LookPostVisibility.FOLLOWERS_ONLY ||
    value === LookPostVisibility.UNLISTED
  )
}

function isModerationStatus(value: unknown): value is ModerationStatus {
  return (
    value === ModerationStatus.PENDING_REVIEW ||
    value === ModerationStatus.APPROVED ||
    value === ModerationStatus.REJECTED ||
    value === ModerationStatus.REMOVED ||
    value === ModerationStatus.AUTO_FLAGGED
  )
}

function isVerificationStatus(value: unknown): value is VerificationStatus {
  return (
    value === VerificationStatus.PENDING ||
    value === VerificationStatus.APPROVED ||
    value === VerificationStatus.REJECTED ||
    value === VerificationStatus.NEEDS_INFO
  )
}

function isMediaVisibility(value: unknown): value is MediaVisibility {
  return (
    value === MediaVisibility.PUBLIC ||
    value === MediaVisibility.PRO_CLIENT
  )
}

function parseLooksDetailReview(
  raw: unknown,
): LooksDetailReviewDto | null {
  if (!isRecord(raw)) return null

  const id = pickString(raw.id)
  const headline = pickString(raw.headline)
  const rating = pickNumber(raw.rating)
  const helpfulCount = pickNumber(raw.helpfulCount)

  if (!id || rating === null || helpfulCount === null) {
    return null
  }

  return {
    id,
    rating,
    headline,
    helpfulCount,
  }
}

function parseLooksDetailMedia(
  raw: unknown,
): LooksDetailMediaDto | null {
  if (!isRecord(raw)) return null

  const id = pickString(raw.id)
  const url = pickString(raw.url)
  const createdAt = pickString(raw.createdAt)
  const caption = pickString(raw.caption)
  const thumbUrl = pickString(raw.thumbUrl)
  const review = raw.review == null ? null : parseLooksDetailReview(raw.review)

  const mediaType =
    raw.mediaType === MediaType.IMAGE || raw.mediaType === MediaType.VIDEO
      ? raw.mediaType
      : null

  if (!id || !url || !createdAt || mediaType === null) {
    return null
  }

  return {
    id,
    url,
    thumbUrl,
    mediaType,
    caption,
    createdAt,
    review,
  }
}

function parseLooksDetailService(
  raw: unknown,
): LooksDetailServiceDto | null {
  if (!isRecord(raw)) return null

  const id = pickString(raw.id)
  const name = pickString(raw.name)

  if (!id || !name) return null

  const categoryRaw = isRecord(raw.category) ? raw.category : null
  const category =
    categoryRaw &&
    typeof categoryRaw.name === 'string' &&
    categoryRaw.name.trim().length > 0 &&
    typeof categoryRaw.slug === 'string' &&
    categoryRaw.slug.trim().length > 0
      ? {
          name: categoryRaw.name.trim(),
          slug: categoryRaw.slug.trim(),
        }
      : null

  return {
    id,
    name,
    category,
  }
}

function parseLooksDetailAdmin(
  raw: unknown,
): LooksDetailAdminDto | null {
  if (!isRecord(raw)) return null
  if (raw.canModerate !== true) return null

  const primaryMediaAssetId = pickString(raw.primaryMediaAssetId)
  const archivedAt = pickString(raw.archivedAt)
  const removedAt = pickString(raw.removedAt)
  const primaryMediaRaw = isRecord(raw.primaryMedia) ? raw.primaryMedia : null

  if (!primaryMediaAssetId || !primaryMediaRaw) {
    return null
  }

  const visibility = isMediaVisibility(primaryMediaRaw.visibility)
    ? primaryMediaRaw.visibility
    : null
  const isEligibleForLooks = pickBoolean(primaryMediaRaw.isEligibleForLooks)
  const isFeaturedInPortfolio = pickBoolean(
    primaryMediaRaw.isFeaturedInPortfolio,
  )
  const reviewBody = pickString(primaryMediaRaw.reviewBody)

  if (
    visibility === null ||
    isEligibleForLooks === null ||
    isFeaturedInPortfolio === null
  ) {
    return null
  }

  return {
    canModerate: true,
    archivedAt,
    removedAt,
    primaryMediaAssetId,
    primaryMedia: {
      visibility,
      isEligibleForLooks,
      isFeaturedInPortfolio,
      reviewBody,
    },
  }
}

function parseLooksDetailAsset(
  raw: unknown,
): LooksDetailAssetDto | null {
  if (!isRecord(raw)) return null

  const id = pickString(raw.id)
  const mediaAssetId = pickString(raw.mediaAssetId)
  const sortOrder = pickNumber(raw.sortOrder)
  const media = parseLooksDetailMedia(raw.media)

  if (!id || !mediaAssetId || sortOrder === null || !media) {
    return null
  }

  return {
    id,
    sortOrder,
    mediaAssetId,
    media,
  }
}

export function parseLooksDetailResponse(
  raw: unknown,
): LooksDetailItemDto | null {
  if (!isRecord(raw)) return null

  const itemRaw = isRecord(raw.item) ? raw.item : null
  if (!itemRaw) return null

  const id = pickString(itemRaw.id)
  const caption = pickString(itemRaw.caption)
  const publishedAt = pickString(itemRaw.publishedAt)
  const createdAt = pickString(itemRaw.createdAt)
  const updatedAt = pickString(itemRaw.updatedAt)

  const status = isLookPostStatus(itemRaw.status) ? itemRaw.status : null
  const visibility = isLookPostVisibility(itemRaw.visibility)
    ? itemRaw.visibility
    : null
  const moderationStatus = isModerationStatus(itemRaw.moderationStatus)
    ? itemRaw.moderationStatus
    : null

  const professionalRaw = isRecord(itemRaw.professional)
    ? itemRaw.professional
    : null
  if (!professionalRaw) return null

  const professionalId = pickString(professionalRaw.id)
  const verificationStatus = isVerificationStatus(
    professionalRaw.verificationStatus,
  )
    ? professionalRaw.verificationStatus
    : null
  const isPremium = pickBoolean(professionalRaw.isPremium)

  if (!professionalId || verificationStatus === null || isPremium === null) {
    return null
  }

  const professionType = isProfessionType(professionalRaw.professionType)
    ? professionalRaw.professionType
    : null

  const professional = {
    id: professionalId,
    businessName: pickString(professionalRaw.businessName),
    handle: pickString(professionalRaw.handle),
    avatarUrl: pickString(professionalRaw.avatarUrl),
    professionType,
    location: pickString(professionalRaw.location),
    verificationStatus,
    isPremium,
  }

  const service =
    itemRaw.service == null ? null : parseLooksDetailService(itemRaw.service)

  const primaryMedia = parseLooksDetailMedia(itemRaw.primaryMedia)
  if (!primaryMedia) return null

  const countsRaw = isRecord(itemRaw._count) ? itemRaw._count : null
  const viewerContextRaw = isRecord(itemRaw.viewerContext)
    ? itemRaw.viewerContext
    : null

  if (!countsRaw || !viewerContextRaw) return null

  const likes = pickNumber(countsRaw.likes)
  const comments = pickNumber(countsRaw.comments)
  const saves = pickNumber(countsRaw.saves)
  const shares = pickNumber(countsRaw.shares)

  const isAuthenticated = pickBoolean(viewerContextRaw.isAuthenticated)
  const viewerLiked = pickBoolean(viewerContextRaw.viewerLiked)
  const canComment = pickBoolean(viewerContextRaw.canComment)
  const canSave = pickBoolean(viewerContextRaw.canSave)
  const isOwner = pickBoolean(viewerContextRaw.isOwner)

  if (
    !id ||
    !createdAt ||
    !updatedAt ||
    status === null ||
    visibility === null ||
    moderationStatus === null ||
    likes === null ||
    comments === null ||
    saves === null ||
    shares === null ||
    isAuthenticated === null ||
    viewerLiked === null ||
    canComment === null ||
    canSave === null ||
    isOwner === null
  ) {
    return null
  }

  const assets = Array.isArray(itemRaw.assets)
    ? itemRaw.assets
        .map((asset) => parseLooksDetailAsset(asset))
        .filter((asset): asset is LooksDetailAssetDto => asset !== null)
    : []

  const admin =
    itemRaw.admin == null
      ? undefined
      : parseLooksDetailAdmin(itemRaw.admin) ?? undefined

  return {
    id,
    caption,
    status,
    visibility,
    moderationStatus,
    publishedAt,
    createdAt,
    updatedAt,
    professional,
    service,
    primaryMedia,
    assets,
    _count: {
      likes,
      comments,
      saves,
      shares,
    },
    viewerContext: {
      isAuthenticated,
      viewerLiked,
      canComment,
      canSave,
      isOwner,
    },
    ...(admin ? { admin } : {}),
  }
}