// app/api/pro/bookings/[id]/route.ts
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'
import { moneyToFixed2String } from '@/lib/money'
import { sanitizeTimeZone, isValidIanaTimeZone } from '@/lib/timeZone'

export const dynamic = 'force-dynamic'

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

/** Working-hours enforcement (LOCATION truth) */
type WorkingHoursDay = { enabled?: boolean; start?: string; end?: string }
type WorkingHours = Record<string, WorkingHoursDay>

function addDaysToYMD(year: number, month: number, day: number, daysToAdd: number) {
  const d = new Date(Date.UTC(year, month - 1, day + daysToAdd, 12, 0, 0, 0))
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() }
}

function getZonedParts(dateUtc: Date, timeZoneRaw: string) {
  const timeZone = sanitizeTimeZone(timeZoneRaw, 'UTC') || 'UTC'

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

  // Safari-ish edge case: hour can be "24"
  if (hour === 24) {
    hour = 0
    const next = addDaysToYMD(year, month, day, 1)
    year = next.year
    month = next.month
    day = next.day
  }

  return { year, month, day, hour, minute, second }
}

function getWeekdayKeyInTimeZone(
  dateUtc: Date,
  timeZoneRaw: string,
): 'sun' | 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' {
  const timeZone = sanitizeTimeZone(timeZoneRaw, 'UTC') || 'UTC'
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
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null
  return { hh, mm }
}

function minutesSinceMidnightInTimeZone(dateUtc: Date, timeZoneRaw: string) {
  const z = getZonedParts(dateUtc, timeZoneRaw)
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
    return { ok: false, error: 'Working hours are not set yet.' }
  }

  const wh = workingHours as WorkingHours
  const dayKey = getWeekdayKeyInTimeZone(scheduledStartUtc, timeZone)
  const rule = wh?.[dayKey]

  if (!rule || rule.enabled === false) {
    return { ok: false, error: 'That time is outside your working hours.' }
  }

  const startHHMM = parseHHMM(rule.start)
  const endHHMM = parseHHMM(rule.end)
  if (!startHHMM || !endHHMM) {
    return { ok: false, error: 'Your working hours are misconfigured.' }
  }

  const windowStartMin = startHHMM.hh * 60 + startHHMM.mm
  const windowEndMin = endHHMM.hh * 60 + endHHMM.mm
  if (windowEndMin <= windowStartMin) {
    return { ok: false, error: 'Your working hours are misconfigured.' }
  }

  const startMin = minutesSinceMidnightInTimeZone(scheduledStartUtc, timeZone)
  const endMin = minutesSinceMidnightInTimeZone(scheduledEndUtc, timeZone)

  const endDayKey = getWeekdayKeyInTimeZone(scheduledEndUtc, timeZone)
  if (endDayKey !== dayKey) {
    return { ok: false, error: 'That time is outside your working hours.' }
  }

  if (startMin < windowStartMin || endMin > windowEndMin) {
    return { ok: false, error: 'That time is outside your working hours.' }
  }

  return { ok: true }
}

function normalizeTimeZone(tz: unknown, fallback: string) {
  const raw = typeof tz === 'string' ? tz.trim() : ''
  const cleaned = sanitizeTimeZone(raw, fallback) || fallback
  return isValidIanaTimeZone(cleaned) ? cleaned : fallback
}

function fail(status: number, error: string, details?: any) {
  const dev = process.env.NODE_ENV !== 'production'
  return NextResponse.json(dev && details != null ? { ok: false, error, details } : { ok: false, error }, { status })
}

export async function GET(_req: Request, { params }: Ctx) {
  try {
    const user = await getCurrentUser().catch(() => null)
    if (!user || user.role !== 'PRO' || !user.professionalProfile?.id) {
      return fail(401, 'Not authorized.')
    }

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

    if (!booking || booking.professionalId !== user.professionalProfile.id) {
      return fail(404, 'Booking not found.')
    }

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

    // timezone truth order: booking.locationTimeZone > location.timeZone > pro.timeZone > fallback
    let tz = normalizeTimeZone(booking.locationTimeZone, 'America/Los_Angeles')

    if (!booking.locationTimeZone && booking.locationId) {
      const loc = await prisma.professionalLocation.findFirst({
        where: { id: booking.locationId, professionalId: booking.professionalId },
        select: { timeZone: true },
      })
      if (loc?.timeZone) tz = normalizeTimeZone(loc.timeZone, tz)
    }

    if (!booking.locationTimeZone && !booking.locationId) {
      tz = normalizeTimeZone(booking.professional?.timeZone, tz)
    }

    // For the pro booking editor UI: list services from active offerings
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

          // UI expects durationMinutes
          durationMinutes,
          totalDurationMinutes: durationMinutes,

          subtotalSnapshot: moneyToFixed2String(
            // prefer stored if present, else computed from items
            booking.subtotalSnapshot ?? (computedSubtotal as any),
          ),

          client: {
            fullName,
            email: booking.client?.user?.email ?? null,
            phone: booking.client?.phone ?? null,
          },

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

export async function PATCH(req: Request, { params }: Ctx) {
  try {
    const user = await getCurrentUser().catch(() => null)
    if (!user || user.role !== 'PRO' || !user.professionalProfile?.id) {
      return fail(401, 'Not authorized.')
    }

    const { id } = await Promise.resolve(params)
    const bookingId = (id || '').trim()
    if (!bookingId) return fail(400, 'Missing booking id.')

    const body = await safeJsonReq(req)

    // What UI can send
    const scheduledForRaw = pickString(body?.scheduledFor)
    const notifyClient = Boolean(body?.notifyClient)

    const bufferRaw = body?.bufferMinutes
    const durationMinutesRaw = body?.durationMinutes
    const allowOutside = Boolean(body?.allowOutsideWorkingHours)

    // Service items: replace-all model (simple + safe)
    const serviceItemsRaw = Array.isArray(body?.serviceItems) ? body.serviceItems : null

    const wantsSomething =
      !!scheduledForRaw ||
      bufferRaw != null ||
      durationMinutesRaw != null ||
      serviceItemsRaw != null

    if (!wantsSomething) return fail(400, 'No changes provided.')

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
          subtotalSnapshot: true,

          professionalId: true,
          clientId: true,

          locationId: true,
          locationTimeZone: true,

          professional: { select: { timeZone: true } },

          serviceItems: {
            orderBy: { sortOrder: 'asc' },
            select: { id: true, sortOrder: true },
          },
        },
      })

      if (!existing || existing.professionalId !== user.professionalProfile!.id) {
        throw new Error('NOT_FOUND')
      }
      if (String(existing.status) === 'CANCELLED') {
        throw new Error('CANNOT_EDIT_CANCELLED')
      }

      // Determine appointment timezone from location first
      let apptTz = normalizeTimeZone(existing.locationTimeZone, 'America/Los_Angeles')

      const loc = existing.locationId
        ? await tx.professionalLocation.findFirst({
            where: { id: existing.locationId, professionalId: existing.professionalId, isBookable: true },
            select: { timeZone: true, workingHours: true },
          })
        : null

      if (loc?.timeZone) apptTz = normalizeTimeZone(loc.timeZone, apptTz)
      if (!existing.locationTimeZone && !loc?.timeZone) {
        apptTz = normalizeTimeZone(existing.professional?.timeZone, apptTz)
      }

      // Replace-all serviceItems if provided (no legacy "serviceId" shortcut)
      if (serviceItemsRaw) {
        await tx.bookingServiceItem.deleteMany({ where: { bookingId: existing.id } })

        let idx = 0
        for (const raw of serviceItemsRaw) {
          const serviceId = pickString(raw?.serviceId)
          if (!serviceId) throw new Error('BAD_ITEMS')

          const offeringId = pickString(raw?.offeringId)
          const price = safeNumber(raw?.priceSnapshot)
          const dur = safeNumber(raw?.durationMinutesSnapshot)

          if (!offeringId) throw new Error('BAD_ITEMS')
          if (price == null || price < 0) throw new Error('BAD_ITEMS')
          if (dur == null || dur < 15 || dur > 12 * 60) throw new Error('BAD_ITEMS')

          // ensure offering belongs to this pro and matches serviceId
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
              priceSnapshot: price as any,
              durationMinutesSnapshot: clamp(snap15(dur), 15, 12 * 60),
              sortOrder: Number.isFinite(Number(raw?.sortOrder)) ? Number(raw.sortOrder) : idx,
            },
          })

          idx++
        }
      }

      // Reload items to compute subtotal + duration unless duration explicitly set
      const itemsNow = await tx.bookingServiceItem.findMany({
        where: { bookingId: existing.id },
        orderBy: { sortOrder: 'asc' },
        select: { priceSnapshot: true, durationMinutesSnapshot: true },
      })

      const computedSubtotal = itemsNow.reduce((sum, i) => sum + Number(i.priceSnapshot ?? 0), 0)
      const computedDuration = itemsNow.reduce((sum, i) => sum + Number(i.durationMinutesSnapshot ?? 0), 0)

      const finalStart = nextStart ?? normalizeToMinute(new Date(existing.scheduledFor))
      const finalBuffer = nextBuffer ?? Math.max(0, Number(existing.bufferMinutes ?? 0))

      const durationFallback =
        Number(existing.totalDurationMinutes ?? 0) > 0 ? Number(existing.totalDurationMinutes) : 60

      const finalDuration =
        nextTotalDuration ??
        (computedDuration > 0 ? computedDuration : durationFallback)

      const finalEnd = addMinutes(finalStart, finalDuration + finalBuffer)

      // Working hours check (location truth)
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
          NOT: { status: 'CANCELLED' as any },
        },
        select: {
          id: true,
          scheduledFor: true,
          totalDurationMinutes: true,
          bufferMinutes: true,
        },
        take: 200,
      })

      const hasConflict = others.some((b: any) => {
        const bDur = Number(b.totalDurationMinutes ?? 0) > 0 ? Number(b.totalDurationMinutes) : 60
        const bBuf = Math.max(0, Number(b.bufferMinutes ?? 0))
        if (!Number.isFinite(bDur) || bDur <= 0) return false

        const bStart = normalizeToMinute(new Date(b.scheduledFor))
        const bEnd = addMinutes(bStart, bDur + bBuf)
        return overlaps(bStart, bEnd, finalStart, finalEnd)
      })

      if (hasConflict) throw new Error('CONFLICT')

      const updated = await tx.booking.update({
        where: { id: existing.id },
        data: {
          scheduledFor: finalStart,
          bufferMinutes: finalBuffer,
          totalDurationMinutes: finalDuration,
          subtotalSnapshot: computedSubtotal as any,
        } as any,
        select: {
          id: true,
          scheduledFor: true,
          bufferMinutes: true,
          totalDurationMinutes: true,
          status: true,
        },
      })

      if (notifyClient) {
        // You can replace this later with your real notification system.
        // Keeping this minimal so it doesn't become another "legacy" trap.
        try {
          await tx.clientNotification.create({
            data: {
              clientId: existing.clientId,
              type: 'BOOKING_UPDATE' as any,
              title: 'Appointment updated',
              body: 'Your appointment details were updated.',
              bookingId: updated.id,
              dedupeKey: `BOOKING_UPDATED:${updated.id}:${finalStart.toISOString()}:${finalDuration}:${finalBuffer}`,
            } as any,
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

    console.error('PATCH /api/pro/bookings/[id] error:', e)
    return fail(500, 'Failed to update booking.')
  }
}
