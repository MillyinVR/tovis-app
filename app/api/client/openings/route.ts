// app/api/client/openings/route.ts
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'
import type { ServiceLocationType } from '@prisma/client'

export const dynamic = 'force-dynamic'

function pickString(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

function normalizeLocationType(v: unknown): ServiceLocationType | null {
  const s = typeof v === 'string' ? v.trim().toUpperCase() : ''
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
    const user = await getCurrentUser().catch(() => null)
    if (!user || user.role !== 'CLIENT' || !user.clientProfile?.id) {
      return NextResponse.json({ error: 'Only clients can view openings.' }, { status: 401 })
    }

    const clientId = user.clientProfile.id
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
      select: {
        id: true,
        tier: true,
        sentAt: true,
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
                city: true,
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

        // Pick a mode to display for this opening card.
        // Note: Opening itself doesn’t store locationType (yet), so we pick:
        // - requestedLocationType if it’s supported
        // - else default to SALON if available, else MOBILE
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
                  location: pro.location ?? pro.city ?? null,
                  timeZone: pro.timeZone ?? null,
                }
              : null,

            offering: off
              ? {
                  id: off.id,
                  title: off.title ?? null,
                  offersInSalon: Boolean(off.offersInSalon),
                  offersMobile: Boolean(off.offersMobile),

                  // UI-friendly fields
                  locationType: effectiveLocationType ?? null,
                  priceStartingAt,
                  durationMinutes,
                }
              : null,
          },
        }
      })
      .filter(Boolean)

    return NextResponse.json({ ok: true, notifications: normalized })
  } catch (e) {
    console.error('GET /api/client/openings error', e)
    return NextResponse.json({ error: 'Failed to load openings.' }, { status: 500 })
  }
}
