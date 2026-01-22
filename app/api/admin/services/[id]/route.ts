// app/api/admin/services/[id]/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireUser } from '@/app/api/_utils/auth/requireUser'
import { AdminPermissionRole } from '@prisma/client'
import { hasAdminPermission } from '@/lib/adminPermissions'
import { pickInt, pickMethod, pickString } from '@/app/api/_utils/pick'

export const dynamic = 'force-dynamic'

type Params = { id: string }
type Ctx = { params: Params | Promise<Params> }

async function getParams(ctx: Ctx): Promise<Params> {
  return await Promise.resolve(ctx.params)
}

function trimId(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

function parseBoolString(v: unknown): boolean | null {
  const s = typeof v === 'string' ? v.trim().toLowerCase() : ''
  if (s === 'true') return true
  if (s === 'false') return false
  return null
}

export async function POST(req: NextRequest, ctx: Ctx) {
  try {
    const { user, res } = await requireUser({ roles: ['ADMIN'] as any })
    if (res) return res

    const { id } = await getParams(ctx)
    const serviceId = trimId(id)
    if (!serviceId) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

    const svc = await prisma.service.findUnique({
      where: { id: serviceId },
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
    const method = pickMethod(form.get('_method'))
    if (method !== 'PATCH') return NextResponse.json({ error: 'Unsupported' }, { status: 400 })

    // ---- toggle only (fast path) ----
    const isActive = parseBoolString(pickString(form.get('isActive')))
    if (isActive !== null) {
      await prisma.service.update({
        where: { id: svc.id },
        data: { isActive },
      })

      await prisma.adminActionLog
        .create({
          data: {
            adminUserId: user.id,
            serviceId: svc.id,
            categoryId: svc.categoryId,
            action: 'SERVICE_TOGGLED',
            note: `isActive=${isActive}`,
          },
        })
        .catch(() => null)

      return NextResponse.redirect(new URL('/admin/services', req.url))
    }

    // ---- full edit ----
    const name = pickString(form.get('name'))
    const categoryId = pickString(form.get('categoryId'))
    const defaultDurationMinutes = pickInt(form.get('defaultDurationMinutes'))
    const minPrice = pickString(form.get('minPrice'))
    const description = pickString(form.get('description'))
    const allowMobile = parseBoolString(pickString(form.get('allowMobile'))) ?? false

    if (!name || !categoryId || !defaultDurationMinutes || !minPrice) {
      return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
    }

    // extra guard: if moving categories, must have permission for the *new* category too
    const okNewCategory = await hasAdminPermission({
      adminUserId: user.id,
      allowedRoles: [AdminPermissionRole.SUPER_ADMIN, AdminPermissionRole.SUPPORT],
      scope: { categoryId },
    })
    if (!okNewCategory) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    await prisma.service.update({
      where: { id: svc.id },
      data: {
        name,
        categoryId,
        defaultDurationMinutes,
        minPrice,
        description,
        allowMobile,
      } as any,
    })

    await prisma.adminActionLog
      .create({
        data: {
          adminUserId: user.id,
          serviceId: svc.id,
          categoryId,
          action: 'SERVICE_UPDATED',
          note: name,
        },
      })
      .catch(() => null)

    return NextResponse.redirect(new URL(`/admin/services/${encodeURIComponent(svc.id)}`, req.url))
  } catch (e) {
    console.error('POST /api/admin/services/[id] error', e)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
