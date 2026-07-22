// app/api/v1/pro/availability/busy-days/route.ts
//
// Lightweight, service-agnostic view of a PRO's OWN commitments per calendar
// day, for the aftercare date-picker popup ("which days am I already booked /
// blocked?"). Unlike /api/v1/availability/* (client-facing, per-service slot
// computation) this just buckets the pro's OCCUPYING bookings
// (BOOKING_BLOCKING_STATUSES) + calendar blocks by local day across all
// locations.

import { jsonFail, jsonOk, requirePro } from '@/app/api/_utils'
import { BOOKING_BLOCKING_STATUSES } from '@/lib/booking/constants'
import { utcDateToLocalYmd } from '@/lib/booking/dateTime'
import { prisma } from '@/lib/prisma'
import {
  isValidIanaTimeZone,
  sanitizeTimeZone,
  zonedTimeToUtc,
} from '@/lib/timeZone'

export const dynamic = 'force-dynamic'

const MAX_RANGE_DAYS = 62
const YMD_RE = /^(\d{4})-(\d{2})-(\d{2})$/

type DayBusy = { bookings: number; blocked: boolean }

function parseYmd(value: string | null): {
  year: number
  month: number
  day: number
} | null {
  if (!value) return null
  const m = YMD_RE.exec(value.trim())
  if (!m) return null
  const year = Number(m[1])
  const month = Number(m[2])
  const day = Number(m[3])
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  const probe = new Date(Date.UTC(year, month - 1, day))
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    return null
  }
  return { year, month, day }
}

function ymdString(parts: { year: number; month: number; day: number }): string {
  return `${String(parts.year).padStart(4, '0')}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`
}

function addDaysUtc(parts: { year: number; month: number; day: number }, days: number) {
  const d = new Date(Date.UTC(parts.year, parts.month - 1, parts.day))
  d.setUTCDate(d.getUTCDate() + days)
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() }
}

function daysBetweenInclusive(
  fromYmd: string,
  toYmd: string,
): number {
  const a = parseYmd(fromYmd)
  const b = parseYmd(toYmd)
  if (!a || !b) return 0
  const da = Date.UTC(a.year, a.month - 1, a.day)
  const db = Date.UTC(b.year, b.month - 1, b.day)
  return Math.round((db - da) / (24 * 60 * 60 * 1000)) + 1
}

export async function GET(req: Request) {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res
    const professionalId = auth.professionalId

    const url = new URL(req.url)
    const fromParts = parseYmd(url.searchParams.get('from'))
    const toParts = parseYmd(url.searchParams.get('to'))

    if (!fromParts || !toParts) {
      return jsonFail(400, 'from and to must be YYYY-MM-DD dates.')
    }

    const fromYmd = ymdString(fromParts)
    let toYmd = ymdString(toParts)

    if (toYmd < fromYmd) {
      return jsonFail(400, 'to must be on or after from.')
    }

    // Bound the scan; clamp an over-long range rather than erroring.
    if (daysBetweenInclusive(fromYmd, toYmd) > MAX_RANGE_DAYS) {
      toYmd = ymdString(addDaysUtc(fromParts, MAX_RANGE_DAYS - 1))
    }
    const toPartsClamped = parseYmd(toYmd) ?? toParts

    const tzParam = url.searchParams.get('tz')
    let tz: string
    if (tzParam && isValidIanaTimeZone(tzParam)) {
      tz = sanitizeTimeZone(tzParam, 'UTC')
    } else {
      const profile = await prisma.professionalProfile.findUnique({
        where: { id: professionalId },
        select: { timeZone: true },
      })
      tz = sanitizeTimeZone(profile?.timeZone, 'UTC')
    }

    // UTC window covering [from 00:00 local, (to+1) 00:00 local).
    const fromUtc = zonedTimeToUtc({
      year: fromParts.year,
      month: fromParts.month,
      day: fromParts.day,
      hour: 0,
      minute: 0,
      timeZone: tz,
    })
    const toExclusiveParts = addDaysUtc(toPartsClamped, 1)
    const toUtcExclusive = zonedTimeToUtc({
      year: toExclusiveParts.year,
      month: toExclusiveParts.month,
      day: toExclusiveParts.day,
      hour: 0,
      minute: 0,
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
      const created = { bookings: 0, blocked: false }
      days[ymd] = created
      return created
    }

    for (const booking of bookings) {
      const ymd = utcDateToLocalYmd(booking.scheduledFor, tz)
      if (ymd < fromYmd || ymd > toYmd) continue
      ensure(ymd).bookings += 1
    }

    for (const block of blocks) {
      let cursor = utcDateToLocalYmd(block.startsAt, tz)
      const lastDay = utcDateToLocalYmd(block.endsAt, tz)
      // Walk each local day the block touches, clamped to the requested range.
      // The MAX_RANGE_DAYS cap on the window bounds the iteration.
      for (let guard = 0; guard <= MAX_RANGE_DAYS + 1; guard += 1) {
        if (cursor >= fromYmd && cursor <= toYmd) ensure(cursor).blocked = true
        if (cursor >= lastDay) break
        const parts = parseYmd(cursor)
        if (!parts) break
        cursor = ymdString(addDaysUtc(parts, 1))
      }
    }

    return jsonOk({ tz, from: fromYmd, to: toYmd, days }, 200)
  } catch (error: unknown) {
    console.error('GET /api/v1/pro/availability/busy-days error', error)
    return jsonFail(500, 'Internal server error')
  }
}
