// app/api/internal/privacy/delete/[userId]/route.ts

import { AdminPermissionRole, Prisma, Role } from '@prisma/client'
import { NextResponse, type NextRequest } from 'next/server'

import { requireAdminPermission } from '@/app/api/_utils/auth/requireAdminPermission'
import { requireUser } from '@/app/api/_utils/auth/requireUser'
import { writeAdminAuditLog } from '@/lib/admin/auditLog'
import { prisma } from '@/lib/prisma'
import {
  deleteUserData,
  type DeleteUserDataResult,
} from '@/lib/privacy/deleteUserData'
import { summarizeDeleteUserDataResult } from '@/lib/privacy/deleteUserDataSummary'

type RouteContext = {
  params: Promise<{
    userId: string
  }>
}

type DeletePrivacyRequestBody = {
  dryRun?: unknown
  reason?: unknown
  confirmUserId?: unknown
}

type PrivacyDeleteMode = 'DRY_RUN' | 'ANONYMIZE'

type DryRunParseResult =
  | {
      ok: true
      dryRun: boolean
    }
  | {
      ok: false
      response: NextResponse
    }

const PRIVACY_DELETE_ACTION = 'privacy.user_delete' as const
const PRIVACY_DELETE_DRY_RUN_ACTION = 'privacy.user_delete_dry_run' as const
const DELETE_AUDIT_METADATA_VERSION = 1

function jsonFail(
  status: number,
  code: string,
  message: string,
): NextResponse {
  return NextResponse.json(
    {
      ok: false,
      error: {
        code,
        message,
      },
    },
    {
      status,
      headers: {
        'Cache-Control': 'no-store',
      },
    },
  )
}

function jsonOk<T>(data: T): NextResponse {
  return NextResponse.json(
    {
      ok: true,
      data,
    },
    {
      status: 200,
      headers: {
        'Cache-Control': 'no-store',
      },
    },
  )
}

function readRequestId(request: NextRequest): string | null {
  const requestId = request.headers.get('x-request-id')?.trim()

  return requestId && requestId.length > 0 ? requestId : null
}

async function readBody(request: NextRequest): Promise<DeletePrivacyRequestBody> {
  try {
    const parsed: unknown = await request.json()

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {}
    }

    return parsed
  } catch {
    return {}
  }
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : null
}

/**
 * Fail closed for destructive privacy operations.
 *
 * Missing dryRun defaults to true for operator safety. If dryRun is provided,
 * it must be a real boolean. Strings like "false" or "true" are rejected
 * instead of being interpreted, because accidental coercion must never trigger
 * live anonymization.
 */
function readDryRun(value: unknown): DryRunParseResult {
  if (value === undefined) {
    return {
      ok: true,
      dryRun: true,
    }
  }

  if (typeof value === 'boolean') {
    return {
      ok: true,
      dryRun: value,
    }
  }

  return {
    ok: false,
    response: jsonFail(
      400,
      'INVALID_DRY_RUN',
      'dryRun must be a boolean when provided.',
    ),
  }
}

function privacyDeleteModeFromDryRun(dryRun: boolean): PrivacyDeleteMode {
  return dryRun ? 'DRY_RUN' : 'ANONYMIZE'
}

function buildPrivacyDeleteAuditNote(args: {
  mode: PrivacyDeleteMode
  targetUserId: string
  reason: string
  requestId: string | null
}): string {
  return `Privacy ${
    args.mode === 'DRY_RUN' ? 'delete dry-run' : 'delete/anonymize'
  } for user ${args.targetUserId}. Reason: ${args.reason}. Request id: ${
    args.requestId ?? 'none'
  }.`
}

function buildPrivacyDeleteAuditMetadata(args: {
  mode: PrivacyDeleteMode
  requestId: string | null
  result: DeleteUserDataResult
}): Prisma.JsonObject {
  return {
    requestId: args.requestId,
    mode: args.mode,
    deleteVersion: DELETE_AUDIT_METADATA_VERSION,
    version: DELETE_AUDIT_METADATA_VERSION,
    actionCount: args.result.actions.length,
    limitations: args.result.limitations,
    limitationsCount: args.result.limitations.length,
    requiresManualFollowUp: args.result.limitations.length > 0,
    clientProfileId: args.result.subject.clientProfileId,
    professionalProfileId: args.result.subject.professionalProfileId,
  }
}

async function writePrivacyDeleteAuditLog(args: {
  adminUserId: string
  targetUserId: string
  mode: PrivacyDeleteMode
  reason: string
  requestId: string | null
  result: DeleteUserDataResult
  tx?: Prisma.TransactionClient
}): Promise<void> {
  await writeAdminAuditLog({
    ...(args.tx ? { tx: args.tx } : {}),
    adminUserId: args.adminUserId,
    action:
      args.mode === 'DRY_RUN'
        ? PRIVACY_DELETE_DRY_RUN_ACTION
        : PRIVACY_DELETE_ACTION,
    note: buildPrivacyDeleteAuditNote({
      mode: args.mode,
      targetUserId: args.targetUserId,
      reason: args.reason,
      requestId: args.requestId,
    }),
    targetType: 'user',
    targetId: args.targetUserId,
    metadata: buildPrivacyDeleteAuditMetadata({
      mode: args.mode,
      requestId: args.requestId,
      result: args.result,
    }),
  })
}

async function runDryRunDelete(args: {
  adminUserId: string
  targetUserId: string
  reason: string
  requestId: string | null
}): Promise<DeleteUserDataResult> {
  const mode: PrivacyDeleteMode = 'DRY_RUN'

  const result = await deleteUserData({
    db: prisma,
    userId: args.targetUserId,
    mode,
    requestedByUserId: args.adminUserId,
    reason: args.reason,
  })

  await writePrivacyDeleteAuditLog({
    adminUserId: args.adminUserId,
    targetUserId: args.targetUserId,
    mode,
    reason: args.reason,
    requestId: args.requestId,
    result,
  })

  return result
}

async function runLiveAnonymizeDelete(args: {
  adminUserId: string
  targetUserId: string
  reason: string
  requestId: string | null
}): Promise<DeleteUserDataResult> {
  const mode: PrivacyDeleteMode = 'ANONYMIZE'

  return prisma.$transaction(async (tx) => {
    const result = await deleteUserData({
      db: tx,
      userId: args.targetUserId,
      mode,
      requestedByUserId: args.adminUserId,
      reason: args.reason,
    })

    await writePrivacyDeleteAuditLog({
      tx,
      adminUserId: args.adminUserId,
      targetUserId: args.targetUserId,
      mode,
      reason: args.reason,
      requestId: args.requestId,
      result,
    })

    return result
  })
}

export async function POST(request: NextRequest, context: RouteContext) {
  const { userId } = await context.params
  const targetUserId = userId.trim()

  if (!targetUserId) {
    return jsonFail(400, 'INVALID_USER_ID', 'A target user id is required.')
  }

  const body = await readBody(request)
  const dryRunResult = readDryRun(body.dryRun)

  if (!dryRunResult.ok) {
    return dryRunResult.response
  }

  const dryRun = dryRunResult.dryRun
  const mode = privacyDeleteModeFromDryRun(dryRun)
  const reason = readString(body.reason)
  const confirmUserId = readString(body.confirmUserId)
  const requestId = readRequestId(request)

  if (!reason) {
    return jsonFail(
      400,
      'MISSING_REASON',
      'A reason is required for privacy delete/anonymize requests.',
    )
  }

  if (mode === 'ANONYMIZE' && confirmUserId !== targetUserId) {
    return jsonFail(
      400,
      'CONFIRM_USER_ID_REQUIRED',
      'confirmUserId must match the target user id for a live delete/anonymize request.',
    )
  }

  const auth = await requireUser({ roles: [Role.ADMIN] })
  if (!auth.ok) return auth.res

  if (mode === 'ANONYMIZE' && auth.user.id === targetUserId) {
    return jsonFail(
      400,
      'SELF_DELETE_BLOCKED',
      'Admins cannot delete or anonymize their own account through this route.',
    )
  }

  const permission = await requireAdminPermission({
    adminUserId: auth.user.id,
    allowedRoles: [AdminPermissionRole.SUPER_ADMIN],
  })

  if (!permission.ok) {
    return permission.res
  }

  const result =
    mode === 'ANONYMIZE'
      ? await runLiveAnonymizeDelete({
          adminUserId: auth.user.id,
          targetUserId,
          reason,
          requestId,
        })
      : await runDryRunDelete({
          adminUserId: auth.user.id,
          targetUserId,
          reason,
          requestId,
        })

  return jsonOk({
    result: summarizeDeleteUserDataResult(result),
  })
}