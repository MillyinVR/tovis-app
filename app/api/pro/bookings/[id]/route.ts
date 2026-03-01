// app/api/pro/bookings/[id]/route.ts
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'
import { moneyToFixed2String } from '@/lib/money'
import { sanitizeTimeZone, isValidIanaTimeZone, getZonedParts, minutesSinceMidnightInTimeZone } from '@/lib/timeZone'
import { resolveApptTimeZone } from '@/lib/booking/timeZoneTruth'
import { BookingStatus, ClientNotificationType, Prisma } from '@prisma/client'

export const dynamic = 'force-dynamic'

type PatchStatus = 'ACCEPTED' | 'CANCELLED'
function normalizeStatus(v: unknown): PatchStatus | null {
  const s = typeof v === 'string' ? v.trim().toUpperCase() : ''
  if (s === 'ACCEPTED' || s === 'CANCELLED') return s as PatchStatus
  return null
}

type Ctx = { params: { id: string } | Promise<{ id: string }> }

function pickString(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

function safeNumber(v: unknown): number | null {
  const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : NaN
  return Number.isFinite(n) ? n : null
}

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

function snap15(n: number) {
  const x = Math.round(n / 15) * 15
  return x < 0 ? 0 : x
}

async function safeJsonReq(req: Request) {
  return req.json().catch(() => ({})) as Promise<any>
}

function fail(status: number, error: string, details?: any) {
  const dev = process.env.NODE_ENV !== 'production'
  return NextResponse.json(dev && details != null ? { ok: false, error, details } : { ok: false, error }, { status })
}

/* ---------------------------------------------
   Working-hours enforcement (LOCATION truth)
   --------------------------------------------- */

type WorkingHoursDay = { enabled?: boolean; start?: string; end?: string }
type WorkingHours = Record<string, WorkingHoursDay>

/** "09:00" only (strict) */
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

function weekdayKeyFromZonedParts(z: { year: number; month: number; day: number; timeZone: string }) {
  // UTC noon anchor avoids DST weirdness for weekday labeling
  const asUtc = new Date(Date.UTC(z.year, z.month - 1, z.day, 12, 0, 0, 0))
  const wd = new Intl.DateTimeFormat('en-US', { timeZone: z.timeZone, weekday: 'short' }).format(asUtc).toLowerCase()
  if (wd.startsWith('mon')) return 'mon'
  if (wd.startsWith('tue')) return 'tue'
  if (wd.startsWith('wed')) return 'wed'
  if (wd.startsWith('thu')) return 'thu'
  if (wd.startsWith('fri')) return 'fri'
  if (wd.startsWith('sat')) return 'sat'
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
    return { ok: false, error: 'Working hours are not set yet.' }
  }

  const tz = sanitizeTimeZone(timeZone, 'UTC') || 'UTC'
  const wh = workingHours as WorkingHours

  // Must start & end on the same local day in tz
  const sParts = getZonedParts(scheduledStartUtc, tz)
  const eParts = getZonedParts(scheduledEndUtc, tz)
  const sameLocalDay = sParts.year === eParts.year && sParts.month === eParts.month && sParts.day === eParts.day
  if (!sameLocalDay) return { ok: false, error: 'That time is outside your working hours.' }

  const dayKey = weekdayKeyFromZonedParts({ ...sParts, timeZone: tz })
  const rule = wh?.[dayKey]
  if (!rule || rule.enabled === false) return { ok: false, error: 'That time is outside your working hours.' }

  const startHHMM = parseHHMM(rule.start)
  const endHHMM = parseHHMM(rule.end)
  if (!startHHMM || !endHHMM) return { ok: false, error: 'Your working hours are misconfigured.' }

  const windowStartMin = startHHMM.hh * 60 + startHHMM.mm
  const windowEndMin = endHHMM.hh * 60 + endHHMM.mm
  if (windowEndMin <= windowStartMin) return { ok: false, error: 'Your working hours are misconfigured.' }

  const startMin = minutesSinceMidnightInTimeZone(scheduledStartUtc, tz)
  const endMin = minutesSinceMidnightInTimeZone(scheduledEndUtc, tz)

  if (startMin < windowStartMin || endMin > windowEndMin) {
    return { ok: false, error: 'That time is outside your working hours.' }
  }

  return { ok: true }
}

/* ---------------------------------------------
   Time zone helpers
   --------------------------------------------- */

function normalizeTimeZoneStrict(tzRaw: unknown, fallback: string) {
  const s = typeof tzRaw === 'string' ? tzRaw.trim() : ''
  if (s && isValidIanaTimeZone(s)) return s
  const cleaned = sanitizeTimeZone(s, fallback) || fallback
  return isValidIanaTimeZone(cleaned) ? cleaned : fallback
}

async function resolveBookingTimeZone(args: {
  bookingLocationTimeZone: unknown
  bookingLocationId: string | null
  professionalId: string
  proTimeZone: unknown
  fallback?: string
}) {
  const fallback = args.fallback ?? 'UTC'

  const locTzDirect = typeof args.bookingLocationTimeZone === 'string' ? args.bookingLocationTimeZone.trim() : ''
  if (locTzDirect && isValidIanaTimeZone(locTzDirect)) return locTzDirect

  if (args.bookingLocationId) {
    const loc = await prisma.professionalLocation.findFirst({
      where: { id: args.bookingLocationId, professionalId: args.professionalId },
      select: { timeZone: true },
    })
    const locTz = typeof loc?.timeZone === 'string' ? loc.timeZone.trim() : ''
    if (locTz && isValidIanaTimeZone(locTz)) return locTz
  }

  return normalizeTimeZoneStrict(args.proTimeZone, fallback)
}

/* ---------------------------------------------
   Client notification helper
   FIX #1: tx is Prisma.TransactionClient (not PrismaClient)
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
    data: {
      clientId,
      bookingId,
      type,
      title,
      body,
      dedupeKey,
    },
  })
}

/* ---------------------------------------------
   GET
   --------------------------------------------- */

export async function GET(_req: Request, { params }: Ctx) {
  try {
    const user = await getCurrentUser().catch(() => null)
    if (!user || user.role !== 'PRO' || !user.professionalProfile?.id) return fail(401, 'Not authorized.')

    const { id } = await Promise.resolve(params)
    const bookingId = (id || '').trim()
    if (!bookingId) return fail(400, 'Missing booking id.')

    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      select: {
        id: true,
        status: true,
        scheduledFor: true,
        locationType: true,

        bufferMinutes: true,
        totalDurationMinutes: true,
        subtotalSnapshot: true,

        professionalId: true,
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

    if (!booking || booking.professionalId !== user.professionalProfile.id) return fail(404, 'Booking not found.')

    const start = normalizeToMinute(new Date(booking.scheduledFor))
    if (!Number.isFinite(start.getTime())) return fail(500, 'Booking has an invalid scheduled time.')

    const items = booking.serviceItems || []
    const computedDuration = items.reduce((sum, i) => sum + Number(i.durationMinutesSnapshot ?? 0), 0)
    const computedSubtotal = items.reduce((sum, i) => sum + Number(i.priceSnapshot ?? 0), 0)

    const durationMinutes =
      Number(booking.totalDurationMinutes ?? 0) > 0
        ? Number(booking.totalDurationMinutes)
        : computedDuration > 0
          ? computedDuration
          : 60

    const bufferMinutes = Number(booking.bufferMinutes ?? 0)
    const endsAt = addMinutes(start, durationMinutes + Math.max(0, bufferMinutes))

    const fn = booking.client?.firstName?.trim() || ''
    const ln = booking.client?.lastName?.trim() || ''
    const fullName = fn || ln ? `${fn} ${ln}`.trim() : booking.client?.user?.email || 'Client'

    const tzRes = await resolveApptTimeZone({
      bookingLocationTimeZone: booking.locationTimeZone,
      locationId: booking.locationId ?? null,
      professionalId: booking.professionalId,
      professionalTimeZone: booking.professional?.timeZone,
      fallback: 'UTC',
    })
    const tz = tzRes.ok ? tzRes.timeZone : 'UTC'

    const offerings = await prisma.professionalServiceOffering.findMany({
      where: { professionalId: user.professionalProfile.id, isActive: true },
      select: {
        id: true,
        serviceId: true,
        service: { select: { id: true, name: true, defaultDurationMinutes: true } },
        salonDurationMinutes: true,
        mobileDurationMinutes: true,
      },
      orderBy: { service: { name: 'asc' } },
      take: 500,
    })

    const services = offerings.map((o) => {
      const dur =
        booking.locationType === 'MOBILE'
          ? o.mobileDurationMinutes ?? o.service.defaultDurationMinutes
          : o.salonDurationMinutes ?? o.service.defaultDurationMinutes

      return {
        id: String(o.service.id),
        name: o.service.name,
        offeringId: String(o.id),
        durationMinutes: typeof dur === 'number' ? dur : null,
      }
    })

    return NextResponse.json(
      {
        ok: true,
        booking: {
          id: booking.id,
          status: booking.status,
          scheduledFor: start.toISOString(),
          endsAt: endsAt.toISOString(),
          locationType: booking.locationType,
          bufferMinutes: Math.max(0, bufferMinutes),
          durationMinutes,
          totalDurationMinutes: durationMinutes,
          subtotalSnapshot: moneyToFixed2String(booking.subtotalSnapshot ?? computedSubtotal),
          client: { fullName, email: booking.client?.user?.email ?? null, phone: booking.client?.phone ?? null },
          timeZone: tz,
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
        services,
      },
      { status: 200 },
    )
  } catch (e) {
    console.error('GET /api/pro/bookings/[id] error:', e)
    return fail(500, 'Failed to load booking.')
  }
}

/* ---------------------------------------------
   PATCH
   --------------------------------------------- */

export async function PATCH(req: Request, { params }: Ctx) {
  try {
    const user = await getCurrentUser().catch(() => null)
    if (!user || user.role !== 'PRO' || !user.professionalProfile?.id) return fail(401, 'Not authorized.')

    const { id } = await Promise.resolve(params)
    const bookingId = (id || '').trim()
    if (!bookingId) return fail(400, 'Missing booking id.')

    const body = await safeJsonReq(req)

    // Inputs the UI can send
    const nextStatus = normalizeStatus(body?.status)
    const scheduledForRaw = pickString(body?.scheduledFor)
    const notifyClient = Boolean(body?.notifyClient)

    // Accept both durationMinutes and totalDurationMinutes (clients vary)
    const bufferRaw = body?.bufferMinutes
    const durationMinutesRaw = body?.durationMinutes ?? body?.totalDurationMinutes

    const allowOutside = Boolean(body?.allowOutsideWorkingHours)

    // Service items: replace-all model
    const serviceItemsRaw = Array.isArray(body?.serviceItems) ? body.serviceItems : null

    const wantsSomething =
      nextStatus != null || !!scheduledForRaw || bufferRaw != null || durationMinutesRaw != null || serviceItemsRaw != null

    // No-op should not be an error
    if (!wantsSomething) return NextResponse.json({ ok: true, booking: null, noOp: true }, { status: 200 })

    let nextStart: Date | null = null
    if (scheduledForRaw) {
      nextStart = normalizeToMinute(new Date(scheduledForRaw))
      if (!Number.isFinite(nextStart.getTime())) return fail(400, 'Invalid scheduledFor.')
    }

    let nextBuffer: number | null = null
    if (bufferRaw != null) {
      const n = safeNumber(bufferRaw)
      if (n == null || n < 0 || n > 180) return fail(400, 'Invalid bufferMinutes.')
      nextBuffer = snap15(n)
    }

    let nextTotalDuration: number | null = null
    if (durationMinutesRaw != null) {
      const n = safeNumber(durationMinutesRaw)
      if (n == null) return fail(400, 'Invalid durationMinutes.')
      nextTotalDuration = clamp(snap15(n), 15, 12 * 60)
    }

    const result = await prisma.$transaction(async (tx) => {
      const existing = await tx.booking.findUnique({
        where: { id: bookingId },
        select: {
          id: true,
          status: true,
          scheduledFor: true,
          locationType: true,

          bufferMinutes: true,
          totalDurationMinutes: true,

          professionalId: true,
          clientId: true,

          locationId: true,
          locationTimeZone: true,
          professional: { select: { timeZone: true } },

          serviceItems: { orderBy: { sortOrder: 'asc' }, select: { id: true, sortOrder: true } },
        },
      })

      if (!existing || existing.professionalId !== user.professionalProfile!.id) throw new Error('NOT_FOUND')

      // If already cancelled, allow idempotent cancel but block edits
      if (existing.status === BookingStatus.CANCELLED) {
        if (nextStatus === 'CANCELLED') {
          return {
            id: existing.id,
            scheduledFor: new Date(existing.scheduledFor).toISOString(),
            endsAt: addMinutes(
              new Date(existing.scheduledFor),
              Number(existing.totalDurationMinutes ?? 60) + Math.max(0, Number(existing.bufferMinutes ?? 0)),
            ).toISOString(),
            bufferMinutes: Math.max(0, Number(existing.bufferMinutes ?? 0)),
            durationMinutes: Number(existing.totalDurationMinutes ?? 60),
            totalDurationMinutes: Number(existing.totalDurationMinutes ?? 60),
            status: existing.status,
            subtotalSnapshot: 0,
            timeZone: 'UTC',
          }
        }
        throw new Error('CANNOT_EDIT_CANCELLED')
      }

      // STATUS change: handle CANCELLED early (skip WH/conflicts)
      if (nextStatus === 'CANCELLED') {
        const updated = await tx.booking.update({
          where: { id: existing.id },
          data: {
            status: BookingStatus.CANCELLED,
            finishedAt: new Date(),
          },
          select: { id: true, status: true, scheduledFor: true, bufferMinutes: true, totalDurationMinutes: true },
        })

        if (notifyClient) {
          try {
            await createClientNotification({
              tx,
              clientId: existing.clientId,
              bookingId: updated.id,
              type: ClientNotificationType.BOOKING_CANCELLED,
              title: 'Appointment cancelled',
              body: 'Your appointment was cancelled.',
              dedupeKey: `BOOKING_CANCELLED:${updated.id}:${new Date(updated.scheduledFor).toISOString()}`,
            })
          } catch (e) {
            console.error('Client notification failed (cancel):', e)
          }
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
          subtotalSnapshot: 0,
          timeZone: 'UTC',
        }
      }

      // LOCATION truth for timezone + working-hours checks (for schedule edits)
      const loc = existing.locationId
        ? await tx.professionalLocation.findFirst({
            where: { id: existing.locationId, professionalId: existing.professionalId, isBookable: true },
            select: { timeZone: true, workingHours: true },
          })
        : null

      const tzRes = await resolveApptTimeZone({
        bookingLocationTimeZone: existing.locationTimeZone,
        location: loc ? { id: existing.locationId, timeZone: loc.timeZone } : null,
        locationId: existing.locationId ?? null,
        professionalId: existing.professionalId,
        professionalTimeZone: existing.professional?.timeZone,
        fallback: 'UTC',
      })

      if (!tzRes.ok) throw new Error('TIMEZONE_REQUIRED')
      const apptTz = tzRes.timeZone

      // Replace-all serviceItems if provided
      if (serviceItemsRaw) {
        await tx.bookingServiceItem.deleteMany({ where: { bookingId: existing.id } })

        let idx = 0
        for (const raw of serviceItemsRaw) {
          const serviceId = pickString(raw?.serviceId)
          const offeringId = pickString(raw?.offeringId)
          const price = safeNumber(raw?.priceSnapshot)
          const dur = safeNumber(raw?.durationMinutesSnapshot)

          if (!serviceId || !offeringId) throw new Error('BAD_ITEMS')
          if (price == null || price < 0) throw new Error('BAD_ITEMS')
          if (dur == null || dur < 15 || dur > 12 * 60) throw new Error('BAD_ITEMS')

          const off = await tx.professionalServiceOffering.findFirst({
            where: { id: offeringId, professionalId: existing.professionalId, serviceId, isActive: true },
            select: { id: true },
          })
          if (!off) throw new Error('BAD_ITEMS')

          await tx.bookingServiceItem.create({
            data: {
              bookingId: existing.id,
              serviceId,
              offeringId,
              priceSnapshot: price,
              durationMinutesSnapshot: clamp(snap15(dur), 15, 12 * 60),
              sortOrder: Number.isFinite(Number(raw?.sortOrder)) ? Number(raw.sortOrder) : idx,
            },
          })

          idx++
        }
      }

      const itemsNow = await tx.bookingServiceItem.findMany({
        where: { bookingId: existing.id },
        orderBy: { sortOrder: 'asc' },
        select: { priceSnapshot: true, durationMinutesSnapshot: true },
      })

      const computedSubtotal = itemsNow.reduce((sum, i) => sum + Number(i.priceSnapshot ?? 0), 0)
      const computedDuration = itemsNow.reduce((sum, i) => sum + Number(i.durationMinutesSnapshot ?? 0), 0)

      const finalStart = nextStart ?? normalizeToMinute(new Date(existing.scheduledFor))
      const finalBuffer = nextBuffer ?? Math.max(0, Number(existing.bufferMinutes ?? 0))

      const durationFallback = Number(existing.totalDurationMinutes ?? 0) > 0 ? Number(existing.totalDurationMinutes) : 60
      const finalDuration = nextTotalDuration ?? (computedDuration > 0 ? computedDuration : durationFallback)

      const finalEnd = addMinutes(finalStart, finalDuration + finalBuffer)

      const whCheck = ensureWithinWorkingHours({
        scheduledStartUtc: finalStart,
        scheduledEndUtc: finalEnd,
        workingHours: loc?.workingHours,
        timeZone: apptTz,
      })
      if (!whCheck.ok && !allowOutside) throw new Error(`WH:${whCheck.error}`)

      // Conflict check with other bookings
      const windowStart = addMinutes(finalStart, -(finalDuration + finalBuffer) * 2)
      const windowEnd = addMinutes(finalStart, (finalDuration + finalBuffer) * 2)

      const others = await tx.booking.findMany({
        where: {
          professionalId: existing.professionalId,
          id: { not: existing.id },
          scheduledFor: { gte: windowStart, lte: windowEnd },
          NOT: { status: BookingStatus.CANCELLED },
        },
        select: { id: true, scheduledFor: true, totalDurationMinutes: true, bufferMinutes: true },
        take: 200,
      })

      const hasConflict = others.some((b) => {
        const bDur = Number(b.totalDurationMinutes ?? 0) > 0 ? Number(b.totalDurationMinutes) : 60
        const bBuf = Math.max(0, Number(b.bufferMinutes ?? 0))
        if (!Number.isFinite(bDur) || bDur <= 0) return false

        const bStart = normalizeToMinute(new Date(b.scheduledFor))
        const bEnd = addMinutes(bStart, bDur + bBuf)
        return overlaps(bStart, bEnd, finalStart, finalEnd)
      })
      if (hasConflict) throw new Error('CONFLICT')

      // Apply ACCEPTED status if requested (idempotent)
      const statusUpdate = nextStatus === 'ACCEPTED' ? { status: BookingStatus.ACCEPTED } : {}

      const updated = await tx.booking.update({
        where: { id: existing.id },
        data: {
          ...statusUpdate,
          scheduledFor: finalStart,
          bufferMinutes: finalBuffer,
          totalDurationMinutes: finalDuration,
          subtotalSnapshot: computedSubtotal,
        },
        select: { id: true, scheduledFor: true, bufferMinutes: true, totalDurationMinutes: true, status: true },
      })

      if (notifyClient) {
        try {
          const isConfirm = nextStatus === 'ACCEPTED'
          const title = isConfirm ? 'Appointment confirmed' : 'Appointment updated'
          const bodyText = isConfirm ? 'Your appointment has been confirmed.' : 'Your appointment details were updated.'

          // FIX #2: use real enum values (no BOOKING_UPDATED)
          const type = isConfirm ? ClientNotificationType.BOOKING_CONFIRMED : ClientNotificationType.BOOKING_RESCHEDULED

          await createClientNotification({
            tx,
            clientId: existing.clientId,
            bookingId: updated.id,
            type,
            title,
            body: bodyText,
            dedupeKey: `BOOKING_UPDATED:${updated.id}:${finalStart.toISOString()}:${finalDuration}:${finalBuffer}:${String(updated.status)}`,
          })
        } catch (e) {
          console.error('Client notification failed (booking update):', e)
        }
      }

      return {
        id: updated.id,
        scheduledFor: new Date(updated.scheduledFor).toISOString(),
        endsAt: addMinutes(
          new Date(updated.scheduledFor),
          Number(updated.totalDurationMinutes) + Math.max(0, Number(updated.bufferMinutes)),
        ).toISOString(),
        bufferMinutes: updated.bufferMinutes,
        durationMinutes: updated.totalDurationMinutes,
        totalDurationMinutes: updated.totalDurationMinutes,
        status: updated.status,
        subtotalSnapshot: computedSubtotal,
        timeZone: apptTz,
      }
    })

    return NextResponse.json({ ok: true, booking: result }, { status: 200 })
  } catch (e: any) {
    const msg = String(e?.message || '')

    if (msg === 'NOT_FOUND') return fail(404, 'Booking not found.')
    if (msg === 'CANNOT_EDIT_CANCELLED') return fail(409, 'Cancelled bookings cannot be edited.')
    if (msg === 'CONFLICT') return fail(409, 'That time is not available.')
    if (msg === 'BAD_ITEMS') return fail(400, 'Invalid service items.')
    if (msg.startsWith('WH:')) return fail(400, msg.slice(3) || 'That time is outside working hours.')
    if (msg === 'TIMEZONE_REQUIRED') return fail(400, 'Please set your timezone before editing bookings.')

    console.error('PATCH /api/pro/bookings/[id] error:', e)
    return fail(500, 'Failed to update booking.')
  }
}