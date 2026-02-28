// app/api/admin/services/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireUser } from '@/app/api/_utils/auth/requireUser'
import { AdminPermissionRole } from '@prisma/client'
import { hasAdminPermission } from '@/lib/adminPermissions'
import { pickBool, pickInt, pickMethod, pickString } from '@/app/api/_utils/pick'
import { parseMoney } from '@/lib/money'
import { jsonFail, jsonOk } from '@/app/api/_utils/responses'
import type { Prisma } from '@prisma/client'

export const dynamic = 'force-dynamic'

async function requireSupport(userId: string) {
  return hasAdminPermission({
    adminUserId: userId,
    allowedRoles: [AdminPermissionRole.SUPER_ADMIN, AdminPermissionRole.SUPPORT],
  })
}

function wantsJson(req: NextRequest) {
  const url = new URL(req.url)
  if (url.searchParams.get('format') === 'json') return true

  const accept = req.headers.get('accept') || ''
  if (accept.includes('application/json')) return true

  return false
}

function isPositiveInt(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n) && Math.trunc(n) === n && n > 0
}

export async function GET() {
  try {
    const auth = await requireUser({ roles: ['ADMIN'] })
    if (!auth.ok) return auth.res
    const user = auth.user

    const ok = await requireSupport(user.id)
    if (!ok) return jsonFail(403, 'Forbidden')

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

    return jsonOk({ services }, 200)
  } catch (e) {
    console.error('GET /api/admin/services error', e)
    return jsonFail(500, 'Internal server error')
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireUser({ roles: ['ADMIN'] })
    if (!auth.ok) return auth.res
    const user = auth.user

    const ok = await requireSupport(user.id)
    if (!ok) return jsonFail(403, 'Forbidden')

    const form = await req.formData()
    const method = (pickMethod(form.get('_method')) ?? 'POST').toUpperCase()
    if (method !== 'POST') return jsonFail(400, 'Unsupported operation.')

    const name = (pickString(form.get('name')) ?? '').trim()
    const categoryId = (pickString(form.get('categoryId')) ?? '').trim()

    const defaultDurationMinutes = pickInt(form.get('defaultDurationMinutes')) ?? 60
    const minPriceRaw = (pickString(form.get('minPrice')) ?? '').trim()

    const allowMobile = pickBool(form.get('allowMobile')) ?? false
    const description = (pickString(form.get('description')) ?? '').trim()

    const defaultImageUrlRaw = (pickString(form.get('defaultImageUrl')) ?? '').trim()
    const defaultImageUrl = defaultImageUrlRaw ? defaultImageUrlRaw : null

    const isAddOnEligible = pickBool(form.get('isAddOnEligible')) ?? false
    const addOnGroupRaw = (pickString(form.get('addOnGroup')) ?? '').trim()
    const addOnGroup = addOnGroupRaw ? addOnGroupRaw : null

    if (!name || !categoryId) {
      return jsonFail(400, 'Missing name or categoryId.')
    }

    if (!isPositiveInt(defaultDurationMinutes)) {
      return jsonFail(400, 'Invalid defaultDurationMinutes')
    }

    // Scope check: must be allowed in this category
    const okCategory = await hasAdminPermission({
      adminUserId: user.id,
      allowedRoles: [AdminPermissionRole.SUPER_ADMIN, AdminPermissionRole.SUPPORT],
      scope: { categoryId },
    })
    if (!okCategory) return jsonFail(403, 'Forbidden')

    // ✅ Prisma Decimal, not number
    let minPrice: Prisma.Decimal
    try {
      minPrice = parseMoney(minPriceRaw || '0')
    } catch {
      return jsonFail(400, 'Invalid minPrice. Use e.g. 45 or 45.00')
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
        isAddOnEligible,
        addOnGroup,
      },
      select: { id: true, name: true, categoryId: true },
    })

    await prisma.adminActionLog
      .create({
        data: {
          adminUserId: user.id,
          serviceId: created.id,
          categoryId: created.categoryId,
          action: 'SERVICE_CREATED',
          note: created.name,
        },
      })
      .catch(() => null)

    if (wantsJson(req)) {
      return jsonOk({ id: String(created.id), name: created.name }, 200)
    }

    return NextResponse.redirect(new URL(`/admin/services/${encodeURIComponent(String(created.id))}`, req.url), {
      status: 303,
    })
  } catch (e) {
    console.error('POST /api/admin/services error', e)
    return jsonFail(500, 'Internal server error')
  }
}