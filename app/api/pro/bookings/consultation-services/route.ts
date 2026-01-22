// app/api/pro/bookings/consultation-services/route.ts
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'
import { moneyToFixed2String } from '@/lib/money'

export const dynamic = 'force-dynamic'

export async function GET(_req: Request) {
  try {
    const user = await getCurrentUser().catch(() => null)
    const proId = user?.role === 'PRO' ? user.professionalProfile?.id : null
    if (!proId) {
      return NextResponse.json({ error: 'Not authorized' }, { status: 401 })
    }

    const offerings = await prisma.professionalServiceOffering.findMany({
      where: {
        professionalId: proId,
      } as any,
      orderBy: [{ service: { name: 'asc' } }],
      select: {
        id: true,
        serviceId: true,
        price: true as any,
        service: {
          select: {
            id: true,
            name: true,
            minPrice: true,
            category: { select: { id: true, name: true } },
          },
        },
      } as any,
      take: 500,
    })

    const services = offerings
      .map((o: any) => {
        const svc = o.service
        const priceCandidate = o.price ?? svc?.minPrice ?? null

        return {
          offeringId: String(o.id),
          serviceId: String(o.serviceId ?? svc?.id ?? ''),
          serviceName: svc?.name ?? 'Service',
          categoryName: svc?.category?.name ?? null,

          // ✅ consistent
          defaultPrice: priceCandidate == null ? null : moneyToFixed2String(priceCandidate),
        }
      })
      .filter((x) => x.serviceId)

    return NextResponse.json({ ok: true, services }, { status: 200 })
  } catch (e) {
    console.error('GET /api/pro/bookings/consultation-services error:', e)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
