// app/api/openings/route.ts
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'
import { jsonFail, jsonOk, pickString } from '@/app/api/_utils'

export const dynamic = 'force-dynamic'

function clampInt(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, Math.trunc(n)))
}

function weekdayKey(d: Date) {
  const day = d.getDay()
  if (day === 0) return 'disableSun'
  if (day === 1) return 'disableMon'
  if (day === 2) return 'disableTue'
  if (day === 3) return 'disableWed'
  if (day === 4) return 'disableThu'
  if (day === 5) return 'disableFri'
  return 'disableSat'
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
        status: 'ACTIVE',
        startAt: { gte: now, lte: horizon },
        professional: { lastMinuteSettings: { is: { enabled: true } } },
        // if offering is attached, require it active
        OR: [{ offeringId: null }, { offering: { is: { isActive: true } } }],
      },
      orderBy: { startAt: 'asc' },
      take: take * 2,
      select: {
        id: true,
        startAt: true,
        endAt: true,
        discountPct: true,
        note: true,
        offeringId: true,
        serviceId: true,
        service: { select: { name: true } },
        professional: {
          select: {
            id: true,
            businessName: true,
            handle: true,
            avatarUrl: true,
            professionType: true,
            location: true, // ✅ from ProfessionalProfile
            timeZone: true,
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
            // ✅ also pull primary location details (city/state exist here)
            locations: {
              where: { isPrimary: true },
              take: 1,
              select: { city: true, state: true, formattedAddress: true },
            },
          },
        },
      },
    })

    const filtered = rows.filter((o) => {
      const s = o.professional?.lastMinuteSettings
      if (!s) return true
      const key = weekdayKey(new Date(o.startAt))
      return !(s as any)[key]
    })

    const openings = filtered.slice(0, take).map((o) => {
      const primaryLoc = o.professional.locations?.[0] ?? null
      return {
        id: o.id,
        startAt: o.startAt,
        endAt: o.endAt ?? null,
        discountPct: o.discountPct ?? null,
        note: o.note ?? null,
        offeringId: o.offeringId ?? null,
        serviceId: o.serviceId ?? null,
        serviceName: o.service?.name ?? null,
        professional: {
          id: o.professional.id,
          businessName: o.professional.businessName ?? null,
          handle: o.professional.handle ?? null,
          avatarUrl: o.professional.avatarUrl ?? null,
          professionType: o.professional.professionType ?? null,
          timeZone: o.professional.timeZone ?? null,
          location: o.professional.location ?? null, // display string
          city: primaryLoc?.city ?? null,
          state: primaryLoc?.state ?? null,
          formattedAddress: primaryLoc?.formattedAddress ?? null,
        },
      }
    })

    return jsonOk({ openings })
  } catch (e) {
    console.error('GET /api/openings error', e)
    return jsonFail(500, 'Internal server error')
  }
}
