// app/api/admin/services/[id]/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'
import { AdminPermissionRole } from '@prisma/client'
import { hasAdminPermission } from '@/lib/adminPermissions'

export const dynamic = 'force-dynamic'

function pickString(v: FormDataEntryValue | null) {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

function pickInt(v: FormDataEntryValue | null) {
  const s = pickString(v)
  if (!s) return null
  const n = Number(s)
  return Number.isFinite(n) ? Math.trunc(n) : null
}

export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await getCurrentUser().catch(() => null)
    if (!user || user.role !== 'ADMIN') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { id } = await context.params
    if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

    const svc = await prisma.service.findUnique({
      where: { id },
      select: { id: true, categoryId: true },
    })
    if (!svc) return NextResponse.json({ error: 'Service not found' }, { status: 404 })

    const ok = await hasAdminPermission({
      adminUserId: user.id,
      allowedRoles: [AdminPermissionRole.SUPER_ADMIN, AdminPermissionRole.SUPPORT],
      scope: { serviceId: svc.id, categoryId: svc.categoryId },
    })
    if (!ok) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const form = await req.formData()
    const method = pickString(form.get('_method'))?.toUpperCase()
    if (method !== 'PATCH') return NextResponse.json({ error: 'Unsupported' }, { status: 400 })

    // Toggle only?
    const isActiveRaw = pickString(form.get('isActive'))
    if (isActiveRaw === 'true' || isActiveRaw === 'false') {
      await prisma.service.update({
        where: { id },
        data: { isActive: isActiveRaw === 'true' },
      })

      await prisma.adminActionLog
        .create({
          data: {
            adminUserId: user.id,
            serviceId: id,
            categoryId: svc.categoryId,
            action: 'SERVICE_TOGGLED',
            note: `isActive=${isActiveRaw}`,
          },
        })
        .catch(() => null)

      return NextResponse.redirect(new URL('/admin/services', req.url))
    }

    // Full edit
    const name = pickString(form.get('name'))
    const categoryId = pickString(form.get('categoryId'))
    const defaultDurationMinutes = pickInt(form.get('defaultDurationMinutes'))
    const minPrice = pickString(form.get('minPrice'))
    const description = pickString(form.get('description'))
    const allowMobile = pickString(form.get('allowMobile')) === 'true'

    if (!name || !categoryId || !defaultDurationMinutes || !minPrice) {
      return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
    }

    // If category changes, enforce new category scope too
    const okNewCategory = await hasAdminPermission({
      adminUserId: user.id,
      allowedRoles: [AdminPermissionRole.SUPER_ADMIN, AdminPermissionRole.SUPPORT],
      scope: { categoryId },
    })
    if (!okNewCategory) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    await prisma.service.update({
      where: { id },
      data: {
        name,
        categoryId,
        defaultDurationMinutes,
        minPrice,
        description,
        allowMobile,
      },
    })

    await prisma.adminActionLog
      .create({
        data: {
          adminUserId: user.id,
          serviceId: id,
          categoryId,
          action: 'SERVICE_UPDATED',
          note: name,
        },
      })
      .catch(() => null)

    return NextResponse.redirect(new URL(`/admin/services/${encodeURIComponent(id)}`, req.url))
  } catch (e) {
    console.error('POST /api/admin/services/[id] error', e)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
