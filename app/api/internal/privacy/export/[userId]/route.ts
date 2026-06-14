// app/api/internal/privacy/export/[userId]/route.ts

import { AdminPermissionRole, Role } from '@prisma/client'
import { NextResponse, type NextRequest } from 'next/server'

import { requireAdminPermission } from '@/app/api/_utils/auth/requireAdminPermission'
import { requireUser } from '@/app/api/_utils/auth/requireUser'
import {
  resolveRouteParams,
  type RouteContext,
} from '@/app/api/_utils/routeContext'
import { writeAdminAuditLog } from '@/lib/admin/auditLog'
import { prisma } from '@/lib/prisma'
import {
  exportUserData,
  USER_DATA_EXPORT_VERSION,
} from '@/lib/privacy/exportUserData'

const PRIVACY_EXPORT_ACTION = 'privacy.user_export' as const

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

export async function POST(
  request: NextRequest,
  context: RouteContext<{ userId: string }>,
) {
  const { userId } = await resolveRouteParams(context)
  const targetUserId = userId.trim()

  if (!targetUserId) {
    return jsonFail(400, 'INVALID_USER_ID', 'A target user id is required.')
  }

  const auth = await requireUser({ roles: [Role.ADMIN] })
  if (!auth.ok) return auth.res

  const permission = await requireAdminPermission({
    adminUserId: auth.user.id,
    allowedRoles: [AdminPermissionRole.SUPER_ADMIN],
  })

  if (!permission.ok) {
    return permission.res
  }

  const requestId = readRequestId(request)

  const exported = await exportUserData({
    db: prisma,
    userId: targetUserId,
  })

  await writeAdminAuditLog({
    adminUserId: auth.user.id,
    action: PRIVACY_EXPORT_ACTION,
    note: `Generated privacy export for user ${targetUserId}. Request id: ${
      requestId ?? 'none'
    }.`,
    targetType: 'user',
    targetId: targetUserId,
    professionalId: exported.subject.professionalProfileId,
    metadata: {
      requestId,
      exportVersion: USER_DATA_EXPORT_VERSION,
      clientProfileId: exported.subject.clientProfileId,
      professionalProfileId: exported.subject.professionalProfileId,
      exportedSections: Object.keys(exported.data),
      limitationCount: exported.limitations.length,
    },
  })

  return jsonOk({
    export: exported,
  })
}