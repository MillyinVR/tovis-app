// app/api/pro/bookings/[id]/route.ts
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'
import { moneyToFixed2String } from '@/lib/money/serializeMoney'


export const dynamic = 'force-dynamic'

type Ctx = { params: { id: string } | Promise<{ id: string }> }

function pickString(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null
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

function getWeekdayKeyInTimeZone(
  dateUtc: Date,
  timeZone: string,
): 'sun' | 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' {
  const weekday = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
  })
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

async function safeJsonReq(req: Request) {
  return req.json().catch(() => ({})) as Promise<any>
}

function snap15(n: number) {
  const x = Math.round(n / 15) * 15
  return x < 0 ? 0 : x
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n))
}

export async function GET(_req: Request, { params }: Ctx) {
  try {
    const user = await getCurrentUser().catch(() => null)
    if (!user || user.role !== 'PRO' || !user.professionalProfile?.id) {
      return NextResponse.json({ error: 'Not authorized' }, { status: 401 })
    }

    const { id } = await Promise.resolve(params)
    const bookingId = (id || '').trim()
    if (!bookingId) return NextResponse.json({ error: 'Missing booking id' }, { status: 400 })

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

        // Legacy (kept for transition)
        serviceId: true,
        offeringId: true,
        durationMinutesSnapshot: true,
        priceSnapshot: true,

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
      return NextResponse.json({ error: 'Booking not found' }, { status: 404 })
    }

    const start = new Date(booking.scheduledFor)

    // If totals are 0 (not backfilled yet), fall back to legacy snapshot
    const totalDur =
      Number(booking.totalDurationMinutes ?? 0) > 0
        ? Number(booking.totalDurationMinutes)
        : Number(booking.durationMinutesSnapshot ?? 0)

    const buffer = Number(booking.bufferMinutes ?? 0)
    const endsAt = addMinutes(start, totalDur + buffer)

    const fn = booking.client?.firstName?.trim() || ''
    const ln = booking.client?.lastName?.trim() || ''
    const fullName = fn || ln ? `${fn} ${ln}`.trim() : booking.client?.user?.email || 'Client'

    const tz = isValidIanaTimeZone(booking.professional?.timeZone)
      ? booking.professional!.timeZone!
      : 'America/Los_Angeles'

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
        id: o.service.id,
        name: o.service.name,
        offeringId: o.id,
        durationMinutes: dur ?? null,
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
          bufferMinutes: buffer,
          durationMinutes: totalDur, // 🔥 UI expects durationMinutes
          totalDurationMinutes: totalDur,
          subtotalSnapshot: moneyToFixed2String(booking.subtotalSnapshot ?? booking.priceSnapshot),

          client: {
            fullName,
            email: booking.client?.user?.email ?? null,
            phone: booking.client?.phone ?? null,
          },
          timeZone: tz,

          serviceItems: booking.serviceItems.map((i) => ({
            id: i.id,
            serviceId: i.serviceId,
            offeringId: i.offeringId ?? null,
            serviceName: i.service?.name ?? 'Service',
            priceSnapshot: moneyToFixed2String(i.priceSnapshot),
            durationMinutesSnapshot: i.durationMinutesSnapshot ?? 0,
            sortOrder: i.sortOrder,
          })),
        },
        services,
      },
      { status: 200 },
    )
  } catch (e) {
    console.error('GET /api/pro/bookings/[id] error:', e)
    return NextResponse.json({ error: 'Failed to load booking.' }, { status: 500 })
  }
}

export async function PATCH(req: Request, { params }: Ctx) {
  try {
    const user = await getCurrentUser().catch(() => null)
    if (!user || user.role !== 'PRO' || !user.professionalProfile?.id) {
      return NextResponse.json({ error: 'Not authorized' }, { status: 401 })
    }

    const { id } = await Promise.resolve(params)
    const bookingId = (id || '').trim()
    if (!bookingId) return NextResponse.json({ error: 'Missing booking id' }, { status: 400 })

    const body = await safeJsonReq(req)

    // What the UI sends
    const scheduledForRaw = pickString(body?.scheduledFor)
    const notifyClient = Boolean(body?.notifyClient)
    const serviceIdRaw = pickString(body?.serviceId)

    // Duration: calendar sends durationMinutes, schema stores totalDurationMinutes
    const durationMinutesRaw = body?.durationMinutes
    const totalDurationRaw = body?.totalDurationMinutes // allow legacy callers

    // Buffer optional
    const bufferRaw = body?.bufferMinutes

    // Service item operations (optional advanced usage)
    const serviceItemsRaw = Array.isArray(body?.serviceItems) ? body.serviceItems : null
    const addServiceItem = body?.addServiceItem ?? null
    const updateServiceItem = body?.updateServiceItem ?? null
    const removeServiceItemId = pickString(body?.removeServiceItemId)

    const wantsSomething =
      !!scheduledForRaw ||
      !!serviceIdRaw ||
      bufferRaw != null ||
      durationMinutesRaw != null ||
      totalDurationRaw != null ||
      serviceItemsRaw != null ||
      addServiceItem != null ||
      updateServiceItem != null ||
      !!removeServiceItemId

    if (!wantsSomething) {
      return NextResponse.json({ error: 'No changes provided.' }, { status: 400 })
    }

    let nextStart: Date | null = null
    if (scheduledForRaw) {
      nextStart = normalizeToMinute(new Date(scheduledForRaw))
      if (!Number.isFinite(nextStart.getTime())) {
        return NextResponse.json({ error: 'Invalid scheduledFor.' }, { status: 400 })
      }
    }

    let nextBuffer: number | null = null
    if (bufferRaw != null) {
      const n = Number(bufferRaw)
      if (!Number.isFinite(n) || n < 0 || n > 180) {
        return NextResponse.json({ error: 'Invalid bufferMinutes.' }, { status: 400 })
      }
      nextBuffer = snap15(n)
    }

    // durationMinutes takes precedence over totalDurationMinutes if provided
    let nextTotalDuration: number | null = null
    if (durationMinutesRaw != null || totalDurationRaw != null) {
      const n = Number(durationMinutesRaw != null ? durationMinutesRaw : totalDurationRaw)
      if (!Number.isFinite(n)) return NextResponse.json({ error: 'Invalid durationMinutes.' }, { status: 400 })
      const snapped = snap15(n)
      nextTotalDuration = clamp(snapped, 15, 12 * 60)
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
          durationMinutesSnapshot: true, // legacy fallback
          priceSnapshot: true,
          subtotalSnapshot: true,

          professionalId: true,
          clientId: true,

          professional: { select: { timeZone: true, workingHours: true } },

          serviceItems: {
            orderBy: { sortOrder: 'asc' },
            select: {
              id: true,
              serviceId: true,
              offeringId: true,
              priceSnapshot: true,
              durationMinutesSnapshot: true,
              sortOrder: true,
            },
          },
        },
      })

      if (!existing || existing.professionalId !== user.professionalProfile!.id) {
        throw new Error('NOT_FOUND')
      }
      if (String(existing.status) === 'CANCELLED') {
        throw new Error('CANNOT_EDIT_CANCELLED')
      }

      const proId = existing.professionalId

      const proTz = isValidIanaTimeZone(existing.professional?.timeZone)
        ? existing.professional!.timeZone!
        : 'America/Los_Angeles'

      // Helper: validate offering belongs to pro for a serviceId (and return offeringId)
      async function mustHaveOffering(serviceId: string): Promise<string> {
        const off = await tx.professionalServiceOffering.findFirst({
          where: { professionalId: proId, serviceId, isActive: true },
          select: { id: true },
        })
        if (!off) throw new Error('BAD_SERVICE')
        return off.id
      }

      // If modal sent serviceId, treat that as "single service booking" update:
// replace items with that one service, and reset totals to that service defaults
// (price + duration snapshot) based on current booking locationType.
if (serviceIdRaw) {
  const offeringId = await mustHaveOffering(serviceIdRaw)

  const offering = await tx.professionalServiceOffering.findUnique({
    where: { id: offeringId },
    select: {
      id: true,
      serviceId: true,
      salonPriceStartingAt: true,
      mobilePriceStartingAt: true,
      salonDurationMinutes: true,
      mobileDurationMinutes: true,
    },
  })
  if (!offering) throw new Error('BAD_SERVICE')

  const dur =
    existing.locationType === 'MOBILE'
      ? Number(offering.mobileDurationMinutes ?? 0)
      : Number(offering.salonDurationMinutes ?? 0)

  const price =
    existing.locationType === 'MOBILE'
      ? offering.mobilePriceStartingAt
      : offering.salonPriceStartingAt

  if (!Number.isFinite(dur) || dur <= 0) throw new Error('BAD_SERVICE')
  if (price == null) throw new Error('BAD_SERVICE')

  const snappedDur = clamp(snap15(dur), 15, 12 * 60)
  const priceNum = Number(price)

  await tx.bookingServiceItem.deleteMany({ where: { bookingId: existing.id } })
  await tx.bookingServiceItem.create({
    data: {
      bookingId: existing.id,
      serviceId: serviceIdRaw,
      offeringId: offeringId,
      priceSnapshot: priceNum as any,
      durationMinutesSnapshot: snappedDur,
      sortOrder: 0,
    },
  })

  // If user didn’t explicitly set durationMinutes, default to service duration
  if (nextTotalDuration == null) nextTotalDuration = snappedDur
}


      // Apply service item changes (advanced)
      if (serviceItemsRaw) {
        await tx.bookingServiceItem.deleteMany({ where: { bookingId: existing.id } })

        let idx = 0
        for (const raw of serviceItemsRaw) {
          const sid = pickString(raw?.serviceId)
          if (!sid) throw new Error('BAD_ITEMS')

          const offeringId = pickString(raw?.offeringId) ?? (await mustHaveOffering(sid))
          const price = Number(raw?.priceSnapshot)
          const dur = Number(raw?.durationMinutesSnapshot)

          if (!Number.isFinite(price) || price < 0) throw new Error('BAD_ITEMS')
          if (!Number.isFinite(dur) || dur < 15 || dur > 12 * 60) throw new Error('BAD_ITEMS')

          await tx.bookingServiceItem.create({
            data: {
              bookingId: existing.id,
              serviceId: sid,
              offeringId: offeringId ?? undefined,
              priceSnapshot: price as any,
              durationMinutesSnapshot: clamp(snap15(dur), 15, 12 * 60),
              sortOrder: Number.isFinite(Number(raw?.sortOrder)) ? Number(raw.sortOrder) : idx,
            },
          })

          idx++
        }
      }

      if (addServiceItem) {
        const sid = pickString(addServiceItem?.serviceId)
        if (!sid) throw new Error('BAD_ITEMS')

        const offeringId = pickString(addServiceItem?.offeringId) ?? (await mustHaveOffering(sid))
        const price = Number(addServiceItem?.priceSnapshot)
        const dur = Number(addServiceItem?.durationMinutesSnapshot)

        if (!Number.isFinite(price) || price < 0) throw new Error('BAD_ITEMS')
        if (!Number.isFinite(dur) || dur < 15 || dur > 12 * 60) throw new Error('BAD_ITEMS')

        const lastSort = existing.serviceItems.reduce((m, i) => Math.max(m, i.sortOrder), -1)
        await tx.bookingServiceItem.create({
          data: {
            bookingId: existing.id,
            serviceId: sid,
            offeringId: offeringId ?? undefined,
            priceSnapshot: price as any,
            durationMinutesSnapshot: clamp(snap15(dur), 15, 12 * 60),
            sortOrder: lastSort + 1,
          },
        })
      }

      if (updateServiceItem) {
        const itemId = pickString(updateServiceItem?.id)
        if (!itemId) throw new Error('BAD_ITEMS')

        const sid = pickString(updateServiceItem?.serviceId)
        const offeringIdRaw = pickString(updateServiceItem?.offeringId)
        const price = updateServiceItem?.priceSnapshot
        const dur = updateServiceItem?.durationMinutesSnapshot

        const data: any = {}

        if (sid) {
          data.serviceId = sid
          data.offeringId = offeringIdRaw ?? (await mustHaveOffering(sid))
        }

        if (price != null) {
          const p = Number(price)
          if (!Number.isFinite(p) || p < 0) throw new Error('BAD_ITEMS')
          data.priceSnapshot = p
        }

        if (dur != null) {
          const d = Number(dur)
          if (!Number.isFinite(d) || d < 15 || d > 12 * 60) throw new Error('BAD_ITEMS')
          data.durationMinutesSnapshot = clamp(snap15(d), 15, 12 * 60)
        }

        if (updateServiceItem?.sortOrder != null) {
          const so = Number(updateServiceItem.sortOrder)
          if (!Number.isFinite(so) || so < 0 || so > 10_000) throw new Error('BAD_ITEMS')
          data.sortOrder = so
        }

        await tx.bookingServiceItem.update({ where: { id: itemId }, data })
      }

      if (removeServiceItemId) {
        await tx.bookingServiceItem.delete({ where: { id: removeServiceItemId } }).catch(() => null)
      }

      // Reload items to compute subtotal + computed duration
      const itemsNow = await tx.bookingServiceItem.findMany({
        where: { bookingId: existing.id },
        orderBy: { sortOrder: 'asc' },
        select: { priceSnapshot: true, durationMinutesSnapshot: true },
      })

      const computedSubtotal = itemsNow.reduce((sum, i) => sum + Number(i.priceSnapshot ?? 0), 0)
      const computedDuration = itemsNow.reduce((sum, i) => sum + Number(i.durationMinutesSnapshot ?? 0), 0)

      const finalStart = nextStart ?? normalizeToMinute(new Date(existing.scheduledFor))
      const finalBuffer = nextBuffer ?? Number(existing.bufferMinutes ?? 0)

      // If caller set duration, use it; else use computed; else fallback to legacy
      const legacyDur =
        Number(existing.totalDurationMinutes ?? 0) > 0
          ? Number(existing.totalDurationMinutes)
          : Number(existing.durationMinutesSnapshot ?? 60)

      const finalDuration =
        nextTotalDuration ??
        (computedDuration > 0 ? computedDuration : legacyDur)

      const finalEnd = addMinutes(finalStart, finalDuration + finalBuffer)

      const allowOutside = Boolean(body?.allowOutsideWorkingHours)

      const whCheck = ensureWithinWorkingHours({
        scheduledStartUtc: finalStart,
        scheduledEndUtc: finalEnd,
        workingHours: existing.professional?.workingHours,
        timeZone: proTz,
      })

      // Pros can override outside hours (clients cannot, because clients don’t hit this endpoint)
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
          durationMinutesSnapshot: true,
          bufferMinutes: true,
        },
        take: 120,
      })

      const hasConflict = others.some((b: any) => {
        const bDur =
          Number(b.totalDurationMinutes ?? 0) > 0
            ? Number(b.totalDurationMinutes)
            : Number(b.durationMinutesSnapshot ?? 0)
        const bBuf = Number(b.bufferMinutes ?? 0)
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
          // keep legacy fields untouched unless you explicitly want them mirrored
        } as any,
        select: { id: true, scheduledFor: true, bufferMinutes: true, totalDurationMinutes: true, status: true },
      })

      if (notifyClient) {
        try {
          await tx.clientNotification.create({
            data: {
              clientId: existing.clientId,
              type: 'AFTERCARE' as any, // adjust if you add BOOKING_UPDATE type later
              title: 'Appointment updated',
              body: `Your appointment details were updated.`,
              bookingId: updated.id,
              dedupeKey: `BOOKING_UPDATED:${updated.id}:${finalStart.toISOString()}:${finalDuration}:${finalBuffer}`,
            } as any,
          })
        } catch (e) {
          console.error('Client notification failed (update):', e)
        }
      }

      return {
        id: updated.id,
        scheduledFor: new Date(updated.scheduledFor).toISOString(),
        endsAt: addMinutes(
          new Date(updated.scheduledFor),
          Number(updated.totalDurationMinutes) + Number(updated.bufferMinutes),
        ).toISOString(),
        bufferMinutes: updated.bufferMinutes,
        durationMinutes: updated.totalDurationMinutes,
        totalDurationMinutes: updated.totalDurationMinutes,
        status: updated.status,
        subtotalSnapshot: computedSubtotal,
      }
    })

    return NextResponse.json({ ok: true, booking: result }, { status: 200 })
  } catch (e: any) {
    const msg = String(e?.message || '')

    if (msg === 'NOT_FOUND') return NextResponse.json({ error: 'Booking not found.' }, { status: 404 })
    if (msg === 'CANNOT_EDIT_CANCELLED') return NextResponse.json({ error: 'Cancelled bookings cannot be edited.' }, { status: 409 })
    if (msg === 'CONFLICT') return NextResponse.json({ error: 'That time is not available.' }, { status: 409 })
    if (msg === 'BAD_SERVICE') return NextResponse.json({ error: 'That service is not available for this professional.' }, { status: 400 })
    if (msg === 'BAD_ITEMS') return NextResponse.json({ error: 'Invalid service items.' }, { status: 400 })
    if (msg.startsWith('WH:')) return NextResponse.json({ error: msg.slice(3) || 'That time is outside working hours.' }, { status: 400 })

    console.error('PATCH /api/pro/bookings/[id] error:', e)
    return NextResponse.json({ error: 'Failed to update booking.' }, { status: 500 })
  }
}
