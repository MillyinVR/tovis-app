import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'

export const dynamic = 'force-dynamic'

function toNumber(v: unknown): number | null {
  if (v == null) return null
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'string') {
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }
  // Prisma Decimal (best-effort)
  const s = (v as any)?.toString?.()
  if (typeof s === 'string') {
    const n = Number(s)
    return Number.isFinite(n) ? n : null
  }
  return null
}

export async function GET(_req: Request) {
  try {
    const user = await getCurrentUser().catch(() => null)
    const proId = user?.role === 'PRO' ? user.professionalProfile?.id : null
    if (!proId) {
      return NextResponse.json({ error: 'Not authorized' }, { status: 401 })
    }

    // Pull the pro’s offered services
    // This assumes ProfessionalServiceOffering has: id, professionalId, serviceId, (optional) price
    // and Service has: id, name, minPrice, category relation (optional), isActive (optional)
    const offerings = await prisma.professionalServiceOffering.findMany({
      where: {
        professionalId: proId,
        // If you have these flags, keep them. If not, delete them.
        // isActive: true,
        service: {
          // isActive: true,
        },
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
        const defaultPrice =
          toNumber(o.price) ??
          toNumber(svc?.minPrice) ??
          null

        return {
          offeringId: String(o.id),
          serviceId: String(o.serviceId ?? svc?.id ?? ''),
          serviceName: svc?.name ?? 'Service',
          categoryName: svc?.category?.name ?? null,
          defaultPrice: defaultPrice != null ? Math.round(defaultPrice * 100) / 100 : null,
        }
      })
      .filter((x) => x.serviceId)

    return NextResponse.json({ ok: true, services }, { status: 200 })
  } catch (e) {
    console.error('GET /api/pro/bookings/consultation-services error:', e)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
