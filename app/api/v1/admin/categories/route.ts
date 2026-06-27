// app/api/v1/admin/categories/route.ts

import { NextRequest, NextResponse } from 'next/server'
import { AdminPermissionRole, Role } from '@prisma/client'

import { jsonFail, jsonOk } from '@/app/api/_utils'
import { requireAdminPermission } from '@/app/api/_utils/auth/requireAdminPermission'
import { requireUser } from '@/app/api/_utils/auth/requireUser'
import { pickString } from '@/app/api/_utils/pick'
import { writeAdminAuditLog } from '@/lib/admin/auditLog'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

function slugifyLoose(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
}

export async function GET() {
  try {
    const auth = await requireUser({ roles: [Role.ADMIN] })
    if (!auth.ok) return auth.res

    const user = auth.user

    const permission = await requireAdminPermission({
      adminUserId: user.id,
      allowedRoles: [
        AdminPermissionRole.SUPER_ADMIN,
        AdminPermissionRole.SUPPORT,
      ],
    })

    if (!permission.ok) {
      return permission.res
    }

    const categories = await prisma.serviceCategory.findMany({
      orderBy: [{ parentId: 'asc' }, { name: 'asc' }],
      select: {
        id: true,
        name: true,
        slug: true,
        parentId: true,
        isActive: true,
      },
      take: 2000,
    })

    return jsonOk({ categories })
  } catch (error: unknown) {
    console.error('GET /api/v1/admin/categories error', error)

    const message =
      error instanceof Error ? error.message : 'Internal server error'

    return jsonFail(500, message)
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireUser({ roles: [Role.ADMIN] })
    if (!auth.ok) return auth.res

    const user = auth.user

    const permission = await requireAdminPermission({
      adminUserId: user.id,
      allowedRoles: [
        AdminPermissionRole.SUPER_ADMIN,
        AdminPermissionRole.SUPPORT,
      ],
    })

    if (!permission.ok) {
      return permission.res
    }

    const form = await req.formData()

    const name = (pickString(form.get('name')) ?? '').trim()
    const slugRaw = (pickString(form.get('slug')) ?? '').trim()
    const parentIdRaw = (pickString(form.get('parentId')) ?? '').trim()

    if (!name) {
      return jsonFail(400, 'Missing name')
    }

    const slug = slugifyLoose(slugRaw || name)

    if (!slug) {
      return jsonFail(400, 'Missing/invalid slug')
    }

    const parentId = parentIdRaw ? parentIdRaw : null

    if (parentId) {
      const parent = await prisma.serviceCategory.findUnique({
        where: { id: parentId },
        select: { id: true },
      })

      if (!parent) {
        return jsonFail(400, 'Parent category not found')
      }
    }

    const created = await prisma.serviceCategory.create({
      data: {
        name,
        slug,
        parentId,
        isActive: true,
      },
      select: {
        id: true,
        name: true,
        slug: true,
        parentId: true,
      },
    })

    await writeAdminAuditLog({
      adminUserId: user.id,
      categoryId: created.id,
      action: 'CATEGORY_CREATED',
      note: 'Category created',
      metadata: {
        categoryId: created.id,
        parentCategoryProvided: created.parentId !== null,
        slugProvided: Boolean(slugRaw),
      },
    }).catch(() => null)

    return NextResponse.redirect(new URL('/admin/categories', req.url), {
      status: 303,
    })
  } catch (error: unknown) {
    console.error('POST /api/v1/admin/categories error', error)

    const message =
      error instanceof Error ? error.message : 'Internal server error'

    return jsonFail(500, message)
  }
}