// app/api/pro/allowed-services/route.ts
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { moneyToString } from '@/lib/money'
import { requirePro } from '@/app/api/_utils'

export const dynamic = 'force-dynamic'

function toDto(svc: any) {
  return {
    id: svc.id,
    name: svc.name,
    description: svc.description,
    categoryName: svc.category?.name ?? null,
    categoryDescription: svc.category?.description ?? null,
    defaultDurationMinutes: svc.defaultDurationMinutes,
    minPrice: moneyToString(svc.minPrice),
    allowMobile: svc.allowMobile,
  }
}

export async function GET() {
  try {
    const auth = await requirePro()
    if (auth.res) return auth.res

    // ✅ Current schema: no professionType/licenseState on professionalProfile
    // So we can’t filter by ServicePermission reliably.
    // Return all active services (safe default).
    const services = await prisma.service.findMany({
      where: { isActive: true },
      include: { category: true },
      orderBy: { name: 'asc' },
      take: 2000,
    })

    return NextResponse.json(services.map(toDto), { status: 200 })
  } catch (error) {
    console.error('Allowed services error', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
