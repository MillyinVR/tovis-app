// app/api/v1/client/openings/route.ts
import { prisma } from '@/lib/prisma'
import { pickProfessionalPublicDisplayName } from '@/lib/privacy/professionalDisplayName'
import { moneyToString } from '@/lib/money'
import {
  jsonFail,
  jsonOk,
  pickString,
  requireClient,
  upper,
} from '@/app/api/_utils'
import {
  LastMinuteRecipientStatus,
  OpeningStatus,
  Prisma,
  ServiceLocationType,
} from '@prisma/client'
import { pickRecipientTierPlan } from '@/lib/lastMinute/pickTierPlan'
import {
  mapOpeningServiceDtos,
  mapPublicIncentiveDto,
} from '@/lib/lastMinute/openingDto'
import { filterStillOpenRows } from '@/lib/booking/storedSlotLiveness'
import { openingLivenessCandidate } from '@/lib/lastMinute/openingLiveness'

export const dynamic = 'force-dynamic'

function normalizeLocationType(v: unknown): ServiceLocationType | null {
  const s = upper(v)
  if (s === ServiceLocationType.SALON) return ServiceLocationType.SALON
  if (s === ServiceLocationType.MOBILE) return ServiceLocationType.MOBILE
  return null
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
          firstName: true,
          lastName: true,
          handle: true,
          nameDisplay: true,
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

function mapOpening(recipient: RecipientRow) {
  const opening = recipient.opening
  const matchedTierPlan = pickRecipientTierPlan({
    notifiedTier: recipient.notifiedTier,
    firstMatchedTier: recipient.firstMatchedTier,
    tierPlans: opening.tierPlans,
  })

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
      displayName: pickProfessionalPublicDisplayName(opening.professional),
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
          lat: moneyToString(opening.location.lat),
          lng: moneyToString(opening.location.lng),
        }
      : null,

    services: mapOpeningServiceDtos(opening.services),

    publicIncentive: mapPublicIncentiveDto(matchedTierPlan),
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

    // Tori's rule (F15): a stored time the pro's schedule can no longer serve is
    // not shown at all. The row's own state (ACTIVE / not booked / not cancelled)
    // only moves when THIS opening is claimed or the pro cancels it by hand —
    // nothing retires it when the slot goes to an ordinary booking, gets blocked,
    // or drops out of newly-narrowed hours. So the read asks the schedule.
    const stillOpen = await filterStillOpenRows({
      rows: recipients.filter((recipient) => recipient.opening.services.length > 0),
      toCandidate: (recipient) => openingLivenessCandidate(recipient.opening),
      viewerClientId: clientId,
      // Unreachable — the query and the filter above both require an active
      // service — but stated rather than defaulted: a row with no window to
      // check is a row this feed has nothing to offer for.
      onUncheckable: 'drop',
      nowUtc: now,
    })

    const notifications = stillOpen.map((recipient) => ({
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
    console.error('GET /api/v1/client/openings error', e)
    return jsonFail(500, 'Failed to load openings.')
  }
}