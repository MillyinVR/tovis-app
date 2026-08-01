// lib/booking/series/rollForwardSweep.ts
//
// K20 (Phase 8) — the roll-forward sweep. The LAST step of the K-series.
//
// K18 materializes a series' first window and stops. K19 gave that window a
// surface, and REFUSED to offer the pro an open-ended series precisely because
// nothing existed to advance it (K18-B) — an option whose operator has not been
// built is an offer the app cannot keep
// ([[verifiable-rail-still-needs-an-operator]]). This is that operator.
//
// ## What it does
//
// Every ACTIVE series is kept materialized through a ROLLING WINDOW of
// `SERIES_ROLL_FORWARD_LEAD_DAYS` from now. A weekly series therefore gains
// roughly one appointment a week once its creation window is consumed; a
// six-weekly one gains nothing for well over a year. That is deliberate: the
// window is measured in TIME, not in occurrences, so the pro's calendar is
// always booked about as far ahead as it was on the day they created the series,
// and never further.
//
// ## Why this is safe to run unattended, and repeatedly
//
//  - **Idempotent by construction.** `Booking @@unique([seriesId,
//    seriesOccurrenceIndex])` and `BookingSeriesException @@unique([seriesId,
//    occurrenceIndex])` make a repeated pass over the same indices incapable of
//    producing a second row of either kind. Nothing here relies on the sweep
//    running exactly once.
//  - **It decides nothing.** Every input — the pattern, the location, the
//    add-ons, the deposit rule, and above all the pro's override grants — is
//    read from the series row the pro created. K18 stored those grants for this
//    exact reason.
//  - **It cannot silently reprice.** A follow-on occurrence is booked at
//    occurrence 0's price (lib/booking/series/pinnedPrice.ts).
//  - **It cannot double-book.** Occurrences go through the same
//    `SERIES_MATERIALIZATION` overlap source K18 introduced, which refuses on
//    conflict BEFORE the pro's own double-book authority applies — a collision
//    becomes a recorded skip, never a silent overlap.
//  - **It does not punch permanent holes.** A refusal meaning "not yet" (past
//    the pro's booking horizon, pro not booking-ready) DEFERS instead of writing
//    an exception row, because exception rows are permanent and would make a
//    temporary condition into a missing appointment forever. See
//    `SeriesMaterializationDeferral`.
//
// 🔴 Sweeps on `status`, using `BookingSeries @@index([status,
// nextOccurrenceIndex])` — the index K18 added for this query. K19 stamps
// CANCELLED when a pro stops a series, which is what makes a stopped series
// invisible here rather than something this file has to remember to exclude.

import { BookingSeriesStatus, type Prisma } from '@prisma/client'

import { isBookingError } from '@/lib/booking/errors'
import {
  computeSeriesOccurrenceInstants,
  SERIES_ROLL_FORWARD_LEAD_DAYS,
} from '@/lib/booking/series/schedule'
import { recurringAppointmentsEnabled } from '@/lib/booking/series/flag'
import { advanceBookingSeries } from '@/lib/booking/writeBoundary'
import { captureBookingException } from '@/lib/observability/bookingEvents'
import { logSweepObservation } from '@/lib/observability/sweepObservation'
import { prisma } from '@/lib/prisma'
import { readOptionalEnv } from '@/lib/env'

const ROUTE = 'GET /api/internal/jobs/booking-series/roll-forward'
const EVENT = 'booking_series_roll_forward'

/** Indices one series may ATTEMPT in a single pass. */
export const SERIES_ROLL_FORWARD_MAX_OCCURRENCES_PER_SERIES = 12

/** Series one pass may touch. Truncation is logged, never silent. */
export const SERIES_ROLL_FORWARD_MAX_SERIES_PER_RUN = 200

export type SeriesRollForwardOutcome =
  | 'advanced'
  | 'nothing_due'
  | 'ended'
  | 'not_active'
  | 'advance_error'

export type SeriesRollForwardResult = {
  seriesId: string
  outcome: SeriesRollForwardOutcome
  created: number
  skipped: number
}

export type SeriesRollForwardRunResult = {
  enabled: boolean
  leadDays: number
  candidatesScanned: number
  capped: boolean
  createdCount: number
  skippedCount: number
  tally: Record<SeriesRollForwardOutcome, number>
  results: SeriesRollForwardResult[]
}

const EMPTY_TALLY: Record<SeriesRollForwardOutcome, number> = {
  advanced: 0,
  nothing_due: 0,
  ended: 0,
  not_active: 0,
  advance_error: 0,
}

const CANDIDATE_SELECT = {
  id: true,
  professionalId: true,
  anchorAt: true,
  timeZone: true,
  intervalWeeks: true,
  occurrenceCount: true,
  nextOccurrenceIndex: true,
} satisfies Prisma.BookingSeriesSelect

/**
 * The sweep's own kill switch, separate from the feature flag.
 *
 * `ENABLE_RECURRING_APPOINTMENTS` turns the FEATURE on; this turns only the
 * unattended writer off, which is the knob you want at 3am when the sweep is
 * misbehaving but live series must keep working. Defaults ON: an off-by-default
 * cron is a cron nobody remembers to enable, and this one is inert anyway while
 * the feature flag is unset.
 */
export function seriesRollForwardEnabled(): boolean {
  const raw = readOptionalEnv('SERIES_ROLL_FORWARD_ENABLED')
  if (raw == null) return true
  const v = raw.trim().toLowerCase()
  return !(v === '0' || v === 'false' || v === 'no')
}

/**
 * Advance every ACTIVE series whose next occurrence has come into the window.
 * Never throws: a failure on one series is tallied and the rest of the run
 * proceeds, because one pro's broken offering must not stop every other pro's
 * standing appointments.
 */
export async function rollForwardBookingSeries(opts?: {
  now?: Date
}): Promise<SeriesRollForwardRunResult> {
  const now = opts?.now ?? new Date()
  const leadDays = SERIES_ROLL_FORWARD_LEAD_DAYS
  const notLaterThan = new Date(now.getTime() + leadDays * 24 * 60 * 60_000)

  // 🔴 The FEATURE flag gates the unattended writer first. See
  // `advanceBookingSeries` for why this is gated where K19's cancel is not.
  const featureEnabled = recurringAppointmentsEnabled()
  const enabled = featureEnabled && seriesRollForwardEnabled()

  const candidates = await prisma.bookingSeries.findMany({
    where: { status: BookingSeriesStatus.ACTIVE },
    select: CANDIDATE_SELECT,
    orderBy: { id: 'asc' },
    take: SERIES_ROLL_FORWARD_MAX_SERIES_PER_RUN + 1,
  })

  const capped = candidates.length > SERIES_ROLL_FORWARD_MAX_SERIES_PER_RUN
  const scanned = capped
    ? candidates.slice(0, SERIES_ROLL_FORWARD_MAX_SERIES_PER_RUN)
    : candidates

  // Only series whose NEXT index actually falls inside the window are work. The
  // rest are the overwhelming majority on any given tick (a series materialized
  // 12 weeks deep is due nothing for 12 weeks), and filtering them here costs
  // one date computation instead of a series-row read plus a booking attempt.
  const due = scanned.filter((series) => isSeriesDue({ series, notLaterThan }))

  const tally: Record<SeriesRollForwardOutcome, number> = { ...EMPTY_TALLY }
  const results: SeriesRollForwardResult[] = []

  if (!enabled) {
    logSweepObservation(EVENT, {
      mode: 'observe_only',
      reason: featureEnabled ? 'sweep_disabled' : 'feature_disabled',
      leadDays,
      candidatesScanned: due.length,
      capped,
      scannedAt: now.toISOString(),
    })
    return {
      enabled: false,
      leadDays,
      candidatesScanned: due.length,
      capped,
      createdCount: 0,
      skippedCount: 0,
      tally,
      results,
    }
  }

  let createdCount = 0
  let skippedCount = 0

  for (const series of due) {
    try {
      const advanced = await advanceBookingSeries({
        seriesId: series.id,
        notLaterThan,
        maxOccurrences: SERIES_ROLL_FORWARD_MAX_OCCURRENCES_PER_SERIES,
      })

      if (!advanced) {
        // Cancelled or ended between the scan and the write — the pro stopping a
        // series mid-sweep is ordinary, not an error.
        tally.not_active += 1
        results.push({
          seriesId: series.id,
          outcome: 'not_active',
          created: 0,
          skipped: 0,
        })
        continue
      }

      const created = advanced.occurrences.length
      const skipped = advanced.skipped.length
      createdCount += created
      skippedCount += skipped

      const outcome: SeriesRollForwardOutcome =
        created > 0 || skipped > 0
          ? 'advanced'
          : advanced.seriesStatus === BookingSeriesStatus.ENDED
            ? 'ended'
            : 'nothing_due'

      tally[outcome] += 1
      results.push({ seriesId: series.id, outcome, created, skipped })

      if (created > 0 || skipped > 0) {
        logSweepObservation(EVENT, {
          mode: 'advanced',
          seriesId: series.id,
          professionalId: series.professionalId,
          created,
          skipped,
          fromIndex: series.nextOccurrenceIndex,
          nextOccurrenceIndex: advanced.nextOccurrenceIndex,
          seriesStatus: advanced.seriesStatus,
          deferredAtIndex: advanced.deferred?.index ?? null,
          deferredCode: advanced.deferred?.code ?? null,
          scannedAt: now.toISOString(),
        })
      }
    } catch (error: unknown) {
      tally.advance_error += 1
      results.push({
        seriesId: series.id,
        outcome: 'advance_error',
        created: 0,
        skipped: 0,
      })
      // A BookingError here is a refusal `advanceBookingSeries` could not treat
      // as either a skip or a deferral (a broken series — its offering deleted,
      // its location unscheduleable). It pages, because it needs a human: the
      // series will retry every tick and get nowhere until someone looks.
      captureBookingException({
        error,
        route: ROUTE,
        event: isBookingError(error)
          ? 'SERIES_ROLL_FORWARD_REFUSED'
          : 'SERIES_ROLL_FORWARD_ERROR',
      })
    }
  }

  if (capped) {
    logSweepObservation(EVENT, {
      mode: 'capped',
      cap: SERIES_ROLL_FORWARD_MAX_SERIES_PER_RUN,
      candidatesScanned: candidates.length,
      scannedAt: now.toISOString(),
    })
  }

  return {
    enabled: true,
    leadDays,
    candidatesScanned: due.length,
    capped,
    createdCount,
    skippedCount,
    tally,
    results,
  }
}

/**
 * Is this series' next unattempted occurrence inside the window?
 *
 * 🔴 Uses the SHARED recurrence resolver, never `+ n × 7 × 24h`. "Every Friday
 * 9am" is 9am on both sides of a DST boundary, and a due-check that drifted an
 * hour would advance a series a tick early or late at every transition
 * ([[local-day-arithmetic-not-24h]]).
 *
 * A next occurrence whose wall time does not exist (a spring-forward gap) counts
 * as due: it has no instant to compare, and the pass is what records it as a
 * skip and moves on.
 */
function isSeriesDue(args: {
  series: {
    anchorAt: Date
    timeZone: string
    intervalWeeks: number
    occurrenceCount: number | null
    nextOccurrenceIndex: number
  }
  notLaterThan: Date
}): boolean {
  const { series } = args

  if (
    series.occurrenceCount != null &&
    series.nextOccurrenceIndex >= series.occurrenceCount
  ) {
    // Exhausted but still ACTIVE — due, so the pass can stamp it ENDED and stop
    // re-reading it forever.
    return true
  }

  const [next] = computeSeriesOccurrenceInstants({
    recurrence: {
      anchorAt: series.anchorAt,
      timeZone: series.timeZone,
      intervalWeeks: series.intervalWeeks,
    },
    fromIndex: series.nextOccurrenceIndex,
    count: 1,
  })

  if (!next) return false
  if (next.kind === 'NONEXISTENT') return true

  return next.at.getTime() <= args.notLaterThan.getTime()
}
