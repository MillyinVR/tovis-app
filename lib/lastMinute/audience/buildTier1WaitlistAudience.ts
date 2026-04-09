// lib/lastMinute/audience/buildTier1WaitlistAudience.ts
import { getZonedParts, isValidIanaTimeZone } from '@/lib/timeZone'
import {
  LastMinuteTier,
  Prisma,
  WaitlistPreferenceType,
  WaitlistStatus,
  WaitlistTimeOfDay,
} from '@prisma/client'
import {
  mergeAndDedupeRecipients,
  type LastMinuteAudienceCandidate,
  type LastMinuteDbClient,
} from './mergeAndDedupeRecipients'

export type Tier1WaitlistCandidate = LastMinuteAudienceCandidate

const openingForTier1Select = {
  id: true,
  professionalId: true,
  startAt: true,
  timeZone: true,
  services: {
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    select: {
      serviceId: true,
    },
  },
} satisfies Prisma.LastMinuteOpeningSelect

export type OpeningForTier1 = Prisma.LastMinuteOpeningGetPayload<{
  select: typeof openingForTier1Select
}>

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
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

function minuteOfDayInTimeZone(date: Date, timeZone: string): number {
  const parts = getZonedParts(date, timeZone)
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

function assertValidOpeningTimeZone(openingTimeZone: string): void {
  if (!isNonEmptyString(openingTimeZone) || !isValidIanaTimeZone(openingTimeZone)) {
    throw new Error('buildTier1WaitlistAudience: opening is missing a valid timezone')
  }
}

/**
 * Builds the Tier 1 waitlist audience for a last-minute opening.
 *
 * Rules:
 * - matches active waitlist entries for any service on the opening
 * - respects waitlist time/date preference matching
 * - then hands candidate cleanup to the shared merge/dedupe helper
 */
export async function buildTier1WaitlistAudience(args: {
  tx: LastMinuteDbClient
  opening: OpeningForTier1
  now: Date
}): Promise<Tier1WaitlistCandidate[]> {
  const { tx, opening, now } = args

  assertValidOpeningTimeZone(opening.timeZone)

  const serviceIds = Array.from(
    new Set(opening.services.map((row) => row.serviceId).filter(isNonEmptyString)),
  )

  if (serviceIds.length === 0) {
    return []
  }

  const waitlistEntries = await tx.waitlistEntry.findMany({
    where: {
      professionalId: opening.professionalId,
      status: WaitlistStatus.ACTIVE,
      serviceId: { in: serviceIds },
    },
    select: {
      clientId: true,
      preferenceType: true,
      specificDate: true,
      timeOfDay: true,
      windowStartMin: true,
      windowEndMin: true,
    },
    take: 2000,
  })

  const matchedWaitlistClientIds = Array.from(
    new Set(
      waitlistEntries
        .filter((entry) =>
          waitlistEntryMatchesOpening({
            openingStartAt: opening.startAt,
            openingTimeZone: opening.timeZone,
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

  if (matchedWaitlistClientIds.length === 0) {
    return []
  }

  const candidates: LastMinuteAudienceCandidate[] = matchedWaitlistClientIds.map((clientId) => ({
    clientId,
    matchedTier: LastMinuteTier.WAITLIST,
  }))

  return mergeAndDedupeRecipients({
    tx,
    openingId: opening.id,
    professionalId: opening.professionalId,
    openingTimeZone: opening.timeZone,
    now,
    candidates,
  })
}