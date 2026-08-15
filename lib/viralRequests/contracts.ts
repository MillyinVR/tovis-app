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
   * The picture this look is shown by: the REVIEWER's `coverImageUrl`, and only
   * that. Null until someone sets one — the surfaces then draw their own
   * gradient. `mediaUrls` (what the submitter attached) is never a substitute;
   * see `resolveViralCoverImage`.
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
 * 🔴 ONLY the reviewer's `coverImageUrl` — never the submitter's attachment
 * (Tori, 2026-08-14: *"the client can upload an image or video but only the
 * admin can set it app wide"*).
 *
 * It is tempting to fall back to `mediaUrls[0]` so a look has a picture sooner,
 * and that was the first cut of this function. It is wrong: a client attaches
 * whatever they photographed or found, and approving the look would then publish
 * that image across the platform with nobody having chosen it — someone else's
 * copyrighted shot, or worse, on a surface every client sees. The submitter's
 * media is EVIDENCE for the reviewer, shown in the queue; a reviewer promotes it
 * with one tap ("Use this"), which copies it here. Nothing reaches a client
 * surface until that happens.
 */
export function resolveViralCoverImage(row: {
  coverImageUrl: string | null
}): string | null {
  return row.coverImageUrl?.trim() || null
}

/**
 * What the SUBMITTER attached — reviewer-facing only. Never rendered on a client
 * surface; see `resolveViralCoverImage`.
 */
export function readViralSubmitterMedia(row: {
  mediaUrlsJson: ViralRequestListRow['mediaUrlsJson']
}): string[] {
  return readStringArray(row.mediaUrlsJson)
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