// app/api/pro/bookings/[id]/consultation-services/route.ts
import { prisma } from '@/lib/prisma'
import { jsonFail, jsonOk, pickString, requirePro } from '@/app/api/_utils'

export const dynamic = 'force-dynamic'

type Ctx = { params: { id: string } | Promise<{ id: string }> }

function decimalToNumber(v: unknown): number | null {
  if (v == null) return null
  // Prisma Decimal usually has toString()
  const s = (v as any)?.toString?.()
  if (typeof s === 'string') {
    const n = Number(s)
    return Number.isFinite(n) ? n : null
  }
  // fallback
  const n = Number(v as any)
  return Number.isFinite(n) ? n : null
}

export async function GET(_req: Request, ctx: Ctx) {
  try {
    const auth = await requirePro()
    if (auth.res) return auth.res
    const proId = auth.professionalId

    const { id } = await Promise.resolve(ctx.params)
    const bookingId = pickString(id)
    if (!bookingId) return jsonFail(400, 'Missing booking id.')

    // ✅ booking ownership check (pro must own this booking)
    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      select: { id: true, professionalId: true },
    })
    if (!booking) return jsonFail(404, 'Booking not found.')
    if (booking.professionalId !== proId) return jsonFail(403, 'Forbidden.')

    // ✅ return pro's active offerings + base service info
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

    const services = offerings.map((o) => {
      const defaultPriceRaw = o.salonPriceStartingAt ?? o.mobilePriceStartingAt ?? null
      const defaultPrice = decimalToNumber(defaultPriceRaw)

      return {
        offeringId: o.id,
        serviceId: o.serviceId,
        serviceName: o.service.name,
        categoryName: o.service.category?.name ?? null,
        defaultPrice,
      }
    })

    return jsonOk({ services })
  } catch (e) {
    console.error('GET /api/pro/bookings/[id]/consultation-services error', e)
    return jsonFail(500, 'Internal server error')
  }
}
