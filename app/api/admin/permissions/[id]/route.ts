// app/api/admin/permissions/[id]/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireUser } from '@/app/api/_utils/auth/requireUser'
import { requireAdminPermission } from '@/app/api/_utils/auth/requireAdminPermission'
import { pickMethod } from '@/app/api/_utils/pick'
import { AdminPermissionRole } from '@prisma/client'

export const dynamic = 'force-dynamic'

type Params = { id: string }
type Ctx = { params: Params | Promise<Params> }

async function getParams(ctx: Ctx): Promise<Params> {
  return await Promise.resolve(ctx.params)
}

function trimId(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

export async function POST(req: NextRequest, ctx: Ctx) {
  try {
    const { user, res } = await requireUser({ roles: ['ADMIN'] as any })
    if (res) return res

    const perm = await requireAdminPermission({
      adminUserId: user.id,
      allowedRoles: [AdminPermissionRole.SUPER_ADMIN],
    })
    if (!perm.ok) return perm.res

    const { id } = await getParams(ctx)
    const permissionId = trimId(id)
    if (!permissionId) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

    const form = await req.formData()
    const method = pickMethod(form.get('_method'))
    if (method !== 'DELETE') return NextResponse.json({ error: 'Unsupported' }, { status: 400 })

    const existing = await prisma.adminPermission.findUnique({
      where: { id: permissionId },
      select: {
        id: true,
        adminUserId: true,
        role: true,
        professionalId: true,
        serviceId: true,
        categoryId: true,
      },
    })

    // Idempotent UX: deleting something that’s already gone still “works”
    if (!existing) {
      return NextResponse.redirect(new URL('/admin/permissions', req.url))
    }

    await prisma.adminPermission.delete({ where: { id: permissionId } })

    // best-effort log (never fail request)
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
