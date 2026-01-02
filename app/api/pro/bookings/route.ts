// app/api/pro/bookings/route.ts
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'
import type { ServiceLocationType } from '@prisma/client'

export const dynamic = 'force-dynamic'

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

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n))
}

function snap15(n: number) {
  const x = Math.round(n / 15) * 15
  return x < 0 ? 0 : x
}

function normalizeLocationType(v: unknown): ServiceLocationType {
  const s = typeof v === 'string' ? v.trim().toUpperCase() : ''
  return s === 'MOBILE' ? 'MOBILE' : 'SALON'
}

function isProRole(role: unknown) {
  const r = typeof role === 'string' ? role.toUpperCase() : ''
  return r === 'PRO' || r === 'PROFESSIONAL'
}

function isValidIanaTimeZone(tz: string | null | undefined) {
  if (!tz || typeof tz !== 'string') return false
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz }).format(new Date())
    return true
  } catch {
    return false
  }
}

type WorkingHoursDay = { enabled?: boolean; start?: string; end?: string }
type WorkingHours = Record<string, WorkingHoursDay>

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

function getWeekdayKeyInTimeZone(dateUtc: Date, timeZone: string): 'sun' | 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' {
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
  return { hour: Number(map.hour), minute: Number(map.minute) }
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

/** existingStart < requestedEnd AND existingEnd > requestedStart */
function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date) {
  return aStart < bEnd && aEnd > bStart
}

function toStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  return (v as unknown[])
    .map((x) => (typeof x === 'string' ? x : x == null ? '' : String(x)))
    .map((s) => s.trim())
    .filter(Boolean)
}

function inDev() {
  return process.env.NODE_ENV !== 'production'
}

export async function POST(req: Request) {
  // handy: makes it obvious in your terminal that this file is being hit
  console.log('POST /api/pro/bookings HIT ✅')

  try {
    const user = await getCurrentUser().catch(() => null)
    if (!user || !isProRole((user as any).role) || !(user as any).professionalProfile?.id) {
      return NextResponse.json({ error: 'Only professionals can create bookings.' }, { status: 401 })
    }

    const professionalId = (user as any).professionalProfile.id as string
    const body = (await req.json().catch(() => ({}))) as any

    // DEV logging (don’t ship full payloads to prod logs)
    if (inDev()) {
      console.log('Create booking payload:', {
        clientId: body?.clientId,
        scheduledFor: body?.scheduledFor,
        serviceIds: body?.serviceIds,
        totalDurationMinutes: body?.totalDurationMinutes,
        bufferMinutes: body?.bufferMinutes,
        locationType: body?.locationType,
      })
    }

    const clientId = pickString(body?.clientId)
    const scheduledForRaw = pickString(body?.scheduledFor)
    const internalNotes = pickString(body?.internalNotes)

    const serviceIds = toStringArray(body?.serviceIds)
    const uniqueServiceIds = Array.from(new Set(serviceIds)).slice(0, 10)

    const bufferMinutesRaw = body?.bufferMinutes
    const totalDurationMinutesRaw = body?.totalDurationMinutes
    const locationType = normalizeLocationType(body?.locationType)

    if (!clientId) return NextResponse.json({ error: 'Missing clientId.' }, { status: 400 })
    if (!scheduledForRaw) return NextResponse.json({ error: 'Missing scheduledFor.' }, { status: 400 })
    if (!uniqueServiceIds.length) return NextResponse.json({ error: 'Select at least one service.' }, { status: 400 })

    const scheduledStart = normalizeToMinute(new Date(scheduledForRaw))
    if (!Number.isFinite(scheduledStart.getTime())) {
      return NextResponse.json({ error: 'Invalid scheduledFor.' }, { status: 400 })
    }

    const bufferMinutes = (() => {
      const n = Number(bufferMinutesRaw ?? 0)
      if (!Number.isFinite(n) || n < 0 || n > 180) return 0
      return snap15(n)
    })()

    // pro settings
    const pro = await prisma.professionalProfile.findUnique({
      where: { id: professionalId },
      select: { id: true, timeZone: true, workingHours: true },
    })
    if (!pro) return NextResponse.json({ error: 'Professional profile not found.' }, { status: 404 })

    const proTz = isValidIanaTimeZone(pro.timeZone) ? pro.timeZone! : 'America/Los_Angeles'

    // offerings (DON’T assume `service` relation exists)
    const offerings = await prisma.professionalServiceOffering.findMany({
      where: {
        professionalId,
        isActive: true,
        serviceId: { in: uniqueServiceIds }, // ✅ string[]
      },
      select: {
        id: true,
        serviceId: true,
        salonPriceStartingAt: true,
        mobilePriceStartingAt: true,
        salonDurationMinutes: true,
        mobileDurationMinutes: true,
      },
      take: 50,
    })

    const offeringByServiceId = new Map<string, (typeof offerings)[number]>()
    for (const o of offerings) offeringByServiceId.set(o.serviceId, o)

    for (const sid of uniqueServiceIds) {
      if (!offeringByServiceId.get(sid)) {
        return NextResponse.json(
          { error: 'One or more selected services are not available for this professional.' },
          { status: 400 },
        )
      }
    }

    // fetch service rows separately (fixes “service does not exist” TS/runtime issues)
    const serviceRows = await prisma.service.findMany({
      where: { id: { in: uniqueServiceIds } },
      select: { id: true, name: true, defaultDurationMinutes: true },
      take: 50,
    })
    const serviceById = new Map(serviceRows.map((s) => [s.id, s]))

    const items = uniqueServiceIds.map((sid, idx) => {
      const off = offeringByServiceId.get(sid)!
      const svc = serviceById.get(sid)

      const durRaw =
        locationType === 'MOBILE'
          ? Number(off.mobileDurationMinutes ?? svc?.defaultDurationMinutes ?? 0)
          : Number(off.salonDurationMinutes ?? svc?.defaultDurationMinutes ?? 0)

      const priceRaw = locationType === 'MOBILE' ? off.mobilePriceStartingAt : off.salonPriceStartingAt

      const dur = clamp(snap15(Number(durRaw || 0)), 15, 12 * 60)
      const price = Number(priceRaw ?? 0)

      return {
        serviceId: sid,
        offeringId: off.id,
        serviceName: svc?.name ?? 'Service',
        durationMinutesSnapshot: dur,
        priceSnapshot: price,
        sortOrder: idx,
      }
    })

    const computedDuration = items.reduce((sum, i) => sum + Number(i.durationMinutesSnapshot || 0), 0)
    const computedSubtotal = items.reduce((sum, i) => sum + Number(i.priceSnapshot || 0), 0)

    const uiDuration = Number(totalDurationMinutesRaw)
    const totalDurationMinutes =
      Number.isFinite(uiDuration) && uiDuration >= 15 && uiDuration <= 12 * 60
        ? clamp(snap15(uiDuration), 15, 12 * 60)
        : clamp(snap15(computedDuration || 60), 15, 12 * 60)

    const scheduledEnd = addMinutes(scheduledStart, totalDurationMinutes + bufferMinutes)

    const whCheck = ensureWithinWorkingHours({
      scheduledStartUtc: scheduledStart,
      scheduledEndUtc: scheduledEnd,
      workingHours: pro.workingHours,
      timeZone: proTz,
    })
    if (!whCheck.ok) return NextResponse.json({ error: whCheck.error }, { status: 400 })

    // conflict check
    const windowStart = addMinutes(scheduledStart, -(totalDurationMinutes + bufferMinutes) * 2)
    const windowEnd = addMinutes(scheduledStart, (totalDurationMinutes + bufferMinutes) * 2)

    const others = await prisma.booking.findMany({
      where: {
        professionalId,
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
        Number(b.totalDurationMinutes ?? 0) > 0 ? Number(b.totalDurationMinutes) : Number(b.durationMinutesSnapshot ?? 0)
      const bBuf = Number(b.bufferMinutes ?? 0)
      if (!Number.isFinite(bDur) || bDur <= 0) return false
      const bStart = normalizeToMinute(new Date(b.scheduledFor))
      const bEnd = addMinutes(bStart, bDur + bBuf)
      return overlaps(bStart, bEnd, scheduledStart, scheduledEnd)
    })

    if (hasConflict) return NextResponse.json({ error: 'That time is not available.' }, { status: 409 })

    // NOTE: if your Prisma schema does NOT have some of these fields/relations,
    // Prisma will throw. That’s why we’re surfacing the error below.
    const created = await prisma.booking.create({
      data: {
        professionalId,
        clientId,
        scheduledFor: scheduledStart,
        locationType,
        status: 'ACCEPTED' as any,

        internalNotes: internalNotes ?? null,
        bufferMinutes,
        totalDurationMinutes,
        subtotalSnapshot: computedSubtotal as any,

        // legacy mirrors (first service)
        serviceId: items[0]?.serviceId ?? null,
        offeringId: items[0]?.offeringId ?? null,
        durationMinutesSnapshot: items[0]?.durationMinutesSnapshot ?? null,
        priceSnapshot: items[0]?.priceSnapshot ?? null,

        // relation name must match your Prisma schema
        serviceItems: {
          create: items.map((i) => ({
            serviceId: i.serviceId,
            offeringId: i.offeringId,
            priceSnapshot: i.priceSnapshot as any,
            durationMinutesSnapshot: i.durationMinutesSnapshot,
            sortOrder: i.sortOrder,
          })),
        },
      } as any,
      select: {
        id: true,
        scheduledFor: true,
        totalDurationMinutes: true,
        bufferMinutes: true,
        status: true,
        client: {
          select: {
            firstName: true,
            lastName: true,
            phone: true,
            user: { select: { email: true } },
          },
        },
      },
    })

    const fn = created.client?.firstName?.trim() || ''
    const ln = created.client?.lastName?.trim() || ''
    const clientName = fn || ln ? `${fn} ${ln}`.trim() : created.client?.user?.email || 'Client'

    const serviceName = items.map((i) => i.serviceName).filter(Boolean).join(' + ') || 'Appointment'
    const endsAt = addMinutes(
      new Date(created.scheduledFor),
      Number(created.totalDurationMinutes ?? totalDurationMinutes) + Number(created.bufferMinutes ?? bufferMinutes),
    )

    return NextResponse.json(
      {
        ok: true,
        booking: {
          id: String(created.id),
          scheduledFor: new Date(created.scheduledFor).toISOString(),
          endsAt: endsAt.toISOString(),
          totalDurationMinutes: Number(created.totalDurationMinutes ?? totalDurationMinutes),
          bufferMinutes: Number(created.bufferMinutes ?? bufferMinutes),
          status: created.status,
          serviceName,
          clientName,
        },
      },
      { status: 200 },
    )
  } catch (e: any) {
    console.error('POST /api/pro/bookings error', e)

    // ✅ Surface the real reason in dev so you can actually fix it.
    const msg =
      typeof e?.message === 'string' && e.message.trim()
        ? e.message
        : 'Failed to create booking.'

    return NextResponse.json(
      {
        error: msg,
        name: e?.name,
        code: e?.code,
      },
      { status: 500 },
    )
  }
}
