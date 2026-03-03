// app/api/bookings/finalize/route.ts
import { prisma } from '@/lib/prisma'
import {
  Prisma,
  NotificationType,
  BookingStatus,
  BookingServiceItemType,
  OpeningStatus,
  type BookingSource,
  type ServiceLocationType,
} from '@prisma/client'
import { sanitizeTimeZone, getZonedParts, minutesSinceMidnightInTimeZone, isValidIanaTimeZone } from '@/lib/timeZone'
import { requireClient } from '@/app/api/_utils/auth/requireClient'
import { pickString } from '@/app/api/_utils/pick'
import { jsonFail, jsonOk } from '@/app/api/_utils/responses'
import { createProNotification } from '@/lib/notifications/proNotifications'
import { resolveApptTimeZone } from '@/lib/booking/timeZoneTruth'
import { isRecord } from '@/lib/guards'

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

type WorkingHoursDay = { enabled?: boolean; start?: string; end?: string }
type WorkingHours = Record<string, WorkingHoursDay>

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

function upper(v: unknown) {
  return typeof v === 'string' ? v.trim().toUpperCase() : ''
}

function clampInt(n: number, min: number, max: number) {
  const x = Math.trunc(n)
  return Math.min(Math.max(x, min), max)
}

function normalizeSourceLoose(args: { sourceRaw: unknown; mediaId: string | null; aftercareToken: string | null }): BookingSource {
  const s = upper(args.sourceRaw)

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
  const s = upper(v)
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
  const tz = sanitizeTimeZone(timeZoneRaw, 'UTC') || 'UTC'
  const weekday = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' })
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

function ensureWithinWorkingHours(args: {
  scheduledStartUtc: Date
  scheduledEndUtc: Date
  workingHours: unknown
  timeZone: string
}): { ok: true } | { ok: false; error: string } {
  const { scheduledStartUtc, scheduledEndUtc, workingHours, timeZone } = args
  const tz = sanitizeTimeZone(timeZone, 'UTC') || 'UTC'

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

function pickStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  return v
    .map((x) => (typeof x === 'string' ? x.trim() : ''))
    .filter(Boolean)
    .slice(0, 25)
}

function decimalToNumber(v: unknown): number | undefined {
  if (v == null) return undefined
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined
  const maybe = v as { toString?: () => string }
  const s = typeof maybe?.toString === 'function' ? maybe.toString() : ''
  const n = Number(s)
  return Number.isFinite(n) ? n : undefined
}

function decimalFromUnknown(v: unknown): Prisma.Decimal {
  if (v instanceof Prisma.Decimal) return v
  if (typeof v === 'number' && Number.isFinite(v)) return new Prisma.Decimal(String(v))
  if (typeof v === 'string' && v.trim()) return new Prisma.Decimal(v.trim())
  if (v && typeof v === 'object' && typeof (v as { toString?: unknown }).toString === 'function') {
    return new Prisma.Decimal(String((v as { toString: () => string }).toString()))
  }
  return new Prisma.Decimal('0')
}

export async function POST(request: Request) {
  try {
    const auth = await requireClient()
    if (!auth.ok) return auth.res
    const { clientId, user } = auth

    const rawBody: unknown = await request.json().catch(() => ({}))
    const body = (isRecord(rawBody) ? rawBody : {}) as FinalizeBookingBody

    const offeringId = pickString(body.offeringId)
    const holdId = pickString(body.holdId)

    const mediaId = pickString(body.mediaId)
    const openingId = pickString(body.openingId)
    const aftercareToken = pickString(body.aftercareToken)
    const requestedRebookOfBookingId = pickString(body.rebookOfBookingId)

    const addOnIds = pickStringArray(body.addOnIds)

    const source: BookingSource = normalizeSourceLoose({ sourceRaw: body.source, mediaId, aftercareToken })

    const locationType = normalizeLocationTypeStrict(body.locationType)
    if (!locationType) return jsonFail(400, 'Missing locationType.', { code: 'MISSING_LOCATION_TYPE' })
    if (!offeringId) return jsonFail(400, 'Missing offeringId.', { code: 'MISSING_OFFERING' })
    if (!holdId) return jsonFail(409, 'Missing hold. Please pick a slot again.', { code: 'HOLD_MISSING' })

    if (source === 'DISCOVERY' && !mediaId) {
      return jsonFail(400, 'Discovery bookings require a mediaId.', { code: 'MISSING_MEDIA_ID' })
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

    if (!offering || !offering.isActive) {
      return jsonFail(400, 'Invalid or inactive offering.', { code: 'OFFERING_INACTIVE' })
    }
    if (locationType === 'SALON' && !offering.offersInSalon) {
      return jsonFail(400, 'This service is not offered in-salon.', { code: 'MODE_NOT_SUPPORTED' })
    }
    if (locationType === 'MOBILE' && !offering.offersMobile) {
      return jsonFail(400, 'This service is not offered as mobile.', { code: 'MODE_NOT_SUPPORTED' })
    }

    const priceStartingAt = locationType === 'MOBILE' ? offering.mobilePriceStartingAt : offering.salonPriceStartingAt
    const durationSnapshot = locationType === 'MOBILE' ? offering.mobileDurationMinutes : offering.salonDurationMinutes

    if (priceStartingAt == null) {
      return jsonFail(
        400,
        `Pricing is not set for ${locationType === 'MOBILE' ? 'mobile' : 'salon'} bookings.`,
        { code: 'PRICING_NOT_SET' },
      )
    }

    const baseDurationMinutes = Number(durationSnapshot ?? 0)
    if (!Number.isFinite(baseDurationMinutes) || baseDurationMinutes <= 0) {
      return jsonFail(400, 'Offering duration is invalid for this booking type.', { code: 'INVALID_DURATION' })
    }

    const now = new Date()
    const autoAccept = Boolean(offering.professional?.autoAcceptBookings)
    const initialStatus = autoAccept ? BookingStatus.ACCEPTED : BookingStatus.PENDING

    let rebookOfBookingIdForCreate: string | null = null
    if (source === 'AFTERCARE') {
      if (!aftercareToken) return jsonFail(400, 'Missing aftercare token.', { code: 'AFTERCARE_TOKEN_MISSING' })

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

      if (!aftercare?.booking) return jsonFail(400, 'Invalid aftercare token.', { code: 'AFTERCARE_TOKEN_INVALID' })

      const original = aftercare.booking
      if (original.status !== BookingStatus.COMPLETED) {
        return jsonFail(409, 'Only COMPLETED bookings can be rebooked.', { code: 'AFTERCARE_NOT_COMPLETED' })
      }
      if (original.clientId !== clientId) {
        return jsonFail(403, 'Aftercare link does not match this client.', { code: 'AFTERCARE_CLIENT_MISMATCH' })
      }

      const matchesOffering =
        (original.offeringId && original.offeringId === offering.id) ||
        (original.professionalId === offering.professionalId && original.serviceId === offering.serviceId)

      if (!matchesOffering) {
        return jsonFail(403, 'Aftercare link does not match this offering.', { code: 'AFTERCARE_OFFERING_MISMATCH' })
      }

      rebookOfBookingIdForCreate =
        requestedRebookOfBookingId && requestedRebookOfBookingId === original.id ? requestedRebookOfBookingId : original.id
    }

    const booking = await prisma.$transaction(async (tx) => {
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
          locationId: true,
          locationTimeZone: true,
          locationAddressSnapshot: true,
          locationLatSnapshot: true,
          locationLngSnapshot: true,
        },
      })

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
          stepMinutes: true,
          advanceNoticeMinutes: true,
          maxDaysAhead: true,
          formattedAddress: true,
          lat: true,
          lng: true,
        },
      })
      if (!loc) throw new Error('LOCATION_NOT_FOUND')

      const tzResult = await resolveApptTimeZone({
        holdLocationTimeZone: hold.locationTimeZone,
        location: { id: loc.id, timeZone: loc.timeZone },
        professionalId: offering.professionalId,
        fallback: 'UTC',
        requireValid: true,
      })
      if (!tzResult.ok) throw new Error('TIMEZONE_REQUIRED')

      const apptTz = sanitizeTimeZone(tzResult.timeZone, 'UTC') || 'UTC'
      const tzOk = isValidIanaTimeZone(apptTz)
      if (!tzOk) throw new Error('TIMEZONE_REQUIRED')

      const bufferMinutes = clampInt(Number(loc.bufferMinutes ?? 0) || 0, 0, 180)
      const stepMinutes = clampInt(Number(loc.stepMinutes ?? 15) || 15, 5, 60)
      const advanceNoticeMinutes = clampInt(Number(loc.advanceNoticeMinutes ?? 15) || 15, 0, 24 * 60)
      const maxDaysAhead = clampInt(Number(loc.maxDaysAhead ?? 365) || 365, 1, 3650)

      const requestedStart = normalizeToMinute(new Date(hold.scheduledFor))
      if (!Number.isFinite(requestedStart.getTime())) throw new Error('TIME_IN_PAST')

      // Lead time + max-ahead gates (client must obey)
      if (requestedStart.getTime() < now.getTime() + advanceNoticeMinutes * 60_000) throw new Error('TIME_IN_PAST')
      if (requestedStart.getTime() > now.getTime() + maxDaysAhead * 24 * 60 * 60_000) throw new Error('TOO_FAR')

      // Step alignment gate (client must obey)
      const startMin = minutesSinceMidnightInTimeZone(requestedStart, apptTz)
      if (startMin % stepMinutes !== 0) throw new Error(`STEP:${stepMinutes}`)

      // Optional last-minute opening claim (race-safe)
      if (openingId) {
        const activeOpening = await tx.lastMinuteOpening.findFirst({
          where: { id: openingId, status: OpeningStatus.ACTIVE },
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
          where: { id: openingId, status: OpeningStatus.ACTIVE },
          data: { status: OpeningStatus.BOOKED },
        })
        if (updated.count !== 1) throw new Error('OPENING_NOT_AVAILABLE')
      }

      const addOnLinks = addOnIds.length
        ? await tx.offeringAddOn.findMany({
            where: {
              id: { in: addOnIds },
              offeringId: offering.id,
              isActive: true,
              OR: [{ locationType: null }, { locationType }],
              addOnService: { isActive: true, isAddOnEligible: true },
            },
            select: {
              id: true,
              addOnServiceId: true,
              sortOrder: true,
              priceOverride: true,
              durationOverrideMinutes: true,
              addOnService: { select: { id: true, defaultDurationMinutes: true, minPrice: true } },
            },
            take: 50,
          })
        : []

      if (addOnIds.length && addOnLinks.length !== addOnIds.length) throw new Error('ADDONS_INVALID')

      const addOnServiceIds = addOnLinks.map((x) => x.addOnServiceId)

      const proAddOnOfferings = addOnServiceIds.length
        ? await tx.professionalServiceOffering.findMany({
            where: { professionalId: offering.professionalId, isActive: true, serviceId: { in: addOnServiceIds } },
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
          offeringAddOnId: x.id,
          serviceId: svc.id,
          durationMinutesSnapshot: Number(dur) || 0,
          priceSnapshot: decimalFromUnknown(price),
          sortOrder: x.sortOrder ?? 0,
        }
      })

      for (const a of resolvedAddOns) {
        if (!Number.isFinite(a.durationMinutesSnapshot) || a.durationMinutesSnapshot <= 0) throw new Error('ADDONS_INVALID')
      }

      const basePrice = decimalFromUnknown(priceStartingAt)
      const addOnsPriceTotal = resolvedAddOns.reduce((acc, a) => acc.add(a.priceSnapshot), new Prisma.Decimal(0))
      const subtotal = basePrice.add(addOnsPriceTotal)

      const addOnsDurationTotal = resolvedAddOns.reduce((sum, a) => sum + a.durationMinutesSnapshot, 0)
      const totalDurationMinutes = baseDurationMinutes + addOnsDurationTotal

      // ✅ IMPORTANT: include buffer in the reserved window (WH + conflicts)
      const requestedEnd = addMinutes(requestedStart, totalDurationMinutes + bufferMinutes)

      const whCheck = ensureWithinWorkingHours({
        scheduledStartUtc: requestedStart,
        scheduledEndUtc: requestedEnd,
        workingHours: loc.workingHours,
        timeZone: apptTz,
      })
      if (!whCheck.ok) throw new Error(`WH:${whCheck.error}`)

      // Blocks (location-specific OR global)
      const blockConflict = await tx.calendarBlock.findFirst({
        where: {
          professionalId: offering.professionalId,
          startsAt: { lt: requestedEnd },
          endsAt: { gt: requestedStart },
          OR: [{ locationId: loc.id }, { locationId: null }],
        },
        select: { id: true },
      })
      if (blockConflict) throw new Error('BLOCKED')

      // Tight overlap window so we don’t miss conflicts due to query limits
      const MAX_OTHER_OVERLAP_MINUTES = 12 * 60 + 180
      const earliestStart = addMinutes(requestedStart, -MAX_OTHER_OVERLAP_MINUTES)

      // Bookings (location-scoped)
      const existingBookings = await tx.booking.findMany({
        where: {
          professionalId: offering.professionalId,
          locationId: loc.id,
          scheduledFor: { gte: earliestStart, lt: requestedEnd },
          NOT: { status: BookingStatus.CANCELLED },
        },
        select: { scheduledFor: true, totalDurationMinutes: true, bufferMinutes: true, status: true },
        take: 2000,
      })

      const hasBookingConflict = existingBookings.some((b) => {
        if (b.status === BookingStatus.CANCELLED) return false
        const bStart = normalizeToMinute(new Date(b.scheduledFor))
        const bDur = Number(b.totalDurationMinutes ?? 0) > 0 ? Number(b.totalDurationMinutes) : 60
        const bBuf = Math.max(0, Number(b.bufferMinutes ?? 0))
        const bEnd = addMinutes(bStart, bDur + bBuf)
        return overlaps(bStart, bEnd, requestedStart, requestedEnd)
      })
      if (hasBookingConflict) throw new Error('TIME_NOT_AVAILABLE')

      // Holds (overlap-aware)
      const otherHolds = await tx.bookingHold.findMany({
        where: {
          professionalId: offering.professionalId,
          locationId: loc.id,
          expiresAt: { gt: now },
          scheduledFor: { gte: earliestStart, lt: requestedEnd },
        },
        select: { id: true, scheduledFor: true, offeringId: true },
        take: 2000,
      })

      if (otherHolds.length) {
        const offeringIds = Array.from(new Set(otherHolds.map((h) => h.offeringId))).slice(0, 2000)
        const offerRows = await tx.professionalServiceOffering.findMany({
          where: { id: { in: offeringIds } },
          select: { id: true, salonDurationMinutes: true, mobileDurationMinutes: true },
          take: 2000,
        })
        const byId = new Map(offerRows.map((o) => [o.id, o]))

        const hasHoldConflict = otherHolds.some((h) => {
          if (h.id === hold.id) return false
          const o = byId.get(h.offeringId)
          const durRaw = locationType === 'MOBILE' ? o?.mobileDurationMinutes : o?.salonDurationMinutes
          const hDur = Number(durRaw ?? 0) > 0 ? Number(durRaw) : 60
          const hStart = normalizeToMinute(new Date(h.scheduledFor))
          const hEnd = addMinutes(hStart, hDur + bufferMinutes)
          return overlaps(hStart, hEnd, requestedStart, requestedEnd)
        })

        if (hasHoldConflict) throw new Error('TIME_NOT_AVAILABLE')
      }

      const addressSnapshot: Prisma.InputJsonValue | undefined =
        hold.locationAddressSnapshot ??
        (loc.formattedAddress && loc.formattedAddress.trim()
          ? ({ formattedAddress: loc.formattedAddress.trim() } satisfies Prisma.InputJsonObject)
          : undefined)

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

          subtotalSnapshot: subtotal,
          totalDurationMinutes,
          bufferMinutes,

          locationId: loc.id,
          locationTimeZone: apptTz,
          locationAddressSnapshot: addressSnapshot,
          locationLatSnapshot: hold.locationLatSnapshot ?? decimalToNumber(loc.lat),
          locationLngSnapshot: hold.locationLngSnapshot ?? decimalToNumber(loc.lng),
        },
        select: { id: true, status: true, scheduledFor: true, professionalId: true },
      })

      const baseItem = await tx.bookingServiceItem.create({
        data: {
          bookingId: created.id,
          serviceId: offering.serviceId,
          offeringId: offering.id,
          itemType: BookingServiceItemType.BASE,
          priceSnapshot: basePrice,
          durationMinutesSnapshot: baseDurationMinutes,
          sortOrder: 0,
        },
        select: { id: true },
      })

      if (resolvedAddOns.length) {
        await tx.bookingServiceItem.createMany({
          data: resolvedAddOns.map((a) => ({
            bookingId: created.id,
            serviceId: a.serviceId,
            offeringId: null,
            itemType: BookingServiceItemType.ADD_ON,
            parentItemId: baseItem.id,
            priceSnapshot: a.priceSnapshot,
            durationMinutesSnapshot: a.durationMinutesSnapshot,
            sortOrder: 100 + a.sortOrder,
            notes: `ADDON:${a.offeringAddOnId}`,
          })),
        })
      }

      if (openingId) {
        await tx.openingNotification.updateMany({
          where: { clientId, openingId, bookedAt: null },
          data: { bookedAt: new Date() },
        })
      }

      await tx.bookingHold.delete({ where: { id: hold.id } })
      return created
    })

    const notifType =
      booking.status === BookingStatus.PENDING ? NotificationType.BOOKING_REQUEST : NotificationType.BOOKING_UPDATE

    await createProNotification({
      professionalId: booking.professionalId,
      type: notifType,
      title: notifType === NotificationType.BOOKING_REQUEST ? 'New booking request' : 'New booking confirmed',
      body: '',
      href: `/pro/bookings/${booking.id}`,
      actorUserId: user.id,
      bookingId: booking.id,
      dedupeKey: `PRO_NOTIF:${String(notifType)}:${booking.id}`,
    })

    return jsonOk({ booking }, 201)
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : ''

    if (msg === 'ADDONS_INVALID') return jsonFail(400, 'One or more add-ons are invalid for this booking.', { code: 'ADDONS_INVALID' })
    if (msg === 'TIMEZONE_REQUIRED') return jsonFail(400, 'This professional must set a valid timezone before taking bookings.', { code: 'TIMEZONE_REQUIRED' })
    if (msg === 'OPENING_NOT_AVAILABLE') return jsonFail(409, 'That opening was just taken. Please pick another slot.', { code: 'OPENING_NOT_AVAILABLE' })
    if (msg === 'TIME_NOT_AVAILABLE') return jsonFail(409, 'That time is no longer available. Please select a different slot.', { code: 'TIME_NOT_AVAILABLE' })
    if (msg === 'BLOCKED') return jsonFail(409, 'That time is blocked. Please select a different slot.', { code: 'BLOCKED' })
    if (msg === 'HOLD_NOT_FOUND') return jsonFail(409, 'Hold not found. Please pick a slot again.', { code: 'HOLD_NOT_FOUND' })
    if (msg === 'HOLD_EXPIRED') return jsonFail(409, 'Hold expired. Please pick a slot again.', { code: 'HOLD_EXPIRED' })
    if (msg === 'HOLD_MISMATCH') return jsonFail(409, 'Hold mismatch. Please pick a slot again.', { code: 'HOLD_MISMATCH' })
    if (msg === 'HOLD_MISSING_LOCATION') return jsonFail(409, 'Hold is missing location info. Please pick a slot again.', { code: 'HOLD_MISSING_LOCATION' })
    if (msg === 'LOCATION_NOT_FOUND') return jsonFail(409, 'This location is no longer available. Please pick another slot.', { code: 'LOCATION_NOT_FOUND' })
    if (msg === 'TIME_IN_PAST') return jsonFail(400, 'Please select a future time.', { code: 'TIME_IN_PAST' })
    if (msg === 'TOO_FAR') return jsonFail(400, 'That date is too far in the future.', { code: 'TOO_FAR' })
    if (msg.startsWith('STEP:')) return jsonFail(400, `Start time must be on a ${msg.slice(5)}-minute boundary.`, { code: 'STEP' })
    if (msg.startsWith('WH:')) return jsonFail(400, msg.slice(3) || 'That time is outside working hours.', { code: 'OUTSIDE_WORKING_HOURS' })

    console.error('POST /api/bookings/finalize error:', e)
    return jsonFail(500, 'Internal server error', { code: 'INTERNAL' })
  }
}