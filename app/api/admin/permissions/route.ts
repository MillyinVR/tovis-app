// app/api/admin/permissions/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'
import { AdminPermissionRole } from '@prisma/client'
import { hasAdminPermission } from '@/lib/adminPermissions'

export const dynamic = 'force-dynamic'

function pickString(v: FormDataEntryValue | null) {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

function normalizeRole(v: string | null): AdminPermissionRole | null {
  const s = (v ?? '').toUpperCase()
  if (s === 'SUPER_ADMIN') return AdminPermissionRole.SUPER_ADMIN
  if (s === 'SUPPORT') return AdminPermissionRole.SUPPORT
  if (s === 'REVIEWER') return AdminPermissionRole.REVIEWER
  return null
}

export async function GET() {
  try {
    const user = await getCurrentUser().catch(() => null)
    if (!user || user.role !== 'ADMIN') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // Only SUPER_ADMIN can view/manage permissions
    const ok = await hasAdminPermission({
      adminUserId: user.id,
      allowedRoles: [AdminPermissionRole.SUPER_ADMIN],
    })
    if (!ok) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const [users, permissions, professionals, services, categories] = await Promise.all([
      prisma.user.findMany({
        select: { id: true, email: true, role: true },
        orderBy: { email: 'asc' },
        take: 5000,
      }),
      prisma.adminPermission.findMany({
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          role: true,
          adminUserId: true,
          professionalId: true,
          serviceId: true,
          categoryId: true,
          createdAt: true,
        },
        take: 5000,
      }),
      prisma.professionalProfile.findMany({
        select: { id: true, businessName: true, city: true, state: true },
        orderBy: { id: 'asc' },
        take: 2000,
      }),
      prisma.service.findMany({
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
        take: 2000,
      }),
      prisma.serviceCategory.findMany({
        select: { id: true, name: true, slug: true },
        orderBy: { name: 'asc' },
        take: 2000,
      }),
    ])

    return NextResponse.json(
      {
        ok: true,
        users,
        permissions: permissions.map((p) => ({ ...p, createdAt: p.createdAt.toISOString() })),
        professionals: professionals.map((p) => ({
          id: p.id,
          label: `${p.businessName ?? 'Unnamed pro'}${p.city || p.state ? ` • ${[p.city, p.state].filter(Boolean).join(', ')}` : ''}`,
        })),
        services: services.map((s) => ({ id: s.id, label: s.name })),
        categories: categories.map((c) => ({ id: c.id, label: `${c.name} (${c.slug})` })),
      },
      { status: 200 },
    )
  } catch (e) {
    console.error('GET /api/admin/permissions error', e)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser().catch(() => null)
    if (!user || user.role !== 'ADMIN') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // Only SUPER_ADMIN can assign permissions
    const ok = await hasAdminPermission({
      adminUserId: user.id,
      allowedRoles: [AdminPermissionRole.SUPER_ADMIN],
    })
    if (!ok) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const form = await req.formData()
    const adminUserId = pickString(form.get('adminUserId'))
    const role = normalizeRole(pickString(form.get('role')))
    const professionalId = pickString(form.get('professionalId'))
    const serviceId = pickString(form.get('serviceId'))
    const categoryId = pickString(form.get('categoryId'))

    if (!adminUserId || !role) return NextResponse.json({ error: 'Missing adminUserId/role' }, { status: 400 })

    const created = await prisma.adminPermission.create({
      data: {
        adminUserId,
        role,
        professionalId: professionalId ?? null,
        serviceId: serviceId ?? null,
        categoryId: categoryId ?? null,
      },
      select: { id: true },
    })

    await prisma.adminActionLog
      .create({
        data: {
          adminUserId: user.id,
          action: 'ADMIN_PERMISSION_CREATED',
          note: `for=${adminUserId} role=${role} pro=${professionalId ?? '-'} svc=${serviceId ?? '-'} cat=${categoryId ?? '-'}`,
        },
      })
      .catch(() => null)

    return NextResponse.redirect(new URL('/admin/permissions', req.url))
  } catch (e: any) {
    // unique constraint throws sometimes: keep it user-friendly
    const msg = typeof e?.message === 'string' ? e.message : 'Internal server error'
    console.error('POST /api/admin/permissions error', e)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
