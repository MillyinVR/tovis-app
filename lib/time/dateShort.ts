// lib/time/dateShort.ts
//
// The app's short calendar date — "Aug 9, 2026". Ten components had written
// their own copy of this before it lived here; they agreed on the option set
// and differed only in how they took their input and where the timezone came
// from, which is what these two signatures split on.
//
// Which one to reach for:
//
//   • the date belongs to an APPOINTMENT (or anything with a stored zone) →
//     `formatDateShortInTimeZone`, passing that zone. Scheduling truth is the
//     booking's zone, never the viewer's.
//   • the date is not scheduling truth — a signup date, a referral tap, a
//     membership renewal — → `formatIsoDateShort`, which renders in the
//     viewer's own zone.

import { DEFAULT_TIME_ZONE } from '@/lib/timeZone'
import { formatInTimeZone } from '@/lib/formatInTimeZone'
import { getViewerTimeZone } from '@/lib/bookingTime'

const SHORT_DATE: Intl.DateTimeFormatOptions = {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
}

/**
 * Short date in an explicit timezone. A blank/unknown zone falls back to
 * `DEFAULT_TIME_ZONE` (`formatInTimeZone` sanitizes it either way).
 */
export function formatDateShortInTimeZone(
  value: Date | string,
  timeZone: string | null | undefined,
): string {
  return formatInTimeZone(value, timeZone ?? DEFAULT_TIME_ZONE, SHORT_DATE)
}

/**
 * Short date from a UTC ISO string, rendered in the VIEWER's timezone.
 *
 * Returns `null` — not a placeholder string — when the input is absent or
 * unparseable, so the caller decides what an unknown date looks like.
 */
export function formatIsoDateShort(
  iso: string | null | undefined,
): string | null {
  if (!iso) return null

  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return null

  return formatDateShortInTimeZone(date, getViewerTimeZone())
}
