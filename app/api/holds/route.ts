// app/api/holds/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'
import type { ServiceLocationType } from '@prisma/client'

export const dynamic = 'force-dynamic'

const BUFFER_MINUTES = 5
const HOLD_MINUTES = 10

type CreateHoldBody = {
  offeringId?: unknown
  scheduledFor?: unknown // UTC ISO
  locationType?: unknown
  locationId?: unknown
}

function pickString(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

function isValidDate(d: Date) {
  return d instanceof Date && Number.isFinite(d.getTime())
}

function addMinutes(d: Date, minutes: number) {
  return new Date(d.getTime() + minutes * 60_000)
}

function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date) {
  return aStart < bEnd && aEnd > bStart
}

function normalizeToMinute(d: Date) {
  const x = new Date(d)
  x.setSeconds(0, 0)
  return x
}

function normalizeLocationType(v: unknown): ServiceLocationType | null {
  const s = typeof v === 'string' ? v.trim().toUpperCase() : ''
  if (s === 'SALON') return 'SALON'
  if (s === 'MOBILE') return 'MOBILE'
  return null
}

function pickDurationMinutes(args: {
  locationType: ServiceLocationType
  salonDurationMinutes: number | null
  mobileDurationMinutes: number | null
}) {
  const raw = args.locationType === 'MOBILE' ? args.mobileDurationMinutes : args.salonDurationMinutes
  const n = Number(raw ?? 0)
  return Number.isFinite(n) && n > 0 ? n : 60
}

/** ---------- timezone helpers (no deps) ---------- */
function addDaysToYMD(year: number, month: number, day: number, daysToAdd: number) {
  const d = new Date(Date.UTC(year, month - 1, day + daysToAdd, 12, 0, 0, 0))
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() }
}

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

function zonedTimeToUtc(args: { year: number; month: number; day: number; hour: number; minute: number; timeZone: string }) {
  const { year, month, day, hour, minute, timeZone } = args

  let guess = new Date(Date.UTC(year, month - 1, day, hour, minute, 0, 0))
  const offset1 = getTimeZoneOffsetMinutes(guess, timeZone)
  guess = new Date(guess.getTime() - offset1 * 60_000)

  const offset2 = getTimeZoneOffsetMinutes(guess, timeZone)
  if (offset2 !== offset1) {
    guess = new Date(guess.getTime() - (offset2 - offset1) * 60_000)
  }

  return guess
}

/** Working-hours enforcement (LOCATION truth) */
type WorkingHoursDay = { enabled?: boolean; start?: string; end?: string }
type WorkingHours = Record<string, WorkingHoursDay>

function getWeekdayKeyInTimeZone(dateUtc: Date, timeZone: string): keyof WorkingHours {
  const weekday = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short' }).format(dateUtc).toLowerCase()
  if (weekday.startsWith('mon')) return 'mon'
  if (weekday.startsWith('tue')) return 'tue'
  if (weekday.startsWith('wed')) return 'wed'
  if (weekday.startsWith('thu')) return 'thu'
  if (weekday.startsWith('fri')) return 'fri'
  if (weekday.startsWith('sat')) return 'sat'
  return 'sun'
}

function parseHHMM(v?: string) {
  if (!v || typeof v !== 'string') return null
  const m = /^(\d{2}):(\d{2})$/.exec(v.trim())
  if (!m) return null
  const hh = Number(m[1])
  const mm = Number(m[2])
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null
  return { hh, mm }
}

function minutesSinceMidnightInTimeZone(dateUtc: Date, timeZone: string) {
  const z = getZonedParts(dateUtc, timeZone)
  return z.hour * 60 + z.minute
}

function ensureWithinWorkingHours(args: {
  scheduledStartUtc: Date
  scheduledEndUtc: Date
  workingHours: unknown
  timeZone: string
}): { ok: true } | { ok: false; error: string } {
  const { scheduledStartUtc, scheduledEndUtc, workingHours, timeZone } = args

  if (!workingHours || typeof workingHours !== 'object') {
    return { ok: false, error: 'This professional has not set working hours yet.' }
  }

  const wh = workingHours as WorkingHours
  const dayKey = getWeekdayKeyInTimeZone(scheduledStartUtc, timeZone)
  const rule = wh?.[dayKey]

  if (!rule || rule.enabled === false) {
    return { ok: false, error: 'That time is outside this professional’s working hours.' }
  }

  const startHHMM = parseHHMM(rule.start)
  const endHHMM = parseHHMM(rule.end)
  if (!startHHMM || !endHHMM) {
    return { ok: false, error: 'This professional’s working hours are misconfigured.' }
  }

  const windowStartMin = startHHMM.hh * 60 + startHHMM.mm
  const windowEndMin = endHHMM.hh * 60 + endHHMM.mm
  if (windowEndMin <= windowStartMin) {
    return { ok: false, error: 'This professional’s working hours are misconfigured.' }
  }

  const startMin = minutesSinceMidnightInTimeZone(scheduledStartUtc, timeZone)
  const endMin = minutesSinceMidnightInTimeZone(scheduledEndUtc, timeZone)

  const endDayKey = getWeekdayKeyInTimeZone(scheduledEndUtc, timeZone)
  if (endDayKey !== dayKey) return { ok: false, error: 'That time is outside this professional’s working hours.' }

  if (startMin < windowStartMin || endMin > windowEndMin) {
    return { ok: false, error: 'That time is outside this professional’s working hours.' }
  }

  return { ok: true }
}

/** Location picking */
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
        formattedAddress: true,
        lat: true,
        lng: true,
        bufferMinutes: true,
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
      formattedAddress: true,
      lat: true,
      lng: true,
      bufferMinutes: true,
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

function getDayWindowUtcFromUtcInstant(args: { instantUtc: Date; timeZone: string }) {
  const { instantUtc, timeZone } = args
  const parts = getZonedParts(instantUtc, timeZone)
  const dayStartUtc = zonedTimeToUtc({ year: parts.year, month: parts.month, day: parts.day, hour: 0, minute: 0, timeZone })
  const next = addDaysToYMD(parts.year, parts.month, parts.day, 1)
  const dayEndExclusiveUtc = zonedTimeToUtc({ year: next.year, month: next.month, day: next.day, hour: 0, minute: 0, timeZone })
  return { dayStartUtc, dayEndExclusiveUtc }
}

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser().catch(() => null)

    if (!user) return NextResponse.json({ ok: false, error: 'Please log in.' }, { status: 401 })
    if (user.role !== 'CLIENT' || !user.clientProfile?.id) {
      return NextResponse.json({ ok: false, error: 'Only clients can hold slots.' }, { status: 403 })
    }

    const clientId = user.clientProfile.id
    const body = (await req.json().catch(() => ({}))) as CreateHoldBody

    const offeringId = pickString(body.offeringId)
    const locationType = normalizeLocationType(body.locationType)
    const requestedLocationId = pickString(body.locationId)

    if (!offeringId || !body.scheduledFor || !locationType) {
      return NextResponse.json(
        { ok: false, error: 'Missing offeringId, scheduledFor, or locationType.' },
        { status: 400 },
      )
    }

    const scheduledForParsed = new Date(String(body.scheduledFor))
    if (!isValidDate(scheduledForParsed)) {
      return NextResponse.json({ ok: false, error: 'Invalid scheduledFor.' }, { status: 400 })
    }

    const requestedStart = normalizeToMinute(scheduledForParsed)

    if (requestedStart.getTime() < addMinutes(new Date(), BUFFER_MINUTES).getTime()) {
      return NextResponse.json({ ok: false, error: 'Please select a future time.' }, { status: 400 })
    }

    const result = await prisma.$transaction(async (tx) => {
      const offering = await tx.professionalServiceOffering.findUnique({
        where: { id: offeringId },
        select: {
          id: true,
          isActive: true,
          professionalId: true,
          offersInSalon: true,
          offersMobile: true,
          salonDurationMinutes: true,
          mobileDurationMinutes: true,
        },
      })

      if (!offering || !offering.isActive) {
        return { ok: false as const, status: 400, error: 'Invalid or inactive offering.' }
      }

      if (locationType === 'SALON' && !offering.offersInSalon) {
        return { ok: false as const, status: 400, error: 'This service is not offered in-salon.' }
      }
      if (locationType === 'MOBILE' && !offering.offersMobile) {
        return { ok: false as const, status: 400, error: 'This service is not offered as mobile.' }
      }

      const duration = pickDurationMinutes({
        locationType,
        salonDurationMinutes: offering.salonDurationMinutes,
        mobileDurationMinutes: offering.mobileDurationMinutes,
      })

      const requestedEnd = addMinutes(requestedStart, duration)

      const loc = await pickLocation({
        professionalId: offering.professionalId,
        requestedLocationId,
        locationType,
      })

      if (!loc) {
        return { ok: false as const, status: 400, error: 'No bookable location found for this professional.' }
      }

      const apptTz = loc.timeZone || 'America/Los_Angeles'

      // enforce working hours (LOCATION)
      const whCheck = ensureWithinWorkingHours({
        scheduledStartUtc: requestedStart,
        scheduledEndUtc: requestedEnd,
        workingHours: loc.workingHours,
        timeZone: apptTz,
      })
      if (!whCheck.ok) return { ok: false as const, status: 400, error: whCheck.error }

      const now = new Date()

      // clean expired holds for this pro
      await tx.bookingHold.deleteMany({
        where: { professionalId: offering.professionalId, expiresAt: { lte: now } },
      })

      // if client already holds exact slot at this location+type, return it (idempotent)
      const existingClientHold = await tx.bookingHold.findFirst({
        where: {
          professionalId: offering.professionalId,
          scheduledFor: requestedStart,
          expiresAt: { gt: now },
          clientId,
          locationType,
          locationId: loc.id,
        },
        select: {
          id: true,
          expiresAt: true,
          scheduledFor: true,
          locationType: true,
          locationId: true,
          locationTimeZone: true,
        },
      })

      if (existingClientHold) {
        return { ok: true as const, status: 200, hold: existingClientHold }
      }

      // block if someone else holds this exact slot
      const activeHold = await tx.bookingHold.findFirst({
        where: {
          professionalId: offering.professionalId,
          scheduledFor: requestedStart,
          expiresAt: { gt: now },
          NOT: { clientId },
        },
        select: { id: true },
      })

      if (activeHold) {
        return { ok: false as const, status: 409, error: 'Someone is already holding that time. Try another slot.' }
      }

      // conflict check: bookings within the LOCAL DAY window, include booking buffer if present
      const { dayStartUtc, dayEndExclusiveUtc } = getDayWindowUtcFromUtcInstant({ instantUtc: requestedStart, timeZone: apptTz })

      const existingBookings = await tx.booking.findMany({
        where: {
          professionalId: offering.professionalId,
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
      })

      const bookingConflict = existingBookings.some((b) => {
        const bDur =
          Number(b.totalDurationMinutes ?? 0) > 0
            ? Number(b.totalDurationMinutes)
            : Number(b.durationMinutesSnapshot ?? 0)

        if (!Number.isFinite(bDur) || bDur <= 0) return false

        const bBuf = Number(b.bufferMinutes ?? 0)
        const bStart = normalizeToMinute(new Date(b.scheduledFor))
        const bEnd = addMinutes(bStart, bDur + (Number.isFinite(bBuf) ? bBuf : 0))

        return overlaps(bStart, bEnd, requestedStart, requestedEnd)
      })

      if (bookingConflict) {
        return { ok: false as const, status: 409, error: 'That time was just taken.' }
      }

      const expiresAt = addMinutes(now, HOLD_MINUTES)

      const hold = await tx.bookingHold.create({
        data: {
          offeringId: offering.id,
          professionalId: offering.professionalId,
          clientId,
          scheduledFor: requestedStart,
          expiresAt,
          locationType,

          // lock location + tz
          locationId: loc.id,
          locationTimeZone: apptTz,

          // snapshots
          locationAddressSnapshot: loc.formattedAddress ? { formattedAddress: loc.formattedAddress } : undefined,
          locationLatSnapshot: typeof loc.lat === 'number' ? loc.lat : undefined,
          locationLngSnapshot: typeof loc.lng === 'number' ? loc.lng : undefined,
        },
        select: {
          id: true,
          expiresAt: true,
          scheduledFor: true,
          locationType: true,
          locationId: true,
          locationTimeZone: true,
        },
      })

      return { ok: true as const, status: 201, hold }
    })

    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.error }, { status: result.status })
    }

    return NextResponse.json({ ok: true, hold: result.hold }, { status: result.status })
  } catch (e) {
    console.error('POST /api/holds error', e)
    return NextResponse.json({ ok: false, error: 'Failed to create hold.' }, { status: 500 })
  }
}
