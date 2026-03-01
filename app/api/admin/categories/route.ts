// app/api/admin/categories/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireUser } from '@/app/api/_utils/auth/requireUser'
import { requireAdminPermission } from '@/app/api/_utils/auth/requireAdminPermission'
import { jsonFail, jsonOk } from '@/app/api/_utils'
import { pickString } from '@/app/api/_utils/pick'
import { AdminPermissionRole, Role } from '@prisma/client'

export const dynamic = 'force-dynamic'

function slugifyLoose(s: string) {
  return s
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

    const perm = await requireAdminPermission({
      adminUserId: user.id,
      allowedRoles: [AdminPermissionRole.SUPER_ADMIN, AdminPermissionRole.SUPPORT],
    })
    if (!perm.ok) return perm.res

    const categories = await prisma.serviceCategory.findMany({
      orderBy: [{ parentId: 'asc' }, { name: 'asc' }],
      select: { id: true, name: true, slug: true, parentId: true, isActive: true },
      take: 2000,
    })

    return jsonOk({ categories })
  } catch (err: unknown) {
    console.error('GET /api/admin/categories error', err)
    const message = err instanceof Error ? err.message : 'Internal server error'
    return jsonFail(500, message)
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireUser({ roles: [Role.ADMIN] })
    if (!auth.ok) return auth.res
    const user = auth.user

    const perm = await requireAdminPermission({
      adminUserId: user.id,
      allowedRoles: [AdminPermissionRole.SUPER_ADMIN, AdminPermissionRole.SUPPORT],
    })
    if (!perm.ok) return perm.res

    const form = await req.formData()

    const name = (pickString(form.get('name')) ?? '').trim()
    const slugRaw = (pickString(form.get('slug')) ?? '').trim()
    const parentIdRaw = (pickString(form.get('parentId')) ?? '').trim()

    if (!name) return jsonFail(400, 'Missing name')

    // if slug isn't provided, derive from name (nice UX)
    const slug = slugifyLoose(slugRaw || name)
    if (!slug) return jsonFail(400, 'Missing/invalid slug')

    const parentId: string | null = parentIdRaw ? parentIdRaw : null

    if (parentId) {
      const parent = await prisma.serviceCategory.findUnique({
        where: { id: parentId },
        select: { id: true },
      })
      if (!parent) return jsonFail(400, 'Parent category not found')
    }

    const created = await prisma.serviceCategory.create({
      data: { name, slug, parentId, isActive: true },
      select: { id: true, name: true, slug: true },
    })

    await prisma.adminActionLog
      .create({
        data: {
          adminUserId: user.id,
          categoryId: created.id,
          action: 'CATEGORY_CREATED',
          note: `${created.name} (${created.slug})`,
        },
      })
      .catch(() => null)

    return NextResponse.redirect(new URL('/admin/categories', req.url), { status: 303 })
  } catch (err: unknown) {
    console.error('POST /api/admin/categories error', err)
    const message = err instanceof Error ? err.message : 'Internal server error'
    return jsonFail(500, message)
  }
}