// app/api/bookings/[id]/reschedule/route.ts
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'
import type { ServiceLocationType } from '@prisma/client'

export const dynamic = 'force-dynamic'

type Ctx = { params: { id: string } | Promise<{ id: string }> }
type LocationType = Extract<ServiceLocationType, 'SALON' | 'MOBILE'>

function pickString(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null
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

function overlap(aStart: Date, aMin: number, aBuf: number, bStart: Date, bMin: number, bBuf: number) {
  const aEnd = aStart.getTime() + (aMin + aBuf) * 60_000
  const bEnd = bStart.getTime() + (bMin + bBuf) * 60_000
  return aStart.getTime() < bEnd && bStart.getTime() < aEnd
}

async function requireClient() {
  const user = await getCurrentUser().catch(() => null)
  if (!user || user.role !== 'CLIENT' || !user.clientProfile?.id) return null
  return { user, clientId: user.clientProfile.id }
}

async function computeDurationMinutes(args: {
  bookingDurationSnapshot: number
  offering: null | { salonDurationMinutes: number | null; mobileDurationMinutes: number | null }
  locationType: LocationType
}) {
  const { offering, locationType, bookingDurationSnapshot } = args
  const fromOffering = locationType === 'MOBILE' ? offering?.mobileDurationMinutes : offering?.salonDurationMinutes
  const minutes = Number(fromOffering ?? bookingDurationSnapshot ?? 0)
  if (!Number.isFinite(minutes) || minutes <= 0) return null
  return Math.floor(minutes)
}

/** Working-hours enforcement (LOCATION truth) */
type WorkingHoursDay = { enabled?: boolean; start?: string; end?: string }
type WorkingHours = Record<string, WorkingHoursDay>

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
  if (!rule || rule.enabled === false) return { ok: false, error: 'That time is outside this professional’s working hours.' }

  const startHHMM = parseHHMM(rule.start)
  const endHHMM = parseHHMM(rule.end)
  if (!startHHMM || !endHHMM) return { ok: false, error: 'This professional’s working hours are misconfigured.' }

  const windowStartMin = startHHMM.hh * 60 + startHHMM.mm
  const windowEndMin = endHHMM.hh * 60 + endHHMM.mm
  if (windowEndMin <= windowStartMin) return { ok: false, error: 'This professional’s working hours are misconfigured.' }

  const startMin = minutesSinceMidnightInTimeZone(scheduledStartUtc, timeZone)
  const endMin = minutesSinceMidnightInTimeZone(scheduledEndUtc, timeZone)

  const endDayKey = getWeekdayKeyInTimeZone(scheduledEndUtc, timeZone)
  if (endDayKey !== dayKey) return { ok: false, error: 'That time is outside this professional’s working hours.' }

  if (startMin < windowStartMin || endMin > windowEndMin) {
    return { ok: false, error: 'That time is outside this professional’s working hours.' }
  }
  return { ok: true }
}

type HoldRow = {
  id: string
  clientId: string
  professionalId: string
  offeringId: string | null
  scheduledFor: Date
  expiresAt: Date
  locationType: LocationType
  locationId: string | null
  locationTimeZone: string | null
  locationAddressSnapshot: any | null
  locationLatSnapshot: number | null
  locationLngSnapshot: number | null
}

export async function POST(req: Request, { params }: Ctx) {
  try {
    const auth = await requireClient()
    if (!auth) return NextResponse.json({ ok: false, error: 'Only clients can reschedule.' }, { status: 401 })

    const { id } = await Promise.resolve(params)
    const bookingId = pickString(id)
    if (!bookingId) return NextResponse.json({ ok: false, error: 'Missing booking id.' }, { status: 400 })

    const body = await req.json().catch(() => ({}))
    const holdId = pickString(body?.holdId)
    const locationTypeRaw = body?.locationType

    if (!holdId) return NextResponse.json({ ok: false, error: 'Missing holdId.' }, { status: 400 })
    if (!isLocationType(locationTypeRaw)) {
      return NextResponse.json({ ok: false, error: 'Missing/invalid locationType.' }, { status: 400 })
    }
    const locationType = locationTypeRaw

    const now = new Date()

    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      select: {
        id: true,
        status: true,
        clientId: true,
        professionalId: true,
        offeringId: true,
        durationMinutesSnapshot: true,
        startedAt: true,
        finishedAt: true,
      },
    })

    if (!booking) return NextResponse.json({ ok: false, error: 'Booking not found.' }, { status: 404 })
    if (booking.clientId !== auth.clientId) return NextResponse.json({ ok: false, error: 'Forbidden.' }, { status: 403 })

    if (booking.status === 'COMPLETED' || booking.status === 'CANCELLED') {
      return NextResponse.json({ ok: false, error: 'This booking cannot be rescheduled.' }, { status: 409 })
    }
    if (booking.startedAt || booking.finishedAt) {
      return NextResponse.json({ ok: false, error: 'This booking has started and cannot be rescheduled.' }, { status: 409 })
    }

    const result = await prisma.$transaction(async (tx) => {
      // ✅ Hold is truth. Also: DO NOT cast Prisma select. Type the result instead.
      const hold = (await tx.bookingHold.findUnique({
        where: { id: holdId },
        select: {
          id: true,
          clientId: true,
          professionalId: true,
          offeringId: true,
          scheduledFor: true,
          expiresAt: true,
          locationType: true,

          locationId: true,
          locationTimeZone: true,
          locationAddressSnapshot: true,
          locationLatSnapshot: true,
          locationLngSnapshot: true,
        },
      })) as HoldRow | null

      if (!hold) return { error: 'Hold not found.', status: 404 as const }
      if (hold.clientId !== auth.clientId) return { error: 'Hold does not belong to you.', status: 403 as const }
      if (hold.expiresAt.getTime() <= now.getTime()) return { error: 'Hold expired. Please pick a new time.', status: 409 as const }

      if (hold.professionalId !== booking.professionalId) return { error: 'Hold is for a different professional.', status: 409 as const }
      if (hold.locationType !== locationType) return { error: 'Hold locationType does not match.', status: 409 as const }

      // offering match
      if (booking.offeringId) {
        if (hold.offeringId !== booking.offeringId) return { error: 'Hold is for a different offering.', status: 409 as const }
      } else {
        if (!hold.offeringId) return { error: 'Hold is missing offeringId.', status: 409 as const }
      }

      if (!hold.locationId) return { error: 'Hold is missing location info.', status: 409 as const }

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
      if (!loc) return { error: 'This location is no longer available.', status: 409 as const }

      const apptTz = loc.timeZone || hold.locationTimeZone || 'America/Los_Angeles'
      const bufferMinutes = Math.max(0, Math.min(120, Number(loc.bufferMinutes ?? 0) || 0))

      const offeringIdToUse = booking.offeringId ?? hold.offeringId
      const offering = offeringIdToUse
        ? await tx.professionalServiceOffering.findUnique({
            where: { id: offeringIdToUse },
            select: { id: true, salonDurationMinutes: true, mobileDurationMinutes: true },
          })
        : null

      const durationMinutes = await computeDurationMinutes({
        bookingDurationSnapshot: Number(booking.durationMinutesSnapshot || 0),
        offering: offering
          ? { salonDurationMinutes: offering.salonDurationMinutes, mobileDurationMinutes: offering.mobileDurationMinutes }
          : null,
        locationType,
      })
      if (!durationMinutes) return { error: 'Could not determine duration for this reschedule.', status: 409 as const }

      // ✅ DO NOT trust client scheduledFor. Hold is truth.
      const newStart = normalizeToMinute(new Date(hold.scheduledFor))
      if (newStart.getTime() < now.getTime() - 60_000) {
        return { error: 'That time is in the past.', status: 400 as const }
      }
      const newEnd = addMinutes(newStart, durationMinutes)

      // working hours (LOCATION)
      const whCheck = ensureWithinWorkingHours({
        scheduledStartUtc: newStart,
        scheduledEndUtc: newEnd,
        workingHours: loc.workingHours,
        timeZone: apptTz,
      })
      if (!whCheck.ok) return { error: whCheck.error, status: 400 as const }

      // conflict check (include buffers) against other bookings
      const windowStart = addMinutes(newStart, -24 * 60)
      const windowEnd = addMinutes(newStart, 24 * 60)

      const otherBookings = await tx.booking.findMany({
        where: {
          professionalId: booking.professionalId,
          id: { not: booking.id },
          status: { in: ['PENDING', 'ACCEPTED'] as any },
          scheduledFor: { gte: windowStart, lte: windowEnd },
        },
        select: {
          id: true,
          scheduledFor: true,
          totalDurationMinutes: true,
          durationMinutesSnapshot: true,
          bufferMinutes: true,
        },
        take: 2000,
      })

      const conflicts = otherBookings.some((b) => {
        const bDur =
          Number((b as any).totalDurationMinutes ?? 0) > 0
            ? Number((b as any).totalDurationMinutes)
            : Number((b as any).durationMinutesSnapshot ?? 0)

        const bBuf = Number((b as any).bufferMinutes ?? 0)

        if (!Number.isFinite(bDur) || bDur <= 0) return false
        return overlap(
          newStart,
          durationMinutes,
          bufferMinutes,
          normalizeToMinute(new Date(b.scheduledFor)),
          bDur,
          Number.isFinite(bBuf) ? bBuf : 0,
        )
      })

      if (conflicts) return { error: 'That time is no longer available. Please choose a new slot.', status: 409 as const }

      const updated = await tx.booking.update({
        where: { id: booking.id },
        data: {
          scheduledFor: newStart,
          locationType,
          offeringId: booking.offeringId ?? offeringIdToUse ?? undefined,

          durationMinutesSnapshot: durationMinutes,
          bufferMinutes,

          // persist location
          locationId: loc.id,
          locationTimeZone: apptTz,
          locationAddressSnapshot:
            hold.locationAddressSnapshot ??
            (loc.formattedAddress ? ({ formattedAddress: loc.formattedAddress } as any) : undefined),
          locationLatSnapshot: hold.locationLatSnapshot ?? (typeof loc.lat === 'number' ? loc.lat : undefined),
          locationLngSnapshot: hold.locationLngSnapshot ?? (typeof loc.lng === 'number' ? loc.lng : undefined),
        } as any,
        select: {
          id: true,
          scheduledFor: true,
          status: true,
          locationType: true,
          durationMinutesSnapshot: true,
        },
      })

      await tx.bookingHold.delete({ where: { id: hold.id } })

      return { updated }
    })

    if ('error' in result) {
      return NextResponse.json({ ok: false, error: result.error }, { status: result.status })
    }

    return NextResponse.json({ ok: true, booking: result.updated }, { status: 200 })
  } catch (e) {
    console.error('POST /api/bookings/[id]/reschedule error', e)
    return NextResponse.json({ ok: false, error: 'Failed to reschedule booking.' }, { status: 500 })
  }
}
