// app/api/openings/[openingId]/notify/route.ts
import { prisma } from '@/lib/prisma'
import { isValidIanaTimeZone, startOfDayUtcInTimeZone, getZonedParts } from '@/lib/timeZone'
import { jsonFail, jsonOk, pickString, requirePro } from '@/app/api/_utils'
import {
  BookingStatus,
  OpeningStatus,
  WaitlistStatus,
  OpeningTier,
  WaitlistPreferenceType,
  WaitlistTimeOfDay,
} from '@prisma/client'

export const dynamic = 'force-dynamic'

function daysAgo(n: number): Date {
  return new Date(Date.now() - n * 24 * 60 * 60_000)
}

function isNonEmptyString(x: unknown): x is string {
  return typeof x === 'string' && x.trim().length > 0
}

function requireOpeningTimeZone(raw: unknown): string | null {
  const s = typeof raw === 'string' ? raw.trim() : ''
  if (!s) return null
  if (!isValidIanaTimeZone(s)) return null
  return s
}

type Tier = 'TIER1_WAITLIST_LAPSED' | 'TIER2_FAVORITE_VIEWER'
type Ctx = { params: Promise<{ openingId: string }> | { openingId: string } }
type Candidate = { clientId: string; tier: Tier }

function toOpeningTier(tier: Tier): OpeningTier {
  if (tier === 'TIER1_WAITLIST_LAPSED') return OpeningTier.TIER1_WAITLIST_LAPSED
  return OpeningTier.TIER2_FAVORITE_VIEWER
}

function timeOfDayForHour(hour: number): WaitlistTimeOfDay {
  if (hour < 12) return WaitlistTimeOfDay.MORNING
  if (hour < 17) return WaitlistTimeOfDay.AFTERNOON
  return WaitlistTimeOfDay.EVENING
}

function sameZonedDate(a: Date, b: Date, timeZone: string): boolean {
  const aParts = getZonedParts(a, timeZone)
  const bParts = getZonedParts(b, timeZone)

  return (
    aParts.year === bParts.year &&
    aParts.month === bParts.month &&
    aParts.day === bParts.day
  )
}

function minuteOfDayInTimeZone(d: Date, timeZone: string): number {
  const parts = getZonedParts(d, timeZone)
  return parts.hour * 60 + parts.minute
}

function waitlistEntryMatchesOpening(args: {
  openingStartAt: Date
  openingTimeZone: string
  preferenceType: WaitlistPreferenceType
  specificDate: Date | null
  timeOfDay: WaitlistTimeOfDay | null
  windowStartMin: number | null
  windowEndMin: number | null
}): boolean {
  const {
    openingStartAt,
    openingTimeZone,
    preferenceType,
    specificDate,
    timeOfDay,
    windowStartMin,
    windowEndMin,
  } = args

  if (preferenceType === WaitlistPreferenceType.ANY_TIME) {
    return true
  }

  if (preferenceType === WaitlistPreferenceType.TIME_OF_DAY) {
    if (!timeOfDay) return false
    const openingHour = getZonedParts(openingStartAt, openingTimeZone).hour
    return timeOfDayForHour(openingHour) === timeOfDay
  }

  if (preferenceType === WaitlistPreferenceType.SPECIFIC_DATE) {
    if (!specificDate) return false
    return sameZonedDate(openingStartAt, specificDate, openingTimeZone)
  }

  if (windowStartMin == null || windowEndMin == null) {
    return false
  }

  const openingMinute = minuteOfDayInTimeZone(openingStartAt, openingTimeZone)
  return openingMinute >= windowStartMin && openingMinute < windowEndMin
}

export async function POST(_req: Request, ctx: Ctx) {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res
    const proId = auth.professionalId

    const params = await Promise.resolve(ctx.params)
    const openingId = pickString(params.openingId)
    if (!openingId) return jsonFail(400, 'Missing openingId.')

    const opening = await prisma.lastMinuteOpening.findUnique({
      where: { id: openingId },
      select: {
        id: true,
        status: true,
        professionalId: true,
        serviceId: true,
        timeZone: true,
        startAt: true,
      },
    })

    if (!opening) return jsonFail(404, 'Opening not found.')
    if (opening.professionalId !== proId) return jsonFail(403, 'Forbidden.')
    if (opening.status !== OpeningStatus.ACTIVE) return jsonFail(409, 'Opening is not ACTIVE.')

    const lm = await prisma.lastMinuteSettings.findUnique({
      where: { professionalId: proId },
      select: { enabled: true },
    })
    if (!lm?.enabled) {
      return jsonFail(409, 'Last-minute openings are disabled for this professional.')
    }

    const openingTz = requireOpeningTimeZone(opening.timeZone)
    if (!openingTz) {
      return jsonFail(
        409,
        'Opening is missing a valid appointment timezone. Recreate the opening after setting a valid location timezone.',
      )
    }

    const now = new Date()
    const eightWeeksAgo = daysAgo(56)

    const waitlistEntries = await prisma.waitlistEntry.findMany({
      where: {
        professionalId: proId,
        status: WaitlistStatus.ACTIVE,
        ...(opening.serviceId ? { serviceId: opening.serviceId } : {}),
      },
      select: {
        clientId: true,
        preferenceType: true,
        specificDate: true,
        timeOfDay: true,
        windowStartMin: true,
        windowEndMin: true,
      },
      take: 1000,
    })

    const matchedWaitlistClientIds = Array.from(
      new Set(
        waitlistEntries
          .filter((entry) =>
            waitlistEntryMatchesOpening({
              openingStartAt: opening.startAt,
              openingTimeZone: openingTz,
              preferenceType: entry.preferenceType,
              specificDate: entry.specificDate,
              timeOfDay: entry.timeOfDay,
              windowStartMin: entry.windowStartMin,
              windowEndMin: entry.windowEndMin,
            }),
          )
          .map((entry) => entry.clientId)
          .filter(isNonEmptyString),
      ),
    )

    const upcoming = await prisma.booking.findMany({
      where: {
        professionalId: proId,
        scheduledFor: { gte: now },
        NOT: { status: BookingStatus.CANCELLED },
      },
      select: { clientId: true },
      distinct: ['clientId'],
      take: 5000,
    })
    const hasUpcoming = new Set(upcoming.map((b) => b.clientId).filter(isNonEmptyString))

    const lastBookings = await prisma.booking.findMany({
      where: {
        professionalId: proId,
        scheduledFor: { lt: now },
        NOT: { status: BookingStatus.CANCELLED },
      },
      orderBy: { scheduledFor: 'desc' },
      distinct: ['clientId'],
      select: { clientId: true, scheduledFor: true },
      take: 5000,
    })

    const lastByClient = new Map<string, Date>()
    for (const b of lastBookings) {
      if (isNonEmptyString(b.clientId)) {
        lastByClient.set(b.clientId, b.scheduledFor)
      }
    }

    const tier1ClientIds = matchedWaitlistClientIds.filter((clientId) => {
      return !hasUpcoming.has(clientId)
    })

    const favorites = await prisma.professionalFavorite.findMany({
      where: { professionalId: proId },
      select: { userId: true },
      take: 5000,
    })
    const favoriterUserIds = favorites.map((f) => f.userId).filter(isNonEmptyString)

    const favoriteClients = favoriterUserIds.length
      ? await prisma.clientProfile.findMany({
          where: { userId: { in: favoriterUserIds } },
          select: { id: true },
          take: 5000,
        })
      : []

    const favoriteClientIds = favoriteClients.map((c) => c.id).filter(isNonEmptyString)

    const everBooked = await prisma.booking.findMany({
      where: {
        professionalId: proId,
        NOT: { status: BookingStatus.CANCELLED },
      },
      select: { clientId: true },
      distinct: ['clientId'],
      take: 10000,
    })
    const everBookedSet = new Set(everBooked.map((b) => b.clientId).filter(isNonEmptyString))

    const tier1Set = new Set(tier1ClientIds)
    const tier2ClientIds = favoriteClientIds.filter(
      (clientId) => !tier1Set.has(clientId) && !everBookedSet.has(clientId),
    )

    const tier1Candidates: Candidate[] = tier1ClientIds.map((clientId) => ({
      clientId,
      tier: 'TIER1_WAITLIST_LAPSED',
    }))

    const tier2Candidates: Candidate[] = tier2ClientIds.map((clientId) => ({
      clientId,
      tier: 'TIER2_FAVORITE_VIEWER',
    }))

    const candidates: Candidate[] = [...tier1Candidates, ...tier2Candidates]

    if (!candidates.length) {
      return jsonOk({ openingId, created: 0, reason: 'No eligible recipients' })
    }

    const candidateIds = Array.from(new Set(candidates.map((c) => c.clientId)))

    const notifSettings = await prisma.clientNotificationSettings.findMany({
      where: { clientId: { in: candidateIds } },
      select: { clientId: true, lastMinuteEnabled: true, maxLastMinutePerDay: true },
    })

    const settingsByClient = new Map(
      notifSettings.map((s) => [
        s.clientId,
        { enabled: s.lastMinuteEnabled, max: s.maxLastMinutePerDay },
      ]),
    )

    const todayStartUtc = startOfDayUtcInTimeZone(now, openingTz)

    const counts = await prisma.openingNotification.groupBy({
      by: ['clientId'],
      where: {
        clientId: { in: candidateIds },
        sentAt: { gte: todayStartUtc },
      },
      _count: { _all: true },
    })
    const sentTodayByClient = new Map(counts.map((c) => [c.clientId, c._count._all]))

    const remainingByClient = new Map<string, number>()
    for (const clientId of candidateIds) {
      const settings = settingsByClient.get(clientId)
      if (settings?.enabled === false) {
        remainingByClient.set(clientId, 0)
        continue
      }

      const max = typeof settings?.max === 'number' ? settings.max : 2
      const sent = sentTodayByClient.get(clientId) ?? 0
      remainingByClient.set(clientId, Math.max(0, max - sent))
    }

    const toCreate: Array<{
      openingId: string
      clientId: string
      tier: OpeningTier
      dedupeKey: string
    }> = []

    for (const candidate of candidates) {
      const remaining = remainingByClient.get(candidate.clientId) ?? 0
      if (remaining <= 0) continue

      toCreate.push({
        openingId,
        clientId: candidate.clientId,
        tier: toOpeningTier(candidate.tier),
        dedupeKey: `${openingId}:${candidate.clientId}:${candidate.tier}`,
      })

      remainingByClient.set(candidate.clientId, remaining - 1)
    }

    if (!toCreate.length) {
      return jsonOk({ openingId, created: 0, reason: 'All candidates blocked by settings/daily limits' })
    }

    const created = await prisma.openingNotification.createMany({
      data: toCreate,
      skipDuplicates: true,
    })

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