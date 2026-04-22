// lib/jobs/looksSocial/indexLookPostDocument.ts
import {
  LookPostStatus,
  LookPostVisibility,
  ModerationStatus,
  Prisma,
  PrismaClient,
} from '@prisma/client'

import { isPubliclyApprovedProStatus } from '@/lib/proTrustState'

export type IndexLookPostDocumentDb =
  | PrismaClient
  | Prisma.TransactionClient

export type IndexLookPostDocumentArgs = {
  lookPostId: string
}

const lookPostIndexSelect =
  Prisma.validator<Prisma.LookPostSelect>()({
    id: true,
    professionalId: true,
    serviceId: true,
    caption: true,

    status: true,
    visibility: true,
    moderationStatus: true,

    publishedAt: true,
    archivedAt: true,
    removedAt: true,

    likeCount: true,
    commentCount: true,
    saveCount: true,
    shareCount: true,

    spotlightScore: true,
    rankScore: true,

    createdAt: true,
    updatedAt: true,

    professional: {
      select: {
        id: true,
        businessName: true,
        handle: true,
        verificationStatus: true,
      },
    },

    service: {
      select: {
        id: true,
        name: true,
        category: {
          select: {
            id: true,
            name: true,
            slug: true,
          },
        },
      },
    },
  })

type LookPostIndexRow = Prisma.LookPostGetPayload<{
  select: typeof lookPostIndexSelect
}>

export type LookPostSearchDocument = {
  id: string
  lookPostId: string

  professionalId: string
  professionalBusinessName: string | null
  professionalHandle: string | null
  professionalVerificationStatus: LookPostIndexRow['professional']['verificationStatus']

  serviceId: string | null
  serviceName: string | null
  serviceCategoryId: string | null
  serviceCategoryName: string | null
  serviceCategorySlug: string | null

  caption: string | null

  status: LookPostStatus
  visibility: LookPostVisibility
  moderationStatus: ModerationStatus

  publishedAt: string
  archivedAt: string | null
  removedAt: string | null
  createdAt: string
  updatedAt: string

  likeCount: number
  commentCount: number
  saveCount: number
  shareCount: number
  spotlightScore: number
  rankScore: number

  searchTerms: string[]
  searchText: string
}

export type IndexLookPostDocumentOutcome =
  | {
      action: 'DELETE'
      lookPostId: string
      reason: 'LOOK_POST_NOT_FOUND' | 'LOOK_POST_NOT_SEARCHABLE'
      document: null
    }
  | {
      action: 'UPSERT'
      lookPostId: string
      reason: 'LOOK_POST_SEARCHABLE'
      document: LookPostSearchDocument
    }

function normalizeRequiredId(name: string, value: string): string {
  const trimmed = value.trim()

  if (!trimmed) {
    throw new Error(`${name} is required.`)
  }

  return trimmed
}

function normalizeNullableText(
  value: string | null | undefined,
): string | null {
  if (typeof value !== 'string') return null

  const normalized = value.replace(/\s+/g, ' ').trim()
  return normalized.length > 0 ? normalized : null
}

function normalizeSearchTerm(
  value: string | null | undefined,
): string | null {
  const normalized = normalizeNullableText(value)
  return normalized ? normalized.toLowerCase() : null
}

function toIsoString(value: Date | null): string | null {
  return value ? value.toISOString() : null
}

function buildSearchTerms(row: LookPostIndexRow): string[] {
  const rawTerms = [
    normalizeSearchTerm(row.caption),
    normalizeSearchTerm(row.professional.businessName),
    normalizeSearchTerm(row.professional.handle),
    normalizeSearchTerm(row.service?.name),
    normalizeSearchTerm(row.service?.category?.name),
    normalizeSearchTerm(row.service?.category?.slug),
  ]

  return Array.from(
    new Set(
      rawTerms.filter((term): term is string => term !== null),
    ),
  )
}

export function isLookPostSearchEligible(
  row: Pick<
    LookPostIndexRow,
    'status' | 'visibility' | 'moderationStatus' | 'publishedAt' | 'removedAt'
  > & {
    professional: Pick<
      LookPostIndexRow['professional'],
      'verificationStatus'
    >
  },
): boolean {
  return (
    row.status === LookPostStatus.PUBLISHED &&
    row.visibility === LookPostVisibility.PUBLIC &&
    row.moderationStatus === ModerationStatus.APPROVED &&
    row.publishedAt !== null &&
    row.removedAt === null &&
    isPubliclyApprovedProStatus(
        row.professional.verificationStatus,
    )
  )
}

export function buildLookPostSearchDocument(
  row: LookPostIndexRow,
): LookPostSearchDocument {
  if (row.publishedAt === null) {
    throw new Error(
      'Cannot build look post search document without publishedAt.',
    )
  }

  const caption = normalizeNullableText(row.caption)
  const professionalBusinessName = normalizeNullableText(
    row.professional.businessName,
  )
  const professionalHandle = normalizeNullableText(
    row.professional.handle,
  )
  const serviceName = normalizeNullableText(row.service?.name)
  const serviceCategoryName = normalizeNullableText(
    row.service?.category?.name,
  )
  const serviceCategorySlug = normalizeNullableText(
    row.service?.category?.slug,
  )

  const searchTerms = buildSearchTerms(row)

  return {
    id: row.id,
    lookPostId: row.id,

    professionalId: row.professionalId,
    professionalBusinessName,
    professionalHandle,
    professionalVerificationStatus:
      row.professional.verificationStatus,

    serviceId: row.serviceId,
    serviceName,
    serviceCategoryId: row.service?.category?.id ?? null,
    serviceCategoryName,
    serviceCategorySlug,

    caption,

    status: row.status,
    visibility: row.visibility,
    moderationStatus: row.moderationStatus,

    publishedAt: row.publishedAt.toISOString(),
    archivedAt: toIsoString(row.archivedAt),
    removedAt: toIsoString(row.removedAt),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),

    likeCount: row.likeCount,
    commentCount: row.commentCount,
    saveCount: row.saveCount,
    shareCount: row.shareCount,
    spotlightScore: row.spotlightScore,
    rankScore: row.rankScore,

    searchTerms,
    searchText: searchTerms.join(' '),
  }
}

async function readLookPostForIndexing(
  db: IndexLookPostDocumentDb,
  lookPostId: string,
): Promise<LookPostIndexRow | null> {
  return db.lookPost.findUnique({
    where: { id: lookPostId },
    select: lookPostIndexSelect,
  })
}

/**
 * Honest fallback until a real index backend exists.
 *
 * This function:
 * - loads the canonical LookPost from Prisma
 * - evaluates whether it belongs on the public search surface
 * - builds the normalized document shape we would upsert later
 *
 * It intentionally does NOT write to an external backend yet because the repo
 * does not contain one. The caller can still stop throwing and mark the job
 * completed based on this canonical no-op outcome.
 */
export async function processIndexLookPostDocument(
  db: IndexLookPostDocumentDb,
  args: IndexLookPostDocumentArgs,
): Promise<IndexLookPostDocumentOutcome> {
  const lookPostId = normalizeRequiredId('lookPostId', args.lookPostId)

  const lookPost = await readLookPostForIndexing(db, lookPostId)

  if (!lookPost) {
    return {
      action: 'DELETE',
      lookPostId,
      reason: 'LOOK_POST_NOT_FOUND',
      document: null,
    }
  }

  if (!isLookPostSearchEligible(lookPost)) {
    return {
      action: 'DELETE',
      lookPostId,
      reason: 'LOOK_POST_NOT_SEARCHABLE',
      document: null,
    }
  }

  return {
    action: 'UPSERT',
    lookPostId,
    reason: 'LOOK_POST_SEARCHABLE',
    document: buildLookPostSearchDocument(lookPost),
  }
}