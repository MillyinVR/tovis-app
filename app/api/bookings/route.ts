// app/api/bookings/route.ts
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'
import type { ServiceLocationType } from '@prisma/client'

export const dynamic = 'force-dynamic'

type BookingSourceNormalized = 'REQUESTED' | 'DISCOVERY' | 'AFTERCARE'

type CreateBookingBody = {
  offeringId?: unknown
  scheduledFor?: unknown
  holdId?: unknown
  source?: unknown
  locationType?: unknown
  mediaId?: unknown
  openingId?: unknown
}

type ExistingBookingForConflict = {
  id: string
  scheduledFor: Date
  durationMinutesSnapshot: number | null
}

function pickString(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

function isValidDate(d: Date) {
  return d instanceof Date && Number.isFinite(d.getTime())
}

function addMinutes(date: Date, minutes: number) {
  return new Date(date.getTime() + minutes * 60_000)
}

/** existingStart < requestedEnd AND existingEnd > requestedStart */
function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date) {
  return aStart < bEnd && aEnd > bStart
}

/** Normalize to minute precision (aligns with holds + UI). */
function normalizeToMinute(d: Date) {
  const x = new Date(d)
  x.setSeconds(0, 0)
  return x
}

function normalizeSourceStrict(v: unknown): BookingSourceNormalized | null {
  const s = typeof v === 'string' ? v.trim().toUpperCase() : ''
  if (s === 'AFTERCARE') return 'AFTERCARE'
  if (s === 'DISCOVERY') return 'DISCOVERY'
  if (s === 'REQUESTED') return 'REQUESTED'
  return null
}

function normalizeLocationTypeStrict(v: unknown): ServiceLocationType | null {
  const s = typeof v === 'string' ? v.trim().toUpperCase() : ''
  if (s === 'SALON') return 'SALON'
  if (s === 'MOBILE') return 'MOBILE'
  return null
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

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser().catch(() => null)
    if (!user || user.role !== 'CLIENT' || !user.clientProfile?.id) {
      return NextResponse.json({ ok: false, error: 'Only clients can create bookings.' }, { status: 401 })
    }

    const clientId = user.clientProfile.id
    const body = (await request.json().catch(() => ({}))) as CreateBookingBody

    const offeringId = pickString(body.offeringId)
    const holdId = pickString(body.holdId)

    const source = normalizeSourceStrict(body.source)
    if (!source) {
      return NextResponse.json({ ok: false, error: 'Missing booking source.' }, { status: 400 })
    }

    const locationType = normalizeLocationTypeStrict(body.locationType)
    if (!locationType) {
      return NextResponse.json({ ok: false, error: 'Missing locationType.' }, { status: 400 })
    }

    const mediaId = pickString(body.mediaId) // not stored (yet)
    const openingId = pickString(body.openingId)

    if (!offeringId || !body.scheduledFor) {
      return NextResponse.json({ ok: false, error: 'Missing offering or date/time.' }, { status: 400 })
    }

    if (!holdId) {
      // hold is required; we treat missing hold as a conflict (matches your UX)
      return NextResponse.json({ ok: false, error: 'Missing hold. Please pick a slot again.' }, { status: 409 })
    }

    const scheduledForParsed = new Date(String(body.scheduledFor))
    if (!isValidDate(scheduledForParsed)) {
      return NextResponse.json({ ok: false, error: 'Invalid date/time.' }, { status: 400 })
    }

    const requestedStart = normalizeToMinute(scheduledForParsed)

    const BUFFER_MINUTES = 5
    if (requestedStart.getTime() < addMinutes(new Date(), BUFFER_MINUTES).getTime()) {
      return NextResponse.json({ ok: false, error: 'Please select a future time.' }, { status: 400 })
    }

    const offering = await prisma.professionalServiceOffering.findUnique({
      where: { id: offeringId },
      select: {
        id: true,
        isActive: true,
        professionalId: true,
        serviceId: true,

        offersInSalon: true,
        offersMobile: true,
        salonPriceStartingAt: true,
        salonDurationMinutes: true,
        mobilePriceStartingAt: true,
        mobileDurationMinutes: true,

        professional: {
          select: {
            autoAcceptBookings: true,
            timeZone: true,
            workingHours: true,
          },
        },
      },
    })

    if (!offering || !offering.isActive) {
      return NextResponse.json({ ok: false, error: 'Invalid or inactive offering.' }, { status: 400 })
    }

    if (locationType === 'SALON' && !offering.offersInSalon) {
      return NextResponse.json({ ok: false, error: 'This service is not offered in-salon.' }, { status: 400 })
    }
    if (locationType === 'MOBILE' && !offering.offersMobile) {
      return NextResponse.json({ ok: false, error: 'This service is not offered as mobile.' }, { status: 400 })
    }

    const priceStartingAt = locationType === 'MOBILE' ? offering.mobilePriceStartingAt : offering.salonPriceStartingAt
    const durationSnapshot = locationType === 'MOBILE' ? offering.mobileDurationMinutes : offering.salonDurationMinutes

    if (priceStartingAt == null) {
      return NextResponse.json(
        { ok: false, error: `Pricing is not set for ${locationType === 'MOBILE' ? 'mobile' : 'salon'} bookings.` },
        { status: 400 },
      )
    }

    const durationMinutes = Number(durationSnapshot ?? 0)
    if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) {
      return NextResponse.json({ ok: false, error: 'Offering duration is invalid for this booking type.' }, { status: 400 })
    }

    const requestedEnd = addMinutes(requestedStart, durationMinutes)

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
      return NextResponse.json({ ok: false, error: whCheck.error }, { status: 400 })
    }

    const now = new Date()
    const windowStart = addMinutes(requestedStart, -durationMinutes * 2)
    const windowEnd = addMinutes(requestedStart, durationMinutes * 2)

    const autoAccept = Boolean(offering.professional?.autoAcceptBookings)
    const initialStatus = autoAccept ? 'ACCEPTED' : 'PENDING'

    const booking = await prisma.$transaction(async (tx) => {
      // 1) Validate hold (SERVER TRUTH)
      const hold = await tx.bookingHold.findUnique({
        where: { id: holdId },
        select: {
          id: true,
          offeringId: true,
          professionalId: true,
          clientId: true,
          scheduledFor: true,
          expiresAt: true,
          locationType: true,
        },
      })

      if (!hold) throw new Error('HOLD_NOT_FOUND')

      // Fail closed (do not reveal existence)
      if (hold.clientId !== clientId) throw new Error('HOLD_NOT_FOUND')

      if (hold.expiresAt.getTime() <= now.getTime()) throw new Error('HOLD_EXPIRED')
      if (hold.offeringId !== offeringId) throw new Error('HOLD_MISMATCH')
      if (hold.professionalId !== offering.professionalId) throw new Error('HOLD_MISMATCH')
      if (hold.locationType !== locationType) throw new Error('HOLD_MISMATCH')

      const holdStart = normalizeToMinute(new Date(hold.scheduledFor))
      if (holdStart.getTime() !== requestedStart.getTime()) throw new Error('HOLD_MISMATCH')

      // 2) Conflict re-check (bookings)
      const existing2 = (await tx.booking.findMany({
        where: {
          professionalId: offering.professionalId,
          scheduledFor: { gte: windowStart, lte: windowEnd },
          NOT: { status: 'CANCELLED' },
        },
        select: { id: true, scheduledFor: true, durationMinutesSnapshot: true },
        take: 50,
      })) as ExistingBookingForConflict[]

      const hasConflict2 = existing2.some((b) => {
        const bDur = Number(b.durationMinutesSnapshot || 0)
        if (!Number.isFinite(bDur) || bDur <= 0) return false
        const bStart = normalizeToMinute(new Date(b.scheduledFor))
        const bEnd = addMinutes(bStart, bDur)
        return overlaps(bStart, bEnd, requestedStart, requestedEnd)
      })

      if (hasConflict2) throw new Error('TIME_NOT_AVAILABLE')

      // 3) Claim opening if present
      if (openingId) {
        const activeOpening = await tx.lastMinuteOpening.findFirst({
          where: { id: openingId, status: 'ACTIVE' },
          select: { id: true, startAt: true, professionalId: true, offeringId: true, serviceId: true },
        })

        if (!activeOpening) throw new Error('OPENING_NOT_AVAILABLE')
        if (activeOpening.professionalId !== offering.professionalId) throw new Error('OPENING_NOT_AVAILABLE')
        if (activeOpening.offeringId && activeOpening.offeringId !== offering.id) throw new Error('OPENING_NOT_AVAILABLE')
        if (activeOpening.serviceId && activeOpening.serviceId !== offering.serviceId) throw new Error('OPENING_NOT_AVAILABLE')
        if (normalizeToMinute(new Date(activeOpening.startAt)).getTime() !== requestedStart.getTime()) {
          throw new Error('OPENING_NOT_AVAILABLE')
        }

        const updated = await tx.lastMinuteOpening.updateMany({
          where: { id: openingId, status: 'ACTIVE' },
          data: { status: 'BOOKED' },
        })

        if (updated.count !== 1) throw new Error('OPENING_NOT_AVAILABLE')
      }

      // 4) Create booking
      const created = await tx.booking.create({
        data: {
          clientId,
          professionalId: offering.professionalId,
          serviceId: offering.serviceId,
          offeringId: offering.id,

          scheduledFor: requestedStart,
          status: initialStatus,

          source,
          locationType,

          priceSnapshot: priceStartingAt,
          durationMinutesSnapshot: durationMinutes,
        },
        select: {
          id: true,
          status: true,
          scheduledFor: true,
          professionalId: true,
          serviceId: true,
          offeringId: true,
          source: true,
          locationType: true,
        },
      })

      // 5) Mark notification, if present
      if (openingId) {
        await tx.openingNotification.updateMany({
          where: { clientId, openingId, bookedAt: null },
          data: { bookedAt: new Date() },
        })
      }

      // 6) Delete hold after success
      await tx.bookingHold.delete({ where: { id: hold.id } })

      void mediaId
      return created
    })

    return NextResponse.json({ ok: true, booking }, { status: 201 })
  } catch (e: any) {
    const msg = String(e?.message || '')

    if (msg === 'OPENING_NOT_AVAILABLE') {
      return NextResponse.json(
        { ok: false, error: 'That opening was just taken. Please pick another slot.' },
        { status: 409 },
      )
    }
    if (msg === 'TIME_NOT_AVAILABLE') {
      return NextResponse.json(
        { ok: false, error: 'That time is no longer available. Please select a different slot.' },
        { status: 409 },
      )
    }
    if (msg === 'HOLD_NOT_FOUND') {
      return NextResponse.json({ ok: false, error: 'Hold not found. Please pick a slot again.' }, { status: 409 })
    }
    if (msg === 'HOLD_EXPIRED') {
      return NextResponse.json({ ok: false, error: 'Hold expired. Please pick a slot again.' }, { status: 409 })
    }
    if (msg === 'HOLD_MISMATCH') {
      return NextResponse.json({ ok: false, error: 'Hold mismatch. Please pick a slot again.' }, { status: 409 })
    }

    console.error('POST /api/bookings error:', e)
    return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500 })
  }
}
