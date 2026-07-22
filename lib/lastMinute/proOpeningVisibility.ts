// lib/lastMinute/proOpeningVisibility.ts
//
// F16: tell the PRO when one of their own last-minute openings has gone dark.
//
// Since F15 an opening whose slot has since been booked, blocked, or dropped out
// of the pro's hours is hidden from every client feed. The row itself does not
// move — it stays `ACTIVE` with `bookedAt: null` — so the pro's own list shows a
// healthy-looking card for a slot no client can see, and the pro is the only
// person who can fix it (re-open the day, delete the block, cancel the opening).
//
// This asks the SAME question the client feeds ask — `checkStoredSlotsAreOpen`,
// which is itself the commit gate run with nothing written — and turns the
// verdict into something a badge can say out loud. It is a SIGNAL, not a filter:
// F15 deliberately left the pro's list unfiltered so a dead opening can still be
// cancelled, and nothing here removes a row.
//
// Two things the client feeds never had to decide:
//
//  1. **A hold is not a failure.** `TIME_HELD` on a client feed means "somebody
//     else got there first, hide it". On the pro's card the commonest cause is a
//     client mid-checkout on THIS opening — the feature working. Telling the pro
//     their opening is dark at the moment it is being claimed would be worse
//     than saying nothing, so it gets its own non-alarming state.
//  2. **The pro's select does not filter deactivated offerings.**
//     `proOpeningSelect` deliberately omits the client-facing select's
//     `services.where.offering.isActive` so the pro can see a deactivated link
//     (F9). The visibility question is a CLIENT question, so the filter has to be
//     applied here instead — otherwise a deactivated service could set the window
//     the badge is judged against, and the badge would disagree with the feed it
//     is reporting on.

import { OpeningStatus, ServiceLocationType } from '@prisma/client'

import {
  checkStoredSlotsAreOpen,
  type StoredSlotDeadReason,
} from '@/lib/booking/storedSlotLiveness'
import { openingLivenessCandidate } from '@/lib/lastMinute/openingLiveness'

/**
 * What the pro's card says about one opening. Named for the pro's question
 * ("can clients see this?") rather than for the policy code behind it, because
 * several codes are one job for the pro and one — `TIME_HELD` — is not a job at
 * all.
 */
export type ProOpeningClientVisibility =
  /** Live: the pro's schedule can still serve this time. */
  | 'VISIBLE'
  /** A booking for that time is in flight. Transient, and needs no pro action. */
  | 'BEING_CLAIMED'
  /** The slot went to a booking made through the ordinary flow. */
  | 'TIME_BOOKED'
  /** The pro blocked that time after publishing. */
  | 'TIME_BLOCKED'
  /** The pro's hours moved and no longer cover it. */
  | 'OUTSIDE_WORKING_HOURS'
  /** The location has no usable working hours at all — missing or malformed. */
  | 'WORKING_HOURS_MISSING'
  /** Now inside the pro's advance-notice window. */
  | 'TOO_SOON'
  /** Beyond how far ahead this location takes bookings. */
  | 'TOO_FAR_AHEAD'
  /** The pro re-anchored their booking grid, so the start no longer lands on it. */
  | 'OFF_BOOKING_GRID'
  /** The location stopped being bookable, or was removed. */
  | 'LOCATION_UNAVAILABLE'
  /** The location carries no time zone, so nothing can be scheduled against it. */
  | 'LOCATION_TIME_ZONE_MISSING'
  /** Every offering this opening advertises has been deactivated. */
  | 'NO_ACTIVE_SERVICE'
  /**
   * Not asked: the row is already booked, cancelled or expired, or its time has
   * passed. A distinct state rather than `VISIBLE` so "we did not ask" can never
   * be read as "clients can see it" — the same totality rule
   * `checkStoredSlotsAreOpen` follows.
   */
  | 'NOT_CHECKED'

type VisibilityServiceRow = {
  service: { defaultDurationMinutes: number | null }
  offering: {
    isActive: boolean
    salonDurationMinutes: number | null
    mobileDurationMinutes: number | null
  }
}

/** The subset of `proOpeningSelect` this needs; `ProOpeningRow` satisfies it. */
export type ProOpeningVisibilityRow = {
  id: string
  professionalId: string
  startAt: Date
  status: OpeningStatus
  bookedAt: Date | null
  cancelledAt: Date | null
  locationId: string | null
  locationType: ServiceLocationType
  professional: { timeZone: string | null }
  services: readonly VisibilityServiceRow[]
}

/**
 * Every `SchedulingPolicyFailureCode` plus the two location errors, mapped to
 * what the pro should be told. Exhaustive on purpose and with no `default`: a
 * new refusal code must fail the build here rather than arrive at the badge as
 * an unexplained blank.
 */
function visibilityForDeadReason(
  reason: StoredSlotDeadReason,
): ProOpeningClientVisibility {
  switch (reason) {
    case 'TIME_HELD':
      return 'BEING_CLAIMED'
    case 'TIME_BOOKED':
      return 'TIME_BOOKED'
    case 'TIME_BLOCKED':
      return 'TIME_BLOCKED'
    case 'OUTSIDE_WORKING_HOURS':
      return 'OUTSIDE_WORKING_HOURS'
    // Two codes, one job for the pro: go and fix the location's hours.
    case 'WORKING_HOURS_REQUIRED':
    case 'WORKING_HOURS_INVALID':
      return 'WORKING_HOURS_MISSING'
    case 'ADVANCE_NOTICE_REQUIRED':
      return 'TOO_SOON'
    case 'MAX_DAYS_AHEAD_EXCEEDED':
      return 'TOO_FAR_AHEAD'
    case 'STEP_MISMATCH':
      return 'OFF_BOOKING_GRID'
    case 'LOCATION_NOT_FOUND':
      return 'LOCATION_UNAVAILABLE'
    case 'TIMEZONE_REQUIRED':
      return 'LOCATION_TIME_ZONE_MISSING'
  }
}

/**
 * The services a CLIENT could still claim. Mirrors the client-facing
 * `openingSelect`'s `services.where.offering.isActive`, which `proOpeningSelect`
 * deliberately does not carry — see the header.
 */
function claimableServices(
  services: readonly VisibilityServiceRow[],
): VisibilityServiceRow[] {
  return services.filter((row) => row.offering.isActive)
}

/**
 * A row is worth asking about only while it is live and still in the future.
 * A booked, cancelled or expired opening has nothing to signal, and a past one
 * would answer `ADVANCE_NOTICE_REQUIRED` — true, but not what "too soon" means
 * to a reader.
 */
function isWorthChecking(row: ProOpeningVisibilityRow, nowUtc: Date): boolean {
  return (
    row.status === OpeningStatus.ACTIVE &&
    row.bookedAt === null &&
    row.cancelledAt === null &&
    row.startAt.getTime() > nowUtc.getTime()
  )
}

/**
 * Visibility per opening, keyed by id. Always total: every row passed in gets an
 * entry, so a caller can never read a missing key as `VISIBLE`.
 */
export async function resolveProOpeningVisibility(args: {
  rows: readonly ProOpeningVisibilityRow[]
  nowUtc?: Date
}): Promise<Map<string, ProOpeningClientVisibility>> {
  const nowUtc = args.nowUtc ?? new Date()
  const result = new Map<string, ProOpeningClientVisibility>()

  const candidates = []

  for (const row of args.rows) {
    if (!isWorthChecking(row, nowUtc)) {
      result.set(row.id, 'NOT_CHECKED')
      continue
    }

    const candidate = openingLivenessCandidate({
      ...row,
      services: claimableServices(row.services),
    })

    if (!candidate) {
      // No active offering left to price a window from — which is also how the
      // client feeds drop the row, since they require `services.some.offering
      // .isActive`. The pro is the only one who can revive it.
      result.set(row.id, 'NO_ACTIVE_SERVICE')
      continue
    }

    candidates.push(candidate)
  }

  if (candidates.length === 0) return result

  const verdicts = await checkStoredSlotsAreOpen({
    candidates,
    // The pro is not a client, so there is no viewer hold to discount. A client
    // mid-checkout on this very slot therefore reads as TIME_HELD, which is
    // exactly the state `BEING_CLAIMED` exists to report honestly.
    viewerClientId: null,
    nowUtc,
  })

  for (const candidate of candidates) {
    const verdict = verdicts.get(candidate.key)

    result.set(
      candidate.key,
      verdict === undefined
        ? 'NOT_CHECKED'
        : verdict.open
          ? 'VISIBLE'
          : visibilityForDeadReason(verdict.reason),
    )
  }

  return result
}
