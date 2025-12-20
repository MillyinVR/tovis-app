// app/api/openings/[openingId]/notify/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'

export const dynamic = 'force-dynamic'

function daysAgo(n: number) {
  return new Date(Date.now() - n * 24 * 60 * 60_000)
}

function startOfLocalDay(d = new Date()) {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}

export async function POST(_req: NextRequest, context: { params: Promise<{ openingId: string }> }) {
  try {
    const user = await getCurrentUser().catch(() => null)
    if (!user || user.role !== 'PRO' || !user.professionalProfile?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { openingId } = await context.params
    if (!openingId) return NextResponse.json({ error: 'Missing openingId' }, { status: 400 })

    const proId = user.professionalProfile.id

    const opening = await prisma.lastMinuteOpening.findUnique({
      where: { id: openingId },
      select: {
        id: true,
        status: true,
        startAt: true,
        professionalId: true,
        serviceId: true,
        offeringId: true,
      },
    })

    if (!opening) return NextResponse.json({ error: 'Opening not found.' }, { status: 404 })
    if (opening.professionalId !== proId) return NextResponse.json({ error: 'Forbidden.' }, { status: 403 })
    if (opening.status !== 'ACTIVE') {
      return NextResponse.json({ error: 'Opening is not ACTIVE.' }, { status: 409 })
    }

    const lm = await prisma.lastMinuteSettings.findUnique({
      where: { professionalId: proId },
      select: { enabled: true },
    })
    if (!lm?.enabled) {
      return NextResponse.json({ error: 'Last-minute openings are disabled for this professional.' }, { status: 409 })
    }

    const now = new Date()
    const eightWeeksAgo = daysAgo(56)

    // -----------------------------
    // Tier 1: waitlist + lapsed + no future bookings
    // -----------------------------
    const waitlist = await prisma.waitlistEntry.findMany({
      where: {
        professionalId: proId,
        status: 'ACTIVE',
        ...(opening.serviceId ? { serviceId: opening.serviceId } : {}),
      },
      select: { clientId: true },
      distinct: ['clientId'],
      take: 500,
    })
    const waitlistClientIds = waitlist.map((w) => w.clientId)

    const upcoming = await prisma.booking.findMany({
      where: {
        professionalId: proId,
        scheduledFor: { gte: now },
        NOT: { status: 'CANCELLED' },
      },
      select: { clientId: true },
      distinct: ['clientId'],
      take: 2000,
    })
    const hasUpcoming = new Set(upcoming.map((b) => b.clientId))

    const lastBookings = await prisma.booking.findMany({
      where: {
        professionalId: proId,
        scheduledFor: { lt: now },
        NOT: { status: 'CANCELLED' },
      },
      orderBy: { scheduledFor: 'desc' },
      distinct: ['clientId'],
      select: { clientId: true, scheduledFor: true },
      take: 5000,
    })

    const lastByClient = new Map<string, Date>()
    for (const b of lastBookings) lastByClient.set(b.clientId, b.scheduledFor)

    const tier1ClientIds = waitlistClientIds.filter((clientId) => {
      if (hasUpcoming.has(clientId)) return false
      const last = lastByClient.get(clientId)
      if (!last) return false
      return last.getTime() <= eightWeeksAgo.getTime()
    })

    // -----------------------------
    // Tier 2: favorited pro + never booked this pro
    // -----------------------------
    const favorites = await prisma.professionalFavorite.findMany({
      where: { professionalId: proId },
      select: { userId: true },
      take: 5000,
    })
    const favoriterUserIds = favorites.map((f) => f.userId)

    const favoriteClients = await prisma.clientProfile.findMany({
      where: { userId: { in: favoriterUserIds } },
      select: { id: true },
      take: 5000,
    })
    const favoriteClientIds = favoriteClients.map((c) => c.id)

    const everBooked = await prisma.booking.findMany({
      where: { professionalId: proId, NOT: { status: 'CANCELLED' } },
      select: { clientId: true },
      distinct: ['clientId'],
      take: 10000,
    })
    const everBookedSet = new Set(everBooked.map((b) => b.clientId))

    const tier1Set = new Set(tier1ClientIds)
    const tier2ClientIds = favoriteClientIds.filter((cid) => !tier1Set.has(cid) && !everBookedSet.has(cid))

    const candidates = [
      ...tier1ClientIds.map((id) => ({ clientId: id, tier: 'TIER1_WAITLIST_LAPSED' as const })),
      ...tier2ClientIds.map((id) => ({ clientId: id, tier: 'TIER2_FAVORITE_VIEWER' as const })),
    ]

    if (candidates.length === 0) {
      return NextResponse.json({ ok: true, openingId, created: 0, reason: 'No eligible recipients' }, { status: 200 })
    }

    const candidateIds = Array.from(new Set(candidates.map((c) => c.clientId)))

    const notifSettings = await prisma.clientNotificationSettings.findMany({
      where: { clientId: { in: candidateIds } },
      select: { clientId: true, lastMinuteEnabled: true, maxLastMinutePerDay: true },
    })
    const settingsByClient = new Map(
      notifSettings.map((s) => [s.clientId, { enabled: s.lastMinuteEnabled, max: s.maxLastMinutePerDay }]),
    )

    const todayStart = startOfLocalDay(new Date())
    const counts = await prisma.openingNotification.groupBy({
      by: ['clientId'],
      where: { clientId: { in: candidateIds }, sentAt: { gte: todayStart } },
      _count: { _all: true },
    })
    const sentTodayByClient = new Map(counts.map((c) => [c.clientId, c._count._all]))

    const toCreate = candidates
      .filter((c) => {
        const s = settingsByClient.get(c.clientId)
        if (s && s.enabled === false) return false
        const max = s?.max ?? 2
        const sent = sentTodayByClient.get(c.clientId) ?? 0
        return sent < max
      })
      .map((c) => ({
        openingId,
        clientId: c.clientId,
        tier: c.tier,
        dedupeKey: `${openingId}:${c.clientId}:${c.tier}`,
      }))

    if (toCreate.length === 0) {
      return NextResponse.json(
        { ok: true, openingId, created: 0, reason: 'All candidates blocked by settings/daily limits' },
        { status: 200 },
      )
    }

    const created = await prisma.openingNotification.createMany({
      data: toCreate,
      skipDuplicates: true,
    })

    return NextResponse.json(
      {
        ok: true,
        openingId,
        created: created.count,
        tier1: tier1ClientIds.length,
        tier2: tier2ClientIds.length,
      },
      { status: 201 },
    )
  } catch (e) {
    console.error('POST /api/openings/[openingId]/notify error', e)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
