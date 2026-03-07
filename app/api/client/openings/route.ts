// app/api/client/openings/route.ts
import { prisma } from '@/lib/prisma'
import { OpeningStatus, Prisma, ServiceLocationType } from '@prisma/client'
import { requireClient, pickString, upper, jsonFail, jsonOk } from '@/app/api/_utils'
import { moneyToString } from '@/lib/money'

export const dynamic = 'force-dynamic'

function normalizeLocationType(v: unknown): ServiceLocationType | null {
  const s = upper(v)
  if (s === ServiceLocationType.SALON) return ServiceLocationType.SALON
  if (s === ServiceLocationType.MOBILE) return ServiceLocationType.MOBILE
  return null
}

type OfferingModeFields = {
  salonPriceStartingAt: Prisma.Decimal | null
  salonDurationMinutes: number | null
  mobilePriceStartingAt: Prisma.Decimal | null
  mobileDurationMinutes: number | null
}
function getSupportedLocationTypes(args: {
  offersInSalon: boolean
  offersMobile: boolean
}): ServiceLocationType[] {
  const supported: ServiceLocationType[] = []

  if (args.offersInSalon) supported.push(ServiceLocationType.SALON)
  if (args.offersMobile) supported.push(ServiceLocationType.MOBILE)

  return supported
}

function formatMoneyOrNull(value: Prisma.Decimal | null) {
  return value ? moneyToString(value) : null
}

function resolveSelectedLocationType(args: {
  requested: ServiceLocationType | null
  supported: ServiceLocationType[]
}): ServiceLocationType | null {
  const { requested, supported } = args

  if (requested) {
    return supported.includes(requested) ? requested : null
  }

  if (supported.length === 1) {
    return supported[0]
  }

  return null
}

function buildModeDetails(offering: OfferingModeFields, locationType: ServiceLocationType) {
  const rawPrice =
    locationType === ServiceLocationType.MOBILE
      ? offering.mobilePriceStartingAt
      : offering.salonPriceStartingAt

  const rawDuration =
    locationType === ServiceLocationType.MOBILE
      ? offering.mobileDurationMinutes
      : offering.salonDurationMinutes

  const durationMinutes =
    typeof rawDuration === 'number' && Number.isFinite(rawDuration) && rawDuration > 0
      ? rawDuration
      : null

  return {
    priceStartingAt: formatMoneyOrNull(rawPrice),
    durationMinutes,
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

    const notifications = await prisma.openingNotification.findMany({
      where: {
        clientId,
        bookedAt: null,
        opening: {
          status: OpeningStatus.ACTIVE,
          ...(serviceId ? { serviceId } : {}),
          ...(professionalId ? { professionalId } : {}),
        },
      },
      orderBy: { sentAt: 'desc' },
      take: 50,
      select: {
        id: true,
        tier: true,
        sentAt: true,
        deliveredAt: true,
        openedAt: true,
        clickedAt: true,
        bookedAt: true,
        opening: {
          select: {
            id: true,
            status: true,
            startAt: true,
            endAt: true,
            discountPct: true,
            note: true,
            professional: {
              select: {
                id: true,
                businessName: true,
                avatarUrl: true,
                location: true,
                timeZone: true,
              },
            },
            service: {
              select: {
                id: true,
                name: true,
              },
            },
            offering: {
              select: {
                id: true,
                title: true,
                offersInSalon: true,
                offersMobile: true,
                salonPriceStartingAt: true,
                salonDurationMinutes: true,
                mobilePriceStartingAt: true,
                mobileDurationMinutes: true,
              },
            },
          },
        },
      },
    })

    const normalized = notifications
      .map((notification) => {
        const opening = notification.opening
        if (!opening) return null

        const offering = opening.offering
        const professional = opening.professional

        if (!offering) {
          return {
            id: notification.id,
            tier: notification.tier,
            sentAt: notification.sentAt.toISOString(),
            deliveredAt: notification.deliveredAt ? notification.deliveredAt.toISOString() : null,
            openedAt: notification.openedAt ? notification.openedAt.toISOString() : null,
            clickedAt: notification.clickedAt ? notification.clickedAt.toISOString() : null,
            bookedAt: notification.bookedAt ? notification.bookedAt.toISOString() : null,

            opening: {
              id: opening.id,
              status: opening.status,
              startAt: opening.startAt.toISOString(),
              endAt: opening.endAt ? opening.endAt.toISOString() : null,
              discountPct: opening.discountPct ?? null,
              note: opening.note ?? null,
              service: opening.service
                ? {
                    id: opening.service.id,
                    name: opening.service.name,
                  }
                : null,
              professional: professional
                ? {
                    id: professional.id,
                    businessName: professional.businessName ?? null,
                    avatarUrl: professional.avatarUrl ?? null,
                    location: professional.location ?? null,
                    timeZone: professional.timeZone ?? null,
                  }
                : null,
              offering: null,
            },
          }
        }

        const supportedLocationTypes = getSupportedLocationTypes({
          offersInSalon: Boolean(offering.offersInSalon),
          offersMobile: Boolean(offering.offersMobile),
        })

        if (supportedLocationTypes.length === 0) {
          return null
        }

        if (requestedLocationType && !supportedLocationTypes.includes(requestedLocationType)) {
          return null
        }

        const selectedLocationType = resolveSelectedLocationType({
          requested: requestedLocationType,
          supported: supportedLocationTypes,
        })

        const requiresLocationTypeSelection =
          selectedLocationType == null && supportedLocationTypes.length > 1

        const salon = {
          enabled: Boolean(offering.offersInSalon),
          ...buildModeDetails(offering, ServiceLocationType.SALON),
        }

        const mobile = {
          enabled: Boolean(offering.offersMobile),
          ...buildModeDetails(offering, ServiceLocationType.MOBILE),
        }

        const selectedMode =
          selectedLocationType === ServiceLocationType.SALON
            ? {
                locationType: ServiceLocationType.SALON,
                priceStartingAt: salon.priceStartingAt,
                durationMinutes: salon.durationMinutes,
              }
            : selectedLocationType === ServiceLocationType.MOBILE
              ? {
                  locationType: ServiceLocationType.MOBILE,
                  priceStartingAt: mobile.priceStartingAt,
                  durationMinutes: mobile.durationMinutes,
                }
              : null

        return {
          id: notification.id,
          tier: notification.tier,
          sentAt: notification.sentAt.toISOString(),
          deliveredAt: notification.deliveredAt ? notification.deliveredAt.toISOString() : null,
          openedAt: notification.openedAt ? notification.openedAt.toISOString() : null,
          clickedAt: notification.clickedAt ? notification.clickedAt.toISOString() : null,
          bookedAt: notification.bookedAt ? notification.bookedAt.toISOString() : null,

          opening: {
            id: opening.id,
            status: opening.status,
            startAt: opening.startAt.toISOString(),
            endAt: opening.endAt ? opening.endAt.toISOString() : null,
            discountPct: opening.discountPct ?? null,
            note: opening.note ?? null,

            service: opening.service
              ? {
                  id: opening.service.id,
                  name: opening.service.name,
                }
              : null,

            professional: professional
              ? {
                  id: professional.id,
                  businessName: professional.businessName ?? null,
                  avatarUrl: professional.avatarUrl ?? null,
                  location: professional.location ?? null,
                  timeZone: professional.timeZone ?? null,
                }
              : null,

            offering: {
              id: offering.id,
              title: offering.title ?? null,
              supportedLocationTypes,
              selectedLocationType,
              requiresLocationTypeSelection,
              selectedMode,
              salon,
              mobile,
            },
          },
        }
      })
      .filter((value): value is NonNullable<typeof value> => value !== null)

    return jsonOk({ notifications: normalized })
  } catch (e) {
    console.error('GET /api/client/openings error', e)
    return jsonFail(500, 'Failed to load openings.')
  }
}