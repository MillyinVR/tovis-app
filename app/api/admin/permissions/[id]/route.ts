// app/api/admin/permissions/[id]/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'
import { AdminPermissionRole } from '@prisma/client'
import { hasAdminPermission } from '@/lib/adminPermissions'

export const dynamic = 'force-dynamic'

function pickString(v: FormDataEntryValue | null) {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await getCurrentUser().catch(() => null)
    if (!user || user.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // SUPER_ADMIN only
    const ok = await hasAdminPermission({
      adminUserId: user.id,
      allowedRoles: [AdminPermissionRole.SUPER_ADMIN],
    })
    if (!ok) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const { id } = await context.params
    if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

    const form = await req.formData()
    const method = pickString(form.get('_method'))?.toUpperCase()
    if (method !== 'DELETE') return NextResponse.json({ error: 'Unsupported' }, { status: 400 })

    // Grab it first so we can log what was deleted (and return 404 gracefully)
    const existing = await prisma.adminPermission.findUnique({
      where: { id },
      select: { id: true, adminUserId: true, role: true, professionalId: true, serviceId: true, categoryId: true },
    })
    if (!existing) {
      // nothing to delete, but don’t crash and burn
      return NextResponse.redirect(new URL('/admin/permissions', req.url))
    }

    await prisma.adminPermission.delete({ where: { id } })

    await prisma.adminActionLog
      .create({
        data: {
          adminUserId: user.id,
          action: 'ADMIN_PERMISSION_DELETED',
          note: `permissionId=${existing.id} for=${existing.adminUserId} role=${existing.role} pro=${existing.professionalId ?? '-'} svc=${existing.serviceId ?? '-'} cat=${existing.categoryId ?? '-'}`,
        },
      })
      .catch(() => null)

    return NextResponse.redirect(new URL('/admin/permissions', req.url))
  } catch (e) {
    console.error('POST /api/admin/permissions/[id] error', e)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
