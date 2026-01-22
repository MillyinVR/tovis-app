// app/api/pro/last-minute/route.ts
import { prisma } from '@/lib/prisma'
import type { ServiceLocationType } from '@prisma/client'
import { jsonFail, jsonOk, pickString, requirePro, upper } from '@/app/api/_utils'

// If you already have this, use your real import and delete the fallback below.
// import { computeLastMinuteDiscount } from '@/lib/lastMinute/computeLastMinuteDiscount'

export const dynamic = 'force-dynamic'

function normalizeLocationType(v: unknown): ServiceLocationType {
  const s = upper(v)
  return s === 'MOBILE' ? 'MOBILE' : 'SALON'
}

function toNumberFromDecimalish(v: unknown): number | null {
  if (v == null) return null
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'string') {
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }
  // Prisma Decimal: toNumber()
  const maybe: any = v
  if (typeof maybe?.toNumber === 'function') {
    const n = maybe.toNumber()
    return Number.isFinite(n) ? n : null
  }
  const n = Number(String(v))
  return Number.isFinite(n) ? n : null
}

function pickBasePrice(args: {
  locationType: ServiceLocationType
  offering: { salonPriceStartingAt: unknown | null; mobilePriceStartingAt: unknown | null }
  serviceMinPrice: unknown
}) {
  const offeringPrice =
    args.locationType === 'MOBILE'
      ? toNumberFromDecimalish(args.offering.mobilePriceStartingAt)
      : toNumberFromDecimalish(args.offering.salonPriceStartingAt)

  if (offeringPrice != null) return offeringPrice

  const serviceMin = toNumberFromDecimalish(args.serviceMinPrice)
  return serviceMin != null ? serviceMin : 0
}

// Fallback if you haven’t wired the real one yet.
async function computeLastMinuteDiscount(_args: {
  professionalId: string
  serviceId: string
  startAt: Date
  basePrice: number
}) {
  return { discountPct: 0, discountAmount: 0 }
}

export async function POST(req: Request) {
  try {
    const auth = await requirePro()
    if (auth.res) return auth.res
    const professionalId = auth.professionalId

    const body = (await req.json().catch(() => ({}))) as any
    const bookingId = pickString(body?.bookingId)
    const offeringIdOverride = pickString(body?.offeringId)
    const locationTypeFallback = normalizeLocationType(body?.locationType)

    if (!bookingId) return jsonFail(400, 'Missing bookingId.')

    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      select: {
        id: true,
        professionalId: true,
        serviceId: true,
        offeringId: true,
        scheduledFor: true,
        locationType: true,
        status: true,
      },
    })

    if (!booking || booking.professionalId !== professionalId) {
      return jsonFail(404, 'Booking not found.')
    }

    const effectiveLocationType: ServiceLocationType = (booking.locationType as any) ?? locationTypeFallback

    const offeringId = booking.offeringId ?? offeringIdOverride
    if (!offeringId) return jsonFail(400, 'Missing offeringId (booking has no offeringId).')

    const offering = await prisma.professionalServiceOffering.findFirst({
      where: { id: offeringId, professionalId, isActive: true },
      select: {
        id: true,
        professionalId: true,
        serviceId: true,
        offersInSalon: true,
        offersMobile: true,
        salonPriceStartingAt: true,
        mobilePriceStartingAt: true,
        service: { select: { minPrice: true } },
      },
    })

    if (!offering) return jsonFail(404, 'Offering not found or inactive.')

    if (effectiveLocationType === 'SALON' && !offering.offersInSalon) {
      return jsonFail(400, 'This offering is not available in-salon.')
    }
    if (effectiveLocationType === 'MOBILE' && !offering.offersMobile) {
      return jsonFail(400, 'This offering is not available as mobile.')
    }

    const basePrice = pickBasePrice({
      locationType: effectiveLocationType,
      offering: {
        salonPriceStartingAt: offering.salonPriceStartingAt,
        mobilePriceStartingAt: offering.mobilePriceStartingAt,
      },
      serviceMinPrice: offering.service.minPrice,
    })

    const discount = await computeLastMinuteDiscount({
      professionalId: offering.professionalId,
      serviceId: offering.serviceId,
      startAt: booking.scheduledFor,
      basePrice,
    })

    const updated = await prisma.booking.update({
      where: { id: booking.id },
      data: {
        // if your schema expects Decimal, you can store as number if field is Float,
        // or convert to Decimal string if field is Decimal.
        discountAmount: discount.discountAmount ? discount.discountAmount : undefined,
      } as any,
      select: { id: true },
    })

    return jsonOk({ bookingId: updated.id, basePrice, discount }, 200)
  } catch (e) {
    console.error('POST /api/pro/last-minute error', e)
    return jsonFail(500, 'Internal server error')
  }
}
