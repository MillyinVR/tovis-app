// lib/viralRequests/contracts.ts
import type {
  EnqueueViralRequestApprovalNotificationsResult,
  ViralRequestListRow,
} from '@/lib/viralRequests'

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []

  return value.filter((entry): entry is string => typeof entry === 'string')
}

function toIso(value: Date | null): string | null {
  return value ? value.toISOString() : null
}

export type ViralRequestDto = {
  id: string
  name: string
  description: string | null
  sourceUrl: string | null
  links: string[]
  mediaUrls: string[]
  requestedCategoryId: string | null
  requestedCategory: {
    id: string
    name: string
    slug: string
  } | null
  status: ViralRequestListRow['status']
  moderationStatus: ViralRequestListRow['moderationStatus']
  reportCount: number
  removedAt: string | null
  reviewedAt: string | null
  reviewedByUserId: string | null
  approvedAt: string | null
  rejectedAt: string | null
  adminNotes: string | null
  createdAt: string
  updatedAt: string
}

export function toViralRequestDto(row: ViralRequestListRow): ViralRequestDto {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? null,
    sourceUrl: row.sourceUrl ?? null,
    links: readStringArray(row.linksJson),
    mediaUrls: readStringArray(row.mediaUrlsJson),
    requestedCategoryId: row.requestedCategoryId ?? null,
    requestedCategory: row.requestedCategory
      ? {
          id: row.requestedCategory.id,
          name: row.requestedCategory.name,
          slug: row.requestedCategory.slug,
        }
      : null,
    status: row.status,
    moderationStatus: row.moderationStatus,
    reportCount: row.reportCount,
    removedAt: toIso(row.removedAt),
    reviewedAt: toIso(row.reviewedAt),
    reviewedByUserId: row.reviewedByUserId ?? null,
    approvedAt: toIso(row.approvedAt),
    rejectedAt: toIso(row.rejectedAt),
    adminNotes: row.adminNotes ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

export type ViralRequestApprovalNotificationsDto = {
  enqueued: true
  matchedProfessionalIds: string[]
  notificationIds: string[]
}

export function toViralRequestApprovalNotificationsDto(
  result: EnqueueViralRequestApprovalNotificationsResult,
): ViralRequestApprovalNotificationsDto {
  return {
    enqueued: result.enqueued,
    matchedProfessionalIds: [...result.matchedProfessionalIds],
    notificationIds: [...result.notificationIds],
  }
}