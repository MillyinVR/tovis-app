// app/api/admin/services/[id]/permissions/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'
import { ProfessionType } from '@prisma/client'

export const dynamic = 'force-dynamic'

function pickString(v: FormDataEntryValue | null) {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await getCurrentUser().catch(() => null)
    if (!user || user.role !== 'ADMIN') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { id } = await context.params
    if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

    const form = await req.formData()

    const stateCodeRaw = pickString(form.get('stateCode'))
    const stateCode = stateCodeRaw ? stateCodeRaw.toUpperCase().slice(0, 2) : null

    const selected = form.getAll('professionType').map((v) => String(v))
    const allowed = new Set(Object.values(ProfessionType))
    const professionTypes = selected.filter((v) => allowed.has(v as any)) as ProfessionType[]

    await prisma.$transaction(async (tx) => {
      await tx.servicePermission.deleteMany({ where: { serviceId: id } })

      if (professionTypes.length) {
        await tx.servicePermission.createMany({
          data: professionTypes.map((pt) => ({
            serviceId: id,
            professionType: pt,
            stateCode,
          })),
        })
      }
    })

    return NextResponse.redirect(new URL(`/admin/services/${encodeURIComponent(id)}`, req.url))
  } catch (e) {
    console.error('POST /api/admin/services/[id]/permissions error', e)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
