// lib/viralRequests/index.ts
import {
  ModerationStatus,
  Prisma,
  PrismaClient,
  ProfessionType,
  VerificationStatus,
  ViralRequestApprovalFanOutStatus,
  ViralServiceRequestStatus,
} from '@prisma/client'

import { notifyMatchedProsAboutApprovedViralRequest } from '@/lib/notifications/social'
import { PUBLICLY_APPROVED_PRO_STATUSES } from '@/lib/proTrustState'
import { BUCKETS } from '@/lib/storageBuckets'
import { platformCrossTenantProVisibilityFilter } from '@/lib/tenant'
import { readViralSubmitterMedia } from '@/lib/viralRequests/contracts'
import { canTransitionViralRequestStatus } from '@/lib/viralRequests/status'
import { asTrimmedString, normalizeRequiredId } from '@/lib/guards'
import { isSameUrlIgnoringQuery } from '@/lib/url'

export type ViralRequestsDb = PrismaClient | Prisma.TransactionClient

/** Submitter uploads are public-intent: a reviewer has to be able to see them. */
const VIRAL_REQUEST_UPLOAD_BUCKET = BUCKETS.mediaPublic

export const viralRequestListSelect =
  Prisma.validator<Prisma.ViralServiceRequestSelect>()({
    id: true,
    clientId: true,
    name: true,
    description: true,
    sourceUrl: true,
    linksJson: true,
    mediaUrlsJson: true,
    coverImageUrl: true,
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

export const viralRequestApprovalFanOutSelect =
  Prisma.validator<Prisma.ViralRequestApprovalFanOutSelect>()({
    id: true,
    viralServiceRequestId: true,
    professionalId: true,
    status: true,
    matchedAt: true,
    queuedAt: true,
    sentAt: true,
    skippedAt: true,
    failedAt: true,
    skipReason: true,
    lastError: true,
    notificationId: true,
    notificationDispatchId: true,
    createdAt: true,
    updatedAt: true,
  })

export type ViralRequestApprovalFanOutRow =
  Prisma.ViralRequestApprovalFanOutGetPayload<{
    select: typeof viralRequestApprovalFanOutSelect
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
  notificationIds: string[]
}

export type ViralRequestListOptions = {
  take?: number
  skip?: number
}

/**
 * 🔴 No `mediaUrls` here, deliberately. Submitter media arrives ONLY through
 * `attachClientViralRequestMedia`, which refuses any URL this server did not
 * mint for that request. Accepting a caller-supplied list at create time was a
 * hole around that gate: a reviewer's "Use this" would publish a host the
 * submitter controls, free to swap the bytes after approval. Creating the row
 * is what produces the id the upload path is derived from, so there is no
 * minted URL to accept at this point anyway.
 */
export type CreateClientViralRequestArgs = {
  clientId: string
  name: string
  description?: string | null
  sourceUrl?: string | null
  requestedCategoryId?: string | null
  links?: readonly string[] | null
}

export type DeleteClientViralRequestArgs = {
  clientId: string
  requestId: string
}

export type RemoveViralRequestMediaArgs = {
  requestId: string
  mediaUrl: string
  supabaseBaseUrl: string
}

export type RemoveViralRequestMediaResult =
  | {
      ok: true
      request: ViralRequestListRow
      /** The object to delete from storage — the row no longer references it. */
      storagePath: string
      /**
       * True when this attachment WAS the published cover and the cover was
       * cleared with it. The caller surfaces this: on an approved look it is a
       * client-facing change, not bookkeeping.
       */
      clearedCover: boolean
    }
  | { ok: false; reason: 'NOT_FOUND' | 'MEDIA_NOT_ATTACHED' | 'INVALID_MEDIA_URL' }

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

export type CreateViralRequestApprovalFanOutRowsArgs = {
  requestId: string
  take?: number
  skip?: number
}

export type CreateViralRequestApprovalFanOutRowsResult = {
  requestId: string
  matchedProfessionalIds: string[]
  fanOutRows: ViralRequestApprovalFanOutRow[]
}

export type ListViralRequestApprovalFanOutRowsArgs = {
  requestId: string
  statuses?: readonly ViralRequestApprovalFanOutStatus[]
  take?: number
  skip?: number
}

export type MarkViralRequestApprovalFanOutRowsQueuedArgs = {
  fanOutRowIds: readonly string[]
}

export type MarkViralRequestApprovalFanOutRowsQueuedResult = {
  updatedCount: number
}

export type MarkViralRequestApprovalFanOutRowsSkippedArgs = {
  fanOutRowIds: readonly string[]
  reason: string
}

export type MarkViralRequestApprovalFanOutRowsSkippedResult = {
  updatedCount: number
}

export type MarkViralRequestApprovalFanOutRowsFailedArgs = {
  fanOutRowIds: readonly string[]
  message: string
}

export type MarkViralRequestApprovalFanOutRowsFailedResult = {
  updatedCount: number
}

export type BuildViralRequestUploadTargetPathArgs = {
  requestId: string
  fileName: string
}

/** Why a client's write against their own viral request was refused. */
export type ViralRequestWriteRefusal = 'NOT_FOUND' | 'FORBIDDEN' | 'FINALIZED'

export type ClientOwnedViralRequestForWrite = {
  id: string
  clientId: string
  status: ViralServiceRequestStatus
  mediaUrlsJson: ViralRequestListRow['mediaUrlsJson']
}

export type LoadClientOwnedViralRequestResult =
  | { ok: true; request: ClientOwnedViralRequestForWrite }
  | { ok: false; reason: ViralRequestWriteRefusal }

export type AttachClientViralRequestMediaArgs = {
  clientId: string
  requestId: string
  /** The public URL the upload route returned for THIS request. */
  mediaUrl: string
  /** `NEXT_PUBLIC_SUPABASE_URL` — the project whose bucket we will accept. */
  supabaseBaseUrl: string
}

export type AttachClientViralRequestMediaResult =
  | { ok: true; request: ViralRequestListRow }
  | {
      ok: false
      reason: ViralRequestWriteRefusal | 'INVALID_MEDIA_URL' | 'MEDIA_LIMIT'
    }

const DEFAULT_TAKE = 20
const MAX_TAKE = 100

/**
 * How many attachments one submission may carry. The forms attach one, so this
 * is a backstop against a caller looping the PATCH, not a product limit — the
 * reviewer's queue renders every one of them.
 */
export const VIRAL_REQUEST_MEDIA_LIMIT = 4

function pickDispatchTx(
  db: ViralRequestsDb,
): Prisma.TransactionClient | undefined {
  return '$transaction' in db ? undefined : db
}

function normalizeRequiredIdList(
  name: string,
  values: readonly string[],
): string[] {
  return Array.from(
    new Set(values.map((value) => normalizeRequiredId(name, value))),
  )
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
  if (!values) {
    return undefined
  }

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

    if (seen.has(serviceId)) {
      continue
    }

    seen.add(serviceId)
    services.push({
      id: serviceId,
      name: offering.service.name,
    })
  }

  return services
}

function sortFanOutRowsByMatchedProfessionalIds(
  rows: ViralRequestApprovalFanOutRow[],
  matchedProfessionalIds: readonly string[],
): ViralRequestApprovalFanOutRow[] {
  const rowsByProfessionalId = new Map(
    rows.map((row) => [row.professionalId, row] as const),
  )

  return matchedProfessionalIds
    .map((professionalId) => rowsByProfessionalId.get(professionalId) ?? null)
    .filter(
      (row): row is ViralRequestApprovalFanOutRow => row !== null,
    )
}

async function getApprovedViralRequestMatchContext(
  db: ViralRequestsDb,
  args: FindMatchingProsForViralRequestArgs,
): Promise<{
  request: ViralRequestListRow
  matches: ViralRequestMatchedProfessional[]
}> {
  const request = await getViralRequestByIdOrThrow(db, args.requestId)

  if (request.status !== ViralServiceRequestStatus.APPROVED) {
    throw new Error(
      'Viral request must be APPROVED before approval fan-out can run.',
    )
  }

  const matches = await findMatchingProsForViralRequest(db, {
    requestId: request.id,
    take: args.take,
    skip: args.skip,
  })

  return {
    request,
    matches,
  }
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
  const requestedCategoryId = asTrimmedString(args.requestedCategoryId)
  const links = normalizeUrlList(args.links, 'links')
  const linksJson = toOptionalJsonArray(links)

  const created = await db.viralServiceRequest.create({
    data: {
      clientId,
      name,
      description,
      sourceUrl,
      requestedCategoryId,
      status: ViralServiceRequestStatus.REQUESTED,
      ...(linksJson !== undefined ? { linksJson } : {}),
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
  const reviewerUserId = asTrimmedString(args.reviewerUserId)
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
      // Viral requests are a tovis-root marketplace feature; matching fans
      // out across all tenants by design. Thread a real TenantContext here
      // if viral requests ever become tenant-facing.
      ...platformCrossTenantProVisibilityFilter(),
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

export async function createViralRequestApprovalFanOutRows(
  db: ViralRequestsDb,
  args: CreateViralRequestApprovalFanOutRowsArgs,
): Promise<CreateViralRequestApprovalFanOutRowsResult> {
  const { request, matches } = await getApprovedViralRequestMatchContext(db, {
    requestId: args.requestId,
    take: args.take,
    skip: args.skip,
  })

  const matchedProfessionalIds = matches.map((match) => match.id)

  if (matchedProfessionalIds.length === 0) {
    return {
      requestId: request.id,
      matchedProfessionalIds: [],
      fanOutRows: [],
    }
  }

  await db.viralRequestApprovalFanOut.createMany({
    data: matchedProfessionalIds.map((professionalId) => ({
      viralServiceRequestId: request.id,
      professionalId,
      status: ViralRequestApprovalFanOutStatus.PLANNED,
    })),
    skipDuplicates: true,
  })

  const rows = await db.viralRequestApprovalFanOut.findMany({
    where: {
      viralServiceRequestId: request.id,
      professionalId: {
        in: matchedProfessionalIds,
      },
    },
    select: viralRequestApprovalFanOutSelect,
  })

  return {
    requestId: request.id,
    matchedProfessionalIds,
    fanOutRows: sortFanOutRowsByMatchedProfessionalIds(
      rows,
      matchedProfessionalIds,
    ),
  }
}

export async function listViralRequestApprovalFanOutRows(
  db: ViralRequestsDb,
  args: ListViralRequestApprovalFanOutRowsArgs,
): Promise<ViralRequestApprovalFanOutRow[]> {
  const requestId = normalizeRequiredId('requestId', args.requestId)

  return db.viralRequestApprovalFanOut.findMany({
    where: {
      viralServiceRequestId: requestId,
      ...(args.statuses && args.statuses.length > 0
        ? {
            status: {
              in: [...args.statuses],
            },
          }
        : {}),
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: normalizeTake(args.take),
    skip: normalizeSkip(args.skip),
    select: viralRequestApprovalFanOutSelect,
  })
}

export async function markViralRequestApprovalFanOutRowsQueued(
  db: ViralRequestsDb,
  args: MarkViralRequestApprovalFanOutRowsQueuedArgs,
): Promise<MarkViralRequestApprovalFanOutRowsQueuedResult> {
  const fanOutRowIds = normalizeRequiredIdList('fanOutRowId', args.fanOutRowIds)

  if (fanOutRowIds.length === 0) {
    return { updatedCount: 0 }
  }

  const now = new Date()

  const updated = await db.viralRequestApprovalFanOut.updateMany({
    where: {
      id: {
        in: fanOutRowIds,
      },
    },
    data: {
      status: ViralRequestApprovalFanOutStatus.NOTIFICATION_ENQUEUED,
      queuedAt: now,
      failedAt: null,
      skippedAt: null,
      lastError: null,
      skipReason: null,
    },
  })

  return {
    updatedCount: updated.count,
  }
}

export async function markViralRequestApprovalFanOutRowsSkipped(
  db: ViralRequestsDb,
  args: MarkViralRequestApprovalFanOutRowsSkippedArgs,
): Promise<MarkViralRequestApprovalFanOutRowsSkippedResult> {
  const fanOutRowIds = normalizeRequiredIdList('fanOutRowId', args.fanOutRowIds)

  if (fanOutRowIds.length === 0) {
    return { updatedCount: 0 }
  }

  const reason = normalizeOptionalText(args.reason, {
    maxLength: 2000,
  })

  if (!reason) {
    throw new Error('reason is required.')
  }

  const now = new Date()

  const updated = await db.viralRequestApprovalFanOut.updateMany({
    where: {
      id: {
        in: fanOutRowIds,
      },
    },
    data: {
      status: ViralRequestApprovalFanOutStatus.SKIPPED,
      skippedAt: now,
      failedAt: null,
      lastError: null,
      skipReason: reason,
    },
  })

  return {
    updatedCount: updated.count,
  }
}

export async function markViralRequestApprovalFanOutRowsFailed(
  db: ViralRequestsDb,
  args: MarkViralRequestApprovalFanOutRowsFailedArgs,
): Promise<MarkViralRequestApprovalFanOutRowsFailedResult> {
  const fanOutRowIds = normalizeRequiredIdList('fanOutRowId', args.fanOutRowIds)

  if (fanOutRowIds.length === 0) {
    return { updatedCount: 0 }
  }

  const message = normalizeOptionalText(args.message, {
    maxLength: 2000,
  })

  if (!message) {
    throw new Error('message is required.')
  }

  const now = new Date()

  const updated = await db.viralRequestApprovalFanOut.updateMany({
    where: {
      id: {
        in: fanOutRowIds,
      },
    },
    data: {
      status: ViralRequestApprovalFanOutStatus.FAILED,
      failedAt: now,
      lastError: message,
    },
  })

  return {
    updatedCount: updated.count,
  }
}

/**
 * Sets (or clears) the picture an approved viral look is shown by.
 *
 * Deliberately its own writer rather than a field on `updateViralRequestStatus`:
 * a reviewer sets the cover BEFORE approving, and often without changing the
 * status at all. Folding it into the status update would mean either a
 * status-less status change or no way to fix a cover on an already-approved
 * look.
 *
 * Passing null clears it, and clearing means the look has NO picture again —
 * every surface falls back to its own gradient, never to the submitter's
 * attachment (`resolveViralCoverImage`). Only what a reviewer set is published.
 */
export async function setViralRequestCoverImage(
  db: ViralRequestsDb,
  args: { requestId: string; coverImageUrl: string | null },
): Promise<ViralRequestListRow> {
  const requestId = normalizeRequiredId('requestId', args.requestId)
  // Same validator every other URL on this model goes through, so a cover
  // cannot be the one field that accepts a `javascript:` href.
  const coverImageUrl = normalizeHttpUrl(args.coverImageUrl, 'coverImageUrl')

  return db.viralServiceRequest.update({
    where: { id: requestId },
    data: { coverImageUrl },
    select: viralRequestListSelect,
  })
}

/**
 * The admin review queue's read — every client's requests, newest first.
 *
 * Deliberately NOT `listClientViralRequests` with the client filter dropped:
 * that one is a client reading their OWN submissions and is ordered for a
 * "your requests" list. This is a work queue, so it sorts the things a reviewer
 * has to act on to the top — REQUESTED and IN_REVIEW before anything already
 * decided — and only then by age.
 */
const ADMIN_QUEUE_ACTIONABLE: ViralServiceRequestStatus[] = [
  ViralServiceRequestStatus.REQUESTED,
  ViralServiceRequestStatus.IN_REVIEW,
]

export async function listAdminViralRequests(
  db: ViralRequestsDb,
  options?: { take?: number },
): Promise<ViralRequestListRow[]> {
  const take = Math.min(Math.max(options?.take ?? 100, 1), 300)

  const rows = await db.viralServiceRequest.findMany({
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take,
    select: viralRequestListSelect,
  })

  // Sorted in JS, not SQL: "needs a decision" is a two-value set rather than an
  // ordering the enum happens to have, and the same helper is the one the page
  // shows a count from.
  return [...rows].sort((a, b) => {
    const aActionable = ADMIN_QUEUE_ACTIONABLE.includes(a.status) ? 0 : 1
    const bActionable = ADMIN_QUEUE_ACTIONABLE.includes(b.status) ? 0 : 1
    if (aActionable !== bActionable) return aActionable - bActionable
    return b.createdAt.getTime() - a.createdAt.getTime()
  })
}

export function isViralRequestAwaitingReview(
  status: ViralServiceRequestStatus,
): boolean {
  return ADMIN_QUEUE_ACTIONABLE.includes(status)
}

/**
 * Where a reviewer's cover image lands. One object per request, overwritten on
 * replace — a cover has no history worth keeping, and leaving the old bytes
 * behind would make the bucket grow with every retry.
 */
export function buildViralRequestCoverTargetPath(args: {
  requestId: string
  extension: string
}): string {
  const extension = args.extension.replace(/[^a-z0-9]/gi, '').toLowerCase()
  return `${viralRequestRootPath(args.requestId)}cover.${extension || 'jpg'}`
}

/** The sub-folder a SUBMITTER's own attachments live in, under the root below. */
const VIRAL_REQUEST_UPLOADS_SEGMENT = 'uploads/'

/**
 * Everything stored for one request hangs off this folder — the reviewer's cover
 * beside the submitter's uploads. Derived in ONE place so the builders and the
 * validator that has to recognise them cannot drift apart.
 */
function viralRequestRootPath(requestId: string): string {
  return `viral-requests/${normalizeRequiredId('requestId', requestId)}/`
}

/** Every object a SUBMITTER uploads for one request lives under this folder. */
function viralRequestUploadPathPrefix(requestId: string): string {
  return `${viralRequestRootPath(requestId)}${VIRAL_REQUEST_UPLOADS_SEGMENT}`
}

export function buildViralRequestUploadTargetPath(
  args: BuildViralRequestUploadTargetPathArgs,
): string {
  const fileName = normalizeUploadFileName(args.fileName)

  return `${viralRequestUploadPathPrefix(args.requestId)}${fileName}`
}

/**
 * The public URL of a storage object — the one the upload route hands back and
 * the only shape the persist route will accept, built in one place so the two
 * cannot drift.
 */
export function buildViralRequestUploadPublicUrl(args: {
  supabaseBaseUrl: string
  path: string
}): string {
  const base = args.supabaseBaseUrl.trim().replace(/\/+$/, '')

  return `${base}/storage/v1/object/public/${VIRAL_REQUEST_UPLOAD_BUCKET}/${args.path}`
}

/**
 * True only for a URL this server itself minted for THIS request.
 *
 * 🔴 The gate that keeps the review queue honest. Without it a client could
 * PATCH any `https://…` they like onto their submission, and a reviewer's "Use
 * this" would publish a stranger's server platform-wide — one that can swap the
 * bytes for something else the moment it is approved. Our own object cannot: the
 * path is derived from the request id, only the ownership-checked upload route
 * signs a write into it, and it is signed `upsert: false`.
 */
export function isViralRequestUploadPublicUrl(args: {
  supabaseBaseUrl: string
  requestId: string
  url: string
}): boolean {
  const base = args.supabaseBaseUrl.trim()
  if (!base) return false

  const prefix = buildViralRequestUploadPublicUrl({
    supabaseBaseUrl: base,
    path: viralRequestUploadPathPrefix(args.requestId),
  })

  if (!args.url.startsWith(prefix)) return false

  // Equality against the sanitizer, not just "no slashes": it also refuses the
  // query string, the encoded traversal and the empty name in one comparison.
  const fileName = args.url.slice(prefix.length)

  return fileName.length > 0 && fileName === normalizeUploadFileName(fileName)
}

/**
 * True only for a URL this server minted for THIS request, in either of the two
 * shapes a cover may legitimately come from: the reviewer's own uploaded frame
 * (`…/cover.ext`) or one of the submitter's attachments (`…/uploads/name`).
 *
 * 🔴 The gate on the PROMOTE side. `isViralRequestUploadPublicUrl` guards what a
 * client may attach; this guards what a reviewer may publish. Without it "Use
 * this" writes whatever URL the finalize body carried onto the one column every
 * client surface renders — including a host the submitter controls, free to swap
 * the bytes the moment it is approved. A human still has to click, so this is
 * not an authorization check; it is what stops that click from being abusable.
 */
export function isViralRequestCoverCandidateUrl(args: {
  supabaseBaseUrl: string
  requestId: string
  url: string
}): boolean {
  const base = args.supabaseBaseUrl.trim()
  if (!base) return false

  const prefix = buildViralRequestUploadPublicUrl({
    supabaseBaseUrl: base,
    path: viralRequestRootPath(args.requestId),
  })

  if (!args.url.startsWith(prefix)) return false

  const rest = args.url.slice(prefix.length)

  // The reviewer's own frame, exactly as buildViralRequestCoverTargetPath spells
  // it: one object per request, extension already stripped to [a-z0-9].
  if (/^cover\.[a-z0-9]+$/.test(rest)) return true

  // A submitter attachment — same sanitizer the upload route wrote it with.
  if (rest.startsWith(VIRAL_REQUEST_UPLOADS_SEGMENT)) {
    const fileName = rest.slice(VIRAL_REQUEST_UPLOADS_SEGMENT.length)

    return fileName.length > 0 && fileName === normalizeUploadFileName(fileName)
  }

  return false
}

/**
 * The gate every client WRITE against their own viral request passes through.
 *
 * One helper rather than a copy per route because minting the signed upload and
 * persisting the URL it produced are two halves of one act: if they could
 * disagree, media would land on a request the upload route would have refused.
 */
export async function loadClientOwnedViralRequestForWrite(
  db: ViralRequestsDb,
  args: { clientId: string; requestId: string },
): Promise<LoadClientOwnedViralRequestResult> {
  const clientId = normalizeRequiredId('clientId', args.clientId)
  const requestId = normalizeRequiredId('requestId', args.requestId)

  const request = await db.viralServiceRequest.findUnique({
    where: { id: requestId },
    select: {
      id: true,
      clientId: true,
      status: true,
      mediaUrlsJson: true,
    },
  })

  if (!request) return { ok: false, reason: 'NOT_FOUND' }
  if (request.clientId !== clientId) return { ok: false, reason: 'FORBIDDEN' }

  if (
    request.status === ViralServiceRequestStatus.APPROVED ||
    request.status === ViralServiceRequestStatus.REJECTED
  ) {
    return { ok: false, reason: 'FINALIZED' }
  }

  return { ok: true, request }
}

/**
 * Persists an upload the submitter just made onto their own request — the write
 * the upload route never had.
 *
 * Append-only, and deliberately so: this column is the EVIDENCE a reviewer
 * decides on, so a submitter must not be able to swap it for something else
 * after it has been looked at. Removing an attachment is a reviewer's call.
 *
 * Re-attaching the same URL is a no-op rather than an error, which is what a
 * double-tapped submit produces (the path is derived from the file name, so the
 * retry mints the same URL).
 */
export async function attachClientViralRequestMedia(
  db: ViralRequestsDb,
  args: AttachClientViralRequestMediaArgs,
): Promise<AttachClientViralRequestMediaResult> {
  const requestId = normalizeRequiredId('requestId', args.requestId)

  // `normalizeHttpUrl` THROWS on junk rather than returning null, and a client
  // typing nonsense into this field is a 400, not a 500 — so catch it here and
  // let it join the other refusals.
  let mediaUrl: string | null
  try {
    mediaUrl = normalizeHttpUrl(args.mediaUrl, 'mediaUrl')
  } catch {
    return { ok: false, reason: 'INVALID_MEDIA_URL' }
  }

  // Checked before the row is read so an unacceptable URL cannot be told apart
  // from an unknown request by timing or by which error comes back.
  if (
    !mediaUrl ||
    !isViralRequestUploadPublicUrl({
      supabaseBaseUrl: args.supabaseBaseUrl,
      requestId,
      url: mediaUrl,
    })
  ) {
    return { ok: false, reason: 'INVALID_MEDIA_URL' }
  }

  const loaded = await loadClientOwnedViralRequestForWrite(db, {
    clientId: args.clientId,
    requestId,
  })

  if (!loaded.ok) return loaded

  const existing = readViralSubmitterMedia(loaded.request)

  if (existing.includes(mediaUrl)) {
    return { ok: true, request: await getViralRequestByIdOrThrow(db, requestId) }
  }

  if (existing.length >= VIRAL_REQUEST_MEDIA_LIMIT) {
    return { ok: false, reason: 'MEDIA_LIMIT' }
  }

  // Read-modify-write: jsonb has no Prisma append. Two attaches racing could
  // drop one, which the one-file-per-submit forms cannot produce — and the case
  // they CAN produce (the same file twice) is the no-op above.
  const updated = await db.viralServiceRequest.update({
    where: { id: requestId },
    data: { mediaUrlsJson: [...existing, mediaUrl] },
    select: viralRequestListSelect,
  })

  return { ok: true, request: updated }
}

/**
 * A reviewer detaches one of the submitter's uploads.
 *
 * The counterpart of `attachClientViralRequestMedia`, and deliberately NOT its
 * mirror image on two points:
 *
 * 1. **It works on a finalized request.** Attaching refuses once a request is
 *    APPROVED or REJECTED; removing exists precisely for that state. Rejecting a
 *    submission stopped further attachments but left the ones already there on
 *    the row and their bytes in a PUBLIC bucket, with no way to take them down.
 * 2. **It is admin-only** — the actor is the reviewer, not the submitter, so
 *    there is no client-ownership check here. The route enforces the admin
 *    scope, the same bar that promoting a cover requires.
 *
 * 🔴 THE COVER. "Use this" copies the attachment's URL straight into
 * `coverImageUrl` — it does not copy the bytes to a separate object (see
 * `VIRAL_REQUEST_COVER_IMAGE_PUBLIC_FINALIZE`). So deleting the object under a
 * promoted attachment would leave every client surface rendering a cover that
 * 404s. When the removed attachment IS the cover, the cover is cleared in the
 * same write.
 *
 * ⚠️ And the cover may carry a `?v=` cache-buster that the attachment URL never
 * has (`withCacheBuster` runs AFTER the candidate check, and an attachment URL
 * with a query string is refused outright by `isViralRequestUploadPublicUrl`).
 * Comparing the two raw strings therefore MISSES the match and reintroduces the
 * dangling cover, so the comparison drops the query on both sides.
 *
 * Storage deletion is the caller's job, from `storagePath`, and must happen
 * AFTER this returns: if it fails, an orphaned object is harmless, whereas a
 * deleted object still referenced by a live row is not.
 */
export async function removeViralRequestMedia(
  db: ViralRequestsDb,
  args: RemoveViralRequestMediaArgs,
): Promise<RemoveViralRequestMediaResult> {
  const requestId = normalizeRequiredId('requestId', args.requestId)

  let mediaUrl: string | null
  try {
    mediaUrl = normalizeHttpUrl(args.mediaUrl, 'mediaUrl')
  } catch {
    return { ok: false, reason: 'INVALID_MEDIA_URL' }
  }

  // Same gate the attach path applies, for the same reason: only an object this
  // server minted for THIS request is addressable here, so a crafted URL cannot
  // aim the storage delete that follows at someone else's object.
  if (
    !mediaUrl ||
    !isViralRequestUploadPublicUrl({
      supabaseBaseUrl: args.supabaseBaseUrl,
      requestId,
      url: mediaUrl,
    })
  ) {
    return { ok: false, reason: 'INVALID_MEDIA_URL' }
  }

  const request = await db.viralServiceRequest.findUnique({
    where: { id: requestId },
    select: { id: true, coverImageUrl: true, mediaUrlsJson: true },
  })

  if (!request) return { ok: false, reason: 'NOT_FOUND' }

  const existing = readViralSubmitterMedia(request)
  if (!existing.includes(mediaUrl)) {
    return { ok: false, reason: 'MEDIA_NOT_ATTACHED' }
  }

  const clearedCover = isSameUrlIgnoringQuery(request.coverImageUrl, mediaUrl)

  const updated = await db.viralServiceRequest.update({
    where: { id: requestId },
    data: {
      mediaUrlsJson: existing.filter((url) => url !== mediaUrl),
      ...(clearedCover ? { coverImageUrl: null } : {}),
    },
    select: viralRequestListSelect,
  })

  return {
    ok: true,
    request: updated,
    storagePath: storagePathFromViralUploadUrl({
      supabaseBaseUrl: args.supabaseBaseUrl,
      url: mediaUrl,
    }),
    clearedCover,
  }
}

/**
 * The bucket-relative path inside a public URL this server minted.
 *
 * Only ever called on a URL `isViralRequestUploadPublicUrl` has already
 * accepted, so the prefix is known to be present.
 */
function storagePathFromViralUploadUrl(args: {
  supabaseBaseUrl: string
  url: string
}): string {
  const prefix = buildViralRequestUploadPublicUrl({
    supabaseBaseUrl: args.supabaseBaseUrl,
    path: '',
  })

  return args.url.startsWith(prefix) ? args.url.slice(prefix.length) : args.url
}

/**
 * Worker/orchestrator-only downstream helper.
 *
 * Creates pro inbox Notification rows for approved viral requests and lets the
 * existing notification foundation enqueue downstream dispatch for newly
 * created rows.
 *
 * Idempotency:
 * - notification identity is stable per (professionalId, dedupeKey)
 * - repeated calls update the same inbox row and do not enqueue a second
 *   delivery cycle
 *
 * Important:
 * - this helper does not write NotificationDispatch rows directly
 * - durable inbox creation + downstream dispatch stay inside the existing
 *   notification foundation
 * - do not call this from moderation routes or request handlers
 */
export async function enqueueViralRequestApprovalNotifications(
  db: ViralRequestsDb,
  args: FindMatchingProsForViralRequestArgs,
): Promise<EnqueueViralRequestApprovalNotificationsResult> {
  const { request, matches } = await getApprovedViralRequestMatchContext(db, {
    requestId: args.requestId,
    take: args.take,
    skip: args.skip,
  })

  const notificationResult =
    await notifyMatchedProsAboutApprovedViralRequest({
      viralRequestId: request.id,
      requestName: request.name,
      requestedCategoryId: request.requestedCategoryId,
      recipients: matches.map((match) => ({
        professionalId: match.id,
        matchedServiceIds: match.matchingServices.map((service) => service.id),
      })),
      tx: pickDispatchTx(db),
    })

  return {
    enqueued: true,
    matchedProfessionalIds: notificationResult.matchedProfessionalIds,
    notificationIds: notificationResult.notificationIds,
  }
}