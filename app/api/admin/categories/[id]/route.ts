// app/api/admin/categories/[id]/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'
import { AdminPermissionRole } from '@prisma/client'
import { hasAdminPermission } from '@/lib/adminPermissions'

export const dynamic = 'force-dynamic'

function pickString(v: unknown) {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await getCurrentUser().catch(() => null)
    if (!user || user.role !== 'ADMIN') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { id } = await context.params
    if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

    const ok = await hasAdminPermission({
      adminUserId: user.id,
      allowedRoles: [AdminPermissionRole.SUPER_ADMIN, AdminPermissionRole.SUPPORT],
      scope: { categoryId: id },
    })
    if (!ok) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const form = await req.formData()
    const method = pickString(form.get('_method'))?.toUpperCase()
    if (method !== 'PATCH') return NextResponse.json({ error: 'Unsupported' }, { status: 400 })

    const isActiveRaw = pickString(form.get('isActive'))
    const isActive = isActiveRaw === 'true'

    const updated = await prisma.serviceCategory.update({
      where: { id },
      data: { isActive },
      select: { id: true, name: true, slug: true },
    })

    await prisma.adminActionLog
      .create({
        data: {
          adminUserId: user.id,
          categoryId: updated.id,
          action: 'CATEGORY_TOGGLED',
          note: `${updated.name} (${updated.slug}) -> ${isActive ? 'ENABLED' : 'DISABLED'}`,
        },
      })
      .catch(() => null)

    return NextResponse.redirect(new URL('/admin/categories', req.url))
  } catch (e) {
    console.error('POST /api/admin/categories/[id] error', e)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
