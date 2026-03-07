// app/api/pro/services/route.ts
import { prisma } from '@/lib/prisma'
import { ServiceLocationType } from '@prisma/client'
import { jsonFail, jsonOk, requirePro } from '@/app/api/_utils'
import { moneyToString } from '@/lib/money'

export const dynamic = 'force-dynamic'

function normalizeLocationType(raw: string | null): ServiceLocationType | null {
  const value = typeof raw === 'string' ? raw.trim().toUpperCase() : ''
  if (value === ServiceLocationType.SALON) return ServiceLocationType.SALON
  if (value === ServiceLocationType.MOBILE) return ServiceLocationType.MOBILE
  return null
}

function getSupportedLocationTypes(args: {
  salonEnabled: boolean
  mobileEnabled: boolean
}): ServiceLocationType[] {
  const supported: ServiceLocationType[] = []

  if (args.salonEnabled) supported.push(ServiceLocationType.SALON)
  if (args.mobileEnabled) supported.push(ServiceLocationType.MOBILE)

  return supported
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

function normalizeDuration(raw: number | null | undefined, fallback: number | null | undefined) {
  const value = raw ?? fallback ?? null
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
}

function buildModeDetails(args: {
  enabledByOffering: boolean
  durationMinutes: number | null
  priceStartingAt: string | null
}) {
  const enabled =
    args.enabledByOffering &&
    args.durationMinutes != null &&
    args.priceStartingAt != null

  return {
    enabled,
    durationMinutes: enabled ? args.durationMinutes : null,
    priceStartingAt: enabled ? args.priceStartingAt : null,
  }
}

export async function GET(req: Request) {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res

    const professionalId = auth.professionalId
    const { searchParams } = new URL(req.url)

    const rawLocationType = searchParams.get('locationType')
    const requestedLocationType = normalizeLocationType(rawLocationType)

    if (rawLocationType && !requestedLocationType) {
      return jsonFail(400, 'Invalid locationType. Use SALON or MOBILE.')
    }

    const offerings = await prisma.professionalServiceOffering.findMany({
      where: {
        professionalId,
        isActive: true,
      },
      select: {
        id: true,
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
            isActive: true,
            defaultDurationMinutes: true,
            category: {
              select: {
                isActive: true,
              },
            },
          },
        },
      },
      orderBy: { service: { name: 'asc' } },
      take: 500,
    })

    const services = offerings
      .map((offering) => {
        const serviceIsAvailable =
          Boolean(offering.service.isActive) &&
          Boolean(offering.service.category?.isActive)

        if (!serviceIsAvailable) {
          return null
        }

        const salonDurationMinutes = normalizeDuration(
          offering.salonDurationMinutes,
          offering.service.defaultDurationMinutes,
        )
        const mobileDurationMinutes = normalizeDuration(
          offering.mobileDurationMinutes,
          offering.service.defaultDurationMinutes,
        )

        const salonPriceStartingAt =
          offering.salonPriceStartingAt != null
            ? moneyToString(offering.salonPriceStartingAt)
            : null

        const mobilePriceStartingAt =
          offering.mobilePriceStartingAt != null
            ? moneyToString(offering.mobilePriceStartingAt)
            : null

        const salon = buildModeDetails({
          enabledByOffering: Boolean(offering.offersInSalon),
          durationMinutes: salonDurationMinutes,
          priceStartingAt: salonPriceStartingAt,
        })

        const mobile = buildModeDetails({
          enabledByOffering: Boolean(offering.offersMobile),
          durationMinutes: mobileDurationMinutes,
          priceStartingAt: mobilePriceStartingAt,
        })

        const supportedLocationTypes = getSupportedLocationTypes({
          salonEnabled: salon.enabled,
          mobileEnabled: mobile.enabled,
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

        const selectedMode =
          selectedLocationType === ServiceLocationType.SALON
            ? {
                locationType: ServiceLocationType.SALON,
                durationMinutes: salon.durationMinutes,
                priceStartingAt: salon.priceStartingAt,
              }
            : selectedLocationType === ServiceLocationType.MOBILE
              ? {
                  locationType: ServiceLocationType.MOBILE,
                  durationMinutes: mobile.durationMinutes,
                  priceStartingAt: mobile.priceStartingAt,
                }
              : null

        return {
          serviceId: offering.service.id,
          name: offering.service.name,
          offeringId: offering.id,

          supportedLocationTypes,
          selectedLocationType,
          requiresLocationTypeSelection,
          selectedMode,

          salon,
          mobile,
        }
      })
      .filter((service): service is NonNullable<typeof service> => service !== null)

    return jsonOk(
      {
        locationType: requestedLocationType,
        services,
      },
      200,
    )
  } catch (e) {
    console.error('GET /api/pro/services error:', e)
    return jsonFail(500, 'Failed to load services.')
  }
}