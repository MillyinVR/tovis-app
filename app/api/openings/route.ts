// app/api/openings/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'

export const dynamic = 'force-dynamic'

function pickString(v: unknown) {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

function clampInt(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, Math.trunc(n)))
}

function weekdayKey(d: Date) {
  // JS: 0=Sun ... 6=Sat
  const day = d.getDay()
  if (day === 0) return 'disableSun'
  if (day === 1) return 'disableMon'
  if (day === 2) return 'disableTue'
  if (day === 3) return 'disableWed'
  if (day === 4) return 'disableThu'
  if (day === 5) return 'disableFri'
  return 'disableSat'
}

export async function GET(req: NextRequest) {
  try {
    // Require auth (prevents scraping + matches your UX)
    const user = await getCurrentUser().catch(() => null)
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const url = new URL(req.url)

    // Support hours=48 OR days=2
    const hoursParam = pickString(url.searchParams.get('hours'))
    const daysParam = pickString(url.searchParams.get('days'))
    const takeParam = pickString(url.searchParams.get('take'))

    let hours = 48
    if (hoursParam) {
      const h = Number(hoursParam)
      if (Number.isFinite(h)) hours = clampInt(h, 1, 168) // max 7 days
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

    // Pull "ACTIVE" openings in window, but include:
    // - settings.enabled must be true
    // - offering must be active (so booking link isn't a trap)
    // We'll filter weekday disables in-memory (simple + safe).
    const rows = await prisma.lastMinuteOpening.findMany({
      where: {
        status: 'ACTIVE',
        startAt: { gte: now, lte: horizon },

        // Pro must have last-minute enabled (settings row is always created by your /pro page upsert)
        professional: {
          lastMinuteSettings: {
            is: { enabled: true },
          },
        },

        // If the opening references an offering, ensure it's active.
        // If offeringId can be null in your schema, this still works because relation is optional.
        ...(true
          ? {
              offering: {
                is: { isActive: true },
              },
            }
          : {}),
      },
      orderBy: { startAt: 'asc' },
      take: take * 2, // grab a bit extra because we may filter out disabled weekdays
      select: {
        id: true,
        startAt: true,
        endAt: true,
        discountPct: true,
        note: true,
        offeringId: true,
        serviceId: true,
        professional: {
          select: {
            id: true,
            businessName: true,
            city: true,
            state: true,
            location: true,
            timeZone: true,
            avatarUrl: true,
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
        service: { select: { name: true } },
      },
    })

    // Filter out openings that fall on pro-disabled weekdays
    const filtered = rows.filter((o) => {
      const settings = o.professional?.lastMinuteSettings
      if (!settings) return true
      const key = weekdayKey(new Date(o.startAt))
      return !(settings as any)[key]
    })

    // Trim to requested take
    const openings = filtered.slice(0, take).map((o) => ({
      ...o,
      // don't leak settings into client payload
      professional: {
        ...o.professional,
        lastMinuteSettings: undefined,
      } as any,
    }))

    return NextResponse.json({ ok: true, openings }, { status: 200 })
  } catch (e) {
    console.error('GET /api/openings error', e)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
