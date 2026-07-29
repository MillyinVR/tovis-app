// app/api/v1/pro/availability/busy-days/route.ts
//
// The per-day overlay behind every pro-facing date picker, in two modes.
//
// 1. BUSY-ONLY (no `serviceId`) — the original, service-agnostic shape: buckets
//    the pro's OCCUPYING bookings (BOOKING_BLOCKING_STATUSES) and calendar
//    blocks by local day, across all locations. Answers "where am I already
//    committed?". Days with nothing on them are omitted.
//
// 2. OPEN-SLOT (with `serviceId`) — R4. Additionally counts the BOOKABLE start
//    times left on each day for that service, so the grid can show where the
//    pro can still fit someone rather than only where they can't. Days are then
//    zero-filled across the range, because "0 open" is information and must not
//    look like "not counted".
//
// The counting lives in `lib/availability/data/openSlotDays.ts`, which drives
// the same slot engine `/api/v1/availability/*` uses — one occupancy read for
// the whole range plus an in-memory pass per day.
//
// Scope: everything is the SESSION's pro. There is no `professionalId`
// parameter; the service context params only narrow which of THEIR offerings is
// being counted.

import { jsonFail, jsonOk, requirePro } from '@/app/api/_utils'
import {
  enumerateYmdRange,
  parseYYYYMMDD,
  ymdSerial,
  ymdToString,
  type YMD,
} from '@/lib/availability/core/summaryWindow'
import { loadOpenSlotDays } from '@/lib/availability/data/openSlotDays'
import { parseAvailabilityRequest } from '@/lib/availability/http/parseAvailabilityRequest'
import { BOOKING_BLOCKING_STATUSES } from '@/lib/booking/constants'
import { utcDateToLocalYmd } from '@/lib/booking/dateTime'
import type {
  ProAvailabilityBusyDaysOk,
  ProBusyDayDTO,
  ProOpenSlotContextDTO,
} from '@/lib/dto/proAvailability'
import { prisma } from '@/lib/prisma'
import { addDaysToYMD } from '@/lib/time'
import {
  isValidIanaTimeZone,
  sanitizeTimeZone,
  startOfLocalDayUtc,
} from '@/lib/timeZone'

export const dynamic = 'force-dynamic'

const MAX_RANGE_DAYS = 62

// The wire shape is the DTO, so native decode models are generated from the
// same declaration the route is checked against (`satisfies` below).
type DayBusy = ProBusyDayDTO

function daysBetweenInclusive(from: YMD, to: YMD): number {
  return ymdSerial(to) - ymdSerial(from) + 1
}

export async function GET(req: Request) {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res
    const professionalId = auth.professionalId

    const url = new URL(req.url)
    const fromParts = parseYYYYMMDD(url.searchParams.get('from'))
    const toParts = parseYYYYMMDD(url.searchParams.get('to'))

    if (!fromParts || !toParts) {
      return jsonFail(400, 'from and to must be YYYY-MM-DD dates.')
    }

    const fromYmd = ymdToString(fromParts)

    if (ymdSerial(toParts) < ymdSerial(fromParts)) {
      return jsonFail(400, 'to must be on or after from.')
    }

    // Bound the scan; clamp an over-long range rather than erroring.
    const clampedToParts =
      daysBetweenInclusive(fromParts, toParts) > MAX_RANGE_DAYS
        ? addDaysToYMD(
            fromParts.year,
            fromParts.month,
            fromParts.day,
            MAX_RANGE_DAYS - 1,
          )
        : toParts
    const toYmd = ymdToString(clampedToParts)

    // Reuses the availability routes' own query parser so the service-context
    // params (serviceId / locationType / locationId / addOnIds /
    // rescheduleBookingId) are spelled and normalized identically everywhere.
    const {
      serviceId,
      requestedLocationType,
      requestedLocationId,
      addOnIds,
      rescheduleBookingId,
      rebookOfBookingId,
    } = parseAvailabilityRequest(req)

    const openSlotResult = serviceId
      ? await loadOpenSlotDays({
          professionalId,
          serviceId,
          requestedLocationType,
          requestedLocationId,
          addOnIds,
          rescheduleBookingId,
          rebookOfBookingId,
          fromYmd,
          toYmd,
        })
      : null

    // Timezone truth: when counts were computed they were bucketed in the
    // OFFERING's location zone, so the busy buckets MUST use that same zone —
    // two overlays keyed to different local days would land on the same grid
    // cell and disagree. Otherwise fall back to the requested zone, then the
    // pro's profile zone.
    let tz: string
    if (openSlotResult?.ok) {
      tz = openSlotResult.timeZone
    } else {
      const tzParam = url.searchParams.get('tz')
      if (tzParam && isValidIanaTimeZone(tzParam)) {
        tz = sanitizeTimeZone(tzParam, 'UTC')
      } else {
        const profile = await prisma.professionalProfile.findUnique({
          where: { id: professionalId },
          select: { timeZone: true },
        })
        tz = sanitizeTimeZone(profile?.timeZone, 'UTC')
      }
    }

    // UTC window covering [from 00:00 local, (to+1) 00:00 local).
    const fromUtc = startOfLocalDayUtc({
      year: fromParts.year,
      month: fromParts.month,
      day: fromParts.day,
      timeZone: tz,
    })
    const toExclusiveParts = addDaysToYMD(
      clampedToParts.year,
      clampedToParts.month,
      clampedToParts.day,
      1,
    )
    const toUtcExclusive = startOfLocalDayUtc({
      year: toExclusiveParts.year,
      month: toExclusiveParts.month,
      day: toExclusiveParts.day,
      timeZone: tz,
    })

    const [bookings, blocks] = await Promise.all([
      prisma.booking.findMany({
        where: {
          professionalId,
          // The shared occupancy set (F8), not a local copy: this popup must
          // call a day busy for exactly the bookings that block a slot. It used
          // to omit COMPLETED on the theory that "completed is past" — an
          // early-finished or same-day session makes that false.
          status: { in: [...BOOKING_BLOCKING_STATUSES] },
          scheduledFor: { gte: fromUtc, lt: toUtcExclusive },
        },
        select: { scheduledFor: true },
      }),
      prisma.calendarBlock.findMany({
        where: {
          professionalId,
          startsAt: { lt: toUtcExclusive },
          endsAt: { gt: fromUtc },
        },
        select: { startsAt: true, endsAt: true },
      }),
    ])

    const days: Record<string, DayBusy> = {}
    const ensure = (ymd: string): DayBusy => {
      const existing = days[ymd]
      if (existing) return existing
      const created: DayBusy = { bookings: 0, blocked: false }
      days[ymd] = created
      return created
    }

    for (const booking of bookings) {
      const ymd = utcDateToLocalYmd(booking.scheduledFor, tz)
      if (ymd < fromYmd || ymd > toYmd) continue
      ensure(ymd).bookings += 1
    }

    for (const block of blocks) {
      // Walk only the part of the block that OVERLAPS the requested range.
      //
      // The clamp is what makes a long block correct, not just cheaper: this
      // used to walk from the block's own first day with an iteration cap, so a
      // block spanning more days than the cap (a months-long closure) ran out of
      // iterations before reaching the requested window and left every day in
      // it unmarked — the picker offered days the pro had blocked off.
      const firstDay = utcDateToLocalYmd(block.startsAt, tz)
      const lastDay = utcDateToLocalYmd(block.endsAt, tz)
      const walkFrom = firstDay > fromYmd ? firstDay : fromYmd
      const walkTo = lastDay < toYmd ? lastDay : toYmd
      if (walkFrom > walkTo) continue

      for (const ymd of enumerateYmdRange(walkFrom, walkTo, MAX_RANGE_DAYS + 1)) {
        ensure(ymdToString(ymd)).blocked = true
      }
    }

    // Zero-fill the whole range when counts exist: a day with no openings is a
    // real answer, and must be distinguishable from one never counted.
    if (openSlotResult?.ok) {
      for (const ymd of enumerateYmdRange(fromYmd, toYmd, MAX_RANGE_DAYS + 1)) {
        const key = ymdToString(ymd)
        ensure(key).openSlots = openSlotResult.openSlots[key] ?? 0
      }
    }

    const openSlots: ProOpenSlotContextDTO | null = !serviceId
      ? null
      : openSlotResult?.ok
        ? {
            computed: true,
            durationMinutes: openSlotResult.durationMinutes,
            reason: null,
          }
        : {
            computed: false,
            durationMinutes: null,
            reason: openSlotResult?.code ?? 'UNKNOWN',
          }

    return jsonOk(
      {
        ok: true,
        tz,
        from: fromYmd,
        to: toYmd,
        days,
        openSlots,
      } satisfies ProAvailabilityBusyDaysOk,
      200,
    )
  } catch (error: unknown) {
    console.error('GET /api/v1/pro/availability/busy-days error', error)
    return jsonFail(500, 'Internal server error')
  }
}
