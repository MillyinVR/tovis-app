// lib/availability/data/openSlotDays.ts
//
// "How many bookable starts do I have on each of these days, for THIS service?"
// — the per-day open-slot counts behind the pro-facing availability calendar
// (R4). `/api/v1/pro/availability/busy-days` answers "where am I already
// committed"; this answers the question the pro is actually asking when they
// open a date picker, which is where they can still FIT someone.
//
// Cost shape, deliberately: ONE `loadBusyIntervals` call spans the whole
// requested range (Redis-cached, keyed on `scheduleVersion`), and each day is
// then a pure in-memory `computeDaySlotsFast`. A 31-day month is therefore one
// occupancy query plus 31 CPU passes — NOT one slot-engine query per day. This
// is the same arrangement `/api/v1/availability/bootstrap` already uses for its
// day scroller, just over a calendar month instead of a 21-day window.
//
// The WIDTH matters more than it looks. A new booking is offered
// `base + add-ons`, but a RESCHEDULE commits the booking's own
// `totalDurationMinutes`, which drifts from the offering the moment a pro edits
// a duration. Counting with the wrong one would light up days the commit then
// refuses — the exact failure B3/B3-A fixed for the client grid
// ([[offer-reserve-commit-are-three-windows]],
// [[promise-site-runs-the-commit-site-gate]]). Rather than re-deriving that
// here, this calls the same `resolveAvailabilityDurationMinutes` the client day
// and bootstrap routes call, passing a PRO-owned reschedule context.
//
// Everything is scoped to the professional the CALLER is authenticated as.
// There is deliberately no `professionalId` on the wire: a pro can only ever
// count their own openings.

import { ServiceLocationType, Prisma } from '@prisma/client'

import {
  computeDayBoundsUtc,
  computeDaySlotsFast,
} from '@/lib/availability/core/dayComputation'
import { enumerateYmdRange, ymdToString } from '@/lib/availability/core/summaryWindow'
import { loadBusyIntervals } from '@/lib/availability/data/busyIntervals'
import { resolveAvailabilityDurationMinutes } from '@/lib/availability/data/durationContext'
import { loadAvailabilityOfferingContext } from '@/lib/availability/data/offeringContext'
import {
  getScheduleConfigVersion,
  getScheduleVersion,
} from '@/lib/booking/cacheVersion'
import { OCCUPANCY_WINDOW_PADDING_MINUTES } from '@/lib/booking/constants'
import { addMinutes } from '@/lib/booking/conflicts'
import { type BookingErrorCode } from '@/lib/booking/errors'
import { prisma, prismaRead } from '@/lib/prisma'

type AvailabilityDbClient = Prisma.TransactionClient | typeof prisma

export type LoadOpenSlotDaysArgs = {
  /** The AUTHENTICATED pro. Never taken from the query string. */
  professionalId: string
  serviceId: string
  requestedLocationType: ServiceLocationType | null
  requestedLocationId: string | null
  addOnIds: string[]
  /**
   * Set when the pro is MOVING an existing booking. Two effects, both needed
   * for the grid to agree with the commit: the width is read from that booking
   * rather than the offering, and the booking stops being an obstacle to itself
   * (B3-B — otherwise its own day looks fuller than it is).
   */
  rescheduleBookingId: string | null
  /**
   * Set when the pro is booking the NEXT appointment from this booking's
   * aftercare. The width is then the CLONE's width — the rebook commit copies
   * the source booking's items (base + add-ons), so counting at offering-base
   * width lights up days the clone doesn't fit. Unlike a reschedule the source
   * booking keeps occupying its own (past) day, so it is NOT excluded from the
   * busy read.
   */
  rebookOfBookingId: string | null
  /** Inclusive local-day range, "YYYY-MM-DD". Caller has already clamped it. */
  fromYmd: string
  toYmd: string
  client?: AvailabilityDbClient
}

export type LoadOpenSlotDaysResult =
  | {
      ok: true
      /** The zone the days were bucketed in (the offering's location zone). */
      timeZone: string
      /** The width every count was computed for. */
      durationMinutes: number
      /** Bookable start count per local "YYYY-MM-DD". Dense over the range. */
      openSlots: Record<string, number>
    }
  | {
      ok: false
      /**
       * Why counts are unavailable. Callers degrade to the busy-only overlay
       * rather than failing — a pro who can't get counts should still be able
       * to pick a day.
       */
      code:
        | BookingErrorCode
        | 'SERVICE_NOT_FOUND'
        | 'PROFESSIONAL_NOT_FOUND'
        /** The range didn't parse or was empty — a caller bug, not a booking one. */
        | 'INVALID_RANGE'
    }

export async function loadOpenSlotDays(
  args: LoadOpenSlotDaysArgs,
): Promise<LoadOpenSlotDaysResult> {
  const client = args.client ?? prismaRead
  const ymds = enumerateYmdRange(args.fromYmd, args.toYmd)

  const firstYmd = ymds[0]
  const lastYmd = ymds[ymds.length - 1]
  if (!firstYmd || !lastYmd) return { ok: false, code: 'INVALID_RANGE' }

  const [scheduleVersion, scheduleConfigVersion] = await Promise.all([
    getScheduleVersion(args.professionalId),
    getScheduleConfigVersion(args.professionalId),
  ])

  const baseContext = await loadAvailabilityOfferingContext({
    professionalId: args.professionalId,
    serviceId: args.serviceId,
    requestedLocationType: args.requestedLocationType,
    requestedLocationId: args.requestedLocationId,
    // Counting a pro's own openings is never address-scoped: the pro is asking
    // "when am I free for this service", not "can I reach this client".
    clientAddressId: null,
    scheduleConfigVersion,
    cacheEnabled: true,
    client,
  })

  if (!baseContext.ok) {
    if (baseContext.kind === 'NOT_FOUND') {
      return {
        ok: false,
        code:
          baseContext.entity === 'PROFESSIONAL'
            ? 'PROFESSIONAL_NOT_FOUND'
            : 'SERVICE_NOT_FOUND',
      }
    }
    return { ok: false, code: baseContext.code }
  }

  const {
    locationId,
    effectiveLocationType,
    timeZone,
    workingHours,
    defaultStepMinutes,
    defaultLead,
    locationBufferMinutes,
    maxAdvanceDays,
    durationMinutes: baseDurationMinutes,
    offeringDbId,
  } = baseContext.value

  // The one function the client offer, the hold and the commit all size from.
  const width = await resolveAvailabilityDurationMinutes({
    professionalId: args.professionalId,
    offeringId: offeringDbId,
    addOnIds: args.addOnIds,
    locationType: effectiveLocationType,
    baseDurationMinutes,
    reschedule: args.rescheduleBookingId
      ? {
          bookingId: args.rescheduleBookingId,
          owner: { kind: 'PRO', professionalId: args.professionalId },
        }
      : null,
    rebookOf: args.rebookOfBookingId
      ? {
          bookingId: args.rebookOfBookingId,
          owner: { kind: 'PRO', professionalId: args.professionalId },
        }
      : null,
    client,
  })

  if (!width.ok) return { ok: false, code: width.code }

  const durationMinutes = width.durationMinutes

  const firstBounds = computeDayBoundsUtc(firstYmd, timeZone)
  const lastBounds = computeDayBoundsUtc(lastYmd, timeZone)

  // ONE occupancy read for the whole month, padded so an appointment straddling
  // either edge still blocks the slots it actually occupies.
  const busy = await loadBusyIntervals({
    professionalId: args.professionalId,
    locationId,
    windowStartUtc: addMinutes(
      firstBounds.dayStartUtc,
      -OCCUPANCY_WINDOW_PADDING_MINUTES,
    ),
    windowEndUtc: addMinutes(
      lastBounds.dayEndExclusiveUtc,
      OCCUPANCY_WINDOW_PADDING_MINUTES,
    ),
    nowUtc: new Date(),
    fallbackDurationMinutes: durationMinutes,
    locationBufferMinutes,
    scheduleVersion,
    excludeBookingId: args.rescheduleBookingId,
    cache: { enabled: true },
    client,
  })

  const dayResults = await Promise.all(
    ymds.map(async (ymd) => {
      const result = await computeDaySlotsFast({
        dateYMD: ymd,
        durationMinutes,
        stepMinutes: defaultStepMinutes,
        timeZone,
        workingHours,
        leadTimeMinutes: defaultLead,
        locationBufferMinutes,
        maxAdvanceDays,
        busy,
        debug: false,
      })

      // A day the engine REFUSES (no working hours, past, beyond the booking
      // horizon) genuinely has zero bookable starts — that is a count, not an
      // error, and the grid should show it as full rather than as unknown.
      return { ymd, count: result.ok ? result.slots.length : 0 }
    }),
  )

  const openSlots: Record<string, number> = {}
  for (const row of dayResults) {
    openSlots[ymdToString(row.ymd)] = row.count
  }

  return { ok: true, timeZone, durationMinutes, openSlots }
}
