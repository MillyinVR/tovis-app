import { ymdInTimeZone } from '@/lib/time'

/**
 * "Tomorrow" / "In 3 days" / "In 6 weeks" for the appointment-prep hero.
 *
 * 🔴 COUNTED IN CALENDAR DAYS IN THE APPOINTMENT'S OWN ZONE, not in 24h blocks.
 * An 11pm-Monday "now" and a 9am-Wednesday appointment is 34 hours apart, which
 * `Math.floor(hours / 24)` calls "tomorrow" and a human calls "in 2 days". The
 * zone matters for the same reason a booking's time does: the appointment
 * happens where the pro is, not where the phone is.
 *
 * The design's three shapes hang off `tone`:
 *   urgent — today or tomorrow: the gold-bordered hero.
 *   near   — inside a fortnight: the standard hero.
 *   far    — beyond that: a single quiet line, and the board card is promoted
 *            above the checklist, because the useful thing to do six weeks out
 *            is send the pro your looks.
 */

export type PrepCountdownTone = 'urgent' | 'near' | 'far' | 'past'

export type PrepCountdown = {
  /** Whole calendar days from today to the appointment, in its own zone. */
  days: number
  tone: PrepCountdownTone
  /** The big line: "Tomorrow", "In 3 days". */
  label: string
}

/** Beyond this the screen changes shape — see `tone`. */
const FAR_DAY_THRESHOLD = 14

/** Noon UTC for a YYYY-MM-DD, so a DST shift inside the range cannot move a day boundary. */
function noonUtc(ymd: string): number {
  const [y, m, d] = ymd.split('-')
  return Date.UTC(Number(y), Number(m) - 1, Number(d), 12)
}

function daysBetweenYmd(fromYmd: string, toYmd: string): number {
  return Math.round((noonUtc(toYmd) - noonUtc(fromYmd)) / 86_400_000)
}

export function buildPrepCountdown(
  scheduledFor: Date,
  timeZone: string,
  now: Date = new Date(),
): PrepCountdown {
  const days = daysBetweenYmd(
    ymdInTimeZone(now, timeZone),
    ymdInTimeZone(scheduledFor, timeZone),
  )

  if (days < 0) return { days, tone: 'past', label: 'Past' }
  if (days === 0) return { days, tone: 'urgent', label: 'Today' }
  if (days === 1) return { days, tone: 'urgent', label: 'Tomorrow' }

  const tone: PrepCountdownTone = days > FAR_DAY_THRESHOLD ? 'far' : 'near'
  return { days, tone, label: formatDistance(days) }
}

/**
 * Weeks read better than days once there are enough of them — "in 6 weeks", not
 * "in 43 days". Below a fortnight days are what a person actually counts.
 */
function formatDistance(days: number): string {
  if (days <= FAR_DAY_THRESHOLD) return `In ${days} days`

  const weeks = Math.round(days / 7)
  if (weeks < 9) return `In ${weeks} weeks`

  const months = Math.round(days / 30)
  return months <= 1 ? 'In 1 month' : `In ${months} months`
}
