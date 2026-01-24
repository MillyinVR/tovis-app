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

    // ✅ pickString returns string | null in your codebase
    const name = (pickString(form.get('name')) ?? '').trim()
    const slugRaw = (pickString(form.get('slug')) ?? '').trim()
    const parentIdRaw = (pickString(form.get('parentId')) ?? '').trim()

    if (!name) return NextResponse.json({ error: 'Missing name' }, { status: 400 })

    const slug = slugifyLoose(slugRaw)
    if (!slug) return NextResponse.json({ error: 'Missing/invalid slug' }, { status: 400 })

    // ✅ empty string -> null
    const parentId: string | null = parentIdRaw ? parentIdRaw : null

    if (parentId) {
      const parent = await prisma.serviceCategory.findUnique({
        where: { id: parentId },
        select: { id: true },
      })
      if (!parent) return NextResponse.json({ error: 'Parent category not found' }, { status: 400 })
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
  } catch (e) {
    console.error('POST /api/admin/categories error', e)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
