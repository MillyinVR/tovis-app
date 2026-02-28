// app/api/admin/services/[id]/permissions/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireUser } from '@/app/api/_utils/auth/requireUser'
import { requireAdminPermission } from '@/app/api/_utils/auth/requireAdminPermission'
import { pickStateCode } from '@/app/api/_utils/pick'
import { AdminPermissionRole, ProfessionType } from '@prisma/client'

export const dynamic = 'force-dynamic'

type Params = { id: string }
type Ctx = { params: Params | Promise<Params> }

async function getParams(ctx: Ctx): Promise<Params> {
  return await Promise.resolve(ctx.params)
}

function trimId(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

function normalizeProfessionTypes(values: FormDataEntryValue[]): ProfessionType[] {
  const allowed = new Set(Object.values(ProfessionType))
  const out: ProfessionType[] = []

  for (const v of values) {
    const s = String(v).trim()
    if (allowed.has(s as ProfessionType)) out.push(s as ProfessionType)
  }

  // de-dupe while preserving order
  return Array.from(new Set(out))
}

export async function POST(req: NextRequest, ctx: Ctx) {
  try {
    const auth = await requireUser({ roles: ['ADMIN'] })
    if (!auth.ok) return auth.res
    const user = auth.user

    const { id } = await getParams(ctx)
    const serviceId = trimId(id)
    if (!serviceId) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

    const svc = await prisma.service.findUnique({
      where: { id: serviceId },
      select: { id: true, categoryId: true },
    })
    if (!svc) return NextResponse.json({ error: 'Service not found' }, { status: 404 })

    const perm = await requireAdminPermission({
      adminUserId: user.id,
      allowedRoles: [AdminPermissionRole.SUPER_ADMIN, AdminPermissionRole.SUPPORT],
      scope: { serviceId: svc.id, categoryId: svc.categoryId },
    })
    if (!perm.ok) return perm.res

    const form = await req.formData()

    // should return null or something like 'CA'
    const stateCode = pickStateCode(form.get('stateCode'))
    const professionTypes = normalizeProfessionTypes(form.getAll('professionType'))

    await prisma.$transaction(async (tx) => {
      await tx.servicePermission.deleteMany({ where: { serviceId: svc.id } })

      // If none checked, this clears permissions (valid)
      if (professionTypes.length) {
        await tx.servicePermission.createMany({
          data: professionTypes.map((pt) => ({
            serviceId: svc.id,
            professionType: pt,
            stateCode,
          })),
          skipDuplicates: true,
        })
      }
    })

    return NextResponse.redirect(new URL(`/admin/services/${encodeURIComponent(svc.id)}`, req.url), { status: 303 })
  } catch (e) {
    console.error('POST /api/admin/services/[id]/permissions error', e)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}