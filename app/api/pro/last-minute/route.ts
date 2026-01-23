// app/api/pro/last-minute/route.ts
import { prisma } from '@/lib/prisma'
import type { ServiceLocationType } from '@prisma/client'
import { jsonFail, jsonOk, pickString, requirePro, upper } from '@/app/api/_utils'
import { moneyToFixed2String } from '@/lib/money'

export const dynamic = 'force-dynamic'

function normalizeProId(auth: any): string | null {
  const id =
    (typeof auth?.professionalId === 'string' && auth.professionalId.trim()) ||
    (typeof auth?.proId === 'string' && auth.proId.trim()) ||
    null
  return id ? id.trim() : null
}

function normalizeLocationType(v: unknown): ServiceLocationType {
  const s = upper(v)
  return s === 'MOBILE' ? 'MOBILE' : 'SALON'
}

function decimalishToNumber(v: unknown): number | null {
  const fixed = moneyToFixed2String(v as any)
  if (!fixed) return null
  const n = Number(fixed)
  return Number.isFinite(n) ? n : null
}

function pickBasePrice(args: {
  locationType: ServiceLocationType
  offering: { salonPriceStartingAt: unknown | null; mobilePriceStartingAt: unknown | null }
  serviceMinPrice: unknown
}) {
  const offeringPrice =
    args.locationType === 'MOBILE'
      ? decimalishToNumber(args.offering.mobilePriceStartingAt)
      : decimalishToNumber(args.offering.salonPriceStartingAt)

  if (offeringPrice != null) return offeringPrice

  const serviceMin = decimalishToNumber(args.serviceMinPrice)
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

    const professionalId = normalizeProId(auth)
    if (!professionalId) return jsonFail(401, 'Unauthorized.')

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

    await prisma.booking.update({
      where: { id: booking.id },
      data: {
        // Keep as-is; your schema may be Float or Decimal. If Decimal, prisma can usually coerce numeric.
        discountAmount: discount.discountAmount ? discount.discountAmount : undefined,
      } as any,
      select: { id: true },
    })

    return jsonOk({ bookingId: booking.id, basePrice, discount }, 200)
  } catch (e) {
    console.error('POST /api/pro/last-minute error', e)
    return jsonFail(500, 'Internal server error')
  }
}
