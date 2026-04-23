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

import type {
  LooksCommentDto,
  LooksDetailAdminDto,
  LooksDetailAssetDto,
  LooksDetailItemDto,
  LooksDetailMediaDto,
  LooksDetailReviewDto,
  LooksDetailServiceDto,
  LooksFeedItemDto,
  LooksFeedResponseDto,
} from '@/lib/looks/types'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
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
  return value === Role.CLIENT || value === Role.PRO || value === Role.ADMIN
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

export function parseLooksFeedEnvelope(raw: unknown): LooksFeedResponseDto {
  const items = parseLooksFeedResponse(raw)

  if (!isRecord(raw)) {
    return {
      items,
      nextCursor: null,
    }
  }

  const viewerContextRaw = isRecord(raw.viewerContext) ? raw.viewerContext : null

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
    const viewerSaved = pickBoolean(item.viewerSaved)

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
      viewerSaved === null ||
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
      viewerSaved,

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

function parseLooksDetailReview(raw: unknown): LooksDetailReviewDto | null {
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

function parseLooksDetailMedia(raw: unknown): LooksDetailMediaDto | null {
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

function parseLooksDetailService(raw: unknown): LooksDetailServiceDto | null {
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

function parseLooksDetailAdmin(raw: unknown): LooksDetailAdminDto | null {
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

function parseLooksDetailAsset(raw: unknown): LooksDetailAssetDto | null {
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

export function parseLooksDetailResponse(raw: unknown): LooksDetailItemDto | null {
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