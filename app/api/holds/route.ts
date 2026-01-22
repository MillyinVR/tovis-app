// app/api/holds/route.ts
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import type { ServiceLocationType } from '@prisma/client'
import { pickBookableLocation } from '@/lib/booking/pickLocation'
import {
  getZonedParts,
  minutesSinceMidnightInTimeZone,
  sanitizeTimeZone,
  zonedTimeToUtc,
} from '@/lib/timeZone'
import { jsonFail, jsonOk, pickString, requireClient, upper } from '@/app/api/_utils'

export const dynamic = 'force-dynamic'

const BUFFER_MINUTES = 5
const HOLD_MINUTES = 10

type CreateHoldBody = {
  offeringId?: unknown
  scheduledFor?: unknown // UTC ISO
  locationType?: unknown
  locationId?: unknown
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
  const s = upper(v)
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

/** ✅ Accepts both "9:00" and "09:00" */
function parseHHMM(v?: string) {
  if (!v || typeof v !== 'string') return null
  const m = /^(\d{1,2}):(\d{2})$/.exec(v.trim())
  if (!m) return null
  const hh = Number(m[1])
  const mm = Number(m[2])
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null
  return { hh, mm }
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

function getDayWindowUtcFromUtcInstant(args: { instantUtc: Date; timeZone: string }) {
  const tz = sanitizeTimeZone(args.timeZone, 'UTC')
  const parts = getZonedParts(args.instantUtc, tz)

  const dayStartUtc = zonedTimeToUtc({
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: 0,
    minute: 0,
    second: 0,
    timeZone: tz,
  })

  const dayEndExclusiveUtc = zonedTimeToUtc({
    year: parts.year,
    month: parts.month,
    day: parts.day + 1,
    hour: 0,
    minute: 0,
    second: 0,
    timeZone: tz,
  })

  return { dayStartUtc, dayEndExclusiveUtc }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireClient()
    if (auth.res) return auth.res
    const { clientId } = auth

    const body = (await req.json().catch(() => ({}))) as CreateHoldBody

    const offeringId = pickString(body.offeringId)
    const requestedLocationId = pickString(body.locationId)
    const locationType = normalizeLocationType(body.locationType)
    const scheduledForRaw = typeof body.scheduledFor === 'string' ? body.scheduledFor : null

    if (!offeringId || !scheduledForRaw || !locationType) {
      return jsonFail(400, 'Missing offeringId, scheduledFor, or locationType.')
    }

    const scheduledForParsed = new Date(scheduledForRaw)
    if (!isValidDate(scheduledForParsed)) return jsonFail(400, 'Invalid scheduledFor.')

    const requestedStart = normalizeToMinute(scheduledForParsed)

    if (requestedStart.getTime() < addMinutes(new Date(), BUFFER_MINUTES).getTime()) {
      return jsonFail(400, 'Please select a future time.')
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

      const loc = await pickBookableLocation({
        professionalId: offering.professionalId,
        requestedLocationId,
        locationType,
      })

      if (!loc) {
        return { ok: false as const, status: 400, error: 'No bookable location found for this professional.' }
      }

      const apptTz = sanitizeTimeZone(loc.timeZone, 'America/Los_Angeles')

      const whCheck = ensureWithinWorkingHours({
        scheduledStartUtc: requestedStart,
        scheduledEndUtc: requestedEnd,
        workingHours: loc.workingHours,
        timeZone: apptTz,
      })
      if (!whCheck.ok) return { ok: false as const, status: 400, error: whCheck.error }

      const now = new Date()

      await tx.bookingHold.deleteMany({
        where: { professionalId: offering.professionalId, expiresAt: { lte: now } },
      })

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
      if (existingClientHold) return { ok: true as const, status: 200, hold: existingClientHold }

      const activeHold = await tx.bookingHold.findFirst({
        where: {
          professionalId: offering.professionalId,
          scheduledFor: requestedStart,
          expiresAt: { gt: now },
          locationType,
          locationId: loc.id,
          NOT: { clientId },
        },
        select: { id: true },
      })
      if (activeHold) {
        return { ok: false as const, status: 409, error: 'Someone is already holding that time. Try another slot.' }
      }

      const { dayStartUtc, dayEndExclusiveUtc } = getDayWindowUtcFromUtcInstant({
        instantUtc: requestedStart,
        timeZone: apptTz,
      })

      const existingBookings = await tx.booking.findMany({
        where: {
          professionalId: offering.professionalId,
          locationId: loc.id,
          locationType,
          scheduledFor: { gte: dayStartUtc, lt: dayEndExclusiveUtc },
          status: { in: ['PENDING', 'ACCEPTED'] },
        },
        select: {
          scheduledFor: true,
          totalDurationMinutes: true,
          bufferMinutes: true,
        },
        take: 2000,
      })

      const bookingConflict = existingBookings.some((b) => {
        const bDur = Number(b.totalDurationMinutes ?? 0)
        if (!Number.isFinite(bDur) || bDur <= 0) return false
        const bBuf = Number(b.bufferMinutes ?? 0)
        const bStart = normalizeToMinute(new Date(b.scheduledFor))
        const bEnd = addMinutes(bStart, bDur + (Number.isFinite(bBuf) ? bBuf : 0))
        return overlaps(bStart, bEnd, requestedStart, requestedEnd)
      })

      if (bookingConflict) return { ok: false as const, status: 409, error: 'That time was just taken.' }

      const expiresAt = addMinutes(now, HOLD_MINUTES)

      const hold = await tx.bookingHold.create({
        data: {
          offeringId: offering.id,
          professionalId: offering.professionalId,
          clientId,
          scheduledFor: requestedStart,
          expiresAt,
          locationType,

          locationId: loc.id,
          locationTimeZone: apptTz,

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

    if (!result.ok) return jsonFail(result.status, result.error)
    return jsonOk({ ok: true, hold: result.hold }, result.status)
  } catch (e) {
    console.error('POST /api/holds error', e)
    return jsonFail(500, 'Failed to create hold.')
  }
}
