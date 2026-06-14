// lib/adminModeration/service.ts
import {
  AdminPermissionRole,
  LookPostStatus,
  ModerationStatus,
  Prisma,
  PrismaClient,
  Role,
  ViralServiceRequestStatus,
} from '@prisma/client'

import { jsonFail, jsonOk } from '@/app/api/_utils'
import { requireAdminPermission } from '@/app/api/_utils/auth/requireAdminPermission'
import { requireUser } from '@/app/api/_utils/auth/requireUser'
import {
  isLookCommentModerationAction,
  isLookPostModerationAction,
  isViralRequestModerationAction,
  toLookCommentModerationResultDto,
  toLookPostModerationResultDto,
  toViralRequestModerationResultDto,
  type AdminModerationResultDto,
  type AdminModerationTargetKind,
  type LookCommentModerationAction,
  type LookPostModerationAction,
  type ViralRequestModerationAction,
} from '@/lib/adminModeration/contracts'
import {
  enqueueFanOutViralRequestApprovalNotifications,
  enqueueRecomputeLookCounts,
} from '@/lib/jobs/looksSocial/enqueue'
import { enqueueLookPostMutationPolicy } from '@/lib/jobs/looksSocial/mutationEnqueuePolicy'
import {
  recomputeLookPostCommentCount,
  recomputeLookPostScores,
} from '@/lib/looks/counters'
import { isRecord } from '@/lib/guards'
import { prisma } from '@/lib/prisma'
import { updateViralRequestStatus } from '@/lib/viralRequests'
import {
  toQueuedViralRequestApprovalNotificationsDto,
  toViralRequestDto,
} from '@/lib/viralRequests/contracts'
import {
  writeAdminAuditLog,
  type WriteAdminAuditLogArgs,
} from '@/lib/admin/auditLog'

type AdminModerationDb = Prisma.TransactionClient | PrismaClient
type JsonRecord = Record<string, unknown>

type AdminPermissionScope = {
  professionalId?: string
  serviceId?: string
  categoryId?: string
}

type ParsedLookPostModerationRequest = {
  kind: 'LOOK_POST'
  targetId: string
  action: LookPostModerationAction
  adminNotes?: string
}

type ParsedLookCommentModerationRequest = {
  kind: 'LOOK_COMMENT'
  targetId: string
  action: LookCommentModerationAction
  adminNotes?: string
}

type ParsedViralRequestModerationRequest = {
  kind: 'VIRAL_SERVICE_REQUEST'
  targetId: string
  action: ViralRequestModerationAction
  adminNotes?: string
}

type ParsedAdminModerationRequest =
  | ParsedLookPostModerationRequest
  | ParsedLookCommentModerationRequest
  | ParsedViralRequestModerationRequest

type AdminModerationAuditLogData = Omit<
  WriteAdminAuditLogArgs,
  'adminUserId' | 'tx'
>

type ExecuteAdminModerationResult = {
  response: AdminModerationResultDto
  logData: AdminModerationAuditLogData
}

const lookPostPermissionSelect =
  Prisma.validator<Prisma.LookPostSelect>()({
    id: true,
    status: true,
    moderationStatus: true,
    reviewedAt: true,
    reviewedByUserId: true,
    adminNotes: true,
    reportCount: true,
    archivedAt: true,
    removedAt: true,
    professionalId: true,
    serviceId: true,
    service: {
      select: {
        categoryId: true,
      },
    },
  })

type LookPostPermissionRow = Prisma.LookPostGetPayload<{
  select: typeof lookPostPermissionSelect
}>

const lookCommentPermissionSelect =
  Prisma.validator<Prisma.LookCommentSelect>()({
    id: true,
    lookPostId: true,
    moderationStatus: true,
    removedAt: true,
    reviewedAt: true,
    reviewedByUserId: true,
    adminNotes: true,
    reportCount: true,
    lookPost: {
      select: {
        id: true,
        professionalId: true,
        serviceId: true,
        service: {
          select: {
            categoryId: true,
          },
        },
      },
    },
  })

type LookCommentPermissionRow = Prisma.LookCommentGetPayload<{
  select: typeof lookCommentPermissionSelect
}>

const viralRequestPermissionSelect =
  Prisma.validator<Prisma.ViralServiceRequestSelect>()({
    id: true,
    status: true,
    requestedCategoryId: true,
  })

type ViralRequestPermissionRow = Prisma.ViralServiceRequestGetPayload<{
  select: typeof viralRequestPermissionSelect
}>

class AdminModerationRouteError extends Error {
  readonly status: number
  readonly details?: Record<string, unknown>

  constructor(
    status: number,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(message)
    this.status = status
    this.details = details
  }
}

function trimString(value: unknown): string | null {
  return typeof value === 'string' ? value.trim() || null : null
}

function normalizeTargetId(
  kind: AdminModerationTargetKind,
  value: string,
): string {
  const trimmed = value.trim()

  if (trimmed) {
    return trimmed
  }

  switch (kind) {
    case 'LOOK_POST':
      throw new AdminModerationRouteError(400, 'Missing look id.')
    case 'LOOK_COMMENT':
      throw new AdminModerationRouteError(400, 'Missing look comment id.')
    case 'VIRAL_SERVICE_REQUEST':
      throw new AdminModerationRouteError(400, 'Missing viral request id.')
  }
}

async function readJsonBody(req: Request): Promise<JsonRecord | null> {
  const contentType = req.headers.get('content-type') ?? ''

  if (contentType && !contentType.includes('application/json')) {
    return null
  }

  try {
    const raw: unknown = await req.json()
    return isRecord(raw) ? raw : {}
  } catch {
    return {}
  }
}

function compactPermissionScope(
  scope: AdminPermissionScope,
): AdminPermissionScope | undefined {
  const professionalId = trimString(scope.professionalId)
  const serviceId = trimString(scope.serviceId)
  const categoryId = trimString(scope.categoryId)

  if (!professionalId && !serviceId && !categoryId) {
    return undefined
  }

  return {
    ...(professionalId ? { professionalId } : {}),
    ...(serviceId ? { serviceId } : {}),
    ...(categoryId ? { categoryId } : {}),
  }
}

function buildLookPostPermissionScope(
  row: Pick<LookPostPermissionRow, 'professionalId' | 'serviceId' | 'service'>,
): AdminPermissionScope | undefined {
  return compactPermissionScope({
    professionalId: row.professionalId,
    serviceId: row.serviceId ?? undefined,
    categoryId: row.service?.categoryId ?? undefined,
  })
}

function buildLookCommentPermissionScope(
  row: Pick<LookCommentPermissionRow, 'lookPost'>,
): AdminPermissionScope | undefined {
  return compactPermissionScope({
    professionalId: row.lookPost.professionalId,
    serviceId: row.lookPost.serviceId ?? undefined,
    categoryId: row.lookPost.service?.categoryId ?? undefined,
  })
}

function buildViralRequestPermissionScope(
  row: Pick<ViralRequestPermissionRow, 'requestedCategoryId'>,
): AdminPermissionScope | undefined {
  return compactPermissionScope({
    categoryId: row.requestedCategoryId ?? undefined,
  })
}

async function readPermissionScopeForTargetOrThrow(
  db: AdminModerationDb,
  request: ParsedAdminModerationRequest,
): Promise<AdminPermissionScope | undefined> {
  switch (request.kind) {
    case 'LOOK_POST': {
      const row = await db.lookPost.findUnique({
        where: { id: request.targetId },
        select: lookPostPermissionSelect,
      })

      if (!row) {
        throw new AdminModerationRouteError(404, 'Look post not found.')
      }

      return buildLookPostPermissionScope(row)
    }

    case 'LOOK_COMMENT': {
      const row = await db.lookComment.findUnique({
        where: { id: request.targetId },
        select: lookCommentPermissionSelect,
      })

      if (!row) {
        throw new AdminModerationRouteError(404, 'Look comment not found.')
      }

      return buildLookCommentPermissionScope(row)
    }

    case 'VIRAL_SERVICE_REQUEST': {
      const row = await db.viralServiceRequest.findUnique({
        where: { id: request.targetId },
        select: viralRequestPermissionSelect,
      })

      if (!row) {
        throw new AdminModerationRouteError(404, 'Viral request not found.')
      }

      return buildViralRequestPermissionScope(row)
    }
  }
}

function parseLookPostModerationBody(
  targetId: string,
  body: JsonRecord,
): ParsedLookPostModerationRequest {
  const action = body.action
  const adminNotes = trimString(body.adminNotes) ?? undefined

  if (!isLookPostModerationAction(action)) {
    throw new AdminModerationRouteError(400, 'Invalid look moderation action.')
  }

  return {
    kind: 'LOOK_POST',
    targetId,
    action,
    ...(adminNotes ? { adminNotes } : {}),
  }
}

function parseLookCommentModerationBody(
  targetId: string,
  body: JsonRecord,
): ParsedLookCommentModerationRequest {
  const action = body.action
  const adminNotes = trimString(body.adminNotes) ?? undefined

  if (!isLookCommentModerationAction(action)) {
    throw new AdminModerationRouteError(
      400,
      'Invalid look comment moderation action.',
    )
  }

  return {
    kind: 'LOOK_COMMENT',
    targetId,
    action,
    ...(adminNotes ? { adminNotes } : {}),
  }
}

function parseViralRequestModerationBody(
  targetId: string,
  body: JsonRecord,
): ParsedViralRequestModerationRequest {
  const action = body.action
  const adminNotes = trimString(body.adminNotes) ?? undefined

  if (!isViralRequestModerationAction(action)) {
    throw new AdminModerationRouteError(
      400,
      'Invalid viral request moderation action.',
    )
  }

  return {
    kind: 'VIRAL_SERVICE_REQUEST',
    targetId,
    action,
    ...(adminNotes ? { adminNotes } : {}),
  }
}

function buildAdminNotesAuditSuffix(adminNotes: string | undefined): string {
  if (adminNotes === undefined) {
    return 'adminNotesProvided=false'
  }

  return `adminNotesProvided=true adminNotesLength=${adminNotes.length}`
}

function buildSafeAdminModerationAuditNote(args: {
  targetLabel: 'lookPostId' | 'lookCommentId' | 'requestId'
  targetId: string
  lookPostId?: string
  adminNotes?: string
}): string {
  const targetPart = `${args.targetLabel}=${args.targetId}`
  const lookPostPart = args.lookPostId ? ` lookPostId=${args.lookPostId}` : ''
  const notesPart = buildAdminNotesAuditSuffix(args.adminNotes)

  return `${targetPart}${lookPostPart} ${notesPart}`
}

function buildAdminActionLogData(args: {
  action: string
  targetLabel: 'lookPostId' | 'lookCommentId' | 'requestId'
  targetId: string
  lookPostId?: string
  adminNotes?: string
  scope?: AdminPermissionScope
}): AdminModerationAuditLogData {
  return {
    action: args.action,
    note: buildSafeAdminModerationAuditNote({
      targetLabel: args.targetLabel,
      targetId: args.targetId,
      lookPostId: args.lookPostId,
      adminNotes: args.adminNotes,
    }),
    professionalId: args.scope?.professionalId ?? null,
    serviceId: args.scope?.serviceId ?? null,
    categoryId: args.scope?.categoryId ?? null,
  }
}

function buildLookPostLogAction(action: LookPostModerationAction): string {
  switch (action) {
    case 'approve':
      return 'LOOK_POST_APPROVED'
    case 'reject':
      return 'LOOK_POST_REJECTED'
    case 'remove':
      return 'LOOK_POST_REMOVED'
  }
}

function buildLookCommentLogAction(
  action: LookCommentModerationAction,
): string {
  switch (action) {
    case 'approve':
      return 'LOOK_COMMENT_APPROVED'
    case 'reject':
      return 'LOOK_COMMENT_REJECTED'
    case 'remove':
      return 'LOOK_COMMENT_REMOVED'
  }
}

function buildViralRequestLogAction(
  action: ViralRequestModerationAction,
): string {
  switch (action) {
    case 'mark_in_review':
      return 'VIRAL_REQUEST_MARKED_IN_REVIEW'
    case 'approve':
      return 'VIRAL_REQUEST_APPROVED'
    case 'reject':
      return 'VIRAL_REQUEST_REJECTED'
  }
}

function assertLookPostActionAllowed(
  row: Pick<LookPostPermissionRow, 'status' | 'moderationStatus'>,
  action: LookPostModerationAction,
): void {
  if (action === 'remove' && row.status === LookPostStatus.REMOVED) {
    throw new AdminModerationRouteError(
      409,
      `Invalid look post moderation transition: status=${row.status} moderationStatus=${row.moderationStatus} action=${action}.`,
    )
  }

  if (
    action === 'approve' &&
    (row.status === LookPostStatus.REMOVED ||
      row.moderationStatus === ModerationStatus.APPROVED)
  ) {
    throw new AdminModerationRouteError(
      409,
      `Invalid look post moderation transition: status=${row.status} moderationStatus=${row.moderationStatus} action=${action}.`,
    )
  }

  if (
    action === 'reject' &&
    (row.status === LookPostStatus.REMOVED ||
      row.moderationStatus === ModerationStatus.REJECTED)
  ) {
    throw new AdminModerationRouteError(
      409,
      `Invalid look post moderation transition: status=${row.status} moderationStatus=${row.moderationStatus} action=${action}.`,
    )
  }
}

function assertLookCommentActionAllowed(
  row: Pick<LookCommentPermissionRow, 'moderationStatus'>,
  action: LookCommentModerationAction,
): void {
  if (
    action === 'approve' &&
    (row.moderationStatus === ModerationStatus.APPROVED ||
      row.moderationStatus === ModerationStatus.REMOVED)
  ) {
    throw new AdminModerationRouteError(
      409,
      `Invalid look comment moderation transition: moderationStatus=${row.moderationStatus} action=${action}.`,
    )
  }

  if (
    action === 'reject' &&
    (row.moderationStatus === ModerationStatus.REJECTED ||
      row.moderationStatus === ModerationStatus.REMOVED)
  ) {
    throw new AdminModerationRouteError(
      409,
      `Invalid look comment moderation transition: moderationStatus=${row.moderationStatus} action=${action}.`,
    )
  }

  if (
    action === 'remove' &&
    row.moderationStatus === ModerationStatus.REMOVED
  ) {
    throw new AdminModerationRouteError(
      409,
      `Invalid look comment moderation transition: moderationStatus=${row.moderationStatus} action=${action}.`,
    )
  }
}

function assertViralRequestActionAllowed(
  row: Pick<ViralRequestPermissionRow, 'status'>,
  action: ViralRequestModerationAction,
): void {
  switch (row.status) {
    case ViralServiceRequestStatus.REQUESTED:
      return

    case ViralServiceRequestStatus.IN_REVIEW:
      if (action === 'mark_in_review') {
        throw new AdminModerationRouteError(
          409,
          `Invalid viral request moderation transition: status=${row.status} action=${action}.`,
        )
      }
      return

    case ViralServiceRequestStatus.APPROVED:
    case ViralServiceRequestStatus.REJECTED:
      throw new AdminModerationRouteError(
        409,
        `Invalid viral request moderation transition: status=${row.status} action=${action}.`,
      )
  }
}

function getNextViralRequestStatus(
  action: ViralRequestModerationAction,
): ViralServiceRequestStatus {
  switch (action) {
    case 'mark_in_review':
      return ViralServiceRequestStatus.IN_REVIEW
    case 'approve':
      return ViralServiceRequestStatus.APPROVED
    case 'reject':
      return ViralServiceRequestStatus.REJECTED
  }
}

function getNextViralModerationStatus(
  action: ViralRequestModerationAction,
): ModerationStatus {
  switch (action) {
    case 'mark_in_review':
      return ModerationStatus.PENDING_REVIEW
    case 'approve':
      return ModerationStatus.APPROVED
    case 'reject':
      return ModerationStatus.REJECTED
  }
}

function buildLookPostModerationMutation(
  action: LookPostModerationAction,
): 'MODERATION_APPROVE' | 'MODERATION_REJECT' | 'MODERATION_REMOVE' {
  switch (action) {
    case 'approve':
      return 'MODERATION_APPROVE'
    case 'reject':
      return 'MODERATION_REJECT'
    case 'remove':
      return 'MODERATION_REMOVE'
  }
}

async function executeLookPostModeration(
  db: AdminModerationDb,
  adminUserId: string,
  request: ParsedLookPostModerationRequest,
): Promise<ExecuteAdminModerationResult> {
  const existing = await db.lookPost.findUnique({
    where: { id: request.targetId },
    select: lookPostPermissionSelect,
  })

  if (!existing) {
    throw new AdminModerationRouteError(404, 'Look post not found.')
  }

  assertLookPostActionAllowed(existing, request.action)

  const now = new Date()

  const data: Prisma.LookPostUncheckedUpdateInput =
    request.action === 'approve'
      ? {
          moderationStatus: ModerationStatus.APPROVED,
          reviewedAt: now,
          reviewedByUserId: adminUserId,
          ...(request.adminNotes !== undefined
            ? { adminNotes: request.adminNotes }
            : {}),
        }
      : request.action === 'reject'
        ? {
            moderationStatus: ModerationStatus.REJECTED,
            reviewedAt: now,
            reviewedByUserId: adminUserId,
            ...(request.adminNotes !== undefined
              ? { adminNotes: request.adminNotes }
              : {}),
          }
        : {
            status: LookPostStatus.REMOVED,
            moderationStatus: ModerationStatus.REMOVED,
            removedAt: now,
            reviewedAt: now,
            reviewedByUserId: adminUserId,
            ...(request.adminNotes !== undefined
              ? { adminNotes: request.adminNotes }
              : {}),
          }

  const updated = await db.lookPost.update({
    where: { id: request.targetId },
    data,
    select: lookPostPermissionSelect,
  })

  await recomputeLookPostScores(db, request.targetId)

  await enqueueLookPostMutationPolicy(db, {
    lookPostId: request.targetId,
    mutation: buildLookPostModerationMutation(request.action),
    feedEligibilityChanged: true,
    searchableDocumentChanged: true,
  })

  const scope = buildLookPostPermissionScope(updated)
  const response = toLookPostModerationResultDto({
    id: updated.id,
    action: request.action,
    status: updated.status,
    moderationStatus: updated.moderationStatus,
    archivedAt: updated.archivedAt,
    removedAt: updated.removedAt,
    reviewedAt: updated.reviewedAt,
    reviewedByUserId: updated.reviewedByUserId,
    adminNotes: updated.adminNotes,
    reportCount: updated.reportCount,
  })

  return {
    response,
    logData: buildAdminActionLogData({
      action: buildLookPostLogAction(request.action),
      targetLabel: 'lookPostId',
      targetId: updated.id,
      adminNotes: request.adminNotes,
      scope,
    }),
  }
}

async function executeLookCommentModeration(
  db: AdminModerationDb,
  adminUserId: string,
  request: ParsedLookCommentModerationRequest,
): Promise<ExecuteAdminModerationResult> {
  const existing = await db.lookComment.findUnique({
    where: { id: request.targetId },
    select: lookCommentPermissionSelect,
  })

  if (!existing) {
    throw new AdminModerationRouteError(404, 'Look comment not found.')
  }

  assertLookCommentActionAllowed(existing, request.action)

  const moderationStatus =
    request.action === 'approve'
      ? ModerationStatus.APPROVED
      : request.action === 'reject'
        ? ModerationStatus.REJECTED
        : ModerationStatus.REMOVED

  const now = new Date()

  const updated = await db.lookComment.update({
    where: { id: request.targetId },
    data: {
      moderationStatus,
      reviewedAt: now,
      reviewedByUserId: adminUserId,
      ...(request.adminNotes !== undefined
        ? { adminNotes: request.adminNotes }
        : {}),
      ...(request.action === 'remove' ? { removedAt: now } : {}),
    },
    select: {
      id: true,
      lookPostId: true,
      moderationStatus: true,
      removedAt: true,
      reviewedAt: true,
      reviewedByUserId: true,
      adminNotes: true,
      reportCount: true,
    },
  })

  const commentsCount = await recomputeLookPostCommentCount(
    db,
    updated.lookPostId,
  )

  await enqueueRecomputeLookCounts(db, {
    lookPostId: updated.lookPostId,
  })

  const scope = buildLookCommentPermissionScope(existing)
  const response = toLookCommentModerationResultDto({
    id: updated.id,
    lookPostId: updated.lookPostId,
    action: request.action,
    moderationStatus: updated.moderationStatus,
    removedAt: updated.removedAt,
    reviewedAt: updated.reviewedAt,
    reviewedByUserId: updated.reviewedByUserId,
    adminNotes: updated.adminNotes,
    reportCount: updated.reportCount,
    commentsCount,
  })

  return {
    response,
    logData: buildAdminActionLogData({
      action: buildLookCommentLogAction(request.action),
      targetLabel: 'lookCommentId',
      targetId: updated.id,
      lookPostId: updated.lookPostId,
      adminNotes: request.adminNotes,
      scope,
    }),
  }
}

async function executeViralRequestModeration(
  db: AdminModerationDb,
  adminUserId: string,
  request: ParsedViralRequestModerationRequest,
): Promise<ExecuteAdminModerationResult> {
  const existing = await db.viralServiceRequest.findUnique({
    where: { id: request.targetId },
    select: viralRequestPermissionSelect,
  })

  if (!existing) {
    throw new AdminModerationRouteError(404, 'Viral request not found.')
  }

  assertViralRequestActionAllowed(existing, request.action)

  const updated = await updateViralRequestStatus(db, {
    requestId: request.targetId,
    nextStatus: getNextViralRequestStatus(request.action),
    reviewerUserId: adminUserId,
    adminNotes: request.adminNotes,
    moderationStatus: getNextViralModerationStatus(request.action),
  })

  const requestDto = toViralRequestDto(updated)
  const scope = buildViralRequestPermissionScope(existing)

  if (request.action === 'approve') {
    const fanOutJob = await enqueueFanOutViralRequestApprovalNotifications(db, {
      requestId: request.targetId,
    })

    const notificationsDto = toQueuedViralRequestApprovalNotificationsDto({
      jobId: fanOutJob.id,
    })

    return {
      response: toViralRequestModerationResultDto({
        id: updated.id,
        action: request.action,
        request: requestDto,
        notifications: notificationsDto,
      }),
      logData: buildAdminActionLogData({
        action: buildViralRequestLogAction(request.action),
        targetLabel: 'requestId',
        targetId: updated.id,
        adminNotes: request.adminNotes,
        scope,
      }),
    }
  }

  const response = toViralRequestModerationResultDto({
    id: updated.id,
    action: request.action,
    request: requestDto,
  })

  return {
    response,
    logData: buildAdminActionLogData({
      action: buildViralRequestLogAction(request.action),
      targetLabel: 'requestId',
      targetId: updated.id,
      adminNotes: request.adminNotes,
      scope,
    }),
  }
}

export async function executeAdminModeration(
  db: AdminModerationDb,
  adminUserId: string,
  request: ParsedAdminModerationRequest,
): Promise<ExecuteAdminModerationResult> {
  switch (request.kind) {
    case 'LOOK_POST':
      return executeLookPostModeration(db, adminUserId, request)
    case 'LOOK_COMMENT':
      return executeLookCommentModeration(db, adminUserId, request)
    case 'VIRAL_SERVICE_REQUEST':
      return executeViralRequestModeration(db, adminUserId, request)
  }
}

async function runModerationRequest(
  adminUserId: string,
  request: ParsedAdminModerationRequest,
): Promise<ExecuteAdminModerationResult | Response> {
  const scope = await readPermissionScopeForTargetOrThrow(prisma, request)

  const permission = await requireAdminPermission({
    adminUserId,
    allowedRoles: [
      AdminPermissionRole.SUPER_ADMIN,
      AdminPermissionRole.REVIEWER,
    ],
    scope,
  })

  if (!permission.ok) {
    return permission.res
  }

  const executed = await prisma.$transaction(async (tx) => {
    const result = await executeAdminModeration(tx, adminUserId, request)

    await writeAdminAuditLog({
      tx,
      adminUserId,
      ...result.logData,
    })

    return result
  })

  return executed
}

function toErrorResponse(error: unknown): Response {
  if (error instanceof AdminModerationRouteError) {
    return jsonFail(error.status, error.message, error.details)
  }

  const message =
    error instanceof Error ? error.message : 'Internal server error'

  if (message === 'Look post not found.') {
    return jsonFail(404, message)
  }

  if (message === 'Look comment not found.') {
    return jsonFail(404, message)
  }

  if (message === 'Viral request not found.') {
    return jsonFail(404, message)
  }

  if (message.startsWith('Text must be ')) {
    return jsonFail(400, message)
  }

  if (message.startsWith('Invalid viral request status transition:')) {
    return jsonFail(409, message)
  }

  return jsonFail(500, message)
}

function getSafeErrorLog(error: unknown): {
  errorName: string
  errorMessage: string
} {
  if (error instanceof Error) {
    return {
      errorName: error.name,
      errorMessage: error.message,
    }
  }

  return {
    errorName: 'UnknownError',
    errorMessage: 'Unknown admin moderation route error.',
  }
}

export async function handleAdminModerationRoute(
  req: Request,
  args: {
    kind: AdminModerationTargetKind
    targetId: string
  },
): Promise<Response> {
  try {
    const auth = await requireUser({ roles: [Role.ADMIN] })
    if (!auth.ok) return auth.res

    const targetId = normalizeTargetId(args.kind, args.targetId)
    const body = await readJsonBody(req)

    if (body === null) {
      return jsonFail(415, 'Content-Type must be application/json.')
    }

    const parsed: ParsedAdminModerationRequest =
      args.kind === 'LOOK_POST'
        ? parseLookPostModerationBody(targetId, body)
        : args.kind === 'LOOK_COMMENT'
          ? parseLookCommentModerationBody(targetId, body)
          : parseViralRequestModerationBody(targetId, body)

    const executed = await runModerationRequest(auth.user.id, parsed)

    if (executed instanceof Response) {
      return executed
    }

    return jsonOk(executed.response)
  } catch (error: unknown) {
    console.error('admin moderation route error', getSafeErrorLog(error))
    return toErrorResponse(error)
  }
}