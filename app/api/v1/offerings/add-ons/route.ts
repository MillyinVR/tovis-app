// app/api/v1/offerings/add-ons/route.ts
import { prisma } from '@/lib/prisma'
import { ServiceLocationType } from '@prisma/client'
import { jsonFail, jsonOk } from '@/app/api/_utils'
import { moneyToString } from '@/lib/money'
import { normalizeLocationType } from '@/lib/booking/locationContext'
import { resolveAddOnDurationMinutes } from '@/lib/booking/addOnDuration'
import { noShowProtectionEnabled } from '@/lib/noShowProtection/flag'
import { getProNoShowSettings } from '@/lib/noShowProtection/settings'
import { cancellationPolicyDisclosure } from '@/lib/noShowProtection/policyDisclosure'
import {
  CONSULT_SAFETY_SERVICE_BOOKING_RULES,
  isStrandTestOptionalAddOn,
  STRAND_TEST_ADD_ON_PROMPT,
} from '@/lib/consult/safetyRouting'
import type {
  OfferingAddOnItemDTO,
  OfferingAddOnsResponseDTO,
} from '@/lib/dto/offeringAddOns'

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
        isPreselected: true,
        priceOverride: true,
        durationOverrideMinutes: true,
        addOnService: {
          select: {
            id: true,
            name: true,
            addOnGroup: true,
            defaultDurationMinutes: true,
            minPrice: true,
            category: { select: { slug: true } },
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
      const isStrandTest =
        offering.service?.name ===
        CONSULT_SAFETY_SERVICE_BOOKING_RULES.STRAND_TEST.name
      if (
        isStrandTest &&
        !isStrandTestOptionalAddOn({
          categorySlug: service.category.slug,
          serviceName: service.name,
        })
      ) {
        return []
      }
      const proOffering = proOfferingByServiceId.get(service.id) ?? null

      // The same resolver booking/finalize use for this exact link (§
      // lib/booking/addOnDuration.ts) — so what the client sees here is
      // guaranteed to match what they'd actually be booked for, including a
      // legitimate 0 for an instant/retail add-on.
      const durationMinutes = resolveAddOnDurationMinutes({
        durationOverrideMinutes: link.durationOverrideMinutes,
        proOffering,
        defaultDurationMinutes: service.defaultDurationMinutes,
        locationType,
      })

      const priceRaw =
        link.priceOverride ??
        (locationType === ServiceLocationType.MOBILE
          ? proOffering?.mobilePriceStartingAt
          : proOffering?.salonPriceStartingAt) ??
        service.minPrice

      if (priceRaw == null || durationMinutes == null) {
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
          isPreselected: Boolean(link.isPreselected),
          minutes: durationMinutes,
          price,
        } satisfies OfferingAddOnItemDTO,
      ]
    })

    // The pro's no-show / late-cancel fee policy the client must agree to before
    // booking (M15). Non-null only when the pro charges fees; the native confirm
    // flow shows it + requires agreement. Inert unless the flag is on.
    const cancellationPolicy = noShowProtectionEnabled()
      ? cancellationPolicyDisclosure(
          await getProNoShowSettings(offering.professionalId),
        )
      : null

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
      selectionPrompt:
        offering.service?.name ===
          CONSULT_SAFETY_SERVICE_BOOKING_RULES.STRAND_TEST.name &&
        addOns.length > 0
          ? STRAND_TEST_ADD_ON_PROMPT
          : null,
      cancellationPolicy,
    } satisfies OfferingAddOnsResponseDTO)
  } catch (err: unknown) {
    console.error('GET /api/v1/offerings/add-ons error', err)
    return jsonFail(500, 'Internal server error.')
  }
}
