// app/api/admin/permissions/[id]/route.ts

import { NextRequest, NextResponse } from 'next/server'
import { AdminPermissionRole, Role } from '@prisma/client'

import { jsonFail } from '@/app/api/_utils'
import { requireAdminPermission } from '@/app/api/_utils/auth/requireAdminPermission'
import { requireUser } from '@/app/api/_utils/auth/requireUser'
import { pickMethod } from '@/app/api/_utils/pick'
import { resolveRouteParams, type RouteContext } from '@/app/api/_utils/routeContext'
import { writeAdminAuditLog } from '@/lib/admin/auditLog'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

function trimId(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function redirectToPermissions(req: NextRequest): Response {
  return NextResponse.redirect(new URL('/admin/permissions', req.url), {
    status: 303,
  })
}

export async function POST(req: NextRequest, ctx: RouteContext) {
  try {
    const auth = await requireUser({ roles: [Role.ADMIN] })
    if (!auth.ok) return auth.res

    const user = auth.user

    const permission = await requireAdminPermission({
      adminUserId: user.id,
      allowedRoles: [AdminPermissionRole.SUPER_ADMIN],
    })

    if (!permission.ok) {
      return permission.res
    }

    const { id } = await resolveRouteParams(ctx)
    const permissionId = trimId(id)

    if (!permissionId) {
      return jsonFail(400, 'Missing id')
    }

    const form = await req.formData()
    const method = pickMethod(form.get('_method'))

    if (method !== 'DELETE') {
      return jsonFail(400, 'Unsupported')
    }

    const existing = await prisma.adminPermission.findUnique({
      where: { id: permissionId },
      select: {
        id: true,
        adminUserId: true,
        role: true,
        professionalId: true,
        serviceId: true,
        categoryId: true,
      },
    })

    if (!existing) {
      return redirectToPermissions(req)
    }

    await prisma.adminPermission.delete({
      where: { id: permissionId },
    })

    await writeAdminAuditLog({
      adminUserId: user.id,
      professionalId: existing.professionalId,
      serviceId: existing.serviceId,
      categoryId: existing.categoryId,
      action: 'ADMIN_PERMISSION_DELETED',
      note: 'Admin permission deleted',
      metadata: {
        permissionId: existing.id,
        revokedAdminUserId: existing.adminUserId,
        role: existing.role,
        hadProfessionalScope: existing.professionalId !== null,
        hadServiceScope: existing.serviceId !== null,
        hadCategoryScope: existing.categoryId !== null,
      },
    }).catch(() => null)

    return redirectToPermissions(req)
  } catch (error: unknown) {
    console.error('POST /api/admin/permissions/[id] error', error)

    const message =
      error instanceof Error ? error.message : 'Internal server error'

    return jsonFail(500, message)
  }
}