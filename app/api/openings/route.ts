// app/api/openings/route.ts
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'
import { jsonFail, jsonOk, pickString } from '@/app/api/_utils'
import { OpeningStatus } from '@prisma/client'
import { sanitizeTimeZone } from '@/lib/timeZone'

export const dynamic = 'force-dynamic'

function clampInt(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, Math.trunc(n)))
}

type DisableKey =
  | 'disableMon'
  | 'disableTue'
  | 'disableWed'
  | 'disableThu'
  | 'disableFri'
  | 'disableSat'
  | 'disableSun'

function weekdayDisableKeyInTimeZone(d: Date, timeZone: string): DisableKey {
  const tz = sanitizeTimeZone(timeZone, 'UTC')
  const wd = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' }).format(d)
  switch (wd) {
    case 'Sun':
      return 'disableSun'
    case 'Mon':
      return 'disableMon'
    case 'Tue':
      return 'disableTue'
    case 'Wed':
      return 'disableWed'
    case 'Thu':
      return 'disableThu'
    case 'Fri':
      return 'disableFri'
    default:
      return 'disableSat'
  }
}

export async function GET(req: Request) {
  try {
    const user = await getCurrentUser().catch(() => null)
    if (!user) return jsonFail(401, 'Unauthorized.')

    const url = new URL(req.url)

    const hoursParam = pickString(url.searchParams.get('hours'))
    const daysParam = pickString(url.searchParams.get('days'))
    const takeParam = pickString(url.searchParams.get('take'))

    let hours = 48
    if (hoursParam) {
      const h = Number(hoursParam)
      if (Number.isFinite(h)) hours = clampInt(h, 1, 168)
    } else if (daysParam) {
      const d = Number(daysParam)
      if (Number.isFinite(d)) hours = clampInt(d * 24, 1, 168)
    }

    const take = (() => {
      const t = Number(takeParam ?? 50)
      return Number.isFinite(t) ? clampInt(t, 1, 100) : 50
    })()

    const now = new Date()
    const horizon = new Date(Date.now() + hours * 60 * 60_000)

    const rows = await prisma.lastMinuteOpening.findMany({
      where: {
        status: OpeningStatus.ACTIVE,
        startAt: { gte: now, lte: horizon },
        professional: { lastMinuteSettings: { is: { enabled: true } } },
        OR: [{ offeringId: null }, { offering: { is: { isActive: true } } }],
      },
      orderBy: { startAt: 'asc' },
      take: take * 2, // grab extra so filtering doesn’t starve the list
      select: {
        id: true,
        startAt: true,
        endAt: true,
        discountPct: true,
        note: true,
        offeringId: true,
        serviceId: true,

        // ✅ single source of truth fields
        timeZone: true,
        locationType: true,
        locationId: true,

        service: { select: { name: true } },
        location: {
          select: {
            city: true,
            state: true,
            formattedAddress: true,
          },
        },
        professional: {
          select: {
            id: true,
            businessName: true,
            handle: true,
            avatarUrl: true,
            professionType: true,
            location: true, // display string
            lastMinuteSettings: {
              select: {
                disableMon: true,
                disableTue: true,
                disableWed: true,
                disableThu: true,
                disableFri: true,
                disableSat: true,
                disableSun: true,
              },
            },
          },
        },
      },
    })

    // Filter out openings that fall on a disabled weekday (evaluated in the OPENING timezone)
    const filtered = rows.filter((o) => {
      const s = o.professional.lastMinuteSettings
      if (!s) return true
      const key = weekdayDisableKeyInTimeZone(o.startAt, o.timeZone)
      return !s[key]
    })

    const openings = filtered.slice(0, take).map((o) => ({
      id: o.id,
      startAt: o.startAt.toISOString(),
      endAt: o.endAt ? o.endAt.toISOString() : null,
      discountPct: o.discountPct ?? null,
      note: o.note ?? null,
      offeringId: o.offeringId ?? null,
      serviceId: o.serviceId ?? null,
      serviceName: o.service?.name ?? null,

      // ✅ truth
      timeZone: o.timeZone,
      locationType: o.locationType,
      locationId: o.locationId,

      professional: {
        id: o.professional.id,
        businessName: o.professional.businessName ?? null,
        handle: o.professional.handle ?? null,
        avatarUrl: o.professional.avatarUrl ?? null,
        professionType: o.professional.professionType ?? null,
        location: o.professional.location ?? null,
      },

      // ✅ truth location (from ProfessionalLocation)
      city: o.location.city ?? null,
      state: o.location.state ?? null,
      formattedAddress: o.location.formattedAddress ?? null,
    }))

    return jsonOk({ openings })
  } catch (e) {
    console.error('GET /api/openings error', e)
    return jsonFail(500, 'Internal server error')
  }
}