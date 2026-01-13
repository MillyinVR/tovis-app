// app/api/bookings/route.ts
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'
import type { ServiceLocationType } from '@prisma/client'

export const dynamic = 'force-dynamic'

type BookingSourceNormalized = 'REQUESTED' | 'DISCOVERY' | 'AFTERCARE'

type CreateBookingBody = {
  offeringId?: unknown
  holdId?: unknown
  source?: unknown
  locationType?: unknown

  mediaId?: unknown
  openingId?: unknown
  aftercareToken?: unknown
  rebookOfBookingId?: unknown

  scheduledFor?: unknown // ignored; hold is truth
}

type ExistingBookingForConflict = {
  id: string
  scheduledFor: Date
  totalDurationMinutes: number | null
  durationMinutesSnapshot: number | null
  bufferMinutes: number | null
}

type HoldRow = {
  id: string
  offeringId: string
  professionalId: string
  clientId: string
  scheduledFor: Date
  expiresAt: Date
  locationType: ServiceLocationType
  locationId: string | null
  locationTimeZone: string | null
  locationAddressSnapshot: any | null
  locationLatSnapshot: number | null
  locationLngSnapshot: number | null
}

function pickString(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

function addMinutes(date: Date, minutes: number) {
  return new Date(date.getTime() + minutes * 60_000)
}

function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date) {
  return aStart < bEnd && aEnd > bStart
}

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

  // Safari-ish edge case
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

function normalizeErr(e: any): string {
  return String(e?.message || '')
}

function fail(status: number, code: string, error: string, details?: any) {
  const dev = process.env.NODE_ENV !== 'production'
  return NextResponse.json(
    dev && details != null ? { ok: false, code, error, details } : { ok: false, code, error },
    { status },
  )
}

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser().catch(() => null)
    if (!user || user.role !== 'CLIENT' || !user.clientProfile?.id) {
      return fail(401, 'NOT_AUTHORIZED', 'Only clients can create bookings.')
    }

    const clientId = user.clientProfile.id
    const body = (await request.json().catch(() => ({}))) as CreateBookingBody

    const offeringId = pickString(body.offeringId)
    const holdId = pickString(body.holdId)

    const source = normalizeSourceStrict(body.source)
    if (!source) return fail(400, 'MISSING_SOURCE', 'Missing booking source.')

    const locationType = normalizeLocationTypeStrict(body.locationType)
    if (!locationType) return fail(400, 'MISSING_LOCATION_TYPE', 'Missing locationType.')

    if (!offeringId) return fail(400, 'MISSING_OFFERING', 'Missing offeringId.')
    if (!holdId) return fail(409, 'HOLD_MISSING', 'Missing hold. Please pick a slot again.')

    const mediaId = pickString(body.mediaId)
    const openingId = pickString(body.openingId)
    const aftercareToken = pickString(body.aftercareToken)
    const requestedRebookOfBookingId = pickString(body.rebookOfBookingId)

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
        professional: { select: { autoAcceptBookings: true } },
      },
    })

    if (!offering || !offering.isActive) {
      return fail(400, 'OFFERING_INACTIVE', 'Invalid or inactive offering.')
    }

    if (locationType === 'SALON' && !offering.offersInSalon) {
      return fail(400, 'MODE_NOT_SUPPORTED', 'This service is not offered in-salon.')
    }
    if (locationType === 'MOBILE' && !offering.offersMobile) {
      return fail(400, 'MODE_NOT_SUPPORTED', 'This service is not offered as mobile.')
    }

    const priceStartingAt = locationType === 'MOBILE' ? offering.mobilePriceStartingAt : offering.salonPriceStartingAt
    const durationSnapshot = locationType === 'MOBILE' ? offering.mobileDurationMinutes : offering.salonDurationMinutes

    if (priceStartingAt == null) {
      return fail(
        400,
        'PRICING_NOT_SET',
        `Pricing is not set for ${locationType === 'MOBILE' ? 'mobile' : 'salon'} bookings.`,
      )
    }

    const durationMinutes = Number(durationSnapshot ?? 0)
    if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) {
      return fail(400, 'INVALID_DURATION', 'Offering duration is invalid for this booking type.')
    }

    const now = new Date()
    const autoAccept = Boolean(offering.professional?.autoAcceptBookings)
    const initialStatus = autoAccept ? 'ACCEPTED' : 'PENDING'

    // Aftercare validation (only if AFTERCARE)
    let rebookOfBookingIdForCreate: string | null = null
    if (source === 'AFTERCARE') {
      if (!aftercareToken) return fail(400, 'AFTERCARE_TOKEN_MISSING', 'Missing aftercare token.')

      const aftercare = await prisma.aftercareSummary.findUnique({
        where: { publicToken: aftercareToken },
        select: {
          booking: {
            select: {
              id: true,
              status: true,
              clientId: true,
              professionalId: true,
              serviceId: true,
              offeringId: true,
            },
          },
        },
      })

      if (!aftercare?.booking) return fail(400, 'AFTERCARE_TOKEN_INVALID', 'Invalid aftercare token.')

      const original = aftercare.booking

      if (original.status !== 'COMPLETED') return fail(409, 'AFTERCARE_NOT_COMPLETED', 'Only COMPLETED bookings can be rebooked.')
      if (original.clientId !== clientId) return fail(403, 'AFTERCARE_CLIENT_MISMATCH', 'Aftercare link does not match this client.')

      const matchesOffering =
        (original.offeringId && original.offeringId === offering.id) ||
        (original.professionalId === offering.professionalId && original.serviceId === offering.serviceId)

      if (!matchesOffering) return fail(403, 'AFTERCARE_OFFERING_MISMATCH', 'Aftercare link does not match this offering.')

      rebookOfBookingIdForCreate =
        requestedRebookOfBookingId && requestedRebookOfBookingId === original.id ? requestedRebookOfBookingId : original.id
    }

    const booking = await prisma.$transaction(async (tx) => {
      const hold = (await tx.bookingHold.findUnique({
        where: { id: holdId },
        select: {
          id: true,
          offeringId: true,
          professionalId: true,
          clientId: true,
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

      if (!hold) throw new Error('HOLD_NOT_FOUND')
      if (hold.clientId !== clientId) throw new Error('HOLD_NOT_FOUND')
      if (hold.expiresAt.getTime() <= now.getTime()) throw new Error('HOLD_EXPIRED')

      if (hold.offeringId !== offeringId) throw new Error('HOLD_MISMATCH')
      if (hold.professionalId !== offering.professionalId) throw new Error('HOLD_MISMATCH')
      if (hold.locationType !== locationType) throw new Error('HOLD_MISMATCH')
      if (!hold.locationId) throw new Error('HOLD_MISSING_LOCATION')

      const loc = await tx.professionalLocation.findFirst({
        where: { id: hold.locationId, professionalId: offering.professionalId, isBookable: true },
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
      if (!loc) throw new Error('LOCATION_NOT_FOUND')

      const apptTz = loc.timeZone || hold.locationTimeZone || 'America/Los_Angeles'
      const bufferMinutes = Math.max(0, Math.min(120, Number(loc.bufferMinutes ?? 0) || 0))

      const requestedStart = normalizeToMinute(new Date(hold.scheduledFor))
      const requestedEnd = addMinutes(requestedStart, durationMinutes)

      if (requestedStart.getTime() < addMinutes(new Date(), 5).getTime()) {
        throw new Error('TIME_IN_PAST')
      }

      const whCheck = ensureWithinWorkingHours({
        scheduledStartUtc: requestedStart,
        scheduledEndUtc: requestedEnd,
        workingHours: loc.workingHours,
        timeZone: apptTz,
      })
      if (!whCheck.ok) throw new Error(`WH:${whCheck.error}`)

      const windowStart = addMinutes(requestedStart, -24 * 60)
      const windowEnd = addMinutes(requestedStart, 24 * 60)

      const existing = (await tx.booking.findMany({
        where: {
          professionalId: offering.professionalId,
          scheduledFor: { gte: windowStart, lte: windowEnd },
          NOT: { status: 'CANCELLED' },
        },
        select: {
          id: true,
          scheduledFor: true,
          totalDurationMinutes: true,
          durationMinutesSnapshot: true,
          bufferMinutes: true,
        },
        take: 2000,
      })) as ExistingBookingForConflict[]

      const hasConflict = existing.some((b) => {
        const bDur =
          Number(b.totalDurationMinutes ?? 0) > 0 ? Number(b.totalDurationMinutes) : Number(b.durationMinutesSnapshot ?? 0)
        const bBuf = Number(b.bufferMinutes ?? 0)

        if (!Number.isFinite(bDur) || bDur <= 0) return false

        const bStart = normalizeToMinute(new Date(b.scheduledFor))
        const bEnd = addMinutes(bStart, bDur + (Number.isFinite(bBuf) ? bBuf : 0))
        return overlaps(bStart, bEnd, requestedStart, requestedEnd)
      })

      if (hasConflict) throw new Error('TIME_NOT_AVAILABLE')

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
          rebookOfBookingId: rebookOfBookingIdForCreate,

          priceSnapshot: priceStartingAt,
          durationMinutesSnapshot: durationMinutes,

          subtotalSnapshot: priceStartingAt,
          totalDurationMinutes: durationMinutes,

          bufferMinutes,

          locationId: loc.id,
          locationTimeZone: apptTz,
          locationAddressSnapshot:
            hold.locationAddressSnapshot ??
            (loc.formattedAddress ? ({ formattedAddress: loc.formattedAddress } as any) : undefined),
          locationLatSnapshot: hold.locationLatSnapshot ?? (typeof loc.lat === 'number' ? loc.lat : undefined),
          locationLngSnapshot: hold.locationLngSnapshot ?? (typeof loc.lng === 'number' ? loc.lng : undefined),

          serviceItems: {
            create: [
              {
                serviceId: offering.serviceId,
                offeringId: offering.id,
                priceSnapshot: priceStartingAt,
                durationMinutesSnapshot: durationMinutes,
                sortOrder: 0,
              },
            ],
          },
        } as any,
        select: {
          id: true,
          status: true,
          scheduledFor: true,
          professionalId: true,
          serviceId: true,
          offeringId: true,
          source: true,
          locationType: true,
          subtotalSnapshot: true,
          totalDurationMinutes: true,
        },
      })

      if (openingId) {
        await tx.openingNotification.updateMany({
          where: { clientId, openingId, bookedAt: null },
          data: { bookedAt: new Date() },
        })
      }

      await tx.bookingHold.delete({ where: { id: hold.id } })

      void mediaId
      return created
    })

    return NextResponse.json({ ok: true, booking }, { status: 201 })
  } catch (e: any) {
    const msg = normalizeErr(e)

    if (msg === 'OPENING_NOT_AVAILABLE') return fail(409, 'OPENING_NOT_AVAILABLE', 'That opening was just taken. Please pick another slot.')
    if (msg === 'TIME_NOT_AVAILABLE') return fail(409, 'TIME_NOT_AVAILABLE', 'That time is no longer available. Please select a different slot.')
    if (msg === 'HOLD_NOT_FOUND') return fail(409, 'HOLD_NOT_FOUND', 'Hold not found. Please pick a slot again.')
    if (msg === 'HOLD_EXPIRED') return fail(409, 'HOLD_EXPIRED', 'Hold expired. Please pick a slot again.')
    if (msg === 'HOLD_MISMATCH') return fail(409, 'HOLD_MISMATCH', 'Hold mismatch. Please pick a slot again.')
    if (msg === 'HOLD_MISSING_LOCATION') return fail(409, 'HOLD_MISSING_LOCATION', 'Hold is missing location info. Please pick a slot again.')
    if (msg === 'LOCATION_NOT_FOUND') return fail(409, 'LOCATION_NOT_FOUND', 'This location is no longer available. Please pick another slot.')
    if (msg === 'TIME_IN_PAST') return fail(400, 'TIME_IN_PAST', 'Please select a future time.')
    if (msg.startsWith('WH:')) return fail(400, 'OUTSIDE_WORKING_HOURS', msg.slice(3) || 'That time is outside working hours.')

    console.error('POST /api/bookings error:', e)
    return fail(500, 'INTERNAL', 'Internal server error')
  }
}
