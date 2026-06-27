// app/api/v1/admin/categories/[id]/route.ts

import { NextRequest, NextResponse } from 'next/server'
import { AdminPermissionRole, Role } from '@prisma/client'

import { jsonFail } from '@/app/api/_utils'
import { requireAdminPermission } from '@/app/api/_utils/auth/requireAdminPermission'
import { requireUser } from '@/app/api/_utils/auth/requireUser'
import { pickMethod, pickString } from '@/app/api/_utils/pick'
import { resolveRouteParams, type RouteContext } from '@/app/api/_utils/routeContext'
import { writeAdminAuditLog } from '@/lib/admin/auditLog'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

function trimId(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function parseRequiredActiveFlag(value: unknown): boolean | null {
  const raw = pickString(value)?.trim().toLowerCase() ?? ''

  if (raw === 'true') return true
  if (raw === 'false') return false

  return null
}

export async function POST(req: NextRequest, ctx: RouteContext) {
  try {
    const auth = await requireUser({ roles: [Role.ADMIN] })
    if (!auth.ok) return auth.res

    const user = auth.user

    const { id } = await resolveRouteParams(ctx)
    const categoryId = trimId(id)

    if (!categoryId) {
      return jsonFail(400, 'Missing id')
    }

    const permission = await requireAdminPermission({
      adminUserId: user.id,
      allowedRoles: [
        AdminPermissionRole.SUPER_ADMIN,
        AdminPermissionRole.SUPPORT,
      ],
      scope: { categoryId },
    })

    if (!permission.ok) {
      return permission.res
    }

    const form = await req.formData()
    const method = pickMethod(form.get('_method'))

    if (method !== 'PATCH') {
      return jsonFail(400, 'Unsupported')
    }

    const isActive = parseRequiredActiveFlag(form.get('isActive'))

    if (isActive == null) {
      return jsonFail(400, 'Invalid isActive (expected true/false)')
    }

    const updated = await prisma.serviceCategory.update({
      where: { id: categoryId },
      data: { isActive },
      select: {
        id: true,
        isActive: true,
      },
    })

    await writeAdminAuditLog({
      adminUserId: user.id,
      categoryId: updated.id,
      action: 'CATEGORY_TOGGLED',
      note: `isActive=${String(updated.isActive)}`,
      metadata: {
        categoryId: updated.id,
        isActive: updated.isActive,
      },
    }).catch(() => null)

    return NextResponse.redirect(new URL('/admin/categories', req.url), {
      status: 303,
    })
  } catch (error: unknown) {
    console.error('POST /api/v1/admin/categories/[id] error', error)

    const message =
      error instanceof Error ? error.message : 'Internal server error'

    return jsonFail(500, message)
  }
}