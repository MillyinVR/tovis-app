import {
  LookPostStatus,
  LookPostVisibility,
  MediaType,
  MediaVisibility,
  ModerationStatus,
  ProfessionType,
  ProNameDisplay,
  Role,
  VerificationStatus,
} from '@prisma/client'

import { isRecord } from '@/lib/guards'
import type {
  LookBadgeDto,
  LookBadgeKind,
  LookBadgeTone,
  LooksClientAuthorDto,
  LooksCommentDto,
  LooksDetailAdminDto,
  LooksDetailAssetDto,
  LooksDetailItemDto,
  LooksDetailMediaDto,
  LooksDetailReviewDto,
  LooksDetailServiceDto,
  LooksFeedItemDto,
  LooksFeedResponseDto,
  LooksTagDto,
} from '@/lib/looks/types'
import type { PairedBeforeDto } from '@/lib/media/pairedBefore'

// Parse the tag chips list on a feed/detail item (social-first D1). Tolerant of
// absence (older payloads → []); drops any entry missing a slug or display.
function parseLooksTagList(raw: unknown): LooksTagDto[] {
  if (!Array.isArray(raw)) return []
  const out: LooksTagDto[] = []
  for (const entry of raw) {
    if (!isRecord(entry)) continue
    const slug = pickString(entry.slug)
    const display = pickString(entry.display)
    if (!slug || !display) continue
    out.push({ slug, display })
  }
  return out
}

// Parse an opt-in before/after pairing on the primary asset. Requires an id and
// at least one usable URL; anything else → null (render the single tile).
function parsePairedBefore(raw: unknown): PairedBeforeDto | null {
  if (!isRecord(raw)) return null
  const id = pickString(raw.id)
  const thumbUrl = pickString(raw.thumbUrl)
  const fullUrl = pickString(raw.fullUrl)
  if (!id || (!thumbUrl && !fullUrl)) return null
  return { id, thumbUrl, fullUrl }
}

function isLookBadgeKind(value: unknown): value is LookBadgeKind {
  return (
    value === 'BOOKING_FAST' ||
    value === 'LOOK_BOOKED_RECENTLY' ||
    value === 'BOOKED_30D' ||
    value === 'REBOOK_RATE' ||
    value === 'NEW_TO_PLATFORM' ||
    value === 'EVENT_COUNTDOWN' ||
    value === 'DISTANCE'
  )
}

function isLookBadgeTone(value: unknown): value is LookBadgeTone {
  return (
    value === 'accent' ||
    value === 'info' ||
    value === 'success' ||
    value === 'warn' ||
    value === 'neutral'
  )
}

// Parse the computed feed badge (spec §5). Tolerant of absence (older
// payloads / non-badging surfaces → null); an unknown kind or tone drops the
// badge rather than the item.
function parseLookBadge(raw: unknown): LookBadgeDto | null {
  if (!isRecord(raw)) return null
  const label = pickString(raw.label)
  if (!label) return null
  if (!isLookBadgeKind(raw.kind) || !isLookBadgeTone(raw.tone)) return null
  return { kind: raw.kind, label, tone: raw.tone }
}

function parseLooksClientAuthor(raw: unknown): LooksClientAuthorDto | null {
  if (!isRecord(raw)) return null
  const handle = pickString(raw.handle)
  if (!handle) return null
  return {
    handle,
    avatarUrl: pickString(raw.avatarUrl),
    profileHref: pickString(raw.profileHref),
  }
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

function isProNameDisplay(value: unknown): value is ProNameDisplay {
  return (
    value === ProNameDisplay.BUSINESS_NAME ||
    value === ProNameDisplay.REAL_NAME ||
    value === ProNameDisplay.HANDLE
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
    const viewerFollows = pickBoolean(item.viewerFollows) ?? false

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

        const followerCountRaw = pickNumber(professionalRaw.followerCount)

        professional = {
          id: professionalId,
          businessName: pickString(professionalRaw.businessName),
          firstName: pickString(professionalRaw.firstName),
          lastName: pickString(professionalRaw.lastName),
          handle: pickString(professionalRaw.handle),
          nameDisplay: isProNameDisplay(professionalRaw.nameDisplay)
            ? professionalRaw.nameDisplay
            : null,
          professionType: isProfessionType(professionTypeRaw)
            ? professionTypeRaw
            : null,
          avatarUrl: pickString(professionalRaw.avatarUrl),
          location: pickString(professionalRaw.location),
          followerCount: followerCountRaw !== null && followerCountRaw >= 0
            ? followerCountRaw
            : 0,
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
      clientAuthor: parseLooksClientAuthor(item.clientAuthor),

      _count: {
        likes: likeCount,
        comments: commentCount,
      },
      viewerLiked,
      viewerSaved,
      viewerFollows,

      serviceId: pickString(item.serviceId),
      serviceName: pickString(item.serviceName),
      category: pickString(item.category),
      serviceIds: Array.isArray(item.serviceIds)
        ? item.serviceIds
            .map((value) => pickString(value))
            .filter((value): value is string => value !== null)
        : [],

      // Smart cover-crop focal (camera C6). Tolerant of absence (older payloads
      // → null → center); out-of-range values are re-validated at render.
      focalX: pickNumber(item.focalX),
      focalY: pickNumber(item.focalY),

      priceStartingAt: pickNumber(item.priceStartingAt),

      before: parsePairedBefore(item.before),

      tags: parseLooksTagList(item.tags),

      uploadedByRole: isRole(uploadedByRoleRaw) ? uploadedByRoleRaw : null,
      reviewId: pickString(item.reviewId),
      reviewHelpfulCount: pickNumber(item.reviewHelpfulCount),
      reviewRating: pickNumber(item.reviewRating),
      reviewHeadline: pickString(item.reviewHeadline),

      badge: parseLookBadge(item.badge),
    })
  }

  return parsed
}

export function parseLooksComment(raw: unknown): LooksCommentDto | null {
  if (!isRecord(raw)) return null

  const id = pickString(raw.id)
  const body = pickString(raw.body)
  const createdAt = pickString(raw.createdAt)
  const userRaw = isRecord(raw.user) ? raw.user : null

  if (!id || !body || !createdAt || !userRaw) return null

  const userId = pickString(userRaw.id)
  const displayName = pickString(userRaw.displayName)

  if (!userId || !displayName) return null

  return {
    id,
    body,
    createdAt,
    user: {
      id: userId,
      displayName,
      avatarUrl: pickString(userRaw.avatarUrl),
      profileHref: pickString(userRaw.profileHref),
      isLookAuthor: pickBoolean(userRaw.isLookAuthor) ?? false,
      isPro: pickBoolean(userRaw.isPro) ?? false,
    },
    parentCommentId: pickString(raw.parentCommentId),
    likeCount: pickNumber(raw.likeCount) ?? 0,
    replyCount: pickNumber(raw.replyCount) ?? 0,
    viewerLiked: pickBoolean(raw.viewerLiked) ?? false,
    viewerCanDelete: pickBoolean(raw.viewerCanDelete) ?? false,
  }
}

function parseLooksCommentArray(raw: unknown): LooksCommentDto[] {
  if (!Array.isArray(raw)) return []

  const parsed: LooksCommentDto[] = []
  for (const entry of raw) {
    const comment = parseLooksComment(entry)
    if (comment) parsed.push(comment)
  }

  return parsed
}

export function parseLooksCommentsResponse(raw: unknown): LooksCommentDto[] {
  if (!isRecord(raw)) return []
  return parseLooksCommentArray(raw.comments)
}

export function parseLooksCommentRepliesResponse(
  raw: unknown,
): LooksCommentDto[] {
  if (!isRecord(raw)) return []
  return parseLooksCommentArray(raw.replies)
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
    // Smart cover-crop focal (camera C6). Tolerant of absence → null → center.
    focalX: pickNumber(raw.focalX),
    focalY: pickNumber(raw.focalY),
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
    firstName: pickString(professionalRaw.firstName),
    lastName: pickString(professionalRaw.lastName),
    handle: pickString(professionalRaw.handle),
    nameDisplay: isProNameDisplay(professionalRaw.nameDisplay)
      ? professionalRaw.nameDisplay
      : null,
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
  // views is additive/newer — tolerate its absence so an older payload still
  // parses (defaults to 0) rather than nulling the whole detail.
  const views = pickNumber(countsRaw.views) ?? 0

  const isAuthenticated = pickBoolean(viewerContextRaw.isAuthenticated)
  const viewerLiked = pickBoolean(viewerContextRaw.viewerLiked)
  const viewerSaved = pickBoolean(viewerContextRaw.viewerSaved)
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
    viewerSaved === null ||
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
    clientAuthor: parseLooksClientAuthor(itemRaw.clientAuthor),
    service,
    primaryMedia,
    before: parsePairedBefore(itemRaw.before),
    tags: parseLooksTagList(itemRaw.tags),
    assets,
    _count: {
      likes,
      comments,
      saves,
      shares,
      views,
    },
    viewerContext: {
      isAuthenticated,
      viewerLiked,
      viewerSaved,
      canComment,
      canSave,
      isOwner,
    },
    ...(admin ? { admin } : {}),
  }
}