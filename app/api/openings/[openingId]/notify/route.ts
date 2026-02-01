// app/api/openings/[openingId]/notify/route.ts
import { prisma } from '@/lib/prisma'
import { isValidIanaTimeZone, startOfDayUtcInTimeZone } from '@/lib/timeZone'
import { jsonFail, jsonOk, pickString, requirePro } from '@/app/api/_utils'

export const dynamic = 'force-dynamic'

function daysAgo(n: number) {
  return new Date(Date.now() - n * 24 * 60 * 60_000)
}

/**
 * ✅ STRICT: opening tz must be present AND valid IANA
 * No LA fallback. No pro profile fallback. No guessing.
 */
function requireOpeningTimeZone(raw: unknown): string | null {
  const s = typeof raw === 'string' ? raw.trim() : ''
  if (!s) return null
  if (!isValidIanaTimeZone(s)) return null
  return s
}

type Tier = 'TIER1_WAITLIST_LAPSED' | 'TIER2_FAVORITE_VIEWER'

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ openingId: string }> | { openingId: string } },
) {
  try {
    const auth = await requirePro()
    if (auth.res) return auth.res

    // ✅ no legacy: requirePro is the only truth
    const proId = pickString(auth.professionalId)
    if (!proId) return jsonFail(401, 'Unauthorized.')

    const { openingId: raw } = await Promise.resolve(ctx.params as any)
    const openingId = pickString(raw)
    if (!openingId) return jsonFail(400, 'Missing openingId.')

    const opening = await prisma.lastMinuteOpening.findUnique({
      where: { id: openingId },
      select: {
        id: true,
        status: true,
        professionalId: true,
        serviceId: true,
        timeZone: true, // ✅ schema truth (required)
        startAt: true,
      },
    })

    if (!opening) return jsonFail(404, 'Opening not found.')
    if (opening.professionalId !== proId) return jsonFail(403, 'Forbidden.')
    if (opening.status !== 'ACTIVE') return jsonFail(409, 'Opening is not ACTIVE.')

    const lm = await prisma.lastMinuteSettings.findUnique({
      where: { professionalId: proId },
      select: { enabled: true },
    })
    if (!lm?.enabled) return jsonFail(409, 'Last-minute openings are disabled for this professional.')

    // ✅ DAILY THROTTLE ANCHOR = OPENING TZ (what users feel)
    const openingTz = requireOpeningTimeZone(opening.timeZone)
    if (!openingTz) {
      return jsonFail(
        409,
        'Opening is missing a valid appointment timezone. Recreate the opening after setting a valid location timezone.',
      )
    }

    const now = new Date()
    const eightWeeksAgo = daysAgo(56)

    // ---- Tier 1: waitlist + lapsed + no future bookings ----
    const waitlist = await prisma.waitlistEntry.findMany({
      where: {
        professionalId: proId,
        status: 'ACTIVE',
        ...(opening.serviceId ? { serviceId: opening.serviceId } : {}),
      },
      select: { clientId: true },
      distinct: ['clientId'],
      take: 1000,
    })
    const waitlistClientIds = waitlist.map((w) => w.clientId).filter(Boolean)

    const upcoming = await prisma.booking.findMany({
      where: { professionalId: proId, scheduledFor: { gte: now }, NOT: { status: 'CANCELLED' } },
      select: { clientId: true },
      distinct: ['clientId'],
      take: 5000,
    })
    const hasUpcoming = new Set(upcoming.map((b) => b.clientId).filter(Boolean))

    const lastBookings = await prisma.booking.findMany({
      where: { professionalId: proId, scheduledFor: { lt: now }, NOT: { status: 'CANCELLED' } },
      orderBy: { scheduledFor: 'desc' },
      distinct: ['clientId'],
      select: { clientId: true, scheduledFor: true },
      take: 5000,
    })

    const lastByClient = new Map<string, Date>()
    for (const b of lastBookings) {
      if (b.clientId) lastByClient.set(b.clientId, b.scheduledFor)
    }

    const tier1ClientIds = waitlistClientIds.filter((clientId) => {
      if (hasUpcoming.has(clientId)) return false
      const last = lastByClient.get(clientId)
      return Boolean(last && last.getTime() <= eightWeeksAgo.getTime())
    })

    // ---- Tier 2: favorited pro + never booked pro ----
    const favorites = await prisma.professionalFavorite.findMany({
      where: { professionalId: proId },
      select: { userId: true },
      take: 5000,
    })
    const favoriterUserIds = favorites.map((f) => f.userId).filter(Boolean)

    const favoriteClients = favoriterUserIds.length
      ? await prisma.clientProfile.findMany({
          where: { userId: { in: favoriterUserIds } },
          select: { id: true },
          take: 5000,
        })
      : []
    const favoriteClientIds = favoriteClients.map((c) => c.id).filter(Boolean)

    const everBooked = await prisma.booking.findMany({
      where: { professionalId: proId, NOT: { status: 'CANCELLED' } },
      select: { clientId: true },
      distinct: ['clientId'],
      take: 10000,
    })
    const everBookedSet = new Set(everBooked.map((b) => b.clientId).filter(Boolean))

    const tier1Set = new Set(tier1ClientIds)
    const tier2ClientIds = favoriteClientIds.filter((cid) => !tier1Set.has(cid) && !everBookedSet.has(cid))

    const candidates: Array<{ clientId: string; tier: Tier }> = [
      ...tier1ClientIds.map((clientId) => ({ clientId, tier: 'TIER1_WAITLIST_LAPSED' as const })),
      ...tier2ClientIds.map((clientId) => ({ clientId, tier: 'TIER2_FAVORITE_VIEWER' as const })),
    ]

    if (!candidates.length) {
      return jsonOk({ openingId, created: 0, reason: 'No eligible recipients' })
    }

    // unique client list for settings + counts
    const candidateIds = Array.from(new Set(candidates.map((c) => c.clientId))).filter(Boolean)

    const notifSettings = await prisma.clientNotificationSettings.findMany({
      where: { clientId: { in: candidateIds } },
      select: { clientId: true, lastMinuteEnabled: true, maxLastMinutePerDay: true },
    })

    const settingsByClient = new Map(
      notifSettings.map((s) => [s.clientId, { enabled: s.lastMinuteEnabled, max: s.maxLastMinutePerDay }]),
    )

    /**
     * ✅ “Today” is defined in the OPENING/APPOINTMENT timezone.
     * This ensures daily throttles match what users experience.
     */
    const todayStartUtc = startOfDayUtcInTimeZone(now, openingTz)

    const counts = await prisma.openingNotification.groupBy({
      by: ['clientId'],
      where: { clientId: { in: candidateIds }, sentAt: { gte: todayStartUtc } },
      _count: { _all: true },
    })
    const sentTodayByClient = new Map(counts.map((c) => [c.clientId, c._count._all]))

    /**
     * ✅ IMPORTANT FIX:
     * Enforce max-per-day *within this batch* too.
     * Otherwise a client in multiple tiers could exceed their daily cap in one request.
     *
     * We keep your tier priority by iterating candidates in order (tier1 then tier2).
     */
    const remainingByClient = new Map<string, number>()
    for (const cid of candidateIds) {
      const s = settingsByClient.get(cid)
      if (s?.enabled === false) {
        remainingByClient.set(cid, 0)
        continue
      }
      const max = typeof s?.max === 'number' ? s.max : 2
      const sent = sentTodayByClient.get(cid) ?? 0
      remainingByClient.set(cid, Math.max(0, max - sent))
    }

    const toCreate: Array<{ openingId: string; clientId: string; tier: Tier; dedupeKey: string }> = []

    for (const c of candidates) {
      const remaining = remainingByClient.get(c.clientId) ?? 0
      if (remaining <= 0) continue

      toCreate.push({
        openingId,
        clientId: c.clientId,
        tier: c.tier,
        dedupeKey: `${openingId}:${c.clientId}:${c.tier}`,
      })

      remainingByClient.set(c.clientId, remaining - 1)
    }

    if (!toCreate.length) {
      return jsonOk({ openingId, created: 0, reason: 'All candidates blocked by settings/daily limits' })
    }

    const created = await prisma.openingNotification.createMany({ data: toCreate, skipDuplicates: true })

    return jsonOk(
      {
        openingId,
        created: created.count,
        tier1: tier1ClientIds.length,
        tier2: tier2ClientIds.length,
        openingTz,
        todayStartUtc: todayStartUtc.toISOString(),
        openingStartAt: opening.startAt.toISOString(),
      },
      201,
    )
  } catch (e) {
    console.error('POST /api/openings/[openingId]/notify error', e)
    return jsonFail(500, 'Internal server error')
  }
}
