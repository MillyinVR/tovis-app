// app/api/admin/categories/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireUser } from '@/app/api/_utils/auth/requireUser'
import { AdminPermissionRole } from '@prisma/client'
import { hasAdminPermission } from '@/lib/adminPermissions'
import { pickString } from '@/app/api/_utils/pick'

export const dynamic = 'force-dynamic'

async function requireSupport(userId: string) {
  return hasAdminPermission({
    adminUserId: userId,
    allowedRoles: [AdminPermissionRole.SUPER_ADMIN, AdminPermissionRole.SUPPORT],
  })
}

export async function GET() {
  try {
    const { user, res } = await requireUser({ roles: ['ADMIN'] as any })
    if (res) return res

    const ok = await requireSupport(user.id)
    if (!ok) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const categories = await prisma.serviceCategory.findMany({
      orderBy: [{ parentId: 'asc' }, { name: 'asc' }],
      select: { id: true, name: true, slug: true, parentId: true, isActive: true },
      take: 2000,
    })

    return NextResponse.json({ ok: true, categories }, { status: 200 })
  } catch (e) {
    console.error('GET /api/admin/categories error', e)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const { user, res } = await requireUser({ roles: ['ADMIN'] as any })
    if (res) return res

    const ok = await requireSupport(user.id)
    if (!ok) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const form = await req.formData()
    const name = pickString(form.get('name'))
    const slug = pickString(form.get('slug'))
    const parentId = pickString(form.get('parentId'))

    if (!name || !slug) return NextResponse.json({ error: 'Missing name/slug' }, { status: 400 })

    const created = await prisma.serviceCategory.create({
      data: { name, slug, parentId: parentId ?? null, isActive: true },
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

    return NextResponse.redirect(new URL('/admin/categories', req.url))
  } catch (e) {
    console.error('POST /api/admin/categories error', e)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
