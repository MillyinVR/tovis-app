// app/api/availability/day/route.ts
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import type { ServiceLocationType } from '@prisma/client'

export const dynamic = 'force-dynamic'

type BookingForBusy = {
  scheduledFor: Date
  durationMinutesSnapshot: number | null
}

type HoldForBusy = {
  scheduledFor: Date
  expiresAt: Date
}

type BusyInterval = { start: Date; end: Date }

type WorkingHoursDay = { enabled?: boolean; start?: string; end?: string }
type WorkingHours = Record<string, WorkingHoursDay>

function pickString(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

function toInt(value: string | null, fallback: number) {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

function clampInt(n: number, min: number, max: number) {
  return Math.min(Math.max(n, min), max)
}

function addMinutes(d: Date, minutes: number) {
  return new Date(d.getTime() + minutes * 60_000)
}

/** existingStart < requestedEnd AND requestedStart < existingEnd */
function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date) {
  return aStart < bEnd && bStart < aEnd
}

function normalizeLocationType(v: unknown): ServiceLocationType | null {
  const s = typeof v === 'string' ? v.trim().toUpperCase() : ''
  if (s === 'SALON') return 'SALON'
  if (s === 'MOBILE') return 'MOBILE'
  return null
}

function parseYYYYMMDD(s: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  if (!m) return null
  const year = Number(m[1])
  const month = Number(m[2])
  const day = Number(m[3])
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null
  if (month < 1 || month > 12) return null
  if (day < 1 || day > 31) return null
  return { year, month, day }
}

function parseHHMM(s: string) {
  const m = /^(\d{2}):(\d{2})$/.exec(s)
  if (!m) return null
  const hh = Number(m[1])
  const mm = Number(m[2])
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null
  return { hh, mm }
}

/** TZ wall-clock parts for a UTC instant rendered in timeZone */
function getZonedParts(dateUtc: Date, timeZone: string) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })

  const parts = dtf.formatToParts(dateUtc)
  const map: Record<string, string> = {}
  for (const p of parts) map[p.type] = p.value

  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour),
    minute: Number(map.minute),
    second: Number(map.second),
  }
}

/** offset minutes between UTC and tz at a given UTC instant */
function getTimeZoneOffsetMinutes(dateUtc: Date, timeZone: string) {
  const z = getZonedParts(dateUtc, timeZone)
  const asIfUtc = Date.UTC(z.year, z.month - 1, z.day, z.hour, z.minute, z.second)
  return Math.round((asIfUtc - dateUtc.getTime()) / 60_000)
}

/** Convert a wall-clock time in timeZone into UTC Date (two-pass for DST) */
function zonedTimeToUtc(args: {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  timeZone: string
}) {
  const { year, month, day, hour, minute, timeZone } = args

  // Start with a naive UTC guess, then correct by the timezone offset at that instant.
  let guess = new Date(Date.UTC(year, month - 1, day, hour, minute, 0, 0))
  const offset1 = getTimeZoneOffsetMinutes(guess, timeZone)
  guess = new Date(guess.getTime() - offset1 * 60_000)

  // Second pass handles DST transitions where offset changes between guess and corrected time.
  const offset2 = getTimeZoneOffsetMinutes(guess, timeZone)
  if (offset2 !== offset1) {
    guess = new Date(guess.getTime() - (offset2 - offset1) * 60_000)
  }

  return guess
}

function getDayKeyFromYMD(args: { year: number; month: number; day: number; timeZone: string }) {
  const { year, month, day, timeZone } = args
  // Use noon in the target zone to avoid DST midnight edge weirdness.
  const noonUtc = zonedTimeToUtc({ year, month, day, hour: 12, minute: 0, timeZone })
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short' })
  const w = fmt.format(noonUtc).toLowerCase()
  if (w.startsWith('sun')) return 'sun'
  if (w.startsWith('mon')) return 'mon'
  if (w.startsWith('tue')) return 'tue'
  if (w.startsWith('wed')) return 'wed'
  if (w.startsWith('thu')) return 'thu'
  if (w.startsWith('fri')) return 'fri'
  return 'sat'
}

function pickModeDurationMinutes(
  offering: { salonDurationMinutes: number | null; mobileDurationMinutes: number | null },
  locationType: ServiceLocationType,
) {
  const d = locationType === 'MOBILE' ? offering.mobileDurationMinutes : offering.salonDurationMinutes
  const n = Number(d ?? 0)
  return Number.isFinite(n) && n > 0 ? n : 60
}

async function computeDaySlots(args: {
  professionalId: string
  dateYMD: { year: number; month: number; day: number }
  durationMinutes: number
  stepMinutes: number
  timeZone: string
  workingHours: unknown | null
  bufferMinutes: number
}): Promise<
  | { ok: true; slots: string[]; dayStartUtc: Date; dayEndExclusiveUtc: Date }
  | { ok: false; error: string; dayStartUtc: Date; dayEndExclusiveUtc: Date }
> {
  const { professionalId, dateYMD, durationMinutes, stepMinutes, timeZone, workingHours, bufferMinutes } = args

  const nowUtc = new Date()

  // IMPORTANT: use [start, endExclusive) rather than lte 23:59 to avoid day-boundary rounding issues.
  const dayStartUtc = zonedTimeToUtc({ ...dateYMD, hour: 0, minute: 0, timeZone })
  const dayEndExclusiveUtc = zonedTimeToUtc({ ...dateYMD, hour: 0, minute: 0, timeZone })
  dayEndExclusiveUtc.setUTCDate(dayEndExclusiveUtc.getUTCDate() + 1)

  const wh = workingHours && typeof workingHours === 'object' ? (workingHours as WorkingHours) : null
  if (!wh) {
    return { ok: false, error: 'This professional has not set working hours yet.', dayStartUtc, dayEndExclusiveUtc }
  }

  const dayKey = getDayKeyFromYMD({ ...dateYMD, timeZone })
  const rule = wh[dayKey]

  if (!rule) {
    return { ok: false, error: 'This professional’s working hours are misconfigured.', dayStartUtc, dayEndExclusiveUtc }
  }
  if (rule.enabled === false) {
    return { ok: true, slots: [], dayStartUtc, dayEndExclusiveUtc }
  }

  const startParsed = parseHHMM(String(rule.start ?? ''))
  const endParsed = parseHHMM(String(rule.end ?? ''))
  if (!startParsed || !endParsed) {
    return { ok: false, error: 'This professional’s working hours are misconfigured.', dayStartUtc, dayEndExclusiveUtc }
  }

  const startMinute = startParsed.hh * 60 + startParsed.mm
  const endMinute = endParsed.hh * 60 + endParsed.mm
  if (endMinute <= startMinute) {
    return { ok: false, error: 'This professional’s working hours are misconfigured.', dayStartUtc, dayEndExclusiveUtc }
  }

  const [bookings, holds] = await Promise.all([
    prisma.booking.findMany({
      where: {
        professionalId,
        scheduledFor: { gte: dayStartUtc, lt: dayEndExclusiveUtc },
        // Cancelled bookings should not block availability.
        NOT: { status: 'CANCELLED' },
      },
      select: { scheduledFor: true, durationMinutesSnapshot: true },
      take: 2000,
    }) as unknown as Promise<BookingForBusy[]>,

    prisma.bookingHold.findMany({
      where: {
        professionalId,
        scheduledFor: { gte: dayStartUtc, lt: dayEndExclusiveUtc },
        expiresAt: { gt: nowUtc },
      },
      select: { scheduledFor: true, expiresAt: true },
      take: 2000,
    }) as unknown as Promise<HoldForBusy[]>,
  ])

  const busy: BusyInterval[] = [
    ...bookings.map((b) => {
      const start = new Date(b.scheduledFor)
      const dur = Number(b.durationMinutesSnapshot) || durationMinutes
      return { start, end: addMinutes(start, dur) }
    }),
    ...holds.map((h) => {
      const start = new Date(h.scheduledFor)
      return { start, end: addMinutes(start, durationMinutes) }
    }),
  ]

  const slots: string[] = []
  const bufferCutoffUtc = addMinutes(nowUtc, bufferMinutes)

  for (let minute = startMinute; minute + durationMinutes <= endMinute; minute += stepMinutes) {
    const hh = Math.floor(minute / 60)
    const mm = minute % 60

    const slotStartUtc = zonedTimeToUtc({
      year: dateYMD.year,
      month: dateYMD.month,
      day: dateYMD.day,
      hour: hh,
      minute: mm,
      timeZone,
    })

    if (slotStartUtc.getTime() < bufferCutoffUtc.getTime()) continue

    const slotEndUtc = addMinutes(slotStartUtc, durationMinutes)
    if (busy.some((bi) => overlaps(slotStartUtc, slotEndUtc, bi.start, bi.end))) continue

    slots.push(slotStartUtc.toISOString())
  }

  return { ok: true, slots, dayStartUtc, dayEndExclusiveUtc }
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)

    const professionalId = pickString(searchParams.get('professionalId'))
    const serviceId = pickString(searchParams.get('serviceId'))
    const locationType = normalizeLocationType(searchParams.get('locationType'))
    const dateStr = pickString(searchParams.get('date')) // YYYY-MM-DD in pro TZ

    const stepRaw = pickString(searchParams.get('stepMinutes')) ?? pickString(searchParams.get('step'))
    const bufferRaw = pickString(searchParams.get('bufferMinutes')) ?? pickString(searchParams.get('buffer'))

    const stepMinutes = clampInt(toInt(stepRaw, 5), 5, 60)
    const bufferMinutes = clampInt(toInt(bufferRaw, 10), 0, 120)

    if (!professionalId || !serviceId || !locationType || !dateStr) {
      return NextResponse.json({ ok: false, error: 'Missing required params.' }, { status: 400 })
    }

    const ymd = parseYYYYMMDD(dateStr)
    if (!ymd) {
      return NextResponse.json({ ok: false, error: 'Invalid date. Use YYYY-MM-DD.' }, { status: 400 })
    }

    const pro = await prisma.professionalProfile.findUnique({
      where: { id: professionalId },
      select: { id: true, timeZone: true, workingHours: true },
    })
    if (!pro) return NextResponse.json({ ok: false, error: 'Professional not found.' }, { status: 404 })

    // If timeZone is missing, default is a footgun. Better than crashing, but still a footgun.
    const timeZone = pro.timeZone || 'America/Los_Angeles'

    // Booking window based on PRO calendar days (not naive UTC date math)
    const nowUtc = new Date()
    const nowParts = getZonedParts(nowUtc, timeZone)

    const reqNoonUtc = zonedTimeToUtc({ ...ymd, hour: 12, minute: 0, timeZone })
    const todayNoonUtc = zonedTimeToUtc({
      year: nowParts.year,
      month: nowParts.month,
      day: nowParts.day,
      hour: 12,
      minute: 0,
      timeZone,
    })

    const dayDiff = Math.floor((reqNoonUtc.getTime() - todayNoonUtc.getTime()) / (24 * 60 * 60_000))
    const maxAdvanceDays = 365

    if (dayDiff < 0) {
      return NextResponse.json({ ok: false, error: 'Date is in the past.' }, { status: 400 })
    }
    if (dayDiff > maxAdvanceDays) {
      return NextResponse.json(
        { ok: false, error: `You can book up to ${maxAdvanceDays} days in advance.` },
        { status: 400 },
      )
    }

    const offering = await prisma.professionalServiceOffering.findFirst({
      where: { professionalId, serviceId, isActive: true },
      select: {
        offersInSalon: true,
        offersMobile: true,
        salonDurationMinutes: true,
        mobileDurationMinutes: true,
      },
    })
    if (!offering) return NextResponse.json({ ok: false, error: 'Offering not found.' }, { status: 404 })

    if (locationType === 'SALON' && !offering.offersInSalon) {
      return NextResponse.json({ ok: false, error: 'This service is not offered in-salon.' }, { status: 400 })
    }
    if (locationType === 'MOBILE' && !offering.offersMobile) {
      return NextResponse.json({ ok: false, error: 'This service is not offered as mobile.' }, { status: 400 })
    }

    const durationMinutes = pickModeDurationMinutes(
      { salonDurationMinutes: offering.salonDurationMinutes, mobileDurationMinutes: offering.mobileDurationMinutes },
      locationType,
    )

    const result = await computeDaySlots({
      professionalId,
      dateYMD: ymd,
      durationMinutes,
      stepMinutes,
      timeZone,
      workingHours: pro.workingHours ?? null,
      bufferMinutes,
    })

    const serverNowInProTz = getZonedParts(nowUtc, timeZone)

    if (!result.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: result.error,
          timeZone,
          debug: { serverNowUtc: nowUtc.toISOString(), serverNowInProTz },
        },
        { status: 400 },
      )
    }

    return NextResponse.json({
      ok: true,
      professionalId,
      serviceId,
      locationType,
      timeZone,
      date: dateStr,
      durationMinutes,
      stepMinutes,
      bufferMinutes,
      dayStartUtc: result.dayStartUtc.toISOString(),
      dayEndExclusiveUtc: result.dayEndExclusiveUtc.toISOString(),
      slots: result.slots,
      debug: { serverNowUtc: nowUtc.toISOString(), serverNowInProTz },
    })
  } catch (e) {
    console.error('GET /api/availability/day error', e)
    return NextResponse.json({ ok: false, error: 'Failed to load availability' }, { status: 500 })
  }
}
