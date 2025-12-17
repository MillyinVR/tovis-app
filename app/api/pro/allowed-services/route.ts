// app/api/pro/allowed-services/route.ts
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'
import { moneyToString } from '@/lib/money'

function toDto(svc: any) {
  return {
    id: svc.id,
    name: svc.name,
    description: svc.description,
    categoryName: svc.category?.name ?? null,
    categoryDescription: svc.category?.description ?? null,
    defaultDurationMinutes: svc.defaultDurationMinutes,
    // ✅ Option A: dollars string (works now with Int cents OR later with Decimal)
    minPrice: moneyToString(svc.minPrice),
    allowMobile: svc.allowMobile,
  }
}

export async function GET() {
  try {
    const user = await getCurrentUser()

    if (!user || user.role !== 'PRO' || !user.professionalProfile) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const prof = user.professionalProfile

    // If we don't know their profession yet, return all active services for now
    if (!prof.professionType) {
      const services = await prisma.service.findMany({
        where: { isActive: true },
        include: { category: true },
        orderBy: { name: 'asc' },
      })

      return NextResponse.json(services.map(toDto), { status: 200 })
    }

    // Filter by ServicePermission (profession + optional state)
    const professionType = prof.professionType
    const stateCode = prof.licenseState ?? null

    const permissions = await prisma.servicePermission.findMany({
      where: {
        professionType,
        OR: [{ stateCode }, { stateCode: null }],
      },
      include: {
        service: {
          include: { category: true },
        },
      },
    })

    // Map + filter active + de-dupe
    const seen = new Set<string>()
    const uniqueServices = permissions
      .map((p) => p.service)
      .filter((svc) => svc.isActive)
      .filter((svc) => {
        if (seen.has(svc.id)) return false
        seen.add(svc.id)
        return true
      })

    return NextResponse.json(uniqueServices.map(toDto), { status: 200 })
  } catch (error) {
    console.error('Allowed services error', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
