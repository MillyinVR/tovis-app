// app/api/holds/route.ts
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'
import type { ServiceLocationType } from '@prisma/client'

export const dynamic = 'force-dynamic'

type CreateHoldBody = {
  offeringId?: unknown
  scheduledFor?: unknown
  locationType?: unknown
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

/** existingStart < requestedEnd AND existingEnd > requestedStart */
function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date) {
  return aStart < bEnd && aEnd > bStart
}

/** Normalize to minute precision. */
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

/** -------------------------
 * Working-hours enforcement
 * ------------------------- */
type WorkingHoursDay = { enabled?: boolean; start?: string; end?: string }
type WorkingHours = Record<string, WorkingHoursDay>

function isValidIanaTimeZone(tz: string | null | undefined) {
  if (!tz || typeof tz !== 'string') return false
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz }).format(new Date())
    return true
  } catch {
    return false
  }
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

function getWeekdayKeyInTimeZone(
  dateUtc: Date,
  timeZone: string,
): 'sun' | 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' {
  const weekday = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short' })
    .format(dateUtc)
    .toLowerCase()
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
  if (hh < 0 || hh > 23) return null
  if (mm < 0 || mm > 59) return null
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
  if (endDayKey !== dayKey) {
    return { ok: false, error: 'That time is outside this professional’s working hours.' }
  }

  if (startMin < windowStartMin || endMin > windowEndMin) {
    return { ok: false, error: 'That time is outside this professional’s working hours.' }
  }

  return { ok: true }
}

export async function POST(req: Request) {
  try {
    const user = await getCurrentUser().catch(() => null)
    if (!user || user.role !== 'CLIENT' || !user.clientProfile?.id) {
      return NextResponse.json({ ok: false, error: 'Only clients can hold slots.' }, { status: 401 })
    }
    const clientId = user.clientProfile.id

    const body = (await req.json().catch(() => ({}))) as CreateHoldBody
    const offeringId = pickString(body.offeringId)
    const locationType = normalizeLocationType(body.locationType)

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

    const BUFFER_MINUTES = 5
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
          professional: {
            select: {
              timeZone: true,
              workingHours: true,
            },
          },
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

      const proTz = isValidIanaTimeZone(offering.professional?.timeZone)
        ? offering.professional!.timeZone!
        : 'America/Los_Angeles'

      const whCheck = ensureWithinWorkingHours({
        scheduledStartUtc: requestedStart,
        scheduledEndUtc: requestedEnd,
        workingHours: offering.professional?.workingHours,
        timeZone: proTz,
      })
      if (!whCheck.ok) {
        return { ok: false as const, status: 400, error: whCheck.error }
      }

      const now = new Date()

      // Cleanup: delete expired holds for this exact pro+slot
      await tx.bookingHold.deleteMany({
        where: {
          professionalId: offering.professionalId,
          scheduledFor: requestedStart,
          expiresAt: { lte: now },
        },
      })

      // If THIS client already holds this exact slot, return it
      const existingClientHold = await tx.bookingHold.findFirst({
        where: {
          professionalId: offering.professionalId,
          scheduledFor: requestedStart,
          expiresAt: { gt: now },
          clientId,
        },
        select: { id: true, expiresAt: true, scheduledFor: true },
      })

      if (existingClientHold) {
        return {
          ok: true as const,
          status: 200,
          hold: existingClientHold,
        }
      }

      // Booking conflict check
      const windowStart = addMinutes(requestedStart, -duration * 2)
      const windowEnd = addMinutes(requestedStart, duration * 2)

      const existingBookings = await tx.booking.findMany({
        where: {
          professionalId: offering.professionalId,
          scheduledFor: { gte: windowStart, lte: windowEnd },
          NOT: { status: 'CANCELLED' },
        },
        select: { scheduledFor: true, durationMinutesSnapshot: true },
        take: 50,
      })

      const bookingConflict = existingBookings.some((b) => {
        const bDur = Number(b.durationMinutesSnapshot ?? 0)
        if (!Number.isFinite(bDur) || bDur <= 0) return false
        const bStart = normalizeToMinute(new Date(b.scheduledFor))
        const bEnd = addMinutes(bStart, bDur)
        return overlaps(bStart, bEnd, requestedStart, requestedEnd)
      })

      if (bookingConflict) {
        return { ok: false as const, status: 409, error: 'That time was just taken.' }
      }

      // Hold conflict check: block if ANYONE holds this exact slot
      const activeHold = await tx.bookingHold.findFirst({
        where: {
          professionalId: offering.professionalId,
          scheduledFor: requestedStart,
          expiresAt: { gt: now },
        },
        select: { id: true },
      })

      if (activeHold) {
        return { ok: false as const, status: 409, error: 'Someone is already holding that time. Try another slot.' }
      }

      const expiresAt = addMinutes(now, 10)

      const hold = await tx.bookingHold.create({
        data: {
          offeringId: offering.id,
          professionalId: offering.professionalId,
          clientId,
          scheduledFor: requestedStart,
          expiresAt,
        },
        select: { id: true, expiresAt: true, scheduledFor: true },
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
