// lib/waitlist/preferenceLabel.ts
//
// Shared formatting for a waitlist entry's time/date preference. Mirrors the
// inline formatters in app/messages/page.tsx but lives here so the pro waitlist
// outreach view (and future surfaces) render the same human label without
// duplicating the branching.
import {
  WaitlistPreferenceType,
  WaitlistTimeOfDay,
} from '@prisma/client'

import { formatInTimeZone } from '@/lib/time'

export type WaitlistPreferenceFields = {
  preferenceType: WaitlistPreferenceType
  specificDate: Date | null
  timeOfDay: WaitlistTimeOfDay | null
  windowStartMin: number | null
  windowEndMin: number | null
}

function isPresentString(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function formatShortDate(date: Date): string {
  // A SPECIFIC_DATE preference is a calendar date stored at UTC midnight; format
  // it in UTC so it never drifts to the previous day in negative-offset zones.
  return formatInTimeZone(date, 'UTC', {
    month: 'short',
    day: 'numeric',
  })
}

function formatMinuteOfDay(value: number | null): string | null {
  if (value === null) return null

  const minutesInDay = 24 * 60
  const safeValue = ((value % minutesInDay) + minutesInDay) % minutesInDay
  const hour24 = Math.floor(safeValue / 60)
  const minute = safeValue % 60
  const hour12 = hour24 % 12 || 12
  const suffix = hour24 < 12 ? 'AM' : 'PM'

  return `${hour12}:${minute.toString().padStart(2, '0')} ${suffix}`
}

function formatTimeOfDay(value: WaitlistTimeOfDay | null): string | null {
  if (value === WaitlistTimeOfDay.MORNING) return 'Morning'
  if (value === WaitlistTimeOfDay.AFTERNOON) return 'Afternoon'
  if (value === WaitlistTimeOfDay.EVENING) return 'Evening'

  return null
}

/**
 * Human label for a waitlist entry's preference, e.g. "Any time", "Morning",
 * "Jun 14", "9:00 AM–12:00 PM". Returns "Any time" as a safe default.
 */
export function formatWaitlistPreferenceLabel(
  fields: WaitlistPreferenceFields,
): string {
  if (fields.preferenceType === WaitlistPreferenceType.ANY_TIME) {
    return 'Any time'
  }

  if (fields.preferenceType === WaitlistPreferenceType.TIME_OF_DAY) {
    return formatTimeOfDay(fields.timeOfDay) ?? 'Any time'
  }

  if (
    fields.preferenceType === WaitlistPreferenceType.SPECIFIC_DATE &&
    fields.specificDate
  ) {
    return formatShortDate(fields.specificDate)
  }

  if (fields.preferenceType === WaitlistPreferenceType.TIME_RANGE) {
    const start = formatMinuteOfDay(fields.windowStartMin)
    const end = formatMinuteOfDay(fields.windowEndMin)
    const range = [start, end].filter(isPresentString).join('–')

    return range.length > 0 ? range : 'Any time'
  }

  return 'Any time'
}
