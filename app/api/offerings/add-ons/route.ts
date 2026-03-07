// app/api/offerings/add-ons/route.ts
import { prisma } from '@/lib/prisma'
import { moneyToString } from '@/lib/money'
import { jsonFail, jsonOk } from '@/app/api/_utils'
import { ServiceLocationType } from '@prisma/client'

export const dynamic = 'force-dynamic'

function cleanParam(v: string | null): string | null {
  const s = (v ?? '').trim()
  return s.length ? s : null
}

function parseLocationType(v: string | null): ServiceLocationType | null {
  const s = (v ?? '').trim().toUpperCase()
  if (s === ServiceLocationType.SALON) return ServiceLocationType.SALON
  if (s === ServiceLocationType.MOBILE) return ServiceLocationType.MOBILE
  return null
}

function toSafePositiveInt(v: unknown, fallback = 0) {
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(n)) return fallback
  const x = Math.trunc(n)
  return x > 0 ? x : fallback
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url)

    const offeringId = cleanParam(url.searchParams.get('offeringId'))
    const locationType = parseLocationType(url.searchParams.get('locationType'))

    if (!offeringId || !locationType) {
      return jsonFail(400, 'Missing or invalid offeringId or locationType.')
    }

    const offering = await prisma.professionalServiceOffering.findUnique({
      where: { id: offeringId },
      select: {
        id: true,
        isActive: true,
        professionalId: true,
        offersInSalon: true,
        offersMobile: true,
        professional: {
          select: {
            id: true,
            businessName: true,
          },
        },
        service: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    })

    if (!offering || !offering.isActive) {
      return jsonFail(404, 'Offering not found.')
    }

    if (locationType === ServiceLocationType.SALON && !offering.offersInSalon) {
      return jsonFail(400, 'This offering does not support salon bookings.')
    }

    if (locationType === ServiceLocationType.MOBILE && !offering.offersMobile) {
      return jsonFail(400, 'This offering does not support mobile bookings.')
    }

    const addOnLinks = await prisma.offeringAddOn.findMany({
      where: {
        offeringId: offering.id,
        isActive: true,
        OR: [{ locationType: null }, { locationType }],
        addOnService: {
          isActive: true,
          isAddOnEligible: true,
        },
      },
      select: {
        id: true,
        addOnServiceId: true,
        sortOrder: true,
        isRecommended: true,
        priceOverride: true,
        durationOverrideMinutes: true,
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

    const addOnServiceIds = Array.from(new Set(addOnLinks.map((x) => x.addOnServiceId)))

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

    const proOfferingByServiceId = new Map(proOfferings.map((row) => [row.serviceId, row]))

    const addOns = addOnLinks.map((link) => {
      const svc = link.addOnService
      const proOff = proOfferingByServiceId.get(svc.id) ?? null

      const durationRaw =
        link.durationOverrideMinutes ??
        (locationType === ServiceLocationType.MOBILE
          ? proOff?.mobileDurationMinutes
          : proOff?.salonDurationMinutes) ??
        svc.defaultDurationMinutes ??
        0

      const priceRaw =
        link.priceOverride ??
        (locationType === ServiceLocationType.MOBILE
          ? proOff?.mobilePriceStartingAt
          : proOff?.salonPriceStartingAt) ??
        svc.minPrice

      return {
        id: link.id, // OfferingAddOn.id
        serviceId: svc.id,
        title: svc.name,
        group: svc.addOnGroup ?? null,
        sortOrder: link.sortOrder ?? 0,
        isRecommended: Boolean(link.isRecommended),
        minutes: toSafePositiveInt(durationRaw, 0),
        price: moneyToString(priceRaw) ?? '0.00',
      }
    })

    return jsonOk({
      offeringId: offering.id,
      locationType,
      offering: {
        id: offering.id,
        service: offering.service
          ? {
              id: offering.service.id,
              name: offering.service.name,
            }
          : null,
        professional: offering.professional
          ? {
              id: offering.professional.id,
              businessName: offering.professional.businessName ?? null,
            }
          : null,
      },
      addOns,
    })
  } catch (err: unknown) {
    console.error('GET /api/offerings/add-ons error', err)
    return jsonFail(500, 'Internal server error.')
  }
}