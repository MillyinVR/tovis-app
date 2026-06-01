// app/api/internal/privacy/delete/[userId]/route.ts
import { AdminPermissionRole, Role } from '@prisma/client'
import { NextResponse, type NextRequest } from 'next/server'

import { requireAdminPermission } from '@/app/api/_utils/auth/requireAdminPermission'
import { requireUser } from '@/app/api/_utils/auth/requireUser'
import { writeAdminAuditLog } from '@/lib/admin/auditLog'
import { prisma } from '@/lib/prisma'
import { deleteUserData } from '@/lib/privacy/deleteUserData'
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

const PRIVACY_DELETE_ACTION = 'privacy.user_delete' as const
const PRIVACY_DELETE_DRY_RUN_ACTION = 'privacy.user_delete_dry_run' as const

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

function readDryRun(value: unknown): boolean {
  return value === undefined ? true : value === true
}

export async function POST(request: NextRequest, context: RouteContext) {
  const { userId } = await context.params
  const targetUserId = userId.trim()

  if (!targetUserId) {
    return jsonFail(400, 'INVALID_USER_ID', 'A target user id is required.')
  }

  const body = await readBody(request)
  const dryRun = readDryRun(body.dryRun)
  const reason = readString(body.reason)
  const confirmUserId = readString(body.confirmUserId)

  if (!reason) {
    return jsonFail(
      400,
      'MISSING_REASON',
      'A reason is required for privacy delete/anonymize requests.',
    )
  }

  if (!dryRun && confirmUserId !== targetUserId) {
    return jsonFail(
      400,
      'CONFIRM_USER_ID_REQUIRED',
      'confirmUserId must match the target user id for a live delete/anonymize request.',
    )
  }

  const auth = await requireUser({ roles: [Role.ADMIN] })
  if (!auth.ok) return auth.res

  if (!dryRun && auth.user.id === targetUserId) {
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

  const mode = dryRun ? 'DRY_RUN' : 'ANONYMIZE'

  const result = await deleteUserData({
    db: prisma,
    userId: targetUserId,
    mode,
    requestedByUserId: auth.user.id,
    reason,
  })

  await writeAdminAuditLog({
    adminUserId: auth.user.id,
    action:
      mode === 'DRY_RUN'
        ? PRIVACY_DELETE_DRY_RUN_ACTION
        : PRIVACY_DELETE_ACTION,
    note: `Privacy ${
      mode === 'DRY_RUN' ? 'delete dry-run' : 'delete/anonymize'
    } for user ${targetUserId}. Reason: ${reason}. Request id: ${
      readRequestId(request) ?? 'none'
    }.`,
  })

  return jsonOk({
    result: summarizeDeleteUserDataResult(result),
  })
}