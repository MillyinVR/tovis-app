// app/api/pro/last-minute/route.ts
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'
import type { ServiceLocationType } from '@prisma/client'

// If this lives elsewhere in your codebase, keep your import instead.
// import { computeLastMinuteDiscount } from '@/lib/lastMinute/computeLastMinuteDiscount'

export const dynamic = 'force-dynamic'

function pickString(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

function normalizeLocationType(v: unknown): ServiceLocationType {
  const s = typeof v === 'string' ? v.trim().toUpperCase() : ''
  return s === 'MOBILE' ? 'MOBILE' : 'SALON'
}

function toNumberFromDecimalish(v: any): number | null {
  if (v == null) return null
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'string') {
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }
  // Prisma Decimal has .toNumber()
  if (typeof v?.toNumber === 'function') {
    const n = v.toNumber()
    return Number.isFinite(n) ? n : null
  }
  try {
    const n = Number(String(v))
    return Number.isFinite(n) ? n : null
  } catch {
    return null
  }
}

function pickBasePrice(args: {
  locationType: ServiceLocationType
  offering: {
    salonPriceStartingAt: any | null
    mobilePriceStartingAt: any | null
  }
  service: {
    minPrice: any
  }
}) {
  const { locationType, offering, service } = args

  const offeringPrice =
    locationType === 'MOBILE'
      ? toNumberFromDecimalish(offering.mobilePriceStartingAt)
      : toNumberFromDecimalish(offering.salonPriceStartingAt)

  if (offeringPrice != null) return offeringPrice

  // fallback: service-wide minimum price
  const serviceMin = toNumberFromDecimalish(service.minPrice)
  return serviceMin != null ? serviceMin : 0
}

// NOTE: Replace this with your real discount function or keep your existing import.
// This stub keeps TypeScript happy if you paste the file as-is.
async function computeLastMinuteDiscount(args: {
  professionalId: string
  serviceId: string
  startAt: Date
  basePrice: number
}) {
  // return { discountPct: number, discountAmount: number }
  // You likely already have logic elsewhere; this is just a safe default.
  return { discountPct: 0, discountAmount: 0 }
}

export async function POST(req: Request) {
  try {
    const user = await getCurrentUser().catch(() => null)
    if (!user || user.role !== 'PRO' || !user.professionalProfile?.id) {
      return NextResponse.json({ error: 'Only professionals can access this.' }, { status: 401 })
    }

    const professionalId = user.professionalProfile.id

    const body = (await req.json().catch(() => ({}))) as any
    const bookingId = pickString(body?.bookingId)
    const offeringId = pickString(body?.offeringId) // optional: depends on how your UI calls this
    const locationType = normalizeLocationType(body?.locationType)

    // If your route creates last-minute openings or applies discount on acceptance,
    // you likely need bookingId. Keep this strict.
    if (!bookingId) {
      return NextResponse.json({ error: 'Missing bookingId.' }, { status: 400 })
    }

    // Load booking (must belong to this pro)
    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      select: {
        id: true,
        professionalId: true,
        serviceId: true,
        offeringId: true,
        scheduledFor: true,
        status: true,
        locationType: true,
      },
    })

    if (!booking || booking.professionalId !== professionalId) {
      return NextResponse.json({ error: 'Booking not found.' }, { status: 404 })
    }

    // Prefer the booking’s locationType if set (it is in your schema)
    const effectiveLocationType: ServiceLocationType = booking.locationType ?? locationType

    // Load offering + service for pricing
    const offering = await prisma.professionalServiceOffering.findFirst({
      where: {
        id: booking.offeringId ?? offeringId ?? undefined,
        professionalId,
        isActive: true,
      },
      select: {
        id: true,
        professionalId: true,
        serviceId: true,

        offersInSalon: true,
        offersMobile: true,
        salonPriceStartingAt: true,
        salonDurationMinutes: true,
        mobilePriceStartingAt: true,
        mobileDurationMinutes: true,

        service: {
          select: {
            id: true,
            name: true,
            categoryId: true,
            description: true,
            isActive: true,
            minPrice: true,
            defaultDurationMinutes: true,
            defaultImageUrl: true,
            allowMobile: true,
          },
        },
      },
    })

    if (!offering) {
      return NextResponse.json({ error: 'Offering not found or inactive.' }, { status: 404 })
    }

    // Validate the mode is actually offered (don’t discount a mode they don’t offer)
    if (effectiveLocationType === 'SALON' && !offering.offersInSalon) {
      return NextResponse.json({ error: 'This offering is not available in-salon.' }, { status: 400 })
    }
    if (effectiveLocationType === 'MOBILE' && !offering.offersMobile) {
      return NextResponse.json({ error: 'This offering is not available as mobile.' }, { status: 400 })
    }

    // ✅ Replace old offering.price usage
    const basePriceNum = pickBasePrice({
      locationType: effectiveLocationType,
      offering: {
        salonPriceStartingAt: offering.salonPriceStartingAt,
        mobilePriceStartingAt: offering.mobilePriceStartingAt,
      },
      service: offering.service,
    })

    const discount = await computeLastMinuteDiscount({
      professionalId: offering.professionalId,
      serviceId: offering.serviceId,
      startAt: booking.scheduledFor,
      basePrice: basePriceNum,
    })

    // Example: store discount fields (adjust to your real intent)
    // If you’re accepting bookings, do that here instead.
    const updated = await prisma.booking.update({
      where: { id: booking.id },
      data: {
        // these fields exist on Booking in your schema
        discountAmount: discount.discountAmount ? discount.discountAmount : undefined,
        // You might also calculate totalAmount elsewhere
        // status: 'ACCEPTED',
      },
      select: { id: true },
    })

    return NextResponse.json({ ok: true, bookingId: updated.id, basePrice: basePriceNum, discount })
  } catch (e) {
    console.error('POST /api/pro/bookings error', e)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
