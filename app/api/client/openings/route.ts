// app/api/client/openings/route.ts
import { prisma } from '@/lib/prisma'
import type { ServiceLocationType } from '@prisma/client'
import { requireClient, pickString, upper, jsonFail, jsonOk } from '@/app/api/_utils'

export const dynamic = 'force-dynamic'

function normalizeLocationType(v: unknown): ServiceLocationType | null {
  const s = upper(v)
  if (s === 'SALON') return 'SALON'
  if (s === 'MOBILE') return 'MOBILE'
  return null
}

function pickEffectiveLocationType(args: {
  requested: ServiceLocationType | null
  offersInSalon: boolean
  offersMobile: boolean
}): ServiceLocationType | null {
  const { requested, offersInSalon, offersMobile } = args
  if (requested === 'SALON' && offersInSalon) return 'SALON'
  if (requested === 'MOBILE' && offersMobile) return 'MOBILE'
  if (offersInSalon) return 'SALON'
  if (offersMobile) return 'MOBILE'
  return null
}

function pickModeFields(
  offering: {
    salonPriceStartingAt: any | null
    salonDurationMinutes: number | null
    mobilePriceStartingAt: any | null
    mobileDurationMinutes: number | null
  },
  locationType: ServiceLocationType,
) {
  const priceStartingAt =
    locationType === 'MOBILE' ? offering.mobilePriceStartingAt : offering.salonPriceStartingAt
  const durationMinutes =
    locationType === 'MOBILE' ? offering.mobileDurationMinutes : offering.salonDurationMinutes

  return {
    priceStartingAt: priceStartingAt ?? null,
    durationMinutes: durationMinutes ?? null,
  }
}

function pickConservativeDuration(offering: {
  salonDurationMinutes: number | null
  mobileDurationMinutes: number | null
}) {
  const a = Number(offering.salonDurationMinutes ?? 0)
  const b = Number(offering.mobileDurationMinutes ?? 0)
  const m = Math.max(a, b)
  return Number.isFinite(m) && m > 0 ? m : 60
}

export async function GET(req: Request) {
  try {
    const auth = await requireClient()
    if (auth.res) return auth.res
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
          status: 'ACTIVE',
          ...(serviceId ? { serviceId } : {}),
          ...(professionalId ? { professionalId } : {}),
        },
      },
      orderBy: { sentAt: 'desc' },
      take: 50,
      include: {
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
            service: { select: { id: true, name: true } },
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
      .map((n) => {
        const o = n.opening
        if (!o) return null

        const off = o.offering
        const pro = o.professional

        let effectiveLocationType: ServiceLocationType | null = null
        if (off) {
          effectiveLocationType = pickEffectiveLocationType({
            requested: requestedLocationType,
            offersInSalon: Boolean(off.offersInSalon),
            offersMobile: Boolean(off.offersMobile),
          })
        } else {
          effectiveLocationType = requestedLocationType
        }

        let priceStartingAt: any | null = null
        let durationMinutes: number | null = null

        if (off && effectiveLocationType) {
          const picked = pickModeFields(off, effectiveLocationType)
          priceStartingAt = picked.priceStartingAt
          durationMinutes = picked.durationMinutes
          if (durationMinutes == null) durationMinutes = pickConservativeDuration(off)
        } else if (off) {
          durationMinutes = pickConservativeDuration(off)
        }

        return {
          id: n.id,
          tier: n.tier,
          sentAt: n.sentAt,
          deliveredAt: n.deliveredAt,
          openedAt: n.openedAt,
          clickedAt: n.clickedAt,
          bookedAt: n.bookedAt,

          opening: {
            id: o.id,
            status: o.status,
            startAt: o.startAt,
            endAt: o.endAt ?? null,
            discountPct: o.discountPct ?? null,
            note: o.note ?? null,

            service: o.service ? { id: o.service.id, name: o.service.name } : null,

            professional: pro
              ? {
                  id: pro.id,
                  businessName: pro.businessName ?? null,
                  avatarUrl: pro.avatarUrl ?? null,
                  location: pro.location ?? null,
                  timeZone: pro.timeZone ?? null,
                }
              : null,

            offering: off
              ? {
                  id: off.id,
                  title: off.title ?? null,
                  offersInSalon: Boolean(off.offersInSalon),
                  offersMobile: Boolean(off.offersMobile),

                  locationType: effectiveLocationType ?? null,
                  priceStartingAt,
                  durationMinutes,
                }
              : null,
          },
        }
      })
      .filter(Boolean)

    return jsonOk({ ok: true, notifications: normalized })
  } catch (e) {
    console.error('GET /api/client/openings error', e)
    return jsonFail(500, 'Failed to load openings.')
  }
}
