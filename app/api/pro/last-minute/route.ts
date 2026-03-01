// app/api/pro/last-minute/route.ts
import { prisma } from '@/lib/prisma'
import type { ServiceLocationType, Prisma } from '@prisma/client'
import { jsonFail, jsonOk, pickString, requirePro, upper } from '@/app/api/_utils'
import { computeLastMinuteDiscount } from '@/lib/lastMinutePricing'
import { parseMoney } from '@/lib/money'

export const dynamic = 'force-dynamic'

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

async function readJsonObject(req: Request): Promise<Record<string, unknown>> {
  const raw: unknown = await req.json().catch(() => ({}))
  return isRecord(raw) ? raw : {}
}

function normalizeLocationType(v: unknown): ServiceLocationType {
  const s = upper(v)
  return s === 'MOBILE' ? 'MOBILE' : 'SALON'
}

function pickBasePriceFromBooking(booking: { subtotalSnapshot: Prisma.Decimal }): number {
  // subtotalSnapshot is Decimal(10,2) in your schema
  const n = Number(booking.subtotalSnapshot.toString())
  return Number.isFinite(n) ? n : 0
}

export async function POST(req: Request) {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res
    const professionalId = auth.professionalId

    const body = await readJsonObject(req)

    const bookingId = pickString(body.bookingId)
    const offeringIdOverride = pickString(body.offeringId)
    const locationTypeFallback = normalizeLocationType(body.locationType)

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
        locationTimeZone: true,
        subtotalSnapshot: true,
        discountAmount: true,
      },
    })

    if (!booking || booking.professionalId !== professionalId) {
      return jsonFail(404, 'Booking not found.')
    }

    const effectiveLocationType: ServiceLocationType = booking.locationType ?? locationTypeFallback

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
      },
    })

    if (!offering) return jsonFail(404, 'Offering not found or inactive.')

    if (effectiveLocationType === 'SALON' && !offering.offersInSalon) {
      return jsonFail(400, 'This offering is not available in-salon.')
    }
    if (effectiveLocationType === 'MOBILE' && !offering.offersMobile) {
      return jsonFail(400, 'This offering is not available as mobile.')
    }

    // ✅ Pricing truth for discount is based on booking snapshot (immutable)
    const basePrice = pickBasePriceFromBooking(booking)

    // ✅ Timezone truth should come from booking.locationTimeZone (snapshot) if present.
    // If null, computeLastMinuteDiscount will still work but SAME_DAY boundaries may be “UTC-ish”.
    const tz = typeof booking.locationTimeZone === 'string' ? booking.locationTimeZone.trim() : ''
    const timeZone = tz || 'UTC'

    const discount = await computeLastMinuteDiscount({
      professionalId: offering.professionalId,
      serviceId: offering.serviceId,
      scheduledFor: booking.scheduledFor,
      basePrice,
      timeZone,
    })

    // ✅ discountAmount stored as Decimal? per schema
    const discountAmountDecimal = parseMoney(discount.discountAmount)

    await prisma.booking.update({
      where: { id: booking.id },
      data: {
        discountAmount: discountAmountDecimal,
      },
      select: { id: true },
    })

    return jsonOk(
      {
        bookingId: booking.id,
        basePrice,
        discount,
      },
      200,
    )
  } catch (e) {
    console.error('POST /api/pro/last-minute error', e)
    return jsonFail(500, 'Internal server error')
  }
}