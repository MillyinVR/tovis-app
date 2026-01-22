// app/api/availability/day/route.ts
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import type { ServiceLocationType } from '@prisma/client'
import { pickBookableLocation } from '@/lib/booking/pickLocation'
import { isValidIanaTimeZone, sanitizeTimeZone, getZonedParts, zonedTimeToUtc } from '@/lib/timeZone'
import { pickString } from '@/app/api/_utils/pick'

export const dynamic = 'force-dynamic'

type WorkingHoursDay = { enabled?: boolean; start?: string; end?: string }
type WorkingHours = Record<string, WorkingHoursDay>
type BusyInterval = { start: Date; end: Date }

function toInt(value: string | null, fallback: number) {
  const n = Number(value)
  return Number.isFinite(n) ? Math.trunc(n) : fallback
}

function clampInt(n: number, min: number, max: number) {
  const x = Math.trunc(n)
  return Math.min(Math.max(x, min), max)
}

function addMinutes(d: Date, minutes: number) {
  return new Date(d.getTime() + minutes * 60_000)
}

function normalizeToMinute(d: Date) {
  const x = new Date(d)
  x.setSeconds(0, 0)
  return x
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

function parseYYYYMMDD(s: unknown) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s ?? '').trim())
  if (!m) return null
  const year = Number(m[1])
  const month = Number(m[2])
  const day = Number(m[3])
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null
  if (month < 1 || month > 12) return null
  if (day < 1 || day > 31) return null
  return { year, month, day }
}

/** Accepts both "9:00" and "09:00" */
function parseHHMM(s: unknown) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s ?? '').trim())
  if (!m) return null
  const hh = Number(m[1])
  const mm = Number(m[2])
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null
  return { hh, mm }
}

/**
 * Future-proof stepMinutes:
 * - allow only sensible grids (5/10/15/20/30/60)
 * - if DB contains weird values, snap upward to the next sensible grid
 * - default to 30 when missing
 */
function normalizeStepMinutes(input: unknown, fallback: number) {
  const n = typeof input === 'number' ? input : Number(input)
  const raw = Number.isFinite(n) ? Math.trunc(n) : fallback

  const allowed = new Set([5, 10, 15, 20, 30, 60])
  if (allowed.has(raw)) return raw

  if (raw <= 5) return 5
  if (raw <= 10) return 10
  if (raw <= 15) return 15
  if (raw <= 20) return 20
  if (raw <= 30) return 30
  return 60
}

/** ---------- date helpers ---------- */

function addDaysToYMD(year: number, month: number, day: number, daysToAdd: number) {
  // Anchor at noon UTC to avoid DST weirdness while rolling dates.
  const d = new Date(Date.UTC(year, month - 1, day + daysToAdd, 12, 0, 0, 0))
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() }
}

function ymdSerial(ymd: { year: number; month: number; day: number }) {
  return Math.floor(Date.UTC(ymd.year, ymd.month - 1, ymd.day, 12, 0, 0, 0) / 86_400_000)
}

function ymdToString(ymd: { year: number; month: number; day: number }) {
  const mm = String(ymd.month).padStart(2, '0')
  const dd = String(ymd.day).padStart(2, '0')
  return `${ymd.year}-${mm}-${dd}`
}

function pickTimeZone(locTz: string | null, proTz: string | null) {
  if (isValidIanaTimeZone(locTz)) return String(locTz).trim()
  if (isValidIanaTimeZone(proTz)) return String(proTz).trim()
  return 'America/Los_Angeles'
}

/**
 * Day key (sun/mon/...) for a given YMD interpreted as a LOCAL date in `timeZone`.
 * We compute local-noon -> UTC, then format weekday in the tz. This is DST-stable.
 */
function getDayKeyFromYMD(args: { year: number; month: number; day: number; timeZone: string }) {
  const timeZone = sanitizeTimeZone(args.timeZone, 'America/Los_Angeles')

  const noonUtc = zonedTimeToUtc({
    year: args.year,
    month: args.month,
    day: args.day,
    hour: 12,
    minute: 0,
    second: 0,
    timeZone,
  })

  const w = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short' }).format(noonUtc).toLowerCase()

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
  const base = Number.isFinite(n) && n > 0 ? n : 60
  return clampInt(base, 15, 12 * 60)
}

function pickEffectiveLocationType(args: {
  requested: ServiceLocationType | null
  offersInSalon: boolean
  offersMobile: boolean
}): ServiceLocationType | null {
  const { requested, offersInSalon, offersMobile } = args
  if (requested === 'SALON' && offersInSalon) return 'SALON'
  if (requested === 'MOBILE' && offersMobile) return 'MOBILE'
  if (offersInSalon) return 'SALON'
  if (offersMobile) return 'MOBILE'
  return null
}

/**
 * ✅ Correct day bounds:
 * Interpret YYYY-MM-DD as a LOCAL day in `timeZone`, then compute local midnight -> UTC.
 */
function computeDayBoundsUtc(dateYMD: { year: number; month: number; day: number }, timeZoneRaw: string) {
  const timeZone = sanitizeTimeZone(timeZoneRaw, 'America/Los_Angeles')

  const dayStartUtc = zonedTimeToUtc({
    year: dateYMD.year,
    month: dateYMD.month,
    day: dateYMD.day,
    hour: 0,
    minute: 0,
    second: 0,
    timeZone,
  })

  const next = addDaysToYMD(dateYMD.year, dateYMD.month, dateYMD.day, 1)
  const dayEndExclusiveUtc = zonedTimeToUtc({
    year: next.year,
    month: next.month,
    day: next.day,
    hour: 0,
    minute: 0,
    second: 0,
    timeZone,
  })

  return { timeZone, dayStartUtc, dayEndExclusiveUtc }
}

/** ---------- slot computation ---------- */
async function computeDaySlots(args: {
  professionalId: string
  locationId: string
  dateYMD: { year: number; month: number; day: number }
  durationMinutes: number
  stepMinutes: number
  timeZone: string
  workingHours: unknown | null
  leadTimeMinutes: number
  adjacencyBufferMinutes: number
  debug?: boolean
}): Promise<
  | { ok: true; slots: string[]; dayStartUtc: Date; dayEndExclusiveUtc: Date; debug?: any }
  | { ok: false; error: string; dayStartUtc: Date; dayEndExclusiveUtc: Date; debug?: any }
> {
  const {
    professionalId,
    locationId,
    dateYMD,
    durationMinutes,
    stepMinutes,
    timeZone: tzIn,
    workingHours,
    leadTimeMinutes,
    adjacencyBufferMinutes,
    debug,
  } = args

  const { timeZone, dayStartUtc, dayEndExclusiveUtc } = computeDayBoundsUtc(dateYMD, tzIn)
  const nowUtc = new Date()

  const wh = workingHours && typeof workingHours === 'object' ? (workingHours as WorkingHours) : null
  if (!wh) {
    return {
      ok: false,
      error: 'Working hours are not set for this location.',
      dayStartUtc,
      dayEndExclusiveUtc,
      debug: debug ? { timeZone, reason: 'no-workingHours' } : undefined,
    }
  }

  const dayKey = getDayKeyFromYMD({ ...dateYMD, timeZone })
  const rule = wh[dayKey]

  if (!rule) {
    return {
      ok: false,
      error: 'Working hours are misconfigured (missing weekday rules). Please re-save your schedule.',
      dayStartUtc,
      dayEndExclusiveUtc,
      debug: debug ? { timeZone, dayKey, whKeys: Object.keys(wh) } : undefined,
    }
  }

  if (rule.enabled === false) {
    return {
      ok: true,
      slots: [],
      dayStartUtc,
      dayEndExclusiveUtc,
      debug: debug ? { timeZone, dayKey, enabled: false } : undefined,
    }
  }

  const startParsed = parseHHMM(rule.start)
  const endParsed = parseHHMM(rule.end)
  if (!startParsed || !endParsed) {
    return {
      ok: false,
      error: 'Working hours are misconfigured (invalid start/end time). Please re-save your schedule.',
      dayStartUtc,
      dayEndExclusiveUtc,
      debug: debug ? { timeZone, dayKey, rule } : undefined,
    }
  }

  const startMinute = startParsed.hh * 60 + startParsed.mm
  const endMinute = endParsed.hh * 60 + endParsed.mm
  if (endMinute <= startMinute) {
    return {
      ok: false,
      error: 'Working hours are misconfigured (end must be after start). Please re-save your schedule.',
      dayStartUtc,
      dayEndExclusiveUtc,
      debug: debug ? { timeZone, dayKey, startMinute, endMinute } : undefined,
    }
  }

  // Wider scan catches cross-midnight spillover (shared calendar across modes)
  const scanStartUtc = addMinutes(dayStartUtc, -24 * 60)
  const scanEndUtc = addMinutes(dayEndExclusiveUtc, 24 * 60)

  const [bookings, holds, blocks] = await Promise.all([
    prisma.booking.findMany({
      where: {
        professionalId,
        scheduledFor: { gte: scanStartUtc, lt: scanEndUtc },
        NOT: { status: 'CANCELLED' },
      },
      select: { scheduledFor: true, totalDurationMinutes: true, bufferMinutes: true, status: true },
      take: 3000,
    }),

    prisma.bookingHold.findMany({
      where: {
        professionalId,
        scheduledFor: { gte: scanStartUtc, lt: scanEndUtc },
        expiresAt: { gt: nowUtc },
      },
      select: { scheduledFor: true },
      take: 3000,
    }),

    prisma.calendarBlock.findMany({
      where: {
        professionalId,
        startsAt: { lt: scanEndUtc },
        endsAt: { gt: scanStartUtc },
        OR: [{ locationId: null }, { locationId }],
      },
      select: { startsAt: true, endsAt: true, locationId: true },
      take: 3000,
    }),
  ])

  const adjBuf = clampInt(Number(adjacencyBufferMinutes ?? 0) || 0, 0, 120)

  const busy: BusyInterval[] = [
    ...bookings
      .filter((b) => String(b.status ?? '').toUpperCase() !== 'CANCELLED')
      .map((b) => {
        const start = normalizeToMinute(new Date(b.scheduledFor))
        const baseDur = Number(b.totalDurationMinutes || durationMinutes)
        const bBuf = Number(b.bufferMinutes ?? 0)
        const effectiveBuf = Number.isFinite(bBuf) ? clampInt(bBuf, 0, 120) : adjBuf
        return { start, end: addMinutes(start, baseDur + effectiveBuf) }
      }),

    ...holds.map((h) => {
      const start = normalizeToMinute(new Date(h.scheduledFor))
      return { start, end: addMinutes(start, durationMinutes + adjBuf) }
    }),

    ...blocks.map((bl) => ({ start: new Date(bl.startsAt), end: new Date(bl.endsAt) })),
  ]

  const cutoffUtc = addMinutes(nowUtc, clampInt(Number(leadTimeMinutes ?? 0) || 0, 0, 240))

  // Extra guard: even if callers pass something odd, keep it sane.
  const step = normalizeStepMinutes(stepMinutes, 30)

  const slots: string[] = []

  // debug counters
  let skipBeforeDay = 0
  let skipAfterDay = 0
  let skipLead = 0
  let skipOverEnd = 0
  let skipBusy = 0

  for (let minute = startMinute; minute + durationMinutes <= endMinute; minute += step) {
    const hh = Math.floor(minute / 60)
    const mm = minute % 60

    const slotStartUtc = normalizeToMinute(
      zonedTimeToUtc({
        year: dateYMD.year,
        month: dateYMD.month,
        day: dateYMD.day,
        hour: hh,
        minute: mm,
        second: 0,
        timeZone,
      }),
    )

    if (slotStartUtc < dayStartUtc) {
      skipBeforeDay++
      continue
    }
    if (slotStartUtc >= dayEndExclusiveUtc) {
      skipAfterDay++
      continue
    }
    if (slotStartUtc.getTime() < cutoffUtc.getTime()) {
      skipLead++
      continue
    }

    const slotEndWorkUtc = addMinutes(slotStartUtc, durationMinutes)
    if (slotEndWorkUtc > dayEndExclusiveUtc) {
      skipOverEnd++
      continue
    }

    const slotEndWithBufferUtc = addMinutes(slotStartUtc, durationMinutes + adjBuf)
    if (busy.some((bi) => overlaps(slotStartUtc, slotEndWithBufferUtc, bi.start, bi.end))) {
      skipBusy++
      continue
    }

    slots.push(slotStartUtc.toISOString())
  }

  const startLocal = getZonedParts(dayStartUtc, timeZone)
  const endLocal = getZonedParts(addMinutes(dayEndExclusiveUtc, -1), timeZone) // last ms in day

  const localDateMismatch =
    startLocal.year !== dateYMD.year || startLocal.month !== dateYMD.month || startLocal.day !== dateYMD.day

  return {
    ok: true,
    slots,
    dayStartUtc,
    dayEndExclusiveUtc,
    debug: debug
      ? {
          requestedYMD: dateYMD,
          timeZone,
          dayKey,
          workingHoursRule: rule,

          startMinute,
          endMinute,
          durationMinutes,
          stepMinutes: step,
          leadTimeMinutes,
          cutoffUtc: cutoffUtc.toISOString(),
          dayStartUtc: dayStartUtc.toISOString(),
          dayEndExclusiveUtc: dayEndExclusiveUtc.toISOString(),

          dayStartLocalParts: startLocal,
          dayEndLocalParts: endLocal,
          localDateMismatch,

          busyCount: busy.length,
          blocksCount: blocks.length,
          bookingsCount: bookings.length,
          holdsCount: holds.length,

          skip: { skipBeforeDay, skipAfterDay, skipLead, skipOverEnd, skipBusy },
        }
      : undefined,
  }
}

/** ---------- handler ---------- */
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)

    const professionalId = pickString(searchParams.get('professionalId'))
    const serviceId = pickString(searchParams.get('serviceId'))
    const mediaId = pickString(searchParams.get('mediaId')) // optional

    const requestedLocationType = normalizeLocationType(searchParams.get('locationType'))
    const requestedLocationId = pickString(searchParams.get('locationId'))
    const dateStr = pickString(searchParams.get('date')) // missing => SUMMARY

    const debug = pickString(searchParams.get('debug')) === '1'

    // optional overrides (debug-only for step)
    const stepRaw = pickString(searchParams.get('stepMinutes')) || pickString(searchParams.get('step'))
    const leadRaw =
      pickString(searchParams.get('leadMinutes')) ||
      pickString(searchParams.get('leadTimeMinutes')) ||
      pickString(searchParams.get('lead')) ||
      null

    if (!professionalId || !serviceId) {
      return NextResponse.json({ ok: false, error: 'Missing professionalId or serviceId.' }, { status: 400 })
    }

    // ✅ Drawer needs businessName/avatar/location for ProCard
    const pro = await prisma.professionalProfile.findUnique({
      where: { id: professionalId },
      select: {
        id: true,
        businessName: true,
        avatarUrl: true,
        location: true,
        timeZone: true,
      },
    })
    if (!pro) return NextResponse.json({ ok: false, error: 'Professional not found' }, { status: 404 })

    const offering = await prisma.professionalServiceOffering.findFirst({
      where: { professionalId, serviceId, isActive: true },
      select: {
        id: true,
        offersInSalon: true,
        offersMobile: true,
        salonDurationMinutes: true,
        mobileDurationMinutes: true,
        salonPriceStartingAt: true,
        mobilePriceStartingAt: true,
      },
    })
    if (!offering) return NextResponse.json({ ok: false, error: 'Offering not found' }, { status: 404 })

    const effectiveLocationType =
      pickEffectiveLocationType({
        requested: requestedLocationType,
        offersInSalon: Boolean(offering.offersInSalon),
        offersMobile: Boolean(offering.offersMobile),
      }) ?? null

    if (!effectiveLocationType) {
      return NextResponse.json({ ok: false, error: 'This service is not bookable.' }, { status: 400 })
    }

    const loc = await pickBookableLocation({
      professionalId,
      requestedLocationId,
      locationType: effectiveLocationType,
    })
    if (!loc) return NextResponse.json({ ok: false, error: 'No bookable location found.' }, { status: 400 })

    const locAny = loc as any

    const locId = String(locAny.id || '').trim()
    if (!locId) return NextResponse.json({ ok: false, error: 'Bookable location is missing id.' }, { status: 500 })

    // timezone: location first, then pro, then LA
    const timeZone = pickTimeZone((locAny.timeZone ?? null) as string | null, (pro.timeZone ?? null) as string | null)

    // ✅ stepMinutes: source of truth is location.stepMinutes; fallback 30; debug-only override allowed.
    const defaultStepMinutes = normalizeStepMinutes(locAny.stepMinutes, 30)
    const stepMinutes = debug && stepRaw ? normalizeStepMinutes(stepRaw, defaultStepMinutes) : defaultStepMinutes

    const defaultLead = clampInt(Number(locAny.advanceNoticeMinutes ?? 10), 0, 240)
    const leadTimeMinutes = leadRaw ? clampInt(toInt(leadRaw, defaultLead), 0, 240) : defaultLead

    const adjacencyBufferMinutes = clampInt(Number(locAny.bufferMinutes ?? 10), 0, 120)
    const maxAdvanceDays = clampInt(Number(locAny.maxDaysAhead ?? 365), 1, 365)

    const durationMinutes = pickModeDurationMinutes(
      { salonDurationMinutes: offering.salonDurationMinutes, mobileDurationMinutes: offering.mobileDurationMinutes },
      effectiveLocationType,
    )

    // "today" in chosen timezone
    const nowUtc = new Date()
    const nowParts = getZonedParts(nowUtc, timeZone)
    const todayYMD = { year: nowParts.year, month: nowParts.month, day: nowParts.day }

    const offeringPayload = {
      id: offering.id,
      offersInSalon: Boolean(offering.offersInSalon),
      offersMobile: Boolean(offering.offersMobile),
      salonDurationMinutes: offering.salonDurationMinutes ?? null,
      mobileDurationMinutes: offering.mobileDurationMinutes ?? null,
      salonPriceStartingAt: offering.salonPriceStartingAt ?? null,
      mobilePriceStartingAt: offering.mobilePriceStartingAt ?? null,
    }

    // SUMMARY MODE (next 14 days)
    if (!dateStr) {
      const daysAhead = Math.min(14, maxAdvanceDays)
      const availableDays: Array<{ date: string; slotCount: number }> = []
      let firstError: string | null = null

      for (let i = 0; i < daysAhead; i++) {
        const ymd = addDaysToYMD(todayYMD.year, todayYMD.month, todayYMD.day, i)
        const result = await computeDaySlots({
          professionalId,
          locationId: locId,
          dateYMD: ymd,
          durationMinutes,
          stepMinutes,
          timeZone,
          workingHours: locAny.workingHours ?? null,
          leadTimeMinutes,
          adjacencyBufferMinutes,
          debug: false,
        })

        if (!result.ok) {
          firstError = firstError ?? result.error
          continue
        }

        if (result.slots.length) availableDays.push({ date: ymdToString(ymd), slotCount: result.slots.length })
      }

      if (!availableDays.length) {
        return NextResponse.json(
          { ok: false, error: firstError ?? 'No availability found in the next 14 days.' },
          { status: 400 },
        )
      }

      // ✅ REQUIRED by AvailabilityDrawer/types.ts
      return NextResponse.json({
        ok: true,
        mode: 'SUMMARY' as const,
        mediaId: mediaId || null,
        serviceId,
        professionalId,

        locationType: effectiveLocationType,
        locationId: locId,
        timeZone,

        stepMinutes,
        leadTimeMinutes,
        adjacencyBufferMinutes,
        maxDaysAhead: maxAdvanceDays,
        durationMinutes,

        primaryPro: {
          id: pro.id,
          businessName: pro.businessName ?? null,
          avatarUrl: pro.avatarUrl ?? null,
          location: pro.location ?? null,
          offeringId: offering.id,
          isCreator: true as const,
          timeZone: pro.timeZone ?? timeZone,
        },

        availableDays,
        otherPros: [],

        waitlistSupported: true,
        offering: offeringPayload,
      })
    }

    // DAY MODE
    const ymd = parseYYYYMMDD(dateStr)
    if (!ymd) return NextResponse.json({ ok: false, error: 'Invalid date. Use YYYY-MM-DD.' }, { status: 400 })

    const dayDiff = ymdSerial(ymd) - ymdSerial(todayYMD)
    if (dayDiff < 0) return NextResponse.json({ ok: false, error: 'Date is in the past.' }, { status: 400 })
    if (dayDiff > maxAdvanceDays) {
      return NextResponse.json(
        { ok: false, error: `You can book up to ${maxAdvanceDays} days in advance.` },
        { status: 400 },
      )
    }

    const result = await computeDaySlots({
      professionalId,
      locationId: locId,
      dateYMD: ymd,
      durationMinutes,
      stepMinutes,
      timeZone,
      workingHours: locAny.workingHours ?? null,
      leadTimeMinutes,
      adjacencyBufferMinutes,
      debug,
    })

    if (!result.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: result.error,
          locationId: locId,
          timeZone,
          stepMinutes,
          leadTimeMinutes,
          adjacencyBufferMinutes,
          maxDaysAhead: maxAdvanceDays,
          ...(debug ? { debug: result.debug } : {}),
        },
        { status: 400 },
      )
    }

    return NextResponse.json({
      ok: true,
      mode: 'DAY' as const,
      professionalId,
      serviceId,
      locationType: effectiveLocationType,
      date: dateStr,

      locationId: locId,
      timeZone,
      stepMinutes,
      leadTimeMinutes,
      adjacencyBufferMinutes,
      maxDaysAhead: maxAdvanceDays,

      durationMinutes,
      dayStartUtc: result.dayStartUtc.toISOString(),
      dayEndExclusiveUtc: result.dayEndExclusiveUtc.toISOString(),
      slots: result.slots,

      offering: offeringPayload,
      ...(debug ? { debug: result.debug } : {}),
    })
  } catch (e) {
    console.error('GET /api/availability/day error', e)
    return NextResponse.json({ ok: false, error: 'Failed to load availability' }, { status: 500 })
  }
}
