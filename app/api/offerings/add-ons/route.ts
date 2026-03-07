// app/api/offerings/add-ons/route.ts
import { prisma } from '@/lib/prisma'
import { ServiceLocationType } from '@prisma/client'
import { jsonFail, jsonOk } from '@/app/api/_utils'
import { moneyToString } from '@/lib/money'
import {
  normalizeLocationType,
  pickModeDurationMinutes,
} from '@/lib/booking/locationContext'
import { DEFAULT_DURATION_MINUTES } from '@/lib/booking/constants'

export const dynamic = 'force-dynamic'

function cleanParam(value: string | null): string | null {
  const trimmed = (value ?? '').trim()
  return trimmed.length ? trimmed : null
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url)

    const offeringId = cleanParam(url.searchParams.get('offeringId'))
    const locationType = normalizeLocationType(
      url.searchParams.get('locationType'),
    )

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

    if (
      locationType === ServiceLocationType.SALON &&
      !offering.offersInSalon
    ) {
      return jsonFail(400, 'This offering does not support salon bookings.')
    }

    if (
      locationType === ServiceLocationType.MOBILE &&
      !offering.offersMobile
    ) {
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

    const addOnServiceIds = Array.from(
      new Set(addOnLinks.map((link) => link.addOnServiceId)),
    )

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

    const proOfferingByServiceId = new Map(
      proOfferings.map((row) => [row.serviceId, row]),
    )

    const addOns = addOnLinks.flatMap((link) => {
      const service = link.addOnService
      const proOffering = proOfferingByServiceId.get(service.id) ?? null

      const durationMinutes = pickModeDurationMinutes({
        locationType,
        salonDurationMinutes:
          link.durationOverrideMinutes ??
          proOffering?.salonDurationMinutes ??
          service.defaultDurationMinutes ??
          null,
        mobileDurationMinutes:
          link.durationOverrideMinutes ??
          proOffering?.mobileDurationMinutes ??
          service.defaultDurationMinutes ??
          null,
        fallbackDurationMinutes:
          service.defaultDurationMinutes ?? DEFAULT_DURATION_MINUTES,
      })

      const priceRaw =
        link.priceOverride ??
        (locationType === ServiceLocationType.MOBILE
          ? proOffering?.mobilePriceStartingAt
          : proOffering?.salonPriceStartingAt) ??
        service.minPrice

      if (priceRaw == null || durationMinutes <= 0) {
        return []
      }

      const price = moneyToString(priceRaw)
      if (!price) {
        return []
      }

      return [
        {
          id: link.id,
          serviceId: service.id,
          title: service.name,
          group: service.addOnGroup ?? null,
          sortOrder: link.sortOrder ?? 0,
          isRecommended: Boolean(link.isRecommended),
          minutes: durationMinutes,
          price,
        },
      ]
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