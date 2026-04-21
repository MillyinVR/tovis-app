// lib/viralRequests/contracts.ts
import type {
  EnqueueViralRequestApprovalNotificationsResult,
  ViralRequestListRow,
} from '@/lib/viralRequests'

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value.filter((entry): entry is string => typeof entry === 'string')
}

function copyStringArray(values: readonly string[]): string[] {
  return [...values]
}

function toIso(value: Date | null): string | null {
  return value ? value.toISOString() : null
}

function requireNonEmptyString(name: string, value: string): string {
  const trimmed = value.trim()

  if (!trimmed) {
    throw new Error(`${name} is required.`)
  }

  return trimmed
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

export type InlineViralRequestApprovalNotificationsDto = {
  enqueued: true
  matchedProfessionalIds: string[]
  notificationIds: string[]
  deliveryMode: 'INLINE'
}

export type QueuedViralRequestApprovalNotificationsDto = {
  enqueued: true
  matchedProfessionalIds: string[]
  notificationIds: string[]
  jobId: string
  deliveryMode: 'JOB_QUEUED'
}

export type ViralRequestApprovalNotificationsDto =
  | InlineViralRequestApprovalNotificationsDto
  | QueuedViralRequestApprovalNotificationsDto

export function toViralRequestApprovalNotificationsDto(
  result: EnqueueViralRequestApprovalNotificationsResult,
): InlineViralRequestApprovalNotificationsDto {
  return {
    enqueued: true,
    matchedProfessionalIds: copyStringArray(result.matchedProfessionalIds),
    notificationIds: copyStringArray(result.notificationIds),
    deliveryMode: 'INLINE',
  }
}

export function toQueuedViralRequestApprovalNotificationsDto(args: {
  jobId: string
}): QueuedViralRequestApprovalNotificationsDto {
  return {
    enqueued: true,
    matchedProfessionalIds: [],
    notificationIds: [],
    jobId: requireNonEmptyString('jobId', args.jobId),
    deliveryMode: 'JOB_QUEUED',
  }
}