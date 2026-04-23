// lib/looks/mappers.ts
import 'server-only'

import { MediaType } from '@prisma/client'
import type { MediaVisibility, Role } from '@prisma/client'

import { renderMediaUrls } from '@/lib/media/renderUrls'
import {
  resolveLookPrimaryService,
  toLookPrimaryServiceSummary,
} from '@/lib/looks/serviceOwnership'
import type {
  LooksBoardDetailRow,
  LooksBoardPreviewRow,
  LooksDetailRow,
  LooksFeedRow,
} from '@/lib/looks/selects'
import type {
  LooksBoardDetailDto,
  LooksBoardPreviewDto,
  LooksBoardPreviewPrimaryMediaDto,
  LooksCommentDto,
  LooksDetailAssetDto,
  LooksDetailItemDto,
  LooksDetailReviewDto,
  LooksFeedItemDto,
  LooksPortfolioTileDto,
  LooksRenderedMediaDto,
} from '@/lib/looks/types'
import { mapLooksProProfilePreviewToDto } from '@/lib/looks/profilePreview'

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

function isNonNull<T>(value: T | null): value is T {
  return value !== null
}

function pickString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : null
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

function pickMediaServiceTagIds(
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
  viewerSaved: boolean
}): Promise<LooksFeedItemDto | null> {
  const { item, viewerLiked, viewerSaved } = args
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

  const resolvedPrimaryService = resolveLookPrimaryService({
    serviceId: item.serviceId,
    service: item.service,
  })
  const primaryService = toLookPrimaryServiceSummary(resolvedPrimaryService)

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
    viewerSaved,

    serviceId: primaryService?.id ?? null,
    serviceName: primaryService?.name ?? null,
    category: primaryService?.categoryName ?? null,
    serviceIds: resolvedPrimaryService.serviceIds,

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
    serviceIds: pickMediaServiceTagIds(input.services),
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
}) {
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

  const resolvedPrimaryService = resolveLookPrimaryService({
    serviceId: item.serviceId,
    service: item.service,
  })
  const primaryService = resolvedPrimaryService.primaryService

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

    service: primaryService
      ? {
          id: primaryService.id,
          name: primaryService.name,
          category: primaryService.category
            ? {
                name: primaryService.category.name,
                slug: primaryService.category.slug,
              }
            : null,
        }
      : null,

    primaryMedia: mapRenderableLooksDetailMediaToDto(item.primaryMediaAsset),

    assets: item.assets.map((asset): LooksDetailAssetDto => ({
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