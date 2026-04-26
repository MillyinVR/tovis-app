// app/pro/calendar/_viewModel/monthDensity.ts

import type { CalendarEvent } from '../_types'

import { ymdInTimeZone } from '../_utils/date'
import { isBlockedEvent } from '../_utils/calendarMath'
import { eventStatusTone } from '../_utils/statusStyles'

// ─── Types ────────────────────────────────────────────────────────────────────

export type MonthDensityLevel = 'empty' | 'xs' | 'sm' | 'md' | 'lg'

export type MonthDayDensity = {
  dateKey: string
  bookingCount: number
  blockedCount: number
  pendingCount: number
  completedCount: number
  dangerCount: number
  waitlistCount: number
  totalCount: number
  density: MonthDensityLevel
  tones: string[]
}

type BuildMonthDensityMapArgs = {
  visibleDays: Date[]
  events: CalendarEvent[]
  timeZone: string
}

type EventCountBucket = {
  bookingCount: number
  blockedCount: number
  pendingCount: number
  completedCount: number
  dangerCount: number
  waitlistCount: number
  totalCount: number
  tones: Set<string>
}

// ─── Pure helpers ─────────────────────────────────────────────────────────────

function emptyBucket(): EventCountBucket {
  return {
    bookingCount: 0,
    blockedCount: 0,
    pendingCount: 0,
    completedCount: 0,
    dangerCount: 0,
    waitlistCount: 0,
    totalCount: 0,
    tones: new Set<string>(),
  }
}

function densityForCount(totalCount: number): MonthDensityLevel {
  if (totalCount <= 0) return 'empty'
  if (totalCount === 1) return 'xs'
  if (totalCount <= 3) return 'sm'
  if (totalCount <= 5) return 'md'

  return 'lg'
}

function safeDateFromIso(value: string): Date | null {
  const date = new Date(value)

  return Number.isFinite(date.getTime()) ? date : null
}

function eventDateKey(event: CalendarEvent, timeZone: string): string | null {
  const startsAt = safeDateFromIso(event.startsAt)

  if (!startsAt) return null

  return ymdInTimeZone(startsAt, timeZone)
}

function incrementBucketForEvent(
  bucket: EventCountBucket,
  event: CalendarEvent,
): void {
  const isBlocked = isBlockedEvent(event)
  const tone = eventStatusTone({
    status: event.status,
    isBlocked,
  })

  bucket.totalCount += 1
  bucket.tones.add(tone)

  if (isBlocked) {
    bucket.blockedCount += 1
  } else {
    bucket.bookingCount += 1
  }

  if (tone === 'pending') {
    bucket.pendingCount += 1
  }

  if (tone === 'completed') {
    bucket.completedCount += 1
  }

  if (tone === 'danger') {
    bucket.dangerCount += 1
  }

  if (tone === 'waitlist') {
    bucket.waitlistCount += 1
  }
}

function monthDayDensityFromBucket(args: {
  dateKey: string
  bucket: EventCountBucket | undefined
}): MonthDayDensity {
  const { dateKey, bucket } = args

  if (!bucket) {
    return {
      dateKey,
      bookingCount: 0,
      blockedCount: 0,
      pendingCount: 0,
      completedCount: 0,
      dangerCount: 0,
      waitlistCount: 0,
      totalCount: 0,
      density: 'empty',
      tones: [],
    }
  }

  return {
    dateKey,
    bookingCount: bucket.bookingCount,
    blockedCount: bucket.blockedCount,
    pendingCount: bucket.pendingCount,
    completedCount: bucket.completedCount,
    dangerCount: bucket.dangerCount,
    waitlistCount: bucket.waitlistCount,
    totalCount: bucket.totalCount,
    density: densityForCount(bucket.totalCount),
    tones: Array.from(bucket.tones),
  }
}

// ─── Public helpers ───────────────────────────────────────────────────────────

export function buildMonthDensityMap(
  args: BuildMonthDensityMapArgs,
): Map<string, MonthDayDensity> {
  const { visibleDays, events, timeZone } = args

  const buckets = new Map<string, EventCountBucket>()

  for (const event of events) {
    const dateKey = eventDateKey(event, timeZone)

    if (!dateKey) continue

    const existingBucket = buckets.get(dateKey)
    const bucket = existingBucket ?? emptyBucket()

    incrementBucketForEvent(bucket, event)
    buckets.set(dateKey, bucket)
  }

  const densityMap = new Map<string, MonthDayDensity>()

  for (const day of visibleDays) {
    const dateKey = ymdInTimeZone(day, timeZone)
    const bucket = buckets.get(dateKey)

    densityMap.set(
      dateKey,
      monthDayDensityFromBucket({
        dateKey,
        bucket,
      }),
    )
  }

  return densityMap
}

export function monthDensityForDay(args: {
  densityMap: Map<string, MonthDayDensity>
  dateKey: string
}): MonthDayDensity {
  const { densityMap, dateKey } = args
  const density = densityMap.get(dateKey)

  if (density) return density

  return monthDayDensityFromBucket({
    dateKey,
    bucket: undefined,
  })
}

export function monthDensityToneLimit(args: {
  density: MonthDayDensity
  maxTones: number
}): string[] {
  const { density, maxTones } = args

  if (!Number.isFinite(maxTones) || maxTones <= 0) return []

  return density.tones.slice(0, maxTones)
}