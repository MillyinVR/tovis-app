// app/api/pro/services/route.ts
import { prisma } from '@/lib/prisma'
import { jsonFail, jsonOk, requirePro } from '@/app/api/_utils'

export const dynamic = 'force-dynamic'

type RequestedLocationType = 'SALON' | 'MOBILE' | null

function normalizeLocationType(raw: string | null): RequestedLocationType {
  const value = typeof raw === 'string' ? raw.trim().toUpperCase() : ''
  if (value === 'SALON') return 'SALON'
  if (value === 'MOBILE') return 'MOBILE'
  return null
}

export async function GET(req: Request) {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res

    const professionalId = auth.professionalId
    const { searchParams } = new URL(req.url)
    const rawLocationType = searchParams.get('locationType')
    const locationType = normalizeLocationType(rawLocationType)

    if (rawLocationType && !locationType) {
      return jsonFail(400, 'Invalid locationType. Use SALON or MOBILE.')
    }

    const offerings = await prisma.professionalServiceOffering.findMany({
      where: {
        professionalId,
        isActive: true,
        service: { isActive: true },
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
            defaultDurationMinutes: true,
          },
        },
      },
      orderBy: { service: { name: 'asc' } },
      take: 500,
    })

    const services = offerings.flatMap((o) => {
      const salonDuration =
        o.salonDurationMinutes ?? o.service.defaultDurationMinutes ?? null
      const mobileDuration =
        o.mobileDurationMinutes ?? o.service.defaultDurationMinutes ?? null

      const salonPriceStartingAt =
        o.salonPriceStartingAt != null ? o.salonPriceStartingAt.toString() : null
      const mobilePriceStartingAt =
        o.mobilePriceStartingAt != null ? o.mobilePriceStartingAt.toString() : null

      const canBookSalon =
        o.offersInSalon && salonDuration != null && salonPriceStartingAt != null
      const canBookMobile =
        o.offersMobile && mobileDuration != null && mobilePriceStartingAt != null

      if (locationType === 'SALON' && !canBookSalon) return []
      if (locationType === 'MOBILE' && !canBookMobile) return []

      const durationMinutes =
        locationType === 'SALON'
          ? salonDuration
          : locationType === 'MOBILE'
            ? mobileDuration
            : canBookSalon
              ? salonDuration
              : canBookMobile
                ? mobileDuration
                : null

      const priceStartingAt =
        locationType === 'SALON'
          ? salonPriceStartingAt
          : locationType === 'MOBILE'
            ? mobilePriceStartingAt
            : canBookSalon
              ? salonPriceStartingAt
              : canBookMobile
                ? mobilePriceStartingAt
                : null

      return [
        {
          id: String(o.serviceId),
          name: o.service.name,
          offeringId: String(o.id),

          // mode-aware values for the current caller
          durationMinutes,
          priceStartingAt,

          // keep both modes available so callers can evolve without another route change
          offersInSalon: canBookSalon,
          offersMobile: canBookMobile,
          salonDurationMinutes: canBookSalon ? salonDuration : null,
          mobileDurationMinutes: canBookMobile ? mobileDuration : null,
          salonPriceStartingAt: canBookSalon ? salonPriceStartingAt : null,
          mobilePriceStartingAt: canBookMobile ? mobilePriceStartingAt : null,
        },
      ]
    })

    return jsonOk(
      {
        ok: true,
        locationType,
        services,
      },
      200,
    )
  } catch (e) {
    console.error('GET /api/pro/services error:', e)
    return jsonFail(500, 'Failed to load services.')
  }
}