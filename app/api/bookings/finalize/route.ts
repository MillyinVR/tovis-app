// app/api/bookings/finalize/route.ts
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import type { BookingSource, ServiceLocationType } from '@prisma/client'
import { Prisma } from '@prisma/client'
import { isValidIanaTimeZone, sanitizeTimeZone, getZonedParts, minutesSinceMidnightInTimeZone } from '@/lib/timeZone'
import { requireClient } from '@/app/api/_utils/auth/requireClient'
import { pickString } from '@/app/api/_utils/pick'

export const dynamic = 'force-dynamic'

type FinalizeBookingBody = {
  offeringId?: unknown
  holdId?: unknown
  source?: unknown
  locationType?: unknown

  mediaId?: unknown
  openingId?: unknown
  aftercareToken?: unknown
  rebookOfBookingId?: unknown

  addOnIds?: unknown // OfferingAddOn.id[]
}

type ExistingBookingForConflict = {
  id: string
  scheduledFor: Date
  totalDurationMinutes: number
  bufferMinutes: number
  status: string
}

type HoldRow = {
  id: string
  offeringId: string
  professionalId: string
  clientId: string | null
  scheduledFor: Date
  expiresAt: Date
  locationType: ServiceLocationType

  locationId: string
  locationTimeZone: string | null
  locationAddressSnapshot: any | null
  locationLatSnapshot: number | null
  locationLngSnapshot: number | null
}

type WorkingHoursDay = { enabled?: boolean; start?: string; end?: string }
type WorkingHours = Record<string, WorkingHoursDay>

function sumDecimal(values: Prisma.Decimal[]) {
  return values.reduce((acc, v) => acc.add(v), new Prisma.Decimal(0))
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

function normalizeSourceLoose(args: { sourceRaw: unknown; mediaId: string | null; aftercareToken: string | null }): BookingSource {
  const s = typeof args.sourceRaw === 'string' ? args.sourceRaw.trim().toUpperCase() : ''

  if (s === 'AFTERCARE') return 'AFTERCARE'
  if (s === 'DISCOVERY') return 'DISCOVERY'
  if (s === 'REQUESTED') return 'REQUESTED'

  if (s === 'PROFILE') return 'REQUESTED'
  if (s === 'UNKNOWN') return 'REQUESTED'

  if (args.aftercareToken) return 'AFTERCARE'
  if (args.mediaId) return 'DISCOVERY'
  return 'REQUESTED'
}

function normalizeLocationTypeStrict(v: unknown): ServiceLocationType | null {
  const s = typeof v === 'string' ? v.trim().toUpperCase() : ''
  if (s === 'SALON') return 'SALON'
  if (s === 'MOBILE') return 'MOBILE'
  return null
}

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

function weekdayKeyInTimeZone(dateUtc: Date, timeZoneRaw: string): keyof WorkingHours {
  const timeZone = sanitizeTimeZone(timeZoneRaw, 'UTC')
  const weekday = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short' }).format(dateUtc).toLowerCase()

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
  const tz = sanitizeTimeZone(timeZone, 'UTC')

  if (!workingHours || typeof workingHours !== 'object') {
    return { ok: false, error: 'This professional has not set working hours yet.' }
  }

  const wh = workingHours as WorkingHours
  const dayKey = weekdayKeyInTimeZone(scheduledStartUtc, tz)
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

  const sParts = getZonedParts(scheduledStartUtc, tz)
  const eParts = getZonedParts(scheduledEndUtc, tz)
  const sameLocalDay = sParts.year === eParts.year && sParts.month === eParts.month && sParts.day === eParts.day
  if (!sameLocalDay) return { ok: false, error: 'That time is outside this professional’s working hours.' }

  const startMin = minutesSinceMidnightInTimeZone(scheduledStartUtc, tz)
  const endMin = minutesSinceMidnightInTimeZone(scheduledEndUtc, tz)

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
  return NextResponse.json(dev && details != null ? { ok: false, code, error, details } : { ok: false, code, error }, { status })
}

function pickStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  return v
    .map((x) => (typeof x === 'string' ? x.trim() : ''))
    .filter(Boolean)
    .slice(0, 10)
}

function requireApptTimeZone(args: { locationTimeZone: unknown; holdTimeZone: unknown }) {
  const loc = typeof args.locationTimeZone === 'string' ? args.locationTimeZone.trim() : ''
  if (loc && isValidIanaTimeZone(loc)) return { ok: true as const, timeZone: loc }

  const hold = typeof args.holdTimeZone === 'string' ? args.holdTimeZone.trim() : ''
  if (hold && isValidIanaTimeZone(hold)) return { ok: true as const, timeZone: hold }

  return {
    ok: false as const,
    error: 'This booking location is missing a valid timezone. Please ask the professional to set it before booking.',
  }
}

export async function POST(request: Request) {
  try {
    const auth = await requireClient()
    if (auth.res) return auth.res
    const { clientId } = auth

    const body = (await request.json().catch(() => ({}))) as FinalizeBookingBody

    const offeringId = pickString(body.offeringId)
    const holdId = pickString(body.holdId)

    const mediaId = pickString(body.mediaId)
    const openingId = pickString(body.openingId)
    const aftercareToken = pickString(body.aftercareToken)
    const requestedRebookOfBookingId = pickString(body.rebookOfBookingId)

    const addOnIds = pickStringArray(body.addOnIds)

    const source: BookingSource = normalizeSourceLoose({
      sourceRaw: body.source,
      mediaId,
      aftercareToken,
    })

    const locationType = normalizeLocationTypeStrict(body.locationType)
    if (!locationType) return fail(400, 'MISSING_LOCATION_TYPE', 'Missing locationType.')
    if (!offeringId) return fail(400, 'MISSING_OFFERING', 'Missing offeringId.')
    if (!holdId) return fail(409, 'HOLD_MISSING', 'Missing hold. Please pick a slot again.')

    if (source === 'DISCOVERY' && !mediaId) {
      return fail(400, 'MISSING_MEDIA_ID', 'Discovery bookings require a mediaId.')
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
        professional: { select: { autoAcceptBookings: true } },
      },
    })

    if (!offering || !offering.isActive) return fail(400, 'OFFERING_INACTIVE', 'Invalid or inactive offering.')

    if (locationType === 'SALON' && !offering.offersInSalon) return fail(400, 'MODE_NOT_SUPPORTED', 'This service is not offered in-salon.')
    if (locationType === 'MOBILE' && !offering.offersMobile) return fail(400, 'MODE_NOT_SUPPORTED', 'This service is not offered as mobile.')

    const priceStartingAt = locationType === 'MOBILE' ? offering.mobilePriceStartingAt : offering.salonPriceStartingAt
    const durationSnapshot = locationType === 'MOBILE' ? offering.mobileDurationMinutes : offering.salonDurationMinutes

    if (priceStartingAt == null) {
      return fail(400, 'PRICING_NOT_SET', `Pricing is not set for ${locationType === 'MOBILE' ? 'mobile' : 'salon'} bookings.`)
    }

    const durationMinutes = Number(durationSnapshot ?? 0)
    if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) return fail(400, 'INVALID_DURATION', 'Offering duration is invalid for this booking type.')

    const now = new Date()

    const autoAccept = Boolean(offering.professional?.autoAcceptBookings)
    const initialStatus = autoAccept ? 'ACCEPTED' : 'PENDING'

    // Aftercare validation
    let rebookOfBookingIdForCreate: string | null = null
    if (source === 'AFTERCARE') {
      if (!aftercareToken) return fail(400, 'AFTERCARE_TOKEN_MISSING', 'Missing aftercare token.')

      const aftercare = await prisma.aftercareSummary.findUnique({
        where: { publicToken: aftercareToken },
        select: {
          booking: {
            select: { id: true, status: true, clientId: true, professionalId: true, serviceId: true, offeringId: true },
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

      const tzRes = requireApptTimeZone({ locationTimeZone: loc.timeZone, holdTimeZone: hold.locationTimeZone })
      if (!tzRes.ok) throw new Error('TIMEZONE_REQUIRED')
      const apptTz = sanitizeTimeZone(tzRes.timeZone, 'UTC')

      const bufferMinutes = Math.max(0, Math.min(120, Number(loc.bufferMinutes ?? 0) || 0))

      const requestedStart = normalizeToMinute(new Date(hold.scheduledFor))
      const requestedEnd = addMinutes(requestedStart, durationMinutes)

      if (requestedStart.getTime() < addMinutes(new Date(), 5).getTime()) throw new Error('TIME_IN_PAST')

      const whCheck = ensureWithinWorkingHours({
        scheduledStartUtc: requestedStart,
        scheduledEndUtc: requestedEnd,
        workingHours: loc.workingHours,
        timeZone: apptTz,
      })
      if (!whCheck.ok) throw new Error(`WH:${whCheck.error}`)

      // Conflict check
      const windowStart = addMinutes(requestedStart, -24 * 60)
      const windowEnd = addMinutes(requestedStart, 24 * 60)

      const existing = (await tx.booking.findMany({
        where: {
          professionalId: offering.professionalId,
          scheduledFor: { gte: windowStart, lte: windowEnd },
          NOT: { status: 'CANCELLED' },
        },
        select: { id: true, scheduledFor: true, totalDurationMinutes: true, bufferMinutes: true, status: true },
        take: 2000,
      })) as ExistingBookingForConflict[]

      const hasConflict = existing.some((b) => {
        if (String(b.status ?? '').toUpperCase() === 'CANCELLED') return false
        const bDur = Number(b.totalDurationMinutes ?? 0)
        const bBuf = Number(b.bufferMinutes ?? 0)
        if (!Number.isFinite(bDur) || bDur <= 0) return false

        const bStart = normalizeToMinute(new Date(b.scheduledFor))
        const bEnd = addMinutes(bStart, bDur + (Number.isFinite(bBuf) ? bBuf : 0))
        return overlaps(bStart, bEnd, requestedStart, requestedEnd)
      })

      if (hasConflict) throw new Error('TIME_NOT_AVAILABLE')

      // Opening claim (optional)
      if (openingId) {
        const activeOpening = await tx.lastMinuteOpening.findFirst({
          where: { id: openingId, status: 'ACTIVE' },
          select: { id: true, startAt: true, professionalId: true, offeringId: true, serviceId: true },
        })

        if (!activeOpening) throw new Error('OPENING_NOT_AVAILABLE')
        if (activeOpening.professionalId !== offering.professionalId) throw new Error('OPENING_NOT_AVAILABLE')
        if (activeOpening.offeringId && activeOpening.offeringId !== offering.id) throw new Error('OPENING_NOT_AVAILABLE')
        if (activeOpening.serviceId && activeOpening.serviceId !== offering.serviceId) throw new Error('OPENING_NOT_AVAILABLE')
        if (normalizeToMinute(new Date(activeOpening.startAt)).getTime() !== requestedStart.getTime()) throw new Error('OPENING_NOT_AVAILABLE')

        const updated = await tx.lastMinuteOpening.updateMany({
          where: { id: openingId, status: 'ACTIVE' },
          data: { status: 'BOOKED' },
        })
        if (updated.count !== 1) throw new Error('OPENING_NOT_AVAILABLE')
      }

      // ✅ ADD-ONS: validate + resolve price/duration
      const addOnLinks = addOnIds.length
        ? await tx.offeringAddOn.findMany({
            where: {
              id: { in: addOnIds },
              offeringId: offering.id,
              isActive: true,
              OR: [{ locationType: null }, { locationType }],
              addOnService: { isActive: true, isAddOnEligible: true },
            },
            include: {
              addOnService: {
                select: {
                  id: true,
                  defaultDurationMinutes: true,
                  minPrice: true,
                },
              },
            },
            take: 50,
          })
        : []

      if (addOnIds.length && addOnLinks.length !== addOnIds.length) {
        throw new Error('ADDONS_INVALID')
      }

      const addOnServiceIds = addOnLinks.map((x) => x.addOnServiceId)

      const proAddOnOfferings = addOnServiceIds.length
        ? await tx.professionalServiceOffering.findMany({
            where: {
              professionalId: offering.professionalId,
              isActive: true,
              serviceId: { in: addOnServiceIds },
            },
            select: {
              serviceId: true,
              salonPriceStartingAt: true,
              salonDurationMinutes: true,
              mobilePriceStartingAt: true,
              mobileDurationMinutes: true,
            },
            take: 200,
          })
        : []

      const byServiceId = new Map(proAddOnOfferings.map((o) => [o.serviceId, o]))

      const resolvedAddOns = addOnLinks.map((x) => {
        const svc = x.addOnService
        const proOff = byServiceId.get(svc.id) || null

        const dur =
          x.durationOverrideMinutes ??
          (locationType === 'MOBILE' ? proOff?.mobileDurationMinutes : proOff?.salonDurationMinutes) ??
          svc.defaultDurationMinutes ??
          0

        const price =
          x.priceOverride ??
          (locationType === 'MOBILE' ? proOff?.mobilePriceStartingAt : proOff?.salonPriceStartingAt) ??
          svc.minPrice

        return {
          addOnId: x.id,
          serviceId: svc.id,
          priceSnapshot: price,
          durationMinutesSnapshot: Number(dur) || 0,
          sortOrder: x.sortOrder ?? 0,
        }
      })

      for (const a of resolvedAddOns) {
        if (!Number.isFinite(a.durationMinutesSnapshot) || a.durationMinutesSnapshot <= 0) throw new Error('ADDONS_INVALID')
        if (!a.priceSnapshot) throw new Error('ADDONS_INVALID')
      }

      const addOnsPriceTotal = sumDecimal(
        resolvedAddOns.map((a) => (a.priceSnapshot as unknown as Prisma.Decimal)),
      )
      const addOnsDurationTotal = resolvedAddOns.reduce((sum, a) => sum + a.durationMinutesSnapshot, 0)

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

          subtotalSnapshot: (priceStartingAt as any).add(addOnsPriceTotal),
          totalDurationMinutes: durationMinutes + addOnsDurationTotal,
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
              // base service
              {
                serviceId: offering.serviceId,
                offeringId: offering.id,
                priceSnapshot: priceStartingAt,
                durationMinutesSnapshot: durationMinutes,
                sortOrder: 0,
              },

              // add-ons
              ...resolvedAddOns.map((a) => ({
                serviceId: a.serviceId,
                offeringId: null,
                priceSnapshot: a.priceSnapshot,
                durationMinutesSnapshot: a.durationMinutesSnapshot,
                sortOrder: 100 + a.sortOrder,
                notes: `ADDON:${a.addOnId}`,
              })),
            ],
          },
        },
        select: { id: true, status: true },
      })

      void mediaId // still unused for now

      await tx.bookingHold.delete({ where: { id: hold.id } })

      return created
    })

    return NextResponse.json({ ok: true, booking }, { status: 201 })
  } catch (e: any) {
    const msg = normalizeErr(e)

    if (msg === 'ADDONS_INVALID')
      return fail(400, 'ADDONS_INVALID', 'One or more add-ons are invalid for this booking.')

    if (msg === 'TIMEZONE_REQUIRED')
      return fail(400, 'TIMEZONE_REQUIRED', 'This professional must set a valid timezone before taking bookings.')
    if (msg === 'OPENING_NOT_AVAILABLE')
      return fail(409, 'OPENING_NOT_AVAILABLE', 'That opening was just taken. Please pick another slot.')
    if (msg === 'TIME_NOT_AVAILABLE')
      return fail(409, 'TIME_NOT_AVAILABLE', 'That time is no longer available. Please select a different slot.')
    if (msg === 'HOLD_NOT_FOUND') return fail(409, 'HOLD_NOT_FOUND', 'Hold not found. Please pick a slot again.')
    if (msg === 'HOLD_EXPIRED') return fail(409, 'HOLD_EXPIRED', 'Hold expired. Please pick a slot again.')
    if (msg === 'HOLD_MISMATCH') return fail(409, 'HOLD_MISMATCH', 'Hold mismatch. Please pick a slot again.')
    if (msg === 'HOLD_MISSING_LOCATION')
      return fail(409, 'HOLD_MISSING_LOCATION', 'Hold is missing location info. Please pick a slot again.')
    if (msg === 'LOCATION_NOT_FOUND')
      return fail(409, 'LOCATION_NOT_FOUND', 'This location is no longer available. Please pick another slot.')
    if (msg === 'TIME_IN_PAST') return fail(400, 'TIME_IN_PAST', 'Please select a future time.')
    if (msg.startsWith('WH:')) return fail(400, 'OUTSIDE_WORKING_HOURS', msg.slice(3) || 'That time is outside working hours.')

    console.error('POST /api/bookings/finalize error:', e)
    return fail(500, 'INTERNAL', 'Internal server error')
  }
}
