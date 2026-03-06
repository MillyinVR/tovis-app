// app/api/pro/bookings/[id]/route.ts
import { prisma } from '@/lib/prisma'
import { jsonFail, jsonOk, pickBool, pickEnum, pickInt, pickIsoDate, pickString, requirePro } from '@/app/api/_utils'
import {
  BookingStatus,
  ClientNotificationType,
  Prisma,
  ProfessionalLocationType,
  ServiceLocationType,
} from '@prisma/client'
import { getZonedParts, isValidIanaTimeZone, minutesSinceMidnightInTimeZone, sanitizeTimeZone } from '@/lib/timeZone'
import { resolveApptTimeZone } from '@/lib/booking/timeZoneTruth'
import { moneyToFixed2String } from '@/lib/money'
import { isRecord } from '@/lib/guards'
import { getWorkingWindowForDay } from '@/lib/scheduling/workingHours'

export const dynamic = 'force-dynamic'

type Ctx = { params: { id: string } | Promise<{ id: string }> }

const MAX_SLOT_DURATION_MINUTES = 12 * 60
const MAX_BOOKING_BUFFER_MINUTES = 180
const MAX_OTHER_OVERLAP_MINUTES = MAX_SLOT_DURATION_MINUTES + MAX_BOOKING_BUFFER_MINUTES

function normalizeToMinute(d: Date) {
  const x = new Date(d)
  x.setSeconds(0, 0)
  return x
}

function addMinutes(date: Date, minutes: number) {
  return new Date(date.getTime() + minutes * 60_000)
}

/** existingStart < requestedEnd AND existingEnd > requestedStart */
function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date) {
  return aStart < bEnd && aEnd > bStart
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n))
}

function snapToStep(n: number, stepMinutes: number) {
  const step = clamp(Math.trunc(stepMinutes || 15), 5, 60)
  return Math.round(n / step) * step
}

/**
 * Money helpers (cents-based)
 */
function moneyStringToCents(raw: string): number {
  const cleaned = raw.replace(/\$/g, '').replace(/,/g, '').trim()
  if (!cleaned) return 0
  const m = /^(\d+)(?:\.(\d{0,}))?$/.exec(cleaned)
  if (!m) return 0
  const whole = m[1] || '0'
  let frac = (m[2] || '').slice(0, 2)
  while (frac.length < 2) frac += '0'
  const cents = Number(whole) * 100 + Number(frac || '0')
  return Number.isFinite(cents) ? Math.max(0, cents) : 0
}

function moneyToCents(v: unknown): number {
  if (v == null) return 0
  if (typeof v === 'number') return Number.isFinite(v) ? Math.max(0, Math.round(v * 100)) : 0
  if (typeof v === 'string') return moneyStringToCents(v)
  const maybe = v as { toString?: () => string }
  const s = typeof maybe?.toString === 'function' ? maybe.toString() : ''
  return typeof s === 'string' ? moneyStringToCents(s) : 0
}

function centsToDecimal(cents: number) {
  const c = Math.max(0, Math.trunc(cents))
  const dollars = Math.trunc(c / 100)
  const rem = c % 100
  return new Prisma.Decimal(`${dollars}.${String(rem).padStart(2, '0')}`)
}

/* ---------------------------------------------
   Working-hours enforcement (LOCATION truth)
   --------------------------------------------- */

function ensureWithinWorkingHours(args: {
  scheduledStartUtc: Date
  scheduledEndUtc: Date
  workingHours: unknown
  timeZone: string
}): { ok: true } | { ok: false; error: string } {
  const { scheduledStartUtc, scheduledEndUtc, workingHours, timeZone } = args

  if (!isRecord(workingHours)) {
    return { ok: false, error: 'Working hours are not set yet.' }
  }

  const tz = sanitizeTimeZone(timeZone, 'UTC') || 'UTC'

  const sParts = getZonedParts(scheduledStartUtc, tz)
  const eParts = getZonedParts(scheduledEndUtc, tz)
  const sameLocalDay = sParts.year === eParts.year && sParts.month === eParts.month && sParts.day === eParts.day
  if (!sameLocalDay) {
    return { ok: false, error: 'That time is outside your working hours.' }
  }

  const window = getWorkingWindowForDay(scheduledStartUtc, workingHours, tz)
  if (!window.ok) {
    if (window.reason === 'MISSING') {
      return { ok: false, error: 'Working hours are not set yet.' }
    }
    if (window.reason === 'DISABLED') {
      return { ok: false, error: 'That time is outside your working hours.' }
    }
    return { ok: false, error: 'Your working hours are misconfigured.' }
  }

  const startMin = minutesSinceMidnightInTimeZone(scheduledStartUtc, tz)
  const endMin = minutesSinceMidnightInTimeZone(scheduledEndUtc, tz)

  if (startMin < window.startMinutes || endMin > window.endMinutes) {
    return { ok: false, error: 'That time is outside your working hours.' }
  }

  return { ok: true }
}

/* ---------------------------------------------
   Client notification helper
   --------------------------------------------- */

async function createClientNotification(args: {
  tx: Prisma.TransactionClient
  clientId: string
  bookingId: string
  type: ClientNotificationType
  title: string
  body: string
  dedupeKey: string
}) {
  const { tx, clientId, bookingId, type, title, body, dedupeKey } = args
  await tx.clientNotification.create({
    data: { clientId, bookingId, type, title, body, dedupeKey },
  })
}

/* ---------------------------------------------
   GET
   --------------------------------------------- */

export async function GET(_req: Request, ctx: Ctx) {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res
    const professionalId = auth.professionalId

    const params = await Promise.resolve(ctx.params)
    const bookingId = pickString(params?.id)
    if (!bookingId) return jsonFail(400, 'Missing booking id.')

    const booking = await prisma.booking.findFirst({
      where: { id: bookingId, professionalId },
      select: {
        id: true,
        status: true,
        scheduledFor: true,
        locationType: true,
        bufferMinutes: true,
        totalDurationMinutes: true,
        subtotalSnapshot: true,
        clientId: true,
        locationId: true,
        locationTimeZone: true,
        serviceItems: {
          orderBy: { sortOrder: 'asc' },
          select: {
            id: true,
            serviceId: true,
            offeringId: true,
            priceSnapshot: true,
            durationMinutesSnapshot: true,
            sortOrder: true,
            service: { select: { id: true, name: true } },
          },
        },
        client: {
          select: {
            firstName: true,
            lastName: true,
            phone: true,
            user: { select: { email: true } },
          },
        },
        professional: { select: { timeZone: true } },
      },
    })

    if (!booking) return jsonFail(404, 'Booking not found.')

    const start = normalizeToMinute(new Date(booking.scheduledFor))
    if (!Number.isFinite(start.getTime())) return jsonFail(500, 'Booking has an invalid scheduled time.')

    const items = booking.serviceItems || []
    const computedDuration = items.reduce((sum, i) => sum + Number(i.durationMinutesSnapshot ?? 0), 0)
    const computedSubtotalCents = items.reduce((sum, i) => sum + moneyToCents(i.priceSnapshot), 0)

    const durationMinutes =
      Number(booking.totalDurationMinutes ?? 0) > 0
        ? Number(booking.totalDurationMinutes)
        : computedDuration > 0
          ? computedDuration
          : 60

    const bufferMinutes = Math.max(0, Number(booking.bufferMinutes ?? 0))
    const endsAt = addMinutes(start, durationMinutes + bufferMinutes)

    const fn = booking.client?.firstName?.trim() || ''
    const ln = booking.client?.lastName?.trim() || ''
    const fullName = fn || ln ? `${fn} ${ln}`.trim() : booking.client?.user?.email || 'Client'

    const tzRes = await resolveApptTimeZone({
      bookingLocationTimeZone: booking.locationTimeZone,
      locationId: booking.locationId ?? null,
      professionalId,
      professionalTimeZone: booking.professional?.timeZone,
      fallback: 'UTC',
    })
    const tz = tzRes.ok ? tzRes.timeZone : 'UTC'

    return jsonOk(
      {
        booking: {
          id: booking.id,
          status: booking.status,
          scheduledFor: start.toISOString(),
          endsAt: endsAt.toISOString(),
          locationType: booking.locationType,
          bufferMinutes,
          durationMinutes,
          totalDurationMinutes: durationMinutes,
          subtotalSnapshot: moneyToFixed2String(booking.subtotalSnapshot ?? centsToDecimal(computedSubtotalCents)),
          client: { fullName, email: booking.client?.user?.email ?? null, phone: booking.client?.phone ?? null },
          timeZone: isValidIanaTimeZone(tz) ? tz : 'UTC',
          serviceItems: items.map((i) => ({
            id: i.id,
            serviceId: i.serviceId,
            offeringId: i.offeringId ?? null,
            serviceName: i.service?.name ?? 'Service',
            priceSnapshot: moneyToFixed2String(i.priceSnapshot),
            durationMinutesSnapshot: Number(i.durationMinutesSnapshot ?? 0),
            sortOrder: i.sortOrder,
          })),
        },
      },
      200,
    )
  } catch (e) {
    console.error('GET /api/pro/bookings/[id] error:', e)
    return jsonFail(500, 'Failed to load booking.')
  }
}

/* ---------------------------------------------
   PATCH
   --------------------------------------------- */

export async function PATCH(req: Request, ctx: Ctx) {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res
    const professionalId = auth.professionalId

    const params = await Promise.resolve(ctx.params)
    const bookingId = pickString(params?.id)
    if (!bookingId) return jsonFail(400, 'Missing booking id.')

    const body: unknown = await req.json().catch(() => ({}))
    const rec = isRecord(body) ? body : null

    const nextStatus = pickEnum(rec?.status, ['ACCEPTED', 'CANCELLED'] as const)
    const notifyClient = pickBool(rec?.notifyClient) ?? false
    const allowOutside = pickBool(rec?.allowOutsideWorkingHours) ?? false

    const nextStart = pickIsoDate(rec?.scheduledFor)
    const bufferRaw = rec?.bufferMinutes
    const durationRaw = rec?.durationMinutes ?? rec?.totalDurationMinutes

    const rawItems = rec?.serviceItems
    const serviceItemsRaw: unknown[] | null = Array.isArray(rawItems) ? rawItems : null

    // notifyClient / allowOutside alone should not count as a mutation
    const wantsMutation =
      nextStatus != null || nextStart != null || bufferRaw != null || durationRaw != null || serviceItemsRaw != null

    if (!wantsMutation) return jsonOk({ booking: null, noOp: true }, 200)

    const result = await prisma.$transaction(async (tx) => {
      const existing = await tx.booking.findFirst({
        where: { id: bookingId, professionalId },
        select: {
          id: true,
          status: true,
          scheduledFor: true,
          locationType: true,
          bufferMinutes: true,
          totalDurationMinutes: true,
          clientId: true,
          locationId: true,
          locationTimeZone: true,
          professionalId: true,
          professional: { select: { timeZone: true } },
        },
      })
      if (!existing) throw new Error('NOT_FOUND')

      if (existing.status === BookingStatus.CANCELLED) {
        if (nextStatus === 'CANCELLED') {
          const s = normalizeToMinute(new Date(existing.scheduledFor))
          const dur = Number(existing.totalDurationMinutes ?? 60)
          const buf = Math.max(0, Number(existing.bufferMinutes ?? 0))
          return {
            id: existing.id,
            scheduledFor: s.toISOString(),
            endsAt: addMinutes(s, dur + buf).toISOString(),
            bufferMinutes: buf,
            durationMinutes: dur,
            totalDurationMinutes: dur,
            status: existing.status,
            subtotalSnapshot: '0.00',
            timeZone: 'UTC',
          }
        }
        throw new Error('CANNOT_EDIT_CANCELLED')
      }

      if (nextStatus === 'CANCELLED') {
        const updated = await tx.booking.update({
          where: { id: existing.id },
          data: { status: BookingStatus.CANCELLED },
          select: { id: true, status: true, scheduledFor: true, bufferMinutes: true, totalDurationMinutes: true },
        })

        if (notifyClient) {
          await createClientNotification({
            tx,
            clientId: existing.clientId,
            bookingId: updated.id,
            type: ClientNotificationType.BOOKING_CANCELLED,
            title: 'Appointment cancelled',
            body: 'Your appointment was cancelled.',
            dedupeKey: `BOOKING_CANCELLED:${updated.id}:${new Date(updated.scheduledFor).toISOString()}`,
          })
        }

        const dur = Number(updated.totalDurationMinutes ?? 60)
        const buf = Math.max(0, Number(updated.bufferMinutes ?? 0))
        return {
          id: updated.id,
          scheduledFor: new Date(updated.scheduledFor).toISOString(),
          endsAt: addMinutes(new Date(updated.scheduledFor), dur + buf).toISOString(),
          bufferMinutes: buf,
          durationMinutes: dur,
          totalDurationMinutes: dur,
          status: updated.status,
          subtotalSnapshot: '0.00',
          timeZone: 'UTC',
        }
      }

      if (!existing.locationId) throw new Error('BAD_LOCATION')

      const loc = await tx.professionalLocation.findFirst({
        where: { id: existing.locationId, professionalId: existing.professionalId, isBookable: true },
        select: {
          id: true,
          type: true,
          timeZone: true,
          workingHours: true,
          stepMinutes: true,
          bufferMinutes: true, // ✅ needed for overlap-aware hold windows
        },
      })
      if (!loc) throw new Error('BAD_LOCATION')

      if (existing.locationType === ServiceLocationType.MOBILE && loc.type !== ProfessionalLocationType.MOBILE_BASE) {
        throw new Error('BAD_LOCATION_MODE')
      }
      if (existing.locationType === ServiceLocationType.SALON && loc.type === ProfessionalLocationType.MOBILE_BASE) {
        throw new Error('BAD_LOCATION_MODE')
      }

      const stepMinutes = clamp(Number(loc.stepMinutes ?? 15), 5, 60)
      const locationBufferMinutes = clamp(Number(loc.bufferMinutes ?? 0), 0, MAX_BOOKING_BUFFER_MINUTES)

      const tzRes = await resolveApptTimeZone({
        bookingLocationTimeZone: existing.locationTimeZone,
        locationId: existing.locationId ?? null,
        professionalId: existing.professionalId,
        professionalTimeZone: existing.professional?.timeZone,
        fallback: 'UTC',
      })

      const apptTz = tzRes.ok ? tzRes.timeZone : 'UTC'
      const tzOk = isValidIanaTimeZone(apptTz)

      const nextBuffer = bufferRaw != null ? pickInt(bufferRaw) : null
      if (nextBuffer != null && (nextBuffer < 0 || nextBuffer > MAX_BOOKING_BUFFER_MINUTES)) throw new Error('BAD_BUFFER')

      const nextDuration = durationRaw != null ? pickInt(durationRaw) : null
      if (nextDuration != null && (nextDuration < 15 || nextDuration > MAX_SLOT_DURATION_MINUTES)) throw new Error('BAD_DURATION')

      const finalStart = nextStart ? normalizeToMinute(nextStart) : normalizeToMinute(new Date(existing.scheduledFor))
      if (!Number.isFinite(finalStart.getTime())) throw new Error('BAD_START')

      if (tzOk) {
        const startMin = minutesSinceMidnightInTimeZone(finalStart, apptTz)
        if (startMin % stepMinutes !== 0) throw new Error(`STEP:${stepMinutes}`)
      } else {
        if (finalStart.getUTCMinutes() % stepMinutes !== 0) throw new Error(`STEP:${stepMinutes}`)
      }

      const finalBuffer =
        nextBuffer != null
          ? clamp(snapToStep(nextBuffer, stepMinutes), 0, MAX_BOOKING_BUFFER_MINUTES)
          : Math.max(0, Number(existing.bufferMinutes ?? 0))

      let serviceIdForBooking: string | null = null
      let offeringIdForBooking: string | null = null

      if (serviceItemsRaw) {
        if (!serviceItemsRaw.length) throw new Error('BAD_ITEMS')

        const parsedItems = serviceItemsRaw.map((raw, idx) => {
          if (!isRecord(raw)) throw new Error('BAD_ITEMS')

          const serviceId = pickString(raw.serviceId)
          const offeringId = pickString(raw.offeringId)
          const dur = pickInt(raw.durationMinutesSnapshot)
          const sortOrder = pickInt(raw.sortOrder)
          const priceCents = moneyToCents(raw.priceSnapshot)

          if (!serviceId || !offeringId) throw new Error('BAD_ITEMS')
          if (dur == null || dur < 15 || dur > MAX_SLOT_DURATION_MINUTES) throw new Error('BAD_ITEMS')

          return {
            serviceId,
            offeringId,
            durationMinutesSnapshot: clamp(snapToStep(dur, stepMinutes), 15, MAX_SLOT_DURATION_MINUTES),
            priceSnapshot: centsToDecimal(priceCents),
            sortOrder: sortOrder != null ? sortOrder : idx,
          }
        })

        const offeringIds = Array.from(new Set(parsedItems.map((i) => i.offeringId))).slice(0, 50)
        const offs = await tx.professionalServiceOffering.findMany({
          where: { id: { in: offeringIds }, professionalId: existing.professionalId, isActive: true },
          select: { id: true, serviceId: true },
          take: 100,
        })
        const offById = new Map(offs.map((o) => [o.id, o.serviceId]))

        for (const it of parsedItems) {
          const svc = offById.get(it.offeringId)
          if (!svc || svc !== it.serviceId) throw new Error('BAD_ITEMS')
        }

        await tx.bookingServiceItem.deleteMany({ where: { bookingId: existing.id } })
        for (const it of parsedItems) {
          await tx.bookingServiceItem.create({
            data: {
              bookingId: existing.id,
              serviceId: it.serviceId,
              offeringId: it.offeringId,
              priceSnapshot: it.priceSnapshot,
              durationMinutesSnapshot: it.durationMinutesSnapshot,
              sortOrder: it.sortOrder,
            },
          })
        }

        serviceIdForBooking = parsedItems[0].serviceId
        offeringIdForBooking = parsedItems[0].offeringId
      }

      const itemsNow = await tx.bookingServiceItem.findMany({
        where: { bookingId: existing.id },
        orderBy: { sortOrder: 'asc' },
        select: { priceSnapshot: true, durationMinutesSnapshot: true, serviceId: true, offeringId: true },
      })
      if (!itemsNow.length) throw new Error('BAD_ITEMS')

      const computedSubtotalCents = itemsNow.reduce((sum, i) => sum + moneyToCents(i.priceSnapshot), 0)
      const computedDuration = itemsNow.reduce((sum, i) => sum + Number(i.durationMinutesSnapshot ?? 0), 0)

      const durationFallback = Number(existing.totalDurationMinutes ?? 0) > 0 ? Number(existing.totalDurationMinutes) : 60
      const finalDuration =
        nextDuration != null
          ? clamp(snapToStep(nextDuration, stepMinutes), 15, MAX_SLOT_DURATION_MINUTES)
          : computedDuration > 0
            ? computedDuration
            : durationFallback

      const finalEnd = addMinutes(finalStart, finalDuration + finalBuffer)

      if (!allowOutside) {
        if (!tzOk) throw new Error('TIMEZONE_REQUIRED')
        const whCheck = ensureWithinWorkingHours({
          scheduledStartUtc: finalStart,
          scheduledEndUtc: finalEnd,
          workingHours: loc.workingHours,
          timeZone: apptTz,
        })
        if (!whCheck.ok) throw new Error(`WH:${whCheck.error}`)
      }

      // bookings (location-scoped, overlap-safe window)
      const earliestStart = addMinutes(finalStart, -MAX_OTHER_OVERLAP_MINUTES)

      const others = await tx.booking.findMany({
        where: {
          professionalId: existing.professionalId,
          locationId: loc.id,
          id: { not: existing.id },
          scheduledFor: { gte: earliestStart, lt: finalEnd },
          NOT: { status: BookingStatus.CANCELLED },
        },
        select: { scheduledFor: true, totalDurationMinutes: true, bufferMinutes: true },
        take: 500,
      })

      const hasBookingConflict = others.some((b) => {
        const bStart = normalizeToMinute(new Date(b.scheduledFor))
        const bDur = Number(b.totalDurationMinutes ?? 0) > 0 ? Number(b.totalDurationMinutes) : 60
        const bBuf = Math.max(0, Number(b.bufferMinutes ?? 0))
        const bEnd = addMinutes(bStart, bDur + bBuf)
        return overlaps(bStart, bEnd, finalStart, finalEnd)
      })
      if (hasBookingConflict) throw new Error('CONFLICT')

      const blockConflict = await tx.calendarBlock.findFirst({
        where: {
          professionalId: existing.professionalId,
          startsAt: { lt: finalEnd },
          endsAt: { gt: finalStart },
          OR: [{ locationId: loc.id }, { locationId: null }],
        },
        select: { id: true },
      })
      if (blockConflict) throw new Error('BLOCKED')

      // ✅ holds (overlap-aware, uses offering durations + location buffer)
      const holds = await tx.bookingHold.findMany({
        where: {
          professionalId: existing.professionalId,
          locationId: loc.id,
          expiresAt: { gt: new Date() },
          scheduledFor: { gte: earliestStart, lt: finalEnd },
        },
        select: { id: true, scheduledFor: true, offeringId: true, locationType: true },
        take: 1000,
      })

      if (holds.length) {
        const offeringIds = Array.from(new Set(holds.map((h) => h.offeringId))).slice(0, 2000)
        const offerRows = await tx.professionalServiceOffering.findMany({
          where: { id: { in: offeringIds } },
          select: { id: true, salonDurationMinutes: true, mobileDurationMinutes: true },
          take: 2000,
        })
        const byId = new Map(offerRows.map((o) => [o.id, o]))

        const hasHoldConflict = holds.some((h) => {
          const o = byId.get(h.offeringId)
          const durRaw =
            h.locationType === ServiceLocationType.MOBILE ? o?.mobileDurationMinutes : o?.salonDurationMinutes
          const base = Number(durRaw ?? 0)
          const dur = Number.isFinite(base) && base > 0 ? clamp(base, 15, MAX_SLOT_DURATION_MINUTES) : 60

          const hStart = normalizeToMinute(new Date(h.scheduledFor))
          const hEnd = addMinutes(hStart, dur + locationBufferMinutes)
          return overlaps(hStart, hEnd, finalStart, finalEnd)
        })

        if (hasHoldConflict) throw new Error('HELD')
      }

      const statusUpdate = nextStatus === 'ACCEPTED' ? { status: BookingStatus.ACCEPTED } : {}

      const primary = itemsNow[0]
      const finalServiceId = serviceIdForBooking ?? primary.serviceId
      const finalOfferingId = offeringIdForBooking ?? (primary.offeringId ?? null)

      const updated = await tx.booking.update({
        where: { id: existing.id },
        data: {
          ...statusUpdate,
          scheduledFor: finalStart,
          bufferMinutes: finalBuffer,
          totalDurationMinutes: finalDuration,
          subtotalSnapshot: centsToDecimal(computedSubtotalCents),
          serviceId: finalServiceId,
          offeringId: finalOfferingId,
        },
        select: { id: true, scheduledFor: true, bufferMinutes: true, totalDurationMinutes: true, status: true },
      })

      if (notifyClient) {
        const isConfirm = nextStatus === 'ACCEPTED'
        const title = isConfirm ? 'Appointment confirmed' : 'Appointment updated'
        const bodyText = isConfirm ? 'Your appointment has been confirmed.' : 'Your appointment details were updated.'
        const type = isConfirm ? ClientNotificationType.BOOKING_CONFIRMED : ClientNotificationType.BOOKING_RESCHEDULED

        await createClientNotification({
          tx,
          clientId: existing.clientId,
          bookingId: updated.id,
          type,
          title,
          body: bodyText,
          dedupeKey: `BOOKING_UPDATED:${updated.id}:${finalStart.toISOString()}:${finalDuration}:${finalBuffer}:${String(
            updated.status,
          )}`,
        })
      }

      return {
        id: updated.id,
        scheduledFor: new Date(updated.scheduledFor).toISOString(),
        endsAt: addMinutes(
          new Date(updated.scheduledFor),
          Number(updated.totalDurationMinutes) + Number(updated.bufferMinutes),
        ).toISOString(),
        bufferMinutes: Math.max(0, Number(updated.bufferMinutes)),
        durationMinutes: Number(updated.totalDurationMinutes),
        totalDurationMinutes: Number(updated.totalDurationMinutes),
        status: updated.status,
        subtotalSnapshot: moneyToFixed2String(centsToDecimal(computedSubtotalCents)),
        timeZone: tzOk ? apptTz : 'UTC',
      }
    })

    return jsonOk({ booking: result }, 200)
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : ''

    if (msg === 'NOT_FOUND') return jsonFail(404, 'Booking not found.')
    if (msg === 'CANNOT_EDIT_CANCELLED') return jsonFail(409, 'Cancelled bookings cannot be edited.')
    if (msg === 'CONFLICT') return jsonFail(409, 'That time is not available.')
    if (msg === 'BLOCKED') return jsonFail(409, 'That time is blocked on your calendar.')
    if (msg === 'HELD') return jsonFail(409, 'That time is currently on hold.')
    if (msg === 'BAD_ITEMS') return jsonFail(400, 'Invalid service items.')
    if (msg === 'BAD_BUFFER') return jsonFail(400, 'Invalid bufferMinutes.')
    if (msg === 'BAD_DURATION') return jsonFail(400, 'Invalid durationMinutes.')
    if (msg.startsWith('WH:')) return jsonFail(400, msg.slice(3) || 'That time is outside working hours.')
    if (msg === 'TIMEZONE_REQUIRED') return jsonFail(400, 'Please set your timezone before editing bookings.')
    if (msg === 'BAD_LOCATION') return jsonFail(400, 'Booking location is invalid.')
    if (msg === 'BAD_LOCATION_MODE') return jsonFail(400, 'Booking mode does not match location type.')
    if (msg.startsWith('STEP:')) return jsonFail(400, `Start time must be on a ${msg.slice(5)}-minute boundary.`)
    if (msg === 'BAD_START') return jsonFail(400, 'Invalid scheduledFor.')

    console.error('PATCH /api/pro/bookings/[id] error:', e)
    return jsonFail(500, 'Failed to update booking.')
  }
}