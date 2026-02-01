// app/api/bookings/[id]/reschedule/route.ts
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import type { ServiceLocationType } from '@prisma/client'
import { requireClient } from '@/app/api/_utils/auth/requireClient'
import { pickString } from '@/app/api/_utils/pick'
import {
  sanitizeTimeZone,
  DEFAULT_TIME_ZONE,
  getZonedParts,
  minutesSinceMidnightInTimeZone,
} from '@/lib/timeZone'
import { resolveApptTimeZone } from '@/lib/booking/timeZoneTruth'

export const dynamic = 'force-dynamic'

type Ctx = { params: { id: string } | Promise<{ id: string }> }
type LocationType = Extract<ServiceLocationType, 'SALON' | 'MOBILE'>

type WorkingHoursDay = { enabled?: boolean; start?: string; end?: string }
type WorkingHours = Record<string, WorkingHoursDay>

type HoldRow = {
  id: string
  clientId: string | null
  professionalId: string
  scheduledFor: Date
  expiresAt: Date
  locationType: LocationType
  locationId: string | null
}

function isLocationType(x: unknown): x is LocationType {
  return x === 'SALON' || x === 'MOBILE'
}

function addMinutes(date: Date, minutes: number) {
  return new Date(date.getTime() + minutes * 60_000)
}

function normalizeToMinute(d: Date) {
  const x = new Date(d)
  x.setSeconds(0, 0)
  return x
}

function clampInt(n: number, min: number, max: number) {
  const x = Math.trunc(Number(n))
  if (!Number.isFinite(x)) return min
  return Math.max(min, Math.min(max, x))
}

/** Accepts both "9:00" and "09:00" */
function parseHHMM(v?: string) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(v ?? '').trim())
  if (!m) return null
  const hh = Number(m[1])
  const mm = Number(m[2])
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null
  return { hh, mm }
}

function weekdayKeyFromUtcInstant(dateUtc: Date, timeZoneRaw: string): keyof WorkingHours {
  const timeZone = sanitizeTimeZone(timeZoneRaw, DEFAULT_TIME_ZONE)
  const p = getZonedParts(dateUtc, timeZone)

  // Use a stable mid-day anchor to determine weekday in that timezone.
  // (Avoids oddities around midnight transitions.)
  const noonLocalAsUtc = new Date(Date.UTC(p.year, p.month - 1, p.day, 12, 0, 0))
  const weekday = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short' }).format(noonLocalAsUtc).toLowerCase()

  if (weekday.startsWith('mon')) return 'mon'
  if (weekday.startsWith('tue')) return 'tue'
  if (weekday.startsWith('wed')) return 'wed'
  if (weekday.startsWith('thu')) return 'thu'
  if (weekday.startsWith('fri')) return 'fri'
  if (weekday.startsWith('sat')) return 'sat'
  return 'sun'
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
  const dayKey = weekdayKeyFromUtcInstant(scheduledStartUtc, timeZone)
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

  // Must be same local day
  const endDayKey = weekdayKeyFromUtcInstant(scheduledEndUtc, timeZone)
  if (endDayKey !== dayKey) {
    return { ok: false, error: 'That time is outside this professional’s working hours.' }
  }

  const startMin = minutesSinceMidnightInTimeZone(scheduledStartUtc, timeZone)
  const endMin = minutesSinceMidnightInTimeZone(scheduledEndUtc, timeZone)

  if (startMin < windowStartMin || endMin > windowEndMin) {
    return { ok: false, error: 'That time is outside this professional’s working hours.' }
  }

  return { ok: true }
}

function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date) {
  return aStart < bEnd && aEnd > bStart
}

function fail(status: number, code: string, error: string, details?: any) {
  const dev = process.env.NODE_ENV !== 'production'
  return NextResponse.json(dev && details != null ? { ok: false, code, error, details } : { ok: false, code, error }, {
    status,
  })
}

export async function POST(req: Request, { params }: Ctx) {
  try {
    const auth = await requireClient()
    if (auth.res) return auth.res
    const clientId = auth.clientId

    const { id } = await Promise.resolve(params)
    const bookingId = pickString(id)
    if (!bookingId) return fail(400, 'MISSING_BOOKING', 'Missing booking id.')

    const body = await req.json().catch(() => ({}))
    const holdId = pickString(body?.holdId)
    const locationTypeRaw = body?.locationType

    if (!holdId) return fail(400, 'MISSING_HOLD', 'Missing holdId.')
    if (!isLocationType(locationTypeRaw)) return fail(400, 'INVALID_LOCATION_TYPE', 'Missing/invalid locationType.')
    const locationType = locationTypeRaw

    const now = new Date()

    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      select: {
        id: true,
        status: true,
        clientId: true,
        professionalId: true,
        startedAt: true,
        finishedAt: true,
        totalDurationMinutes: true,
        bufferMinutes: true,
        locationId: true,
        locationTimeZone: true,
      },
    })

    if (!booking) return fail(404, 'NOT_FOUND', 'Booking not found.')
    if (booking.clientId !== clientId) return fail(403, 'FORBIDDEN', 'Forbidden.')

    if (booking.status === 'COMPLETED' || booking.status === 'CANCELLED') {
      return fail(409, 'CANNOT_RESCHEDULE', 'This booking cannot be rescheduled.')
    }
    if (booking.startedAt || booking.finishedAt) {
      return fail(409, 'ALREADY_STARTED', 'This booking has started and cannot be rescheduled.')
    }

    const totalDurationMinutes = clampInt(booking.totalDurationMinutes ?? 0, 1, 24 * 60)
    if (!totalDurationMinutes) {
      return fail(409, 'INVALID_DURATION', 'This booking has an invalid duration and cannot be rescheduled.')
    }

    const result = await prisma.$transaction(async (tx) => {
      const hold = (await tx.bookingHold.findUnique({
        where: { id: holdId },
        select: {
          id: true,
          clientId: true,
          professionalId: true,
          scheduledFor: true,
          expiresAt: true,
          locationType: true,
          locationId: true,
        },
      })) as HoldRow | null

      if (!hold) return { ok: false as const, status: 404, error: 'Hold not found.' }
      if (!hold.clientId || hold.clientId !== clientId)
        return { ok: false as const, status: 403, error: 'Hold does not belong to you.' }
      if (hold.expiresAt.getTime() <= now.getTime())
        return { ok: false as const, status: 409, error: 'Hold expired. Please pick a new time.' }

      if (hold.professionalId !== booking.professionalId)
        return { ok: false as const, status: 409, error: 'Hold is for a different professional.' }

      if (hold.locationType !== locationType)
        return { ok: false as const, status: 409, error: 'Hold locationType does not match.' }

      if (!hold.locationId)
        return { ok: false as const, status: 409, error: 'Hold is missing location info. Please pick a new slot.' }

      const loc = await tx.professionalLocation.findFirst({
        where: { id: hold.locationId, professionalId: booking.professionalId, isBookable: true },
        select: {
          id: true,
          timeZone: true,
          workingHours: true,
          bufferMinutes: true,
          formattedAddress: true,
          lat: true,
          lng: true,
        },
      })

      if (!loc) return { ok: false as const, status: 409, error: 'This location is no longer available.' }

      // ✅ Timezone truth: LOCATION timezone must be valid.
      // No Los Angeles “helpfulness”. If missing, fail.
      const tzRes = await resolveApptTimeZone({
        location: { id: loc.id, timeZone: loc.timeZone },
        professionalId: booking.professionalId,
        fallback: DEFAULT_TIME_ZONE,
        requireValid: true,
      })

      if (!tzRes.ok) return { ok: false as const, status: 409, error: 'This location is missing a valid timezone.' }
      const apptTz = tzRes.timeZone

      const bufferMinutes = clampInt(loc.bufferMinutes ?? booking.bufferMinutes ?? 0, 0, 180)

      const newStart = normalizeToMinute(new Date(hold.scheduledFor))
      if (Number.isNaN(newStart.getTime())) {
        return { ok: false as const, status: 400, error: 'Hold time is invalid. Please pick a new slot.' }
      }

      // a tiny grace window is fine, but don’t allow actual past
      if (newStart.getTime() < now.getTime() - 60_000) {
        return { ok: false as const, status: 400, error: 'That time is in the past.' }
      }

      const newEnd = addMinutes(newStart, totalDurationMinutes + bufferMinutes)

      const whCheck = ensureWithinWorkingHours({
        scheduledStartUtc: newStart,
        scheduledEndUtc: newEnd,
        workingHours: loc.workingHours,
        timeZone: apptTz,
      })
      if (!whCheck.ok) return { ok: false as const, status: 400, error: whCheck.error }

      // Conflict check (simple window)
      const windowStart = addMinutes(newStart, -24 * 60)
      const windowEnd = addMinutes(newStart, 24 * 60)

      const others = await tx.booking.findMany({
        where: {
          professionalId: booking.professionalId,
          id: { not: booking.id },
          status: { in: ['PENDING', 'ACCEPTED'] as any },
          scheduledFor: { gte: windowStart, lte: windowEnd },
          NOT: { status: 'CANCELLED' as any },
        },
        select: {
          id: true,
          scheduledFor: true,
          totalDurationMinutes: true,
          bufferMinutes: true,
        },
        take: 2000,
      })

      const hasConflict = others.some((b) => {
        const bDur = clampInt(b.totalDurationMinutes ?? 0, 0, 24 * 60)
        if (!bDur) return false

        const bBuf = clampInt(b.bufferMinutes ?? 0, 0, 180)
        const bStart = normalizeToMinute(new Date(b.scheduledFor))
        if (Number.isNaN(bStart.getTime())) return false

        const bEnd = addMinutes(bStart, bDur + bBuf)
        return overlaps(bStart, bEnd, newStart, newEnd)
      })

      if (hasConflict) {
        return {
          ok: false as const,
          status: 409,
          error: 'That time is no longer available. Please choose a new slot.',
        }
      }

      const updated = await tx.booking.update({
        where: { id: booking.id },
        data: {
          scheduledFor: newStart,
          locationType,
          bufferMinutes,

          locationId: loc.id,
          locationTimeZone: apptTz,

          // snapshots (keep minimal + stable)
          locationAddressSnapshot: loc.formattedAddress ? ({ formattedAddress: loc.formattedAddress } as any) : undefined,
          locationLatSnapshot: typeof loc.lat === 'number' ? loc.lat : undefined,
          locationLngSnapshot: typeof loc.lng === 'number' ? loc.lng : undefined,
        } as any,
        select: {
          id: true,
          status: true,
          scheduledFor: true,
          locationType: true,
          bufferMinutes: true,
          totalDurationMinutes: true,
          locationTimeZone: true,
        },
      })

      await tx.bookingHold.delete({ where: { id: hold.id } })

      return { ok: true as const, updated }
    })

    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.error }, { status: result.status })
    }

    return NextResponse.json(
      {
        ok: true,
        booking: {
          id: result.updated.id,
          status: result.updated.status,
          scheduledFor: new Date(result.updated.scheduledFor).toISOString(),
          locationType: result.updated.locationType,
          bufferMinutes: result.updated.bufferMinutes ?? 0,
          totalDurationMinutes: result.updated.totalDurationMinutes ?? 0,
          locationTimeZone: result.updated.locationTimeZone ?? null,
        },
      },
      { status: 200 },
    )
  } catch (e) {
    console.error('POST /api/bookings/[id]/reschedule error', e)
    return fail(500, 'INTERNAL', 'Failed to reschedule booking.')
  }
}
