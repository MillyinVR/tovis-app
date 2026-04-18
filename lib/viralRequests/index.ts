// lib/viralRequests/index.ts
import {
  ModerationStatus,
  Prisma,
  PrismaClient,
  ViralServiceRequestStatus,
} from '@prisma/client'
import { canTransitionViralRequestStatus } from '@/lib/viralRequests/status'

type ViralRequestsDb = PrismaClient | Prisma.TransactionClient

export const viralRequestListSelect =
  Prisma.validator<Prisma.ViralServiceRequestSelect>()({
    id: true,
    clientId: true,
    name: true,
    description: true,
    sourceUrl: true,
    linksJson: true,
    mediaUrlsJson: true,
    requestedCategoryId: true,
    status: true,
    moderationStatus: true,
    reviewedAt: true,
    reviewedByUserId: true,
    approvedAt: true,
    rejectedAt: true,
    adminNotes: true,
    createdAt: true,
    updatedAt: true,
    requestedCategory: {
      select: {
        id: true,
        name: true,
        slug: true,
      },
    },
  })

export type ViralRequestListRow = Prisma.ViralServiceRequestGetPayload<{
  select: typeof viralRequestListSelect
}>

function normalizeRequiredId(name: string, value: string): string {
  const trimmed = value.trim()
  if (!trimmed) {
    throw new Error(`${name} is required.`)
  }
  return trimmed
}

function normalizeOptionalId(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function normalizeRequiredName(name: string): string {
  const trimmed = name.trim()
  if (!trimmed) {
    throw new Error('Viral request name is required.')
  }
  if (trimmed.length > 160) {
    throw new Error('Viral request name must be 160 characters or fewer.')
  }
  return trimmed
}

function normalizeOptionalText(
  value: string | null | undefined,
  options?: { maxLength?: number },
): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null

  if (
    typeof options?.maxLength === 'number' &&
    trimmed.length > options.maxLength
  ) {
    throw new Error(
      `Text must be ${options.maxLength} characters or fewer.`,
    )
  }

  return trimmed
}

function normalizeHttpUrl(
  value: string | null | undefined,
  fieldName: string,
): string | null {
  const trimmed = normalizeOptionalText(value)
  if (!trimmed) return null

  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    throw new Error(`${fieldName} must be a valid URL.`)
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`${fieldName} must use http or https.`)
  }

  return url.toString()
}

function normalizeUrlList(
  values: readonly string[] | null | undefined,
  fieldName: string,
): string[] | null {
  if (!values?.length) return null

  const normalized = Array.from(
    new Set(
      values
        .map((value) => normalizeHttpUrl(value, fieldName))
        .filter((value): value is string => value !== null),
    ),
  )

  return normalized.length > 0 ? normalized : null
}

function toOptionalJsonArray(
  values: string[] | null,
): Prisma.InputJsonValue | undefined {
  if (!values) return undefined
  return values
}

function normalizeTake(value: number | null | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 20
  return Math.min(Math.max(Math.trunc(value), 1), 100)
}

function normalizeSkip(value: number | null | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0
  return Math.max(Math.trunc(value), 0)
}

async function getViralRequestByIdOrThrow(
  db: ViralRequestsDb,
  requestId: string,
): Promise<ViralRequestListRow> {
  const row = await db.viralServiceRequest.findUnique({
    where: { id: requestId },
    select: viralRequestListSelect,
  })

  if (!row) {
    throw new Error('Viral request not found.')
  }

  return row
}

export async function listClientViralRequests(
  db: ViralRequestsDb,
  clientId: string,
  options?: {
    take?: number
    skip?: number
  },
): Promise<ViralRequestListRow[]> {
  const normalizedClientId = normalizeRequiredId('clientId', clientId)

  return db.viralServiceRequest.findMany({
    where: {
      clientId: normalizedClientId,
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: normalizeTake(options?.take),
    skip: normalizeSkip(options?.skip),
    select: viralRequestListSelect,
  })
}

export async function createClientViralRequest(
  db: ViralRequestsDb,
  args: {
    clientId: string
    name: string
    description?: string | null
    sourceUrl?: string | null
    requestedCategoryId?: string | null
    links?: readonly string[] | null
    mediaUrls?: readonly string[] | null
  },
): Promise<ViralRequestListRow> {
  const clientId = normalizeRequiredId('clientId', args.clientId)
  const name = normalizeRequiredName(args.name)
  const description = normalizeOptionalText(args.description, {
    maxLength: 2000,
  })
  const sourceUrl = normalizeHttpUrl(args.sourceUrl, 'sourceUrl')
  const requestedCategoryId = normalizeOptionalId(args.requestedCategoryId)
  const links = normalizeUrlList(args.links, 'links')
  const mediaUrls = normalizeUrlList(args.mediaUrls, 'mediaUrls')

  const created = await db.viralServiceRequest.create({
    data: {
      clientId,
      name,
      description,
      sourceUrl,
      requestedCategoryId,
      status: ViralServiceRequestStatus.REQUESTED,
      ...(toOptionalJsonArray(links) !== undefined
        ? { linksJson: toOptionalJsonArray(links) }
        : {}),
      ...(toOptionalJsonArray(mediaUrls) !== undefined
        ? { mediaUrlsJson: toOptionalJsonArray(mediaUrls) }
        : {}),
    },
    select: { id: true },
  })

  return getViralRequestByIdOrThrow(db, created.id)
}

export async function deleteClientViralRequest(
  db: ViralRequestsDb,
  args: {
    clientId: string
    requestId: string
  },
): Promise<{
  deleted: boolean
}> {
  const clientId = normalizeRequiredId('clientId', args.clientId)
  const requestId = normalizeRequiredId('requestId', args.requestId)

  const deleted = await db.viralServiceRequest.deleteMany({
    where: {
      id: requestId,
      clientId,
    },
  })

  return {
    deleted: deleted.count > 0,
  }
}

export async function updateViralRequestStatus(
  db: ViralRequestsDb,
  args: {
    requestId: string
    nextStatus: ViralServiceRequestStatus
    reviewerUserId?: string | null
    adminNotes?: string | null
    moderationStatus?: ModerationStatus
  },
): Promise<ViralRequestListRow> {
  const requestId = normalizeRequiredId('requestId', args.requestId)
  const reviewerUserId = normalizeOptionalId(args.reviewerUserId)
  const adminNotes = normalizeOptionalText(args.adminNotes, {
    maxLength: 2000,
  })

  const existing = await db.viralServiceRequest.findUnique({
    where: { id: requestId },
    select: {
      id: true,
      status: true,
      approvedAt: true,
      rejectedAt: true,
      reviewedAt: true,
      reviewedByUserId: true,
      adminNotes: true,
      moderationStatus: true,
    },
  })

  if (!existing) {
    throw new Error('Viral request not found.')
  }

  if (!canTransitionViralRequestStatus(existing.status, args.nextStatus)) {
    throw new Error(
      `Invalid viral request status transition: ${existing.status} -> ${args.nextStatus}.`,
    )
  }

  const now = new Date()
  const data: Prisma.ViralServiceRequestUncheckedUpdateInput = {
    status: args.nextStatus,
  }

  if (args.adminNotes !== undefined) {
    data.adminNotes = adminNotes
  }

  if (args.moderationStatus !== undefined) {
    data.moderationStatus = args.moderationStatus
  }

  if (reviewerUserId !== null) {
    data.reviewedByUserId = reviewerUserId
  }

  if (existing.status !== args.nextStatus) {
    if (args.nextStatus === ViralServiceRequestStatus.IN_REVIEW) {
      data.reviewedAt = now
      data.approvedAt = null
      data.rejectedAt = null
    } else if (args.nextStatus === ViralServiceRequestStatus.APPROVED) {
      data.reviewedAt = now
      data.approvedAt = now
      data.rejectedAt = null
    } else if (args.nextStatus === ViralServiceRequestStatus.REJECTED) {
      data.reviewedAt = now
      data.rejectedAt = now
      data.approvedAt = null
    }
  } else if (
    reviewerUserId !== null &&
    existing.reviewedByUserId !== reviewerUserId &&
    existing.reviewedAt === null
  ) {
    data.reviewedAt = now
  }

  const updated = await db.viralServiceRequest.update({
    where: { id: requestId },
    data,
    select: { id: true },
  })

  return getViralRequestByIdOrThrow(db, updated.id)
}