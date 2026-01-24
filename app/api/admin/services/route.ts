// app/api/admin/services/route.ts

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireUser } from '@/app/api/_utils/auth/requireUser'
import { AdminPermissionRole } from '@prisma/client'
import { hasAdminPermission } from '@/lib/adminPermissions'
import { pickBool, pickInt, pickMethod, pickString } from '@/app/api/_utils/pick'
import { parseMoney } from '@/lib/money'

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
        defaultImageUrl: true,
        isAddOnEligible: true,
        addOnGroup: true,
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
    const { user, res } = await requireUser({ roles: ['ADMIN'] as any })
    if (res) return res

    const ok = await requireSupport(user.id)
    if (!ok) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const form = await req.formData()
    const method = (pickMethod(form.get('_method')) ?? 'POST').toUpperCase()
    if (method !== 'POST') return NextResponse.json({ error: 'Unsupported operation.' }, { status: 400 })

    const name = (pickString(form.get('name')) ?? '').trim()
    const categoryId = (pickString(form.get('categoryId')) ?? '').trim()

    const defaultDurationMinutes = pickInt(form.get('defaultDurationMinutes')) ?? 60
    const minPriceRaw = (pickString(form.get('minPrice')) ?? '').trim()

    const allowMobile = pickBool(form.get('allowMobile')) ?? false
    const description = (pickString(form.get('description')) ?? '').trim()

    const defaultImageUrlRaw = (pickString(form.get('defaultImageUrl')) ?? '').trim()
    const defaultImageUrl = defaultImageUrlRaw || null

    // ✅ NEW add-on fields
    const isAddOnEligible = pickBool(form.get('isAddOnEligible')) ?? false
    const addOnGroupRaw = (pickString(form.get('addOnGroup')) ?? '').trim()
    const addOnGroup = addOnGroupRaw || null

    if (!name || !categoryId) {
      return NextResponse.json({ error: 'Missing name or categoryId.' }, { status: 400 })
    }

    const okCategory = await hasAdminPermission({
      adminUserId: user.id,
      allowedRoles: [AdminPermissionRole.SUPER_ADMIN, AdminPermissionRole.SUPPORT],
      scope: { categoryId },
    })
    if (!okCategory) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    let minPrice
    try {
      minPrice = parseMoney(minPriceRaw || '0')
    } catch {
      return NextResponse.json({ error: 'Invalid minPrice. Use e.g. 45 or 45.00' }, { status: 400 })
    }

    const created = await prisma.service.create({
      data: {
        name,
        categoryId,
        description: description || null,
        defaultDurationMinutes,
        minPrice,
        defaultImageUrl,
        allowMobile,
        isActive: true,

        // ✅ NEW
        isAddOnEligible,
        addOnGroup,
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
