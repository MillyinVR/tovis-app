// lib/looks/mappers.ts
import {
  MediaType,
  ProfessionType,
  Role,
  type MediaVisibility,
} from '@prisma/client'
import { renderMediaUrls } from '@/lib/media/renderUrls'
import type {
  LooksBoardPreviewRow,
  LooksDetailRow,
  LooksFeedRow,
  LooksProProfilePreviewRow,
} from '@/lib/looks/selects'
import type {
  LooksBoardPreviewDto,
  LooksBoardPreviewPrimaryMediaDto,
  LooksCommentDto,
  LooksFeedItemDto,
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