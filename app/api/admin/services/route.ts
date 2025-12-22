// app/api/admin/services/route.ts
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

function pickBool(v: FormDataEntryValue | null) {
  const s = pickString(v)
  if (!s) return null
  return s === 'true' || s === '1' || s.toLowerCase() === 'on'
}

async function requireSupport(userId: string) {
  return hasAdminPermission({
    adminUserId: userId,
    allowedRoles: [AdminPermissionRole.SUPER_ADMIN, AdminPermissionRole.SUPPORT],
  })
}

export async function GET() {
  try {
    const user = await getCurrentUser().catch(() => null)
    if (!user || user.role !== 'ADMIN') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const ok = await requireSupport(user.id)
    if (!ok) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const services = await prisma.service.findMany({
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        categoryId: true,
        isActive: true,
        allowMobile: true,
        defaultDurationMinutes: true,
        minPrice: true,
      },
      take: 2000,
    })

    return NextResponse.json({ ok: true, services }, { status: 200 })
  } catch (e) {
    console.error('GET /api/admin/services error', e)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser().catch(() => null)
    if (!user || user.role !== 'ADMIN') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const ok = await requireSupport(user.id)
    if (!ok) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const form = await req.formData()
    const method = pickString(form.get('_method'))?.toUpperCase() ?? 'POST'
    if (method !== 'POST') return NextResponse.json({ error: 'Unsupported operation.' }, { status: 400 })

    const name = pickString(form.get('name'))
    const categoryId = pickString(form.get('categoryId'))

    const defaultDurationMinutes = pickInt(form.get('defaultDurationMinutes')) ?? 60
    const minPriceRaw = pickString(form.get('minPrice'))
    const allowMobile = pickBool(form.get('allowMobile')) ?? false
    const description = pickString(form.get('description'))
    const defaultImageUrl = pickString(form.get('defaultImageUrl'))

    if (!name || !categoryId) {
      return NextResponse.json({ error: 'Missing name or categoryId.' }, { status: 400 })
    }

    // Optional: category-scoped enforcement (nice for future)
    const okCategory = await hasAdminPermission({
      adminUserId: user.id,
      allowedRoles: [AdminPermissionRole.SUPER_ADMIN, AdminPermissionRole.SUPPORT],
      scope: { categoryId },
    })
    if (!okCategory) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const minPrice = minPriceRaw ?? '0'

    const created = await prisma.service.create({
      data: {
        name,
        categoryId,
        description,
        defaultDurationMinutes,
        minPrice,
        defaultImageUrl,
        allowMobile,
        isActive: true,
      },
      select: { id: true, name: true },
    })

    await prisma.adminActionLog
      .create({
        data: {
          adminUserId: user.id,
          serviceId: created.id,
          categoryId,
          action: 'SERVICE_CREATED',
          note: created.name,
        },
      })
      .catch(() => null)

    return NextResponse.json({ ok: true, service: created }, { status: 201 })
  } catch (e) {
    console.error('POST /api/admin/services error', e)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
