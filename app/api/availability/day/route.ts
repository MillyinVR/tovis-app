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

function addDaysToYMD(year: number, month: number, day: number, daysToAdd: number) {
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

/**
 * ✅ STRICT timezone selection
 * We require a valid IANA timezone on the LOCATION.
 * If not present, booking/availability must fail (too dangerous otherwise).
 */
function requireLocationTimeZone(locTz: unknown) {
  const s = typeof locTz === 'string' ? locTz.trim() : ''
  if (!s || !isValidIanaTimeZone(s)) return null
  return s
}

function getDayKeyFromYMD(args: { year: number; month: number; day: number; timeZone: string }) {
  const timeZone = sanitizeTimeZone(args.timeZone, 'UTC')

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

function computeDayBoundsUtc(dateYMD: { year: number; month: number; day: number }, timeZoneRaw: string) {
  const timeZone = sanitizeTimeZone(timeZoneRaw, 'UTC')

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

function mergeBusyIntervals(list: BusyInterval[]) {
  const sorted = list
    .filter((x) => x.start.getTime() < x.end.getTime())
    .sort((a, b) => a.start.getTime() - b.start.getTime())

  const out: BusyInterval[] = []
  for (const cur of sorted) {
    const prev = out[out.length - 1]
    if (!prev) {
      out.push({ start: new Date(cur.start), end: new Date(cur.end) })
      continue
    }
    if (cur.start.getTime() <= prev.end.getTime()) {
      if (cur.end.getTime() > prev.end.getTime()) prev.end = new Date(cur.end)
    } else {
      out.push({ start: new Date(cur.start), end: new Date(cur.end) })
    }
  }
  return out
}

async function loadBusyIntervals(args: {
  professionalId: string
  locationId: string
  windowStartUtc: Date
  windowEndUtc: Date
  nowUtc: Date
  durationMinutes: number
  adjacencyBufferMinutes: number
}) {
  const { professionalId, locationId, windowStartUtc, windowEndUtc, nowUtc, durationMinutes, adjacencyBufferMinutes } = args

  const [bookings, holds, blocks] = await Promise.all([
    prisma.booking.findMany({
      where: {
        professionalId,
        scheduledFor: { gte: windowStartUtc, lt: windowEndUtc },
        NOT: { status: 'CANCELLED' },
      },
      select: { scheduledFor: true, totalDurationMinutes: true, bufferMinutes: true, status: true },
      take: 5000,
    }),

    prisma.bookingHold.findMany({
      where: {
        professionalId,
        scheduledFor: { gte: windowStartUtc, lt: windowEndUtc },
        expiresAt: { gt: nowUtc },
      },
      select: { scheduledFor: true, expiresAt: true },
      take: 5000,
    }),

    prisma.calendarBlock.findMany({
      where: {
        professionalId,
        startsAt: { lt: windowEndUtc },
        endsAt: { gt: windowStartUtc },
        OR: [{ locationId: null }, { locationId }],
      },
      select: { startsAt: true, endsAt: true },
      take: 5000,
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

    ...holds
      .filter((h) => new Date(h.expiresAt).getTime() > nowUtc.getTime())
      .map((h) => {
        const start = normalizeToMinute(new Date(h.scheduledFor))
        return { start, end: addMinutes(start, durationMinutes + adjBuf) }
      }),

    ...blocks.map((bl) => ({ start: new Date(bl.startsAt), end: new Date(bl.endsAt) })),
  ]

  return mergeBusyIntervals(busy)
}

function isSlotFree(busy: BusyInterval[], slotStart: Date, slotEnd: Date) {
  for (let i = 0; i < busy.length; i++) {
    const bi = busy[i]
    if (bi.start.getTime() >= slotEnd.getTime()) return true
    if (overlaps(slotStart, slotEnd, bi.start, bi.end)) return false
  }
  return true
}

async function computeDaySlotsFast(args: {
  professionalId: string
  locationId: string
  dateYMD: { year: number; month: number; day: number }
  durationMinutes: number
  stepMinutes: number
  timeZone: string
  workingHours: unknown | null
  leadTimeMinutes: number
  adjacencyBufferMinutes: number
  busy: BusyInterval[]
  debug?: boolean
}): Promise<
  | { ok: true; slots: string[]; dayStartUtc: Date; dayEndExclusiveUtc: Date; debug?: any }
  | { ok: false; error: string; dayStartUtc: Date; dayEndExclusiveUtc: Date; debug?: any }
> {
  const {
    dateYMD,
    durationMinutes,
    stepMinutes,
    timeZone: tzIn,
    workingHours,
    leadTimeMinutes,
    adjacencyBufferMinutes,
    busy,
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

  const adjBuf = clampInt(Number(adjacencyBufferMinutes ?? 0) || 0, 0, 120)
  const cutoffUtc = addMinutes(nowUtc, clampInt(Number(leadTimeMinutes ?? 0) || 0, 0, 240))
  const step = normalizeStepMinutes(stepMinutes, 30)

  const slots: string[] = []

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

    if (slotStartUtc < dayStartUtc) continue
    if (slotStartUtc >= dayEndExclusiveUtc) continue
    if (slotStartUtc.getTime() < cutoffUtc.getTime()) continue

    const slotEndWorkUtc = addMinutes(slotStartUtc, durationMinutes)
    if (slotEndWorkUtc > dayEndExclusiveUtc) continue

    const slotEndWithBufferUtc = addMinutes(slotStartUtc, durationMinutes + adjBuf)
    if (!isSlotFree(busy, slotStartUtc, slotEndWithBufferUtc)) continue

    slots.push(slotStartUtc.toISOString())
  }

  return { ok: true, slots, dayStartUtc, dayEndExclusiveUtc, debug: debug ? { timeZone, dayKey } : undefined }
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)

    const professionalId = pickString(searchParams.get('professionalId'))
    const serviceId = pickString(searchParams.get('serviceId'))
    const mediaId = pickString(searchParams.get('mediaId'))

    const requestedLocationType = normalizeLocationType(searchParams.get('locationType'))
    const requestedLocationId = pickString(searchParams.get('locationId'))
    const dateStr = pickString(searchParams.get('date'))

    const debug = pickString(searchParams.get('debug')) === '1'

    const stepRaw = pickString(searchParams.get('stepMinutes')) || pickString(searchParams.get('step'))
    const leadRaw =
      pickString(searchParams.get('leadMinutes')) ||
      pickString(searchParams.get('leadTimeMinutes')) ||
      pickString(searchParams.get('lead')) ||
      null

    if (!professionalId || !serviceId) {
      return NextResponse.json({ ok: false, error: 'Missing professionalId or serviceId.' }, { status: 400 })
    }

    const [pro, service, offering] = await Promise.all([
      prisma.professionalProfile.findUnique({
        where: { id: professionalId },
        select: { id: true, businessName: true, avatarUrl: true, location: true, timeZone: true },
      }),
      prisma.service.findUnique({
        where: { id: serviceId },
        select: { id: true, name: true, category: { select: { name: true } } },
      }),
      prisma.professionalServiceOffering.findFirst({
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
      }),
    ])

    if (!pro) return NextResponse.json({ ok: false, error: 'Professional not found' }, { status: 404 })
    if (!service) return NextResponse.json({ ok: false, error: 'Service not found' }, { status: 404 })
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

    const timeZone = requireLocationTimeZone(locAny.timeZone)
    if (!timeZone) {
      return NextResponse.json(
        {
          ok: false,
          error:
            'This professional must set a valid timezone for their bookable location before they can accept appointments.',
        },
        { status: 409 },
      )
    }

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

    const workingHours = locAny.workingHours ?? null

    // SUMMARY MODE
    if (!dateStr) {
      const daysAhead = Math.min(14, maxAdvanceDays)
      const ymds = Array.from({ length: daysAhead }, (_, i) =>
        addDaysToYMD(todayYMD.year, todayYMD.month, todayYMD.day, i),
      )

      const firstBounds = computeDayBoundsUtc(ymds[0], timeZone)
      const lastBounds = computeDayBoundsUtc(ymds[ymds.length - 1], timeZone)

      const windowStartUtc = addMinutes(firstBounds.dayStartUtc, -24 * 60)
      const windowEndUtc = addMinutes(lastBounds.dayEndExclusiveUtc, 24 * 60)

      const busy = await loadBusyIntervals({
        professionalId,
        locationId: locId,
        windowStartUtc,
        windowEndUtc,
        nowUtc,
        durationMinutes,
        adjacencyBufferMinutes,
      })

      const availableDays: Array<{ date: string; slotCount: number }> = []
      let firstError: string | null = null

      for (const ymd of ymds) {
        const result = await computeDaySlotsFast({
          professionalId,
          locationId: locId,
          dateYMD: ymd,
          durationMinutes,
          stepMinutes,
          timeZone,
          workingHours,
          leadTimeMinutes,
          adjacencyBufferMinutes,
          busy,
          debug: false,
        })

        if (!result.ok) {
          firstError = firstError ?? result.error
          continue
        }

        if (result.slots.length) availableDays.push({ date: ymdToString(ymd), slotCount: result.slots.length })
      }

      if (!availableDays.length) {
  return NextResponse.json({
    ok: true,
    mode: 'SUMMARY' as const,
    mediaId: mediaId || null,
    serviceId,
    professionalId,
    serviceName: service.name,
    serviceCategoryName: service.category?.name ?? null,
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
      timeZone,
    },
    availableDays: [],
    otherPros: [],
    waitlistSupported: true,
    offering: offeringPayload,
    // optional: expose why empty in debug
    ...(debug ? { debug: { emptyReason: firstError ?? 'none' } } : {}),
  })
}


      return NextResponse.json({
        ok: true,
        mode: 'SUMMARY' as const,
        mediaId: mediaId || null,
        serviceId,
        professionalId,

        serviceName: service.name,
        serviceCategoryName: service.category?.name ?? null,

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
          timeZone,
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

    const bounds = computeDayBoundsUtc(ymd, timeZone)
    const windowStartUtc = addMinutes(bounds.dayStartUtc, -24 * 60)
    const windowEndUtc = addMinutes(bounds.dayEndExclusiveUtc, 24 * 60)

    const busy = await loadBusyIntervals({
      professionalId,
      locationId: locId,
      windowStartUtc,
      windowEndUtc,
      nowUtc,
      durationMinutes,
      adjacencyBufferMinutes,
    })

    const result = await computeDaySlotsFast({
      professionalId,
      locationId: locId,
      dateYMD: ymd,
      durationMinutes,
      stepMinutes,
      timeZone,
      workingHours,
      leadTimeMinutes,
      adjacencyBufferMinutes,
      busy,
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
