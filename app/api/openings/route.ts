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

export async function GET(req: NextRequest) {
  try {
    // Require a logged-in client (keeps the feed from being scraped + matches your UX)
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

    const openings = await prisma.lastMinuteOpening.findMany({
      where: {
        status: 'ACTIVE',
        startAt: { gte: now, lte: horizon },
      },
      orderBy: { startAt: 'asc' },
      take,
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
          },
        },
        service: { select: { name: true } },
      },
    })

    return NextResponse.json({ ok: true, openings }, { status: 200 })
  } catch (e) {
    console.error('GET /api/openings error', e)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
