// lib/privacy/adminLookModeration.ts
//
// PII boundary for the admin Looks/UGC moderation queue (SUPER_ADMIN support
// surface, social-first AM1). Showing the author's name next to the content
// they posted is a legitimate moderation need, but plaintext-PII reads must
// cross HERE — inside lib/privacy — so the crossing stays audited and the
// route/UI never touch raw firstName/lastName. Output PII is limited to display
// labels (author + pro).
//
// This is a platform-operator surface: it reads looks and comments across ALL
// tenants via the explicit platformCrossTenantProVisibilityFilter() opt-out
// (not a discovery leak), and deliberately INCLUDES already-actioned rows
// (rejected/removed/hidden) — moderators need to see what's hidden to reverse
// it. Client-authored looks are included by design (prerequisite for C2).

import {
  LookPostStatus,
  MediaType,
  ModerationReportReason,
  ModerationStatus,
  Prisma,
} from '@prisma/client'

import { renderMediaUrls } from '@/lib/media/renderUrls'
import { prisma } from '@/lib/prisma'
import { platformCrossTenantProVisibilityFilter } from '@/lib/tenant'

const MAX_RESULTS = 50
const MAX_REPORT_REASONS = 20

export type AdminLookModerationStatusFilter =
  | 'REPORTED'
  | 'PENDING'
  | 'FLAGGED'
  | 'REJECTED'
  | 'REMOVED'
  | 'APPROVED'
  | 'ALL'

export const ADMIN_LOOK_MODERATION_STATUS_FILTERS: readonly AdminLookModerationStatusFilter[] =
  ['REPORTED', 'PENDING', 'FLAGGED', 'REJECTED', 'REMOVED', 'APPROVED', 'ALL']

export function isAdminLookModerationStatusFilter(
  value: unknown,
): value is AdminLookModerationStatusFilter {
  return (
    typeof value === 'string' &&
    (ADMIN_LOOK_MODERATION_STATUS_FILTERS as readonly string[]).includes(value)
  )
}

export type AdminLookModerationRow = {
  lookPostId: string
  caption: string | null
  authorKind: 'PRO' | 'CLIENT'
  /** Client's name (client-authored) or the pro's display label (pro-authored). */
  authorLabel: string
  professionalId: string
  /** businessName, else the pro's personal name, else the handle. */
  proLabel: string
  proHandle: string | null
  status: LookPostStatus
  moderationStatus: ModerationStatus
  createdAt: string
  publishedAt: string | null
  thumbUrl: string | null
  mediaType: MediaType
  likeCount: number
  commentCount: number
  saveCount: number
  shareCount: number
  viewCount: number
  /** Count of unresolved reports (drives the Reported queue). */
  reportCount: number
  reportReasons: ModerationReportReason[]
  featured: boolean
  featuredAt: string | null
  adminNotes: string | null
  reviewedAt: string | null
}

export type AdminLookCommentModerationRow = {
  lookCommentId: string
  lookPostId: string
  body: string
  authorLabel: string
  createdAt: string
  moderationStatus: ModerationStatus
  removedAt: string | null
  professionalId: string
  proLabel: string
  proHandle: string | null
  reportCount: number
  reportReasons: ModerationReportReason[]
  adminNotes: string | null
  reviewedAt: string | null
}

function buildProSearchWhere(
  query: string,
): Prisma.ProfessionalProfileWhereInput {
  return {
    // Platform-operator surface: admins intentionally moderate looks across ALL
    // tenants (the explicit cross-tenant opt-out, not a discovery leak).
    ...platformCrossTenantProVisibilityFilter(),
    ...(query.length >= 2
      ? {
          OR: [
            { businessName: { contains: query, mode: 'insensitive' } },
            { handle: { contains: query, mode: 'insensitive' } },
            { firstName: { contains: query, mode: 'insensitive' } },
            { lastName: { contains: query, mode: 'insensitive' } },
          ],
        }
      : {}),
  }
}

function buildLookStatusWhere(
  status: AdminLookModerationStatusFilter,
): Prisma.LookPostWhereInput {
  switch (status) {
    case 'REPORTED':
      return { reports: { some: { resolvedAt: null } } }
    case 'PENDING':
      return { moderationStatus: ModerationStatus.PENDING_REVIEW }
    case 'FLAGGED':
      return { moderationStatus: ModerationStatus.AUTO_FLAGGED }
    case 'REJECTED':
      return { moderationStatus: ModerationStatus.REJECTED }
    case 'REMOVED':
      return { status: LookPostStatus.REMOVED }
    case 'APPROVED':
      return { moderationStatus: ModerationStatus.APPROVED }
    case 'ALL':
      return {}
  }
}

function buildCommentStatusWhere(
  status: AdminLookModerationStatusFilter,
): Prisma.LookCommentWhereInput {
  switch (status) {
    case 'REPORTED':
      return { reports: { some: { resolvedAt: null } } }
    case 'PENDING':
      return { moderationStatus: ModerationStatus.PENDING_REVIEW }
    case 'FLAGGED':
      return { moderationStatus: ModerationStatus.AUTO_FLAGGED }
    case 'REJECTED':
      return { moderationStatus: ModerationStatus.REJECTED }
    case 'REMOVED':
      return { moderationStatus: ModerationStatus.REMOVED }
    case 'APPROVED':
      return { moderationStatus: ModerationStatus.APPROVED }
    case 'ALL':
      return {}
  }
}

function joinName(first: string | null, last: string | null): string {
  return [first, last].filter(Boolean).join(' ').trim()
}

function proLabelFor(pro: {
  id: string
  businessName: string | null
  firstName: string | null
  lastName: string | null
  handle: string | null
}): string {
  return (
    pro.businessName?.trim() ||
    joinName(pro.firstName, pro.lastName) ||
    pro.handle ||
    pro.id
  )
}

function distinctReasons(
  reports: { reason: ModerationReportReason }[],
): ModerationReportReason[] {
  return Array.from(new Set(reports.map((r) => r.reason)))
}

const proLabelSelect = {
  id: true,
  businessName: true,
  firstName: true,
  lastName: true,
  handle: true,
} satisfies Prisma.ProfessionalProfileSelect

export async function listAdminLookModeration(args: {
  status: AdminLookModerationStatusFilter
  q?: string
}): Promise<AdminLookModerationRow[]> {
  const query = (args.q ?? '').trim()

  const looks = await prisma.lookPost.findMany({
    where: {
      professional: buildProSearchWhere(query),
      ...buildLookStatusWhere(args.status),
    },
    orderBy: { createdAt: 'desc' },
    take: MAX_RESULTS,
    select: {
      id: true,
      caption: true,
      clientAuthorId: true,
      status: true,
      moderationStatus: true,
      createdAt: true,
      publishedAt: true,
      featuredAt: true,
      adminNotes: true,
      reviewedAt: true,
      likeCount: true,
      commentCount: true,
      saveCount: true,
      shareCount: true,
      viewCount: true,
      primaryMediaAsset: {
        select: {
          mediaType: true,
          url: true,
          thumbUrl: true,
          storageBucket: true,
          storagePath: true,
          thumbBucket: true,
          thumbPath: true,
        },
      },
      professional: { select: proLabelSelect },
      clientAuthor: { select: { firstName: true, lastName: true } },
      _count: { select: { reports: { where: { resolvedAt: null } } } },
      reports: {
        where: { resolvedAt: null },
        select: { reason: true },
        take: MAX_REPORT_REASONS,
      },
    },
  })

  return Promise.all(
    looks.map(async (look) => {
      const { renderThumbUrl } = await renderMediaUrls(look.primaryMediaAsset)
      const clientName = joinName(
        look.clientAuthor?.firstName ?? null,
        look.clientAuthor?.lastName ?? null,
      )
      const proLabel = proLabelFor(look.professional)

      return {
        lookPostId: look.id,
        caption: look.caption,
        authorKind: look.clientAuthorId ? 'CLIENT' : 'PRO',
        authorLabel: look.clientAuthorId
          ? clientName || 'Client'
          : proLabel,
        professionalId: look.professional.id,
        proLabel,
        proHandle: look.professional.handle,
        status: look.status,
        moderationStatus: look.moderationStatus,
        createdAt: look.createdAt.toISOString(),
        publishedAt: look.publishedAt?.toISOString() ?? null,
        thumbUrl: renderThumbUrl,
        mediaType: look.primaryMediaAsset.mediaType,
        likeCount: look.likeCount,
        commentCount: look.commentCount,
        saveCount: look.saveCount,
        shareCount: look.shareCount,
        viewCount: look.viewCount,
        reportCount: look._count.reports,
        reportReasons: distinctReasons(look.reports),
        featured: look.featuredAt !== null,
        featuredAt: look.featuredAt?.toISOString() ?? null,
        adminNotes: look.adminNotes,
        reviewedAt: look.reviewedAt?.toISOString() ?? null,
      }
    }),
  )
}

export async function listAdminLookCommentModeration(args: {
  status: AdminLookModerationStatusFilter
  q?: string
}): Promise<AdminLookCommentModerationRow[]> {
  const query = (args.q ?? '').trim()

  const comments = await prisma.lookComment.findMany({
    where: {
      lookPost: { professional: buildProSearchWhere(query) },
      ...buildCommentStatusWhere(args.status),
    },
    orderBy: { createdAt: 'desc' },
    take: MAX_RESULTS,
    select: {
      id: true,
      lookPostId: true,
      body: true,
      createdAt: true,
      moderationStatus: true,
      removedAt: true,
      adminNotes: true,
      reviewedAt: true,
      user: {
        select: {
          clientProfile: { select: { firstName: true, lastName: true } },
          professionalProfile: {
            select: { businessName: true, firstName: true, lastName: true },
          },
        },
      },
      lookPost: { select: { professional: { select: proLabelSelect } } },
      _count: { select: { reports: { where: { resolvedAt: null } } } },
      reports: {
        where: { resolvedAt: null },
        select: { reason: true },
        take: MAX_REPORT_REASONS,
      },
    },
  })

  return comments.map((comment) => {
    const pro = comment.lookPost.professional
    const client = comment.user.clientProfile
    const commenterPro = comment.user.professionalProfile
    const authorLabel =
      joinName(client?.firstName ?? null, client?.lastName ?? null) ||
      commenterPro?.businessName?.trim() ||
      joinName(commenterPro?.firstName ?? null, commenterPro?.lastName ?? null) ||
      'User'
    return {
      lookCommentId: comment.id,
      lookPostId: comment.lookPostId,
      body: comment.body,
      authorLabel,
      createdAt: comment.createdAt.toISOString(),
      moderationStatus: comment.moderationStatus,
      removedAt: comment.removedAt?.toISOString() ?? null,
      professionalId: pro.id,
      proLabel: proLabelFor(pro),
      proHandle: pro.handle,
      reportCount: comment._count.reports,
      reportReasons: distinctReasons(comment.reports),
      adminNotes: comment.adminNotes,
      reviewedAt: comment.reviewedAt?.toISOString() ?? null,
    }
  })
}
