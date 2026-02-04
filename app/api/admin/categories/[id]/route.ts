// app/api/admin/categories/[id]/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireUser } from '@/app/api/_utils/auth/requireUser'
import { requireAdminPermission } from '@/app/api/_utils/auth/requireAdminPermission'
import { pickMethod, pickString } from '@/app/api/_utils/pick'
import { AdminPermissionRole } from '@prisma/client'

export const dynamic = 'force-dynamic'

type Params = { id: string }
type Ctx = { params: Params | Promise<Params> }

async function getParams(ctx: Ctx): Promise<Params> {
  return await Promise.resolve(ctx.params)
}

export async function POST(req: NextRequest, ctx: Ctx) {
  try {
    const { user, res } = await requireUser({ roles: ['ADMIN'] as any })
    if (res) return res

    const { id } = await getParams(ctx)
    const categoryId = typeof id === 'string' ? id.trim() : ''
    if (!categoryId) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

    const perm = await requireAdminPermission({
      adminUserId: user.id,
      allowedRoles: [AdminPermissionRole.SUPER_ADMIN, AdminPermissionRole.SUPPORT],
      scope: { categoryId },
    })
    if (!perm.ok) return perm.res

    const form = await req.formData()
    const method = pickMethod(form.get('_method'))
    if (method !== 'PATCH') return NextResponse.json({ error: 'Unsupported' }, { status: 400 })

    const isActiveRaw = pickString(form.get('isActive'))
    const isActive = isActiveRaw === 'true'

    const updated = await prisma.serviceCategory.update({
      where: { id: categoryId },
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

    // ✅ 303 for form navigation
    return NextResponse.redirect(new URL('/admin/categories', req.url), { status: 303 })
  } catch (e) {
    console.error('POST /api/admin/categories/[id] error', e)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
