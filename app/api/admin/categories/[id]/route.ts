// app/api/admin/categories/[id]/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireUser } from '@/app/api/_utils/auth/requireUser'
import { requireAdminPermission } from '@/app/api/_utils/auth/requireAdminPermission'
import { jsonFail } from '@/app/api/_utils'
import { pickMethod, pickString } from '@/app/api/_utils/pick'
import { AdminPermissionRole, Role } from '@prisma/client'

export const dynamic = 'force-dynamic'

type Params = { id: string }
type Ctx = { params: Params | Promise<Params> }

async function getParams(ctx: Ctx): Promise<Params> {
  return await Promise.resolve(ctx.params)
}

function trimId(v: unknown) {
  return typeof v === 'string' ? v.trim() : ''
}

export async function POST(req: NextRequest, ctx: Ctx) {
  try {
    const auth = await requireUser({ roles: [Role.ADMIN] })
    if (!auth.ok) return auth.res
    const user = auth.user

    const { id } = await getParams(ctx)
    const categoryId = trimId(id)
    if (!categoryId) return jsonFail(400, 'Missing id')

    const perm = await requireAdminPermission({
      adminUserId: user.id,
      allowedRoles: [AdminPermissionRole.SUPER_ADMIN, AdminPermissionRole.SUPPORT],
      scope: { categoryId },
    })
    if (!perm.ok) return perm.res

    const form = await req.formData()
    const method = pickMethod(form.get('_method'))
    if (method !== 'PATCH') return jsonFail(400, 'Unsupported')

    // HTML forms send strings. We only accept explicit true/false.
    const isActiveRaw = pickString(form.get('isActive'))?.toLowerCase() ?? ''
    if (isActiveRaw !== 'true' && isActiveRaw !== 'false') {
      return jsonFail(400, 'Invalid isActive (expected true/false)')
    }
    const isActive = isActiveRaw === 'true'

    const updated = await prisma.serviceCategory.update({
      where: { id: categoryId },
      data: { isActive },
      select: { id: true, name: true, slug: true, isActive: true },
    })

    await prisma.adminActionLog
      .create({
        data: {
          adminUserId: user.id,
          categoryId: updated.id,
          action: 'CATEGORY_TOGGLED',
          note: `${updated.name} (${updated.slug}) -> ${updated.isActive ? 'ENABLED' : 'DISABLED'}`,
        },
      })
      .catch(() => null)

    // ✅ 303 for form navigation (PRG pattern)
    return NextResponse.redirect(new URL('/admin/categories', req.url), { status: 303 })
  } catch (err: unknown) {
    console.error('POST /api/admin/categories/[id] error', err)
    const message = err instanceof Error ? err.message : 'Internal server error'
    return jsonFail(500, message)
  }
}