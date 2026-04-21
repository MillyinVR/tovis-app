// lib/viralRequests/index.ts
import {
  ModerationStatus,
  NotificationEventKey,
  NotificationRecipientKind,
  Prisma,
  PrismaClient,
  ProfessionType,
  VerificationStatus,
  ViralServiceRequestStatus,
} from '@prisma/client'

import { enqueueDispatch } from '@/lib/notifications/dispatch/enqueueDispatch'
import { PUBLICLY_APPROVED_PRO_STATUSES } from '@/lib/proTrustState'
import { canTransitionViralRequestStatus } from '@/lib/viralRequests/status'

export type ViralRequestsDb = PrismaClient | Prisma.TransactionClient

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
    reportCount: true,
    removedAt: true,
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

export type ViralRequestMatchedProfessionalService = {
  id: string
  name: string
}

export type ViralRequestMatchedProfessional = {
  id: string
  businessName: string | null
  handle: string | null
  avatarUrl: string | null
  professionType: ProfessionType | null
  location: string | null
  verificationStatus: VerificationStatus
  isPremium: boolean
  matchingServices: ViralRequestMatchedProfessionalService[]
}

export type EnqueueViralRequestApprovalNotificationsResult = {
  enqueued: true
  matchedProfessionalIds: string[]
  dispatchSourceKeys: string[]
}

export type ViralRequestListOptions = {
  take?: number
  skip?: number
}

export type CreateClientViralRequestArgs = {
  clientId: string
  name: string
  description?: string | null
  sourceUrl?: string | null
  requestedCategoryId?: string | null
  links?: readonly string[] | null
  mediaUrls?: readonly string[] | null
}

export type DeleteClientViralRequestArgs = {
  clientId: string
  requestId: string
}

export type UpdateViralRequestStatusArgs = {
  requestId: string
  nextStatus: ViralServiceRequestStatus
  reviewerUserId?: string | null
  adminNotes?: string | null
  moderationStatus?: ModerationStatus
}

export type FindMatchingProsByRequestedCategoryArgs = {
  requestedCategoryId: string
  take?: number
  skip?: number
}

export type FindMatchingProsForViralRequestArgs = {
  requestId: string
  take?: number
  skip?: number
}

export type BuildViralRequestUploadTargetPathArgs = {
  requestId: string
  fileName: string
}

const DEFAULT_TAKE = 20
const MAX_TAKE = 100

function pickDispatchTx(
  db: ViralRequestsDb,
): Prisma.TransactionClient | undefined {
  return '$transaction' in db ? undefined : db
}

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

function normalizeRequiredName(value: string): string {
  const trimmed = value.trim()

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
    throw new Error(`Text must be ${options.maxLength} characters or fewer.`)
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
  values: readonly string[] | null,
): Prisma.InputJsonValue | undefined {
  if (!values) return undefined
  return [...values]
}

function normalizeTake(value: number | null | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_TAKE
  }

  return Math.min(Math.max(Math.trunc(value), 1), MAX_TAKE)
}

function normalizeSkip(value: number | null | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 0
  }

  return Math.max(Math.trunc(value), 0)
}

function normalizeUploadFileName(fileName: string): string {
  const trimmed = fileName.trim()
  if (!trimmed) {
    throw new Error('fileName is required.')
  }

  const withoutDirectories = trimmed
    .replaceAll('\\', '/')
    .split('/')
    .filter(Boolean)
    .at(-1)

  const candidate = withoutDirectories ?? trimmed
  const lastDot = candidate.lastIndexOf('.')

  const rawBase = lastDot > 0 ? candidate.slice(0, lastDot) : candidate
  const rawExt = lastDot > 0 ? candidate.slice(lastDot + 1) : ''

  const safeBase = rawBase
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)

  const safeExt = rawExt
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .slice(0, 16)

  const normalizedBase = safeBase || 'upload'

  return safeExt ? `${normalizedBase}.${safeExt}` : normalizedBase
}

function dedupeMatchingServices(
  offerings: Array<{
    service: {
      id: string
      name: string
    }
  }>,
): ViralRequestMatchedProfessionalService[] {
  const seen = new Set<string>()
  const services: ViralRequestMatchedProfessionalService[] = []

  for (const offering of offerings) {
    const serviceId = offering.service.id
    if (seen.has(serviceId)) continue

    seen.add(serviceId)
    services.push({
      id: serviceId,
      name: offering.service.name,
    })
  }

  return services
}

export async function getViralRequestByIdOrThrow(
  db: ViralRequestsDb,
  requestId: string,
): Promise<ViralRequestListRow> {
  const normalizedRequestId = normalizeRequiredId('requestId', requestId)

  const row = await db.viralServiceRequest.findUnique({
    where: { id: normalizedRequestId },
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
  options?: ViralRequestListOptions,
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
  args: CreateClientViralRequestArgs,
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
  const linksJson = toOptionalJsonArray(links)
  const mediaUrlsJson = toOptionalJsonArray(mediaUrls)

  const created = await db.viralServiceRequest.create({
    data: {
      clientId,
      name,
      description,
      sourceUrl,
      requestedCategoryId,
      status: ViralServiceRequestStatus.REQUESTED,
      ...(linksJson !== undefined ? { linksJson } : {}),
      ...(mediaUrlsJson !== undefined ? { mediaUrlsJson } : {}),
    },
    select: { id: true },
  })

  return getViralRequestByIdOrThrow(db, created.id)
}

export async function deleteClientViralRequest(
  db: ViralRequestsDb,
  args: DeleteClientViralRequestArgs,
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
  args: UpdateViralRequestStatusArgs,
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

export async function findMatchingProsByRequestedCategory(
  db: ViralRequestsDb,
  args: FindMatchingProsByRequestedCategoryArgs,
): Promise<ViralRequestMatchedProfessional[]> {
  const requestedCategoryId = normalizeRequiredId(
    'requestedCategoryId',
    args.requestedCategoryId,
  )

  const rows = await db.professionalProfile.findMany({
    where: {
      verificationStatus: {
        in: [...PUBLICLY_APPROVED_PRO_STATUSES],
      },
      offerings: {
        some: {
          isActive: true,
          service: {
            isActive: true,
            categoryId: requestedCategoryId,
          },
        },
      },
    },
    orderBy: [{ isPremium: 'desc' }, { id: 'asc' }],
    take: normalizeTake(args.take),
    skip: normalizeSkip(args.skip),
    select: {
      id: true,
      businessName: true,
      handle: true,
      avatarUrl: true,
      professionType: true,
      location: true,
      verificationStatus: true,
      isPremium: true,
      offerings: {
        where: {
          isActive: true,
          service: {
            isActive: true,
            categoryId: requestedCategoryId,
          },
        },
        orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
        take: 5,
        select: {
          service: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      },
    },
  })

  return rows.map((row) => ({
    id: row.id,
    businessName: row.businessName ?? null,
    handle: row.handle ?? null,
    avatarUrl: row.avatarUrl ?? null,
    professionType: row.professionType ?? null,
    location: row.location ?? null,
    verificationStatus: row.verificationStatus,
    isPremium: row.isPremium,
    matchingServices: dedupeMatchingServices(row.offerings),
  }))
}

export async function findMatchingProsForViralRequest(
  db: ViralRequestsDb,
  args: FindMatchingProsForViralRequestArgs,
): Promise<ViralRequestMatchedProfessional[]> {
  const request = await getViralRequestByIdOrThrow(db, args.requestId)

  if (!request.requestedCategoryId) {
    return []
  }

  return findMatchingProsByRequestedCategory(db, {
    requestedCategoryId: request.requestedCategoryId,
    take: args.take,
    skip: args.skip,
  })
}

export function buildViralRequestUploadTargetPath(
  args: BuildViralRequestUploadTargetPathArgs,
): string {
  const requestId = normalizeRequiredId('requestId', args.requestId)
  const fileName = normalizeUploadFileName(args.fileName)

  return `viral-requests/${requestId}/uploads/${fileName}`
}

/**
 * Enqueues pro-facing dispatches for approved viral requests that have a
 * requested category and matching approved professionals.
 *
 * Idempotency:
 * - dispatch sourceKey is stable per request/professional pair
 * - repeated calls do not create duplicate dispatch rows
 *
 * Important:
 * - this helper only enqueues dispatches
 * - it does not create a separate product inbox Notification row
 */
export async function enqueueViralRequestApprovalNotifications(
  db: ViralRequestsDb,
  args: FindMatchingProsForViralRequestArgs,
): Promise<EnqueueViralRequestApprovalNotificationsResult> {
  const request = await getViralRequestByIdOrThrow(db, args.requestId)

  if (request.status !== ViralServiceRequestStatus.APPROVED) {
    throw new Error(
      'Viral request must be APPROVED before approval notifications can be enqueued.',
    )
  }

  const matches = await findMatchingProsForViralRequest(db, {
    requestId: request.id,
    take: args.take,
    skip: args.skip,
  })

  const href = `/admin/viral-requests/${encodeURIComponent(request.id)}`
  const dispatchSourceKeys: string[] = []

  for (const match of matches) {
    const result = await enqueueDispatch({
      key: NotificationEventKey.VIRAL_REQUEST_APPROVED,
      sourceKey: `viral-request:${request.id}:professional:${match.id}:approved`,
      recipient: {
        kind: NotificationRecipientKind.PRO,
        professionalId: match.id,
        inAppTargetId: match.id,
      },
      title: 'New viral request in your category',
      body: request.name
        ? `"${request.name}" was approved and matches your services.`
        : 'A newly approved viral request matches your services.',
      href,
      tx: pickDispatchTx(db),
    })

    dispatchSourceKeys.push(result.dispatch.sourceKey)
  }

  return {
    enqueued: true,
    matchedProfessionalIds: matches.map((match) => match.id),
    dispatchSourceKeys,
  }
}