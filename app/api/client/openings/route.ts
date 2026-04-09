// app/api/client/openings/route.ts
import { prisma } from '@/lib/prisma'
import {
  jsonFail,
  jsonOk,
  pickString,
  requireClient,
  upper,
} from '@/app/api/_utils'
import {
  LastMinuteOfferType,
  LastMinuteRecipientStatus,
  LastMinuteTier,
  OpeningStatus,
  Prisma,
  ServiceLocationType,
} from '@prisma/client'

export const dynamic = 'force-dynamic'

function normalizeLocationType(v: unknown): ServiceLocationType | null {
  const s = upper(v)
  if (s === ServiceLocationType.SALON) return ServiceLocationType.SALON
  if (s === ServiceLocationType.MOBILE) return ServiceLocationType.MOBILE
  return null
}

function decimalToString(value: Prisma.Decimal | null): string | null {
  return value ? value.toString() : null
}

function incentiveLabel(plan: {
  offerType: LastMinuteOfferType
  percentOff: number | null
  amountOff: Prisma.Decimal | null
  freeAddOnService: { id: string; name: string } | null
}) {
  if (plan.offerType === LastMinuteOfferType.PERCENT_OFF && plan.percentOff != null) {
    return `${plan.percentOff}% off`
  }

  if (plan.offerType === LastMinuteOfferType.AMOUNT_OFF && plan.amountOff) {
    return `$${plan.amountOff.toString()} off`
  }

  if (plan.offerType === LastMinuteOfferType.FREE_SERVICE) {
    return 'Free service'
  }

  if (plan.offerType === LastMinuteOfferType.FREE_ADD_ON) {
    return plan.freeAddOnService?.name || 'Free add-on'
  }

  return 'No incentive'
}

const recipientSelect = {
  id: true,
  firstMatchedTier: true,
  notifiedTier: true,
  status: true,
  notifiedAt: true,
  openedAt: true,
  clickedAt: true,
  bookedAt: true,
  createdAt: true,
  opening: {
    select: {
      id: true,
      professionalId: true,
      startAt: true,
      endAt: true,
      note: true,
      status: true,
      visibilityMode: true,
      publicVisibleFrom: true,
      publicVisibleUntil: true,
      bookedAt: true,
      cancelledAt: true,
      timeZone: true,
      locationType: true,
      locationId: true,

      location: {
        select: {
          id: true,
          type: true,
          timeZone: true,
          city: true,
          state: true,
          formattedAddress: true,
          lat: true,
          lng: true,
        },
      },

      professional: {
        select: {
          id: true,
          businessName: true,
          handle: true,
          avatarUrl: true,
          professionType: true,
          location: true,
          timeZone: true,
        },
      },

      services: {
        where: {
          offering: {
            is: {
              isActive: true,
            },
          },
        },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
        select: {
          id: true,
          openingId: true,
          serviceId: true,
          offeringId: true,
          sortOrder: true,
          service: {
            select: {
              id: true,
              name: true,
              minPrice: true,
              defaultDurationMinutes: true,
            },
          },
          offering: {
            select: {
              id: true,
              title: true,
              salonPriceStartingAt: true,
              mobilePriceStartingAt: true,
              salonDurationMinutes: true,
              mobileDurationMinutes: true,
              offersInSalon: true,
              offersMobile: true,
            },
          },
        },
      },

      tierPlans: {
        where: {
          cancelledAt: null,
        },
        orderBy: [{ scheduledFor: 'asc' }, { tier: 'asc' }],
        select: {
          id: true,
          tier: true,
          scheduledFor: true,
          offerType: true,
          percentOff: true,
          amountOff: true,
          freeAddOnServiceId: true,
          freeAddOnService: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      },
    },
  },
} satisfies Prisma.LastMinuteRecipientSelect

type RecipientRow = Prisma.LastMinuteRecipientGetPayload<{
  select: typeof recipientSelect
}>

function pickMatchedTierPlan(recipient: RecipientRow) {
  const matchedTier = recipient.notifiedTier ?? recipient.firstMatchedTier
  return recipient.opening.tierPlans.find((plan) => plan.tier === matchedTier) ?? null
}

function mapOpening(recipient: RecipientRow) {
  const opening = recipient.opening
  const matchedTierPlan = pickMatchedTierPlan(recipient)

  return {
    id: opening.id,
    professionalId: opening.professionalId,
    startAt: opening.startAt.toISOString(),
    endAt: opening.endAt ? opening.endAt.toISOString() : null,
    note: opening.note ?? null,
    status: opening.status,
    visibilityMode: opening.visibilityMode,
    publicVisibleFrom: opening.publicVisibleFrom ? opening.publicVisibleFrom.toISOString() : null,
    publicVisibleUntil: opening.publicVisibleUntil ? opening.publicVisibleUntil.toISOString() : null,
    locationType: opening.locationType,
    timeZone: opening.timeZone,

    professional: {
      id: opening.professional.id,
      businessName: opening.professional.businessName ?? null,
      handle: opening.professional.handle ?? null,
      avatarUrl: opening.professional.avatarUrl ?? null,
      professionType: opening.professional.professionType ?? null,
      locationLabel: opening.professional.location ?? null,
      timeZone: opening.professional.timeZone ?? null,
    },

    location: opening.location
      ? {
          id: opening.location.id,
          type: opening.location.type,
          timeZone: opening.location.timeZone ?? null,
          city: opening.location.city ?? null,
          state: opening.location.state ?? null,
          formattedAddress: opening.location.formattedAddress ?? null,
          lat: decimalToString(opening.location.lat),
          lng: decimalToString(opening.location.lng),
        }
      : null,

    services: opening.services.map((serviceRow) => ({
      id: serviceRow.id,
      openingId: serviceRow.openingId,
      serviceId: serviceRow.serviceId,
      offeringId: serviceRow.offeringId,
      sortOrder: serviceRow.sortOrder,
      service: {
        id: serviceRow.service.id,
        name: serviceRow.service.name,
        minPrice: serviceRow.service.minPrice.toString(),
        defaultDurationMinutes: serviceRow.service.defaultDurationMinutes,
      },
      offering: {
        id: serviceRow.offering.id,
        title: serviceRow.offering.title ?? null,
        salonPriceStartingAt: decimalToString(serviceRow.offering.salonPriceStartingAt),
        mobilePriceStartingAt: decimalToString(serviceRow.offering.mobilePriceStartingAt),
        salonDurationMinutes: serviceRow.offering.salonDurationMinutes,
        mobileDurationMinutes: serviceRow.offering.mobileDurationMinutes,
        offersInSalon: serviceRow.offering.offersInSalon,
        offersMobile: serviceRow.offering.offersMobile,
      },
    })),

    publicIncentive: matchedTierPlan
      ? {
          tier: matchedTierPlan.tier,
          offerType: matchedTierPlan.offerType,
          label: incentiveLabel(matchedTierPlan),
          percentOff: matchedTierPlan.percentOff ?? null,
          amountOff: decimalToString(matchedTierPlan.amountOff),
          freeAddOnService: matchedTierPlan.freeAddOnService
            ? {
                id: matchedTierPlan.freeAddOnService.id,
                name: matchedTierPlan.freeAddOnService.name,
              }
            : null,
        }
      : null,
  }
}

export async function GET(req: Request) {
  try {
    const auth = await requireClient()
    if (!auth.ok) return auth.res

    const { clientId } = auth
    const { searchParams } = new URL(req.url)

    const serviceId = pickString(searchParams.get('serviceId'))
    const professionalId = pickString(searchParams.get('professionalId'))
    const requestedLocationType = normalizeLocationType(searchParams.get('locationType'))

    const now = new Date()

    const recipients = await prisma.lastMinuteRecipient.findMany({
      where: {
        clientId,
        cancelledAt: null,
        bookedAt: null,
        notifiedAt: { not: null },
        status: {
          in: [
            LastMinuteRecipientStatus.ENQUEUED,
            LastMinuteRecipientStatus.OPENED,
            LastMinuteRecipientStatus.CLICKED,
          ],
        },
        opening: {
          status: OpeningStatus.ACTIVE,
          bookedAt: null,
          cancelledAt: null,
          startAt: { gte: now },
          ...(professionalId ? { professionalId } : {}),
          ...(requestedLocationType ? { locationType: requestedLocationType } : {}),
          services: {
            some: {
              ...(serviceId ? { serviceId } : {}),
              offering: {
                is: {
                  isActive: true,
                },
              },
            },
          },
        },
      },
      orderBy: [{ notifiedAt: 'desc' }, { createdAt: 'desc' }],
      take: 50,
      select: recipientSelect,
    })

    const notifications = recipients
      .filter((recipient) => recipient.opening.services.length > 0)
      .map((recipient) => ({
        id: recipient.id,
        tier: recipient.notifiedTier ?? recipient.firstMatchedTier,
        sentAt: (recipient.notifiedAt ?? recipient.createdAt).toISOString(),
        openedAt: recipient.openedAt ? recipient.openedAt.toISOString() : null,
        clickedAt: recipient.clickedAt ? recipient.clickedAt.toISOString() : null,
        bookedAt: recipient.bookedAt ? recipient.bookedAt.toISOString() : null,
        opening: mapOpening(recipient),
      }))

    return jsonOk({ notifications }, 200)
  } catch (e) {
    console.error('GET /api/client/openings error', e)
    return jsonFail(500, 'Failed to load openings.')
  }
}