// app/api/pro/bookings/[id]/consultation-services/route.ts
import { prisma } from '@/lib/prisma'
import { jsonFail, jsonOk, pickString, requirePro } from '@/app/api/_utils'

export const dynamic = 'force-dynamic'

type Ctx = { params: { id: string } | Promise<{ id: string }> }

type ServiceDTO = {
  offeringId: string
  serviceId: string
  serviceName: string
  categoryName: string | null
  defaultPrice: number | null
}

function decimalToNumber(v: unknown): number | null {
  if (v == null) return null

  // Prisma Decimal usually has toString()
  const s = (v as any)?.toString?.()
  if (typeof s === 'string') {
    const n = Number(s)
    return Number.isFinite(n) ? n : null
  }

  // Fallback
  const n = Number(v as any)
  return Number.isFinite(n) ? n : null
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

function stableString(v: unknown): string {
  return typeof v === 'string' ? v : String(v ?? '')
}

export async function GET(_req: Request, ctx: Ctx) {
  try {
    const auth = await requirePro()
    if (auth.res) return auth.res
    const proId = auth.professionalId

    const { id } = await Promise.resolve(ctx.params)
    const bookingId = pickString(id)
    if (!bookingId) return jsonFail(400, 'Missing booking id.')

    // ✅ Booking ownership check (pro must own this booking)
    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      select: { id: true, professionalId: true },
    })
    if (!booking) return jsonFail(404, 'Booking not found.')
    if (booking.professionalId !== proId) return jsonFail(403, 'Forbidden.')

    // ✅ Return pro's active offerings + base service info
    // Note: nested orderBy is Prisma-version sensitive, but if it compiles for you, it’s great.
    const offerings = await prisma.professionalServiceOffering.findMany({
      where: {
        professionalId: proId,
        isActive: true,
        service: { isActive: true },
      },
      orderBy: [
        { service: { category: { name: 'asc' } } },
        { service: { name: 'asc' } },
        { createdAt: 'asc' },
      ],
      select: {
        id: true, // offeringId
        serviceId: true,
        service: {
          select: {
            name: true,
            category: { select: { name: true } },
          },
        },
        salonPriceStartingAt: true,
        mobilePriceStartingAt: true,
      },
      take: 500,
    })

    const services: ServiceDTO[] = offerings.map((o) => {
      const defaultPriceRaw = o.salonPriceStartingAt ?? o.mobilePriceStartingAt ?? null
      const defaultPriceNum = decimalToNumber(defaultPriceRaw)

      return {
        offeringId: stableString(o.id),
        serviceId: stableString(o.serviceId),
        serviceName: o.service?.name ?? 'Service',
        categoryName: o.service?.category?.name ?? null,
        defaultPrice: defaultPriceNum == null ? null : round2(defaultPriceNum),
      }
    })

    // Extra safety: stable sort in case DB order changes or Prisma ignores nested sort in some env.
    services.sort((a, b) => {
      const ca = (a.categoryName ?? '').toLowerCase()
      const cb = (b.categoryName ?? '').toLowerCase()
      if (ca < cb) return -1
      if (ca > cb) return 1

      const sa = a.serviceName.toLowerCase()
      const sb = b.serviceName.toLowerCase()
      if (sa < sb) return -1
      if (sa > sb) return 1

      // keep offeringId tie-breaker stable
      return a.offeringId < b.offeringId ? -1 : a.offeringId > b.offeringId ? 1 : 0
    })

    return jsonOk({ services })
  } catch (e) {
    console.error('GET /api/pro/bookings/[id]/consultation-services error', e)
    return jsonFail(500, 'Internal server error')
  }
}