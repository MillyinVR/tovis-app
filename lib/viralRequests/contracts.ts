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
  /**
   * The picture this look is shown by. `coverImageUrl` is the REVIEWER's pick
   * and wins; `mediaUrls[0]` is what the submitter attached. Null when there is
   * neither — the surfaces then draw their own gradient.
   */
  coverImage: string | null
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

/**
 * The one place that decides which picture a viral look is shown by, so the
 * admin queue, the client home and every future surface cannot disagree.
 *
 * The REVIEWER's pick wins over the submitter's attachment — that is the whole
 * point of having both: an admin can replace a bad photo without destroying
 * what the client sent.
 */
export function resolveViralCoverImage(row: {
  coverImageUrl: string | null
  mediaUrlsJson: ViralRequestListRow['mediaUrlsJson']
}): string | null {
  const chosen = row.coverImageUrl?.trim()
  if (chosen) return chosen
  return readStringArray(row.mediaUrlsJson)[0] ?? null
}

export function toViralRequestDto(row: ViralRequestListRow): ViralRequestDto {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? null,
    sourceUrl: row.sourceUrl ?? null,
    links: readStringArray(row.linksJson),
    mediaUrls: readStringArray(row.mediaUrlsJson),
    coverImage: resolveViralCoverImage(row),
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