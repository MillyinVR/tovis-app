// app/api/admin/permissions/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireUser } from '@/app/api/_utils/auth/requireUser'
import { AdminPermissionRole } from '@prisma/client'
import { hasAdminPermission } from '@/lib/adminPermissions'
import { pickString, pickMethod } from '@/app/api/_utils/pick'

export const dynamic = 'force-dynamic'

function normalizeRole(v: string | null): AdminPermissionRole | null {
  const s = (v ?? '').trim().toUpperCase()
  if (s === 'SUPER_ADMIN') return AdminPermissionRole.SUPER_ADMIN
  if (s === 'SUPPORT') return AdminPermissionRole.SUPPORT
  if (s === 'REVIEWER') return AdminPermissionRole.REVIEWER
  return null
}

function trimOrNull(v: string | null): string | null {
  const s = (v ?? '').trim()
  return s ? s : null
}

export async function GET() {
  try {
    const auth = await requireUser({ roles: ['ADMIN'] })
    if (!auth.ok) return auth.res
    const user = auth.user

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
        select: { id: true, businessName: true, location: true },
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
          label: `${p.businessName ?? 'Unnamed pro'}${p.location?.trim() ? ` • ${p.location.trim()}` : ''}`,
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
    const auth = await requireUser({ roles: ['ADMIN'] })
    if (!auth.ok) return auth.res
    const user = auth.user

    const ok = await hasAdminPermission({
      adminUserId: user.id,
      allowedRoles: [AdminPermissionRole.SUPER_ADMIN],
    })
    if (!ok) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const form = await req.formData()
    const method = pickMethod(form.get('_method')) ?? 'POST'
    if (method !== 'POST') return NextResponse.json({ error: 'Unsupported operation.' }, { status: 400 })

    const adminUserId = trimOrNull(pickString(form.get('adminUserId')))
    const role = normalizeRole(pickString(form.get('role')))

    const professionalId = trimOrNull(pickString(form.get('professionalId')))
    const serviceId = trimOrNull(pickString(form.get('serviceId')))
    const categoryId = trimOrNull(pickString(form.get('categoryId')))

    if (!adminUserId || !role) {
      return NextResponse.json({ error: 'Missing adminUserId/role' }, { status: 400 })
    }

    const created = await prisma.adminPermission.create({
      data: {
        adminUserId,
        role,
        professionalId,
        serviceId,
        categoryId,
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

    // ✅ 303 prevents “resubmit form” issues on refresh/back
    return NextResponse.redirect(new URL('/admin/permissions', req.url), { status: 303 })
  } catch (e: any) {
    const msg = typeof e?.message === 'string' ? e.message : 'Internal server error'
    console.error('POST /api/admin/permissions error', e)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}