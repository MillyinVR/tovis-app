// lib/booking/series/schedule.ts
//
// K18 — when does a recurring appointment fall?
//
// 🔴 The one rule this module exists to enforce: a weekly series steps CALENDAR
// WEEKS in the LOCATION's timezone, never 7 × 24h
// ([[local-day-arithmetic-not-24h]]). "Every Friday at 9am" is 9am on both sides
// of a daylight-saving boundary; adding 604,800,000ms to the anchor makes it
// 8am or 10am for half the year, and the client shows up at the wrong hour.
//
// So an occurrence is computed as: the anchor's LOCAL calendar date + 7 ×
// intervalWeeks × index days, at the anchor's LOCAL time-of-day, resolved back
// to UTC in the series' zone.
//
// The awkward part is that "the anchor's local time-of-day on that date" does
// not always exist:
//
//   - SPRING FORWARD: a series anchored at 2:30am in America/New_York has no
//     2:30am on the transition Sunday. We report NONEXISTENT and the caller
//     records a skip. We deliberately do NOT shift it to 3:30am: an appointment
//     the client agreed to at 2:30 is not the same appointment an hour later,
//     and a silent shift is exactly the class of bug this chain keeps finding.
//   - FALL BACK: 1:30am happens twice. Both are real instants at the wall time
//     the pro chose, so we take the FIRST one and say so. Refusing a time that
//     genuinely exists would drop an appointment for no reason.
//
// `zonedPartsToUtcStrict` (lib/booking/dateTime) throws for both cases with one
// message, because its callers — a human picking a slot in a form — want a
// refusal either way. A recurrence generator cannot refuse: it has to tell the
// two apart, keep the ambiguous one and skip only the impossible one. That is
// the whole reason this resolver exists next to it rather than in it.

import {
  addDaysToYMD,
  getZonedParts,
  timeZoneOffsetMinutes,
  zonedPartsToUtcStrict,
} from '@/lib/time'

/**
 * How many occurrences one materialization pass creates.
 *
 * The plan's bounded horizon (~8–12): far enough ahead that a standing client
 * can see their next few months, short enough that a pro's calendar is not
 * pre-filled for a year they may not work. K20's roll-forward cron advances the
 * window; until it exists, an open-ended series simply stops here.
 */
export const SERIES_MATERIALIZE_HORIZON = 12

/**
 * How far ahead K20's roll-forward keeps an ACTIVE series booked.
 *
 * Chosen to match what creation already does rather than invented: the
 * count-based horizon above is ~84 days at the commonest cadence (weekly), so 90
 * days keeps a weekly series at the depth the pro saw on day one and adds one
 * appointment a week thereafter. Lives here, beside the horizon it mirrors, so
 * the read side can state it without importing the write boundary.
 */
export const SERIES_ROLL_FORWARD_LEAD_DAYS = 90

/** Smallest / largest cadence a series may use, in calendar weeks. */
export const MIN_SERIES_INTERVAL_WEEKS = 1
export const MAX_SERIES_INTERVAL_WEEKS = 8

/**
 * Largest total occurrence count a series may plan. Well above the horizon (a
 * two-year weekly standing appointment is a real thing) but bounded, so a typo
 * cannot ask for a hundred thousand appointments.
 */
export const MAX_SERIES_OCCURRENCE_COUNT = 104

export type SeriesOccurrenceInstant =
  | {
      kind: 'EXACT'
      index: number
      at: Date
    }
  | {
      /**
       * The wall time exists twice on this local date (a fall-back overlap).
       * `at` is the FIRST of the two instants.
       */
      kind: 'AMBIGUOUS'
      index: number
      at: Date
    }
  | {
      /** The wall time does not exist on this local date (a spring-forward gap). */
      kind: 'NONEXISTENT'
      index: number
      /** The wall clock that does not exist, e.g. "2027-03-14T02:30". */
      localWallTime: string
    }

export type SeriesRecurrence = {
  /** Occurrence 0's UTC instant — the slot the pro actually picked. */
  anchorAt: Date
  /** The zone whose calendar weeks the pattern steps through. */
  timeZone: string
  /** Cadence in calendar weeks (1 = weekly, 2 = fortnightly, …). */
  intervalWeeks: number
}

function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

function formatWallTime(parts: {
  year: number
  month: number
  day: number
  hour: number
  minute: number
}): string {
  return (
    `${parts.year}-${pad2(parts.month)}-${pad2(parts.day)}` +
    `T${pad2(parts.hour)}:${pad2(parts.minute)}`
  )
}

/**
 * Resolve one local wall time in `timeZone` to a UTC instant, classifying the
 * two DST edge cases instead of throwing on both.
 *
 * The happy path (every occurrence that is not on a transition date) goes
 * through the canonical strict converter, so this is not a second
 * implementation of wall-clock → UTC. Only when that refuses do we probe: an
 * instant a day either side of the naive reading gives us the offsets in force
 * before and after any transition, and the candidates they produce are the only
 * two instants that can possibly carry this wall time.
 */
export function resolveLocalWallTimeInZone(parts: {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  timeZone: string
}): { kind: 'EXACT' | 'AMBIGUOUS'; at: Date } | { kind: 'NONEXISTENT' } {
  try {
    return { kind: 'EXACT', at: zonedPartsToUtcStrict(parts) }
  } catch {
    // Nonexistent or ambiguous — the strict converter cannot tell us which.
  }

  const naiveUtcMs = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    0,
    0,
  )

  const dayMs = 24 * 60 * 60_000
  const candidateMs = new Set<number>()
  for (const probeMs of [naiveUtcMs - dayMs, naiveUtcMs, naiveUtcMs + dayMs]) {
    const offsetMinutes = timeZoneOffsetMinutes(new Date(probeMs), parts.timeZone)
    candidateMs.add(naiveUtcMs + offsetMinutes * 60_000)
  }

  const matching = [...candidateMs]
    .filter((ms) => {
      const actual = getZonedParts(new Date(ms), parts.timeZone)
      return (
        actual.year === parts.year &&
        actual.month === parts.month &&
        actual.day === parts.day &&
        actual.hour === parts.hour &&
        actual.minute === parts.minute
      )
    })
    .sort((a, b) => a - b)

  const earliestMs = matching[0]

  // No instant in this zone reads as that wall clock: the clocks jumped over it.
  if (earliestMs === undefined) return { kind: 'NONEXISTENT' }

  // It reads that way more than once (or the strict converter refused a time
  // that does exist). Take the FIRST — the appointment is at the first 1:30am,
  // not the repeat an hour later.
  return { kind: 'AMBIGUOUS', at: new Date(earliestMs) }
}

/**
 * The instants for occurrence indices [fromIndex, fromIndex + count).
 *
 * Index 0 always returns the anchor itself (EXACT) — the pro picked a real
 * instant, so it cannot be in a gap by construction.
 */
export function computeSeriesOccurrenceInstants(args: {
  recurrence: SeriesRecurrence
  fromIndex: number
  count: number
}): SeriesOccurrenceInstant[] {
  const { anchorAt, timeZone, intervalWeeks } = args.recurrence

  const anchorParts = getZonedParts(anchorAt, timeZone)
  const out: SeriesOccurrenceInstant[] = []

  for (let i = 0; i < args.count; i++) {
    const index = args.fromIndex + i

    if (index === 0) {
      out.push({ kind: 'EXACT', index, at: anchorAt })
      continue
    }

    const ymd = addDaysToYMD(
      anchorParts.year,
      anchorParts.month,
      anchorParts.day,
      index * intervalWeeks * 7,
    )

    const wall = {
      year: ymd.year,
      month: ymd.month,
      day: ymd.day,
      hour: anchorParts.hour,
      minute: anchorParts.minute,
      timeZone,
    }

    const resolved = resolveLocalWallTimeInZone(wall)

    if (resolved.kind === 'NONEXISTENT') {
      out.push({
        kind: 'NONEXISTENT',
        index,
        localWallTime: formatWallTime(wall),
      })
      continue
    }

    out.push({ kind: resolved.kind, index, at: resolved.at })
  }

  return out
}

/**
 * How many indices this pass should attempt, given where the series has got to
 * and how many occurrences it plans in total. Zero means "nothing left".
 */
export function countOccurrencesToMaterialize(args: {
  nextOccurrenceIndex: number
  occurrenceCount: number | null
  horizon?: number
}): number {
  const horizon = args.horizon ?? SERIES_MATERIALIZE_HORIZON
  if (horizon <= 0) return 0

  if (args.occurrenceCount == null) return horizon

  const remaining = args.occurrenceCount - args.nextOccurrenceIndex
  if (remaining <= 0) return 0

  return Math.min(horizon, remaining)
}
