// app/api/pro/bookings/[id]/consultation-services/route.ts
import { prisma } from '@/lib/prisma'
import { jsonFail, jsonOk, pickString, requirePro } from '@/app/api/_utils'
import { Prisma } from '@prisma/client'

export const dynamic = 'force-dynamic'

type Ctx = { params: { id: string } | Promise<{ id: string }> }

type ServiceDTO = {
  offeringId: string
  serviceId: string
  serviceName: string
  categoryName: string | null
  defaultPrice: number | null
}

function hasToString(x: unknown): x is { toString(): string } {
  return typeof x === 'object' && x !== null && 'toString' in x && typeof (x as { toString?: unknown }).toString === 'function'
}

/**
 * Accept only:
 * - Prisma.Decimal
 * - number
 * - string (numeric)
 *
 * Anything else => null.
 */
function decimalToNumber(v: unknown): number | null {
  if (v == null) return null

  if (typeof v === 'number') return Number.isFinite(v) ? v : null

  if (typeof v === 'string') {
    const n = Number(v.trim())
    return Number.isFinite(n) ? n : null
  }

  // Prisma.Decimal falls here (and other objects with toString)
  if (hasToString(v)) {
    const s = v.toString()
    const n = Number(s)
    return Number.isFinite(n) ? n : null
  }

  return null
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

export async function GET(_req: Request, ctx: Ctx) {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res
    const proId = auth.professionalId

    const params = await Promise.resolve(ctx.params)
    const bookingId = pickString(params?.id)
    if (!bookingId) return jsonFail(400, 'Missing booking id.')

    // ✅ Booking ownership check (pro must own this booking)
    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      select: { id: true, professionalId: true },
    })
    if (!booking) return jsonFail(404, 'Booking not found.')
    if (booking.professionalId !== proId) return jsonFail(403, 'Forbidden.')

    // ✅ Return pro's active offerings + base service info
    // Avoid nested orderBy to keep Prisma compatibility stable.
    const offerings = await prisma.professionalServiceOffering.findMany({
      where: {
        professionalId: proId,
        isActive: true,
        service: { isActive: true },
      },
      orderBy: [{ createdAt: 'asc' }],
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
      const defaultPriceRaw: Prisma.Decimal | null =
        o.salonPriceStartingAt ?? o.mobilePriceStartingAt ?? null

      const defaultPriceNum = decimalToNumber(defaultPriceRaw)

      return {
        offeringId: o.id,
        serviceId: o.serviceId,
        serviceName: o.service?.name ?? 'Service',
        categoryName: o.service?.category?.name ?? null,
        defaultPrice: defaultPriceNum == null ? null : round2(defaultPriceNum),
      }
    })

    // ✅ Canonical stable ordering (don’t trust DB ordering)
    services.sort((a, b) => {
      const ca = (a.categoryName ?? '').toLowerCase()
      const cb = (b.categoryName ?? '').toLowerCase()
      if (ca < cb) return -1
      if (ca > cb) return 1

      const sa = a.serviceName.toLowerCase()
      const sb = b.serviceName.toLowerCase()
      if (sa < sb) return -1
      if (sa > sb) return 1

      return a.offeringId < b.offeringId ? -1 : a.offeringId > b.offeringId ? 1 : 0
    })

    return jsonOk({ services }, 200)
  } catch (e) {
    console.error('GET /api/pro/bookings/[id]/consultation-services error', e)
    return jsonFail(500, 'Internal server error')
  }
}