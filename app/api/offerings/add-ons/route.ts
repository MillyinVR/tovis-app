// app/api/offerings/add-ons/route.ts
import { prisma } from '@/lib/prisma'
import { moneyToString } from '@/lib/money'
import { jsonFail, jsonOk } from '@/app/api/_utils'
import { ServiceLocationType } from '@prisma/client'

export const dynamic = 'force-dynamic'

type LocationTypeKey = 'SALON' | 'MOBILE'

function cleanParam(v: string | null): string | null {
  const s = (v ?? '').trim()
  return s.length ? s : null
}

function parseLocationType(v: string | null): LocationTypeKey | null {
  const s = (v ?? '').trim().toUpperCase()
  if (s === 'SALON') return 'SALON'
  if (s === 'MOBILE') return 'MOBILE'
  return null
}

function toPrismaLocationType(v: LocationTypeKey): ServiceLocationType {
  return v === 'SALON' ? ServiceLocationType.SALON : ServiceLocationType.MOBILE
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url)

    const offeringId = cleanParam(url.searchParams.get('offeringId'))
    const locationType = parseLocationType(url.searchParams.get('locationType'))

    if (!offeringId || !locationType) {
      return jsonFail(400, 'Missing or invalid offeringId or locationType')
    }

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
      return jsonFail(404, 'Offering not found')
    }

    const locEnum = toPrismaLocationType(locationType)

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
      const proOff = byServiceId.get(svc.id) ?? null

      const minutesRaw =
        x.durationOverrideMinutes ??
        (locationType === 'SALON' ? proOff?.salonDurationMinutes : proOff?.mobileDurationMinutes) ??
        svc.defaultDurationMinutes ??
        0

      const minutes = Number(minutesRaw)
      const safeMinutes = Number.isFinite(minutes) && minutes > 0 ? minutes : 0

      const priceDec =
        x.priceOverride ??
        (locationType === 'SALON' ? proOff?.salonPriceStartingAt : proOff?.mobilePriceStartingAt) ??
        svc.minPrice

      const price = moneyToString(priceDec) ?? '0.00'

      return {
        id: x.id, // OfferingAddOn.id ✅
        serviceId: svc.id,
        title: svc.name,
        group: svc.addOnGroup ?? null,
        sortOrder: x.sortOrder,
        isRecommended: Boolean(x.isRecommended),
        minutes: safeMinutes,
        price, // "25.00"
      }
    })

    return jsonOk({
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
    })
  } catch (err: unknown) {
    console.error('GET /api/offerings/add-ons error', err)
    const message = err instanceof Error ? err.message : 'Internal server error'
    return jsonFail(500, message)
  }
}