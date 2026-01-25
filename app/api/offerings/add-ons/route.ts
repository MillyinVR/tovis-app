// app/api/offerings/add-ons/route.ts
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { moneyToString } from '@/lib/money'
import { ServiceLocationType } from '@prisma/client'

export const dynamic = 'force-dynamic'

function pickOne(v: string | string[] | null) {
  if (!v) return ''
  return Array.isArray(v) ? (v[0] ?? '') : v
}

function normalizeLocationType(v: string) {
  const s = (v || '').trim().toUpperCase()
  if (s === 'SALON') return 'SALON' as const
  if (s === 'MOBILE') return 'MOBILE' as const
  return null
}

function toServiceLocationType(v: 'SALON' | 'MOBILE'): ServiceLocationType {
  return v === 'SALON' ? ServiceLocationType.SALON : ServiceLocationType.MOBILE
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url)

    const offeringId = pickOne(url.searchParams.get('offeringId'))
    const locationTypeRaw = pickOne(url.searchParams.get('locationType'))
    const locationType = normalizeLocationType(locationTypeRaw)

    if (!offeringId || !locationType) {
      return NextResponse.json({ ok: false, error: 'Missing offeringId or locationType' }, { status: 400 })
    }

    // Load offering + service + professional so UI can show context
    const offering = await prisma.professionalServiceOffering.findUnique({
      where: { id: offeringId },
      select: {
        id: true,
        isActive: true,
        professionalId: true,
        professional: { select: { id: true, businessName: true } },
        service: { select: { id: true, name: true } },
      },
    })

    if (!offering || !offering.isActive) {
      return NextResponse.json({ ok: false, error: 'Offering not found' }, { status: 404 })
    }

    const locEnum = toServiceLocationType(locationType)

    const addOnLinks = await prisma.offeringAddOn.findMany({
      where: {
        offeringId,
        isActive: true,
        OR: [{ locationType: null }, { locationType: locEnum }],
        addOnService: { isActive: true, isAddOnEligible: true },
      },
      include: {
        addOnService: {
          select: {
            id: true,
            name: true,
            addOnGroup: true,
            defaultDurationMinutes: true,
            minPrice: true,
          },
        },
      },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      take: 200,
    })

    const addOnServiceIds = addOnLinks.map((x) => x.addOnServiceId)

    // Resolve per-pro pricing/duration for add-on services if the pro has offerings for them
    const proOfferings = addOnServiceIds.length
      ? await prisma.professionalServiceOffering.findMany({
          where: {
            professionalId: offering.professionalId,
            isActive: true,
            serviceId: { in: addOnServiceIds },
          },
          select: {
            serviceId: true,
            salonPriceStartingAt: true,
            salonDurationMinutes: true,
            mobilePriceStartingAt: true,
            mobileDurationMinutes: true,
          },
          take: 500,
        })
      : []

    const byServiceId = new Map(proOfferings.map((o) => [o.serviceId, o]))

    const addOns = addOnLinks.map((x) => {
      const svc = x.addOnService
      const proOff = byServiceId.get(svc.id) || null

      const minutes =
        x.durationOverrideMinutes ??
        (locationType === 'SALON' ? proOff?.salonDurationMinutes : proOff?.mobileDurationMinutes) ??
        svc.defaultDurationMinutes ??
        0

      const priceDec =
        x.priceOverride ??
        (locationType === 'SALON' ? proOff?.salonPriceStartingAt : proOff?.mobilePriceStartingAt) ??
        svc.minPrice

      const price = moneyToString(priceDec) ?? '0.00'

      return {
        id: String(x.id), // ✅ OfferingAddOn.id (submit this)
        serviceId: String(svc.id),
        title: svc.name,
        group: svc.addOnGroup ?? null,
        sortOrder: x.sortOrder,
        isRecommended: Boolean(x.isRecommended),
        minutes: Number(minutes) || 0,
        price, // "25.00"
      }
    })

    return NextResponse.json(
      {
        ok: true,
        offeringId: offering.id,
        locationType,
        offering: {
          id: offering.id,
          service: offering.service ? { id: offering.service.id, name: offering.service.name } : null,
          professional: offering.professional
            ? { id: offering.professional.id, businessName: offering.professional.businessName ?? null }
            : null,
        },
        addOns,
      },
      { status: 200 },
    )
  } catch (e) {
    console.error('GET /api/offerings/add-ons error', e)
    return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500 })
  }
}
