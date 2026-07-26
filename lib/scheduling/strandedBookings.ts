// lib/scheduling/strandedBookings.ts

/**
 * "Which bookings does this schedule change strand?"
 *
 * Narrowing working hours (or moving a location's timezone) does NOT touch the
 * bookings that already sit in the time being given up — nothing retro-validates
 * them, and that is deliberate: a booking a client already has is not the
 * settings screen's to cancel or move. What WAS missing is that the pro was
 * never told. This module answers the read half so the save can say
 * "3 bookings now fall outside these hours" (Tori's call, 2026-07-25: warn and
 * list, save anyway — never refuse).
 *
 * Two deliberate choices, both of which change what gets reported:
 *
 * 1) The window checked is the APPOINTMENT (`scheduledFor` →
 *    `+ totalDurationMinutes`), NOT the appointment plus its buffer. The write
 *    path validates start→end+buffer because it is protecting the pro's
 *    turnaround time; this report answers a human question ("does this
 *    appointment still fit my hours?"), and a 4:00–5:00 booking under 09:00–17:00
 *    hours is not something a pro would accept being called stranded.
 * 2) The predicate is `ensureWithinWorkingHours` — the SAME function
 *    `checkSlotReadiness` gates every write with — so the report cannot drift
 *    from what the product enforces. ⚠️ Do not reach for
 *    `checkWorkingHoursRange` in `lib/scheduling/workingHours.ts`: it is the same
 *    algorithm with zero callers (dup register B-D12), and using it here would
 *    revive a second definition of the rule.
 */

import { Prisma, type BookingStatus } from '@prisma/client'

import { prisma } from '@/lib/prisma'
import { BOOKING_BLOCKING_STATUSES } from '@/lib/booking/constants'
import { ensureWithinWorkingHours } from '@/lib/booking/workingHoursGuard'
import { normalizeWorkingHours } from '@/lib/scheduling/workingHoursValidation'
import { formatClientName } from '@/lib/profiles/publicProfileFormatting'
import { addMinutes } from '@/lib/booking/conflicts'
import type { ProStrandedBookingsDTO } from '@/lib/dto/proWorkingHours'

type DbClient = Prisma.TransactionClient | typeof prisma

/** How many stranded bookings we list; the count is reported in full. */
export const STRANDED_BOOKING_LIST_LIMIT = 20

/**
 * How far ahead we look. A booking further out than this is still stranded, it
 * just is not what a pro is deciding about when they edit this week's hours —
 * and the scan is a read on the write path of a settings save, so it is bounded
 * on purpose rather than "every booking that exists".
 */
export const STRANDED_BOOKING_LOOKAHEAD_DAYS = 365

const MS_PER_DAY = 24 * 60 * 60_000

export type StrandedBooking = {
  id: string
  /** UTC instant; the caller renders it in the location's timezone. */
  scheduledFor: Date
  durationMinutes: number
  locationId: string
  clientName: string
  serviceName: string | null
}

export type StrandedBookingReport = {
  /** Every future occupying booking outside the new hours, not just the listed ones. */
  total: number
  /** Soonest first, capped at `STRANDED_BOOKING_LIST_LIMIT`. */
  items: StrandedBooking[]
}

export type StrandedScheduleLocation = {
  id: string
  timeZone: string | null
  /** The hours as they will be AFTER the save — not what is still in the row. */
  workingHours: unknown
}

export type FindBookingsOutsideWorkingHoursArgs = {
  db?: DbClient
  professionalId: string
  locations: readonly StrandedScheduleLocation[]
  now: Date
  fallbackTimeZone?: string
  limit?: number
}

const OCCUPYING_STATUSES: readonly BookingStatus[] = BOOKING_BLOCKING_STATUSES

export const EMPTY_STRANDED_BOOKING_REPORT: StrandedBookingReport = {
  total: 0,
  items: [],
}

/**
 * The future bookings at `locations` that do not fit the supplied working hours.
 *
 * `locations` carries the NEW hours, so this must be called with the payload
 * that was just written (or is about to be) — reading the row back works too,
 * as long as the read happens after the commit.
 */
export async function findBookingsOutsideWorkingHours(
  args: FindBookingsOutsideWorkingHoursArgs,
): Promise<StrandedBookingReport> {
  const {
    professionalId,
    locations,
    now,
    fallbackTimeZone = 'UTC',
    limit = STRANDED_BOOKING_LIST_LIMIT,
  } = args

  if (locations.length === 0) return EMPTY_STRANDED_BOOKING_REPORT

  const db = args.db ?? prisma

  // A location whose resolved week is not a valid working-hours object tells us
  // nothing about whether its bookings fit — `ensureWithinWorkingHours` would
  // answer MISSING for every one of them and the pro would be told their
  // calendar was just stranded. Reachable via a timezone-only PATCH over a
  // malformed stored week. "We cannot tell" is silence, not an alarm — the same
  // rule the `null` report state follows.
  const byLocationId = new Map(
    locations
      .filter((l) => normalizeWorkingHours(l.workingHours) !== null)
      .map((l) => [l.id, l]),
  )

  if (byLocationId.size === 0) return EMPTY_STRANDED_BOOKING_REPORT

  const horizon = new Date(
    now.getTime() + STRANDED_BOOKING_LOOKAHEAD_DAYS * MS_PER_DAY,
  )

  const bookings = await db.booking.findMany({
    where: {
      professionalId,
      locationId: { in: [...byLocationId.keys()] },
      status: { in: [...OCCUPYING_STATUSES] },
      scheduledFor: { gte: now, lt: horizon },
    },
    select: {
      id: true,
      scheduledFor: true,
      totalDurationMinutes: true,
      locationId: true,
      service: { select: { name: true } },
      client: {
        select: {
          // pii-plaintext-read-ok: client names have no encrypted counterpart on ClientProfile yet, so these plaintext columns are the source of truth; identical read + `formatClientName` shaping to the pro calendar feed this warning points the pro at
          firstName: true,
          lastName: true, // pii-plaintext-read-ok: see firstName above — same pro-facing client label, same expand-phase columns
          user: { select: { email: true } },
        },
      },
    },
    orderBy: { scheduledFor: 'asc' },
  })

  const items: StrandedBooking[] = []
  let total = 0

  for (const booking of bookings) {
    const location = byLocationId.get(booking.locationId)
    if (!location) continue

    const check = ensureWithinWorkingHours({
      scheduledStartUtc: booking.scheduledFor,
      scheduledEndUtc: addMinutes(
        booking.scheduledFor,
        booking.totalDurationMinutes,
      ),
      workingHours: location.workingHours,
      timeZone: location.timeZone ?? fallbackTimeZone,
      fallbackTimeZone,
    })

    if (check.ok) continue

    total += 1

    if (items.length < limit) {
      items.push({
        id: booking.id,
        scheduledFor: booking.scheduledFor,
        durationMinutes: booking.totalDurationMinutes,
        locationId: booking.locationId,
        clientName: formatClientName({
          firstName: booking.client?.firstName,
          lastName: booking.client?.lastName,
          email: booking.client?.user?.email,
        }),
        serviceName: booking.service?.name?.trim() || null,
      })
    }
  }

  return { total, items }
}

/**
 * The save must never fail because the REPORT failed — the hours are already
 * committed by the time this runs, and a 500 here would tell the pro their save
 * did not happen when it did. A failed scan reports `null` ("we don't know"),
 * which every surface renders as no warning.
 */
export async function findBookingsOutsideWorkingHoursSafe(
  args: FindBookingsOutsideWorkingHoursArgs,
): Promise<StrandedBookingReport | null> {
  try {
    return await findBookingsOutsideWorkingHours(args)
  } catch (error) {
    console.error('findBookingsOutsideWorkingHours failed:', error)
    return null
  }
}

/**
 * Wire shape for the report. `timeZone` is resolved per booking from the
 * location it belongs to, so a multi-location save renders each row in its own
 * zone rather than in the representative location's.
 */
export function toStrandedBookingsDTO(
  report: StrandedBookingReport,
  locations: readonly StrandedScheduleLocation[],
): ProStrandedBookingsDTO {
  return {
    total: report.total,
    items: report.items.map((booking) => ({
      id: booking.id,
      scheduledFor: booking.scheduledFor.toISOString(),
      durationMinutes: booking.durationMinutes,
      locationId: booking.locationId,
      timeZone:
        locations.find((l) => l.id === booking.locationId)?.timeZone ?? 'UTC',
      clientName: booking.clientName,
      serviceName: booking.serviceName,
    })),
  }
}

/**
 * The one entry point both hours writers use: scan (only when something
 * changed), map to the wire, and never let the report take down the save.
 *
 * - `undefined` — nothing changed, so nothing was scanned; the field is OMITTED.
 * - `null`      — the scan FAILED; surfaces render silence, not reassurance.
 */
export async function reportStrandedBookings(args: {
  professionalId: string
  /** The locations whose schedule actually moved; empty means a no-op save. */
  changedLocations: readonly StrandedScheduleLocation[]
  now?: Date
}): Promise<ProStrandedBookingsDTO | null | undefined> {
  if (args.changedLocations.length === 0) return undefined

  const report = await findBookingsOutsideWorkingHoursSafe({
    professionalId: args.professionalId,
    locations: args.changedLocations,
    now: args.now ?? new Date(),
  })

  if (!report) return null

  return toStrandedBookingsDTO(report, args.changedLocations)
}
