import {
  MediaType,
  ProfessionType,
  Role,
} from '@prisma/client'

import type {
  LooksCommentDto,
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