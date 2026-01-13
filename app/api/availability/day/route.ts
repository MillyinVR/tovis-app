// app/api/availability/day/route.ts
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import type { ServiceLocationType } from '@prisma/client'

export const dynamic = 'force-dynamic'

type BookingForBusy = {
  scheduledFor: Date
  totalDurationMinutes: number | null
  durationMinutesSnapshot: number | null
  bufferMinutes: number | null
}

type HoldForBusy = {
  scheduledFor: Date
  expiresAt: Date
}

type BlockForBusy = {
  startsAt: Date
  endsAt: Date
}

type BusyInterval = { start: Date; end: Date }

type WorkingHoursDay = { enabled?: boolean; start?: string; end?: string }
type WorkingHours = Record<string, WorkingHoursDay>

type SummaryPro = {
  id: string
  businessName: string | null
  avatarUrl: string | null
  location: string | null
  city: string | null
  timeZone: string | null
}

type SummaryOffering = {
  id: string
  offersInSalon: boolean
  offersMobile: boolean
  salonDurationMinutes: number | null
  mobileDurationMinutes: number | null
  salonPriceStartingAt: any | null
  mobilePriceStartingAt: any | null
}

/** ---------- small utils ---------- */

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

/** ---------- date helpers ---------- */

function addDaysToYMD(year: number, month: number, day: number, daysToAdd: number) {
  // Anchor at noon UTC to avoid DST weirdness.
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

/** ---------- timezone helpers (no external deps) ---------- */

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
    hourCycle: 'h23',
  } as any)

  const parts = dtf.formatToParts(dateUtc)
  const map: Record<string, string> = {}
  for (const p of parts) map[p.type] = p.value

  let year = Number(map.year)
  let month = Number(map.month)
  let day = Number(map.day)
  let hour = Number(map.hour)
  const minute = Number(map.minute)
  const second = Number(map.second)

  // Some environments can produce hour=24. Normalize it.
  if (hour === 24) {
    hour = 0
    const next = addDaysToYMD(year, month, day, 1)
    year = next.year
    month = next.month
    day = next.day
  }

  return { year, month, day, hour, minute, second }
}

function getTimeZoneOffsetMinutes(dateUtc: Date, timeZone: string) {
  const z = getZonedParts(dateUtc, timeZone)
  const asIfUtc = Date.UTC(z.year, z.month - 1, z.day, z.hour, z.minute, z.second)
  return Math.round((asIfUtc - dateUtc.getTime()) / 60_000)
}

function zonedTimeToUtc(args: {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  timeZone: string
}) {
  const { year, month, day, hour, minute, timeZone } = args

  // Two-pass DST correction.
  let guess = new Date(Date.UTC(year, month - 1, day, hour, minute, 0, 0))
  const offset1 = getTimeZoneOffsetMinutes(guess, timeZone)
  guess = new Date(guess.getTime() - offset1 * 60_000)

  const offset2 = getTimeZoneOffsetMinutes(guess, timeZone)
  if (offset2 !== offset1) {
    guess = new Date(guess.getTime() - (offset2 - offset1) * 60_000)
  }
  return guess
}

function getDayKeyFromYMD(args: { year: number; month: number; day: number; timeZone: string }) {
  const { year, month, day, timeZone } = args
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

/** ---------- location picking ---------- */

async function pickLocation(args: {
  professionalId: string
  requestedLocationId: string | null
  locationType: ServiceLocationType
}) {
  const { professionalId, requestedLocationId, locationType } = args

  if (requestedLocationId) {
    const loc = await prisma.professionalLocation.findFirst({
      where: { id: requestedLocationId, professionalId, isBookable: true },
      select: {
        id: true,
        type: true,
        isPrimary: true,
        timeZone: true,
        workingHours: true,
        bufferMinutes: true,
        stepMinutes: true,
        maxDaysAhead: true,
      },
    })
    if (loc) return loc
  }

  const candidates = await prisma.professionalLocation.findMany({
    where: { professionalId, isBookable: true },
    select: {
      id: true,
      type: true,
      isPrimary: true,
      timeZone: true,
      workingHours: true,
      bufferMinutes: true,
      stepMinutes: true,
      maxDaysAhead: true,
    },
    orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
    take: 50,
  })

  const typeMatch = candidates.filter((c) => c.type === locationType)
  const primaryTypeMatch = typeMatch.find((c) => c.isPrimary)
  if (primaryTypeMatch) return primaryTypeMatch
  if (typeMatch.length) return typeMatch[0]
  if (candidates.length) return candidates[0]

  return null
}

/** ---------- core slot computation ---------- */

async function computeDaySlots(args: {
  professionalId: string
  dateYMD: { year: number; month: number; day: number }
  durationMinutes: number
  stepMinutes: number
  timeZone: string
  workingHours: unknown | null
  leadTimeMinutes: number
  adjacencyBufferMinutes: number
}): Promise<
  | { ok: true; slots: string[]; dayStartUtc: Date; dayEndExclusiveUtc: Date }
  | { ok: false; error: string; dayStartUtc: Date; dayEndExclusiveUtc: Date }
> {
  const {
    professionalId,
    dateYMD,
    durationMinutes,
    stepMinutes,
    timeZone,
    workingHours,
    leadTimeMinutes,
    adjacencyBufferMinutes,
  } = args

  const nowUtc = new Date()

  const dayStartUtc = zonedTimeToUtc({ ...dateYMD, hour: 0, minute: 0, timeZone })
  const nextYMD = addDaysToYMD(dateYMD.year, dateYMD.month, dateYMD.day, 1)
  const dayEndExclusiveUtc = zonedTimeToUtc({ ...nextYMD, hour: 0, minute: 0, timeZone })

  const wh = workingHours && typeof workingHours === 'object' ? (workingHours as WorkingHours) : null
  if (!wh) {
    return { ok: false, error: 'Working hours not set.', dayStartUtc, dayEndExclusiveUtc }
  }

  const dayKey = getDayKeyFromYMD({ ...dateYMD, timeZone })
  const rule = wh[dayKey]

  if (!rule) {
    return { ok: false, error: 'Working hours misconfigured.', dayStartUtc, dayEndExclusiveUtc }
  }
  if (rule.enabled === false) {
    return { ok: true, slots: [], dayStartUtc, dayEndExclusiveUtc }
  }

  const startParsed = parseHHMM(String(rule.start ?? ''))
  const endParsed = parseHHMM(String(rule.end ?? ''))
  if (!startParsed || !endParsed) {
    return { ok: false, error: 'Working hours misconfigured.', dayStartUtc, dayEndExclusiveUtc }
  }

  const startMinute = startParsed.hh * 60 + startParsed.mm
  const endMinute = endParsed.hh * 60 + endParsed.mm
  if (endMinute <= startMinute) {
    return { ok: false, error: 'Working hours misconfigured.', dayStartUtc, dayEndExclusiveUtc }
  }

  const [bookings, holds, blocks] = await Promise.all([
    prisma.booking.findMany({
      where: {
        professionalId,
        scheduledFor: { gte: dayStartUtc, lt: dayEndExclusiveUtc },
        NOT: { status: 'CANCELLED' },
      },
      select: {
        scheduledFor: true,
        totalDurationMinutes: true,
        durationMinutesSnapshot: true,
        bufferMinutes: true,
      },
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

    prisma.calendarBlock.findMany({
      where: {
        professionalId,
        startsAt: { lt: dayEndExclusiveUtc },
        endsAt: { gt: dayStartUtc },
      },
      select: { startsAt: true, endsAt: true },
      take: 2000,
    }) as unknown as Promise<BlockForBusy[]>,
  ])

  const adjBuf = Math.max(0, Math.min(120, Number(adjacencyBufferMinutes ?? 0) || 0))

  const busy: BusyInterval[] = [
    // Bookings: duration + booking buffer (or fallback to location adjacency buffer)
    ...bookings.map((b) => {
      const start = new Date(b.scheduledFor)

      const baseDur =
        Number(b.totalDurationMinutes ?? 0) > 0
          ? Number(b.totalDurationMinutes)
          : Number(b.durationMinutesSnapshot ?? 0) > 0
            ? Number(b.durationMinutesSnapshot)
            : durationMinutes

      const bBuf = Number(b.bufferMinutes ?? NaN)
      const effectiveBuf = Number.isFinite(bBuf) ? Math.max(0, Math.min(120, bBuf)) : adjBuf

      return { start, end: addMinutes(start, baseDur + effectiveBuf) }
    }),

    // Holds: duration + adjacency buffer (prevents adjacent “available” lies)
    ...holds.map((h) => {
      const start = new Date(h.scheduledFor)
      return { start, end: addMinutes(start, durationMinutes + adjBuf) }
    }),

    // Calendar blocks: explicit
    ...blocks.map((bl) => ({ start: new Date(bl.startsAt), end: new Date(bl.endsAt) })),
  ]

  const slots: string[] = []
  const cutoffUtc = addMinutes(nowUtc, Math.max(0, Math.min(240, Number(leadTimeMinutes ?? 0) || 0)))

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

    if (slotStartUtc.getTime() < cutoffUtc.getTime()) continue

    const slotEndUtc = addMinutes(slotStartUtc, durationMinutes)
    if (busy.some((bi) => overlaps(slotStartUtc, slotEndUtc, bi.start, bi.end))) continue

    slots.push(slotStartUtc.toISOString())
  }

  return { ok: true, slots, dayStartUtc, dayEndExclusiveUtc }
}

/** ---------- handler ---------- */

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)

    const professionalId = pickString(searchParams.get('professionalId'))
    const serviceId = pickString(searchParams.get('serviceId'))
    const mediaId = pickString(searchParams.get('mediaId')) // optional, but useful for UI

    const requestedLocationType = normalizeLocationType(searchParams.get('locationType'))
    const dateStr = pickString(searchParams.get('date')) // OPTIONAL: if missing => summary mode
    const requestedLocationId = pickString(searchParams.get('locationId'))

    // Client can suggest these, but we clamp them hard.
    const stepRaw = pickString(searchParams.get('stepMinutes')) ?? pickString(searchParams.get('step'))
    const leadRaw = pickString(searchParams.get('leadMinutes')) ?? pickString(searchParams.get('bufferMinutes')) ?? pickString(searchParams.get('buffer'))

    if (!professionalId || !serviceId) {
      return NextResponse.json({ ok: false, error: 'Missing professionalId or serviceId.' }, { status: 400 })
    }

    const pro = (await prisma.professionalProfile.findUnique({
      where: { id: professionalId },
      select: {
        id: true,
        businessName: true,
        avatarUrl: true,
        location: true,
        city: true,
        timeZone: true,
      } as any,
    })) as SummaryPro | null

    if (!pro) return NextResponse.json({ ok: false, error: 'Professional not found.' }, { status: 404 })

    const offering = (await prisma.professionalServiceOffering.findFirst({
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
    })) as SummaryOffering | null

    if (!offering) return NextResponse.json({ ok: false, error: 'Offering not found.' }, { status: 404 })

    const effectiveLocationType =
      pickEffectiveLocationType({
        requested: requestedLocationType,
        offersInSalon: Boolean(offering.offersInSalon),
        offersMobile: Boolean(offering.offersMobile),
      }) ?? (offering.offersInSalon ? 'SALON' : offering.offersMobile ? 'MOBILE' : null)

    if (!effectiveLocationType) {
      return NextResponse.json({ ok: false, error: 'This service is not bookable (no active mode).' }, { status: 400 })
    }

    const loc = await pickLocation({ professionalId, requestedLocationId, locationType: effectiveLocationType })
    if (!loc) {
      return NextResponse.json({ ok: false, error: 'No bookable location found.' }, { status: 400 })
    }

    const timeZone = (loc.timeZone || pro.timeZone || 'America/Los_Angeles') as string

    // Defaults tuned for Looks flow (Zillow-ish):
    // stepMinutes: client UI can override (clamped); adjacency buffer comes from LOCATION truth.
    const defaultStepMinutes = 30
    const stepMinutes = stepRaw ? clampInt(toInt(stepRaw, defaultStepMinutes), 5, 60) : defaultStepMinutes

    // Lead time: “don’t let me book within X minutes from now”
    const leadTimeMinutes = clampInt(toInt(leadRaw, 10), 0, 240)

    // Adjacency buffer: from location (server truth), also clamped
    const adjacencyBufferMinutes = clampInt(Number(loc.bufferMinutes ?? 10), 0, 120)

    const maxAdvanceDays = clampInt(Number(loc.maxDaysAhead ?? 365), 1, 365)

    const durationMinutes = pickModeDurationMinutes(
      { salonDurationMinutes: offering.salonDurationMinutes, mobileDurationMinutes: offering.mobileDurationMinutes },
      effectiveLocationType,
    )

    // Booking window based on LOCATION calendar day
    const nowUtc = new Date()
    const nowParts = getZonedParts(nowUtc, timeZone)
    const todayYMD = { year: nowParts.year, month: nowParts.month, day: nowParts.day }

    // SUMMARY MODE (no date): return next N days that have at least one slot
    if (!dateStr) {
      const daysAhead = Math.min(14, maxAdvanceDays) // keep it fast
      const availableDays: Array<{ date: string; slotCount: number }> = []

      for (let i = 0; i <= daysAhead; i++) {
        const ymd = addDaysToYMD(todayYMD.year, todayYMD.month, todayYMD.day, i)
        const result = await computeDaySlots({
          professionalId,
          dateYMD: ymd,
          durationMinutes,
          stepMinutes,
          timeZone,
          workingHours: loc.workingHours ?? null,
          leadTimeMinutes,
          adjacencyBufferMinutes,
        })

        if (result.ok && result.slots.length) {
          availableDays.push({ date: ymdToString(ymd), slotCount: result.slots.length })
        }
      }

      const city = pro.city ? String(pro.city).trim() : null
      const otherOfferings = await prisma.professionalServiceOffering.findMany({
        where: {
          serviceId,
          isActive: true,
          professionalId: { not: professionalId },
          ...(city ? { professional: { city } } : {}),
        } as any,
        take: 8,
        select: {
          id: true,
          professional: {
            select: {
              id: true,
              businessName: true,
              avatarUrl: true,
              location: true,
              city: true,
              timeZone: true,
            },
          },
        },
      })

      const otherPros = otherOfferings
        .map((o) => {
          const p = o.professional
          if (!p?.id) return null
          return {
            id: String(p.id),
            businessName: p.businessName ?? null,
            avatarUrl: p.avatarUrl ?? null,
            location: p.location ?? p.city ?? null,
            offeringId: String(o.id),
            timeZone: (p.timeZone || 'America/Los_Angeles') as string,
          }
        })
        .filter(Boolean)

      return NextResponse.json({
        ok: true,
        mode: 'SUMMARY' as const,
        mediaId: mediaId ?? null,
        serviceId,
        professionalId,

        locationType: effectiveLocationType,
        locationId: loc.id,
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
          location: pro.location ?? pro.city ?? null,
          offeringId: offering.id,
          timeZone,
          isCreator: true,
        },

        availableDays,
        otherPros,
        waitlistSupported: true,
      })
    }

    // DAY MODE
    const ymd = parseYYYYMMDD(dateStr)
    if (!ymd) {
      return NextResponse.json({ ok: false, error: 'Invalid date. Use YYYY-MM-DD.' }, { status: 400 })
    }

    const dayDiff = ymdSerial(ymd) - ymdSerial(todayYMD)
    if (dayDiff < 0) {
      return NextResponse.json({ ok: false, error: 'Date is in the past.', timeZone, locationId: loc.id }, { status: 400 })
    }
    if (dayDiff > maxAdvanceDays) {
      return NextResponse.json(
        { ok: false, error: `You can book up to ${maxAdvanceDays} days in advance.`, timeZone, locationId: loc.id },
        { status: 400 },
      )
    }

    const result = await computeDaySlots({
      professionalId,
      dateYMD: ymd,
      durationMinutes,
      stepMinutes,
      timeZone,
      workingHours: loc.workingHours ?? null,
      leadTimeMinutes,
      adjacencyBufferMinutes,
    })

    if (!result.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: result.error,
          timeZone,
          locationId: loc.id,
          stepMinutes,
          leadTimeMinutes,
          adjacencyBufferMinutes,
          maxDaysAhead: maxAdvanceDays,
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

      locationId: loc.id,
      timeZone,
      stepMinutes,
      leadTimeMinutes,
      adjacencyBufferMinutes,
      maxDaysAhead: maxAdvanceDays,

      durationMinutes,
      dayStartUtc: result.dayStartUtc.toISOString(),
      dayEndExclusiveUtc: result.dayEndExclusiveUtc.toISOString(),
      slots: result.slots,
    })
  } catch (e) {
    console.error('GET /api/availability/day error', e)
    return NextResponse.json({ ok: false, error: 'Failed to load availability' }, { status: 500 })
  }
}
