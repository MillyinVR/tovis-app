// app/api/pro/bookings/route.ts
import { prisma } from '@/lib/prisma'
import { Prisma, type ServiceLocationType } from '@prisma/client'
import { jsonFail, jsonOk, pickString, requirePro } from '@/app/api/_utils'

export const dynamic = 'force-dynamic'

function normalizeToMinute(d: Date) {
  const x = new Date(d)
  x.setSeconds(0, 0)
  return x
}

function addMinutes(date: Date, minutes: number) {
  return new Date(date.getTime() + minutes * 60_000)
}

function clampInt(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, Math.trunc(n)))
}

function snap15(n: number) {
  const x = Math.round(n / 15) * 15
  return x < 0 ? 0 : x
}

function normalizeLocationType(v: unknown): ServiceLocationType {
  const s = typeof v === 'string' ? v.trim().toUpperCase() : ''
  return s === 'MOBILE' ? 'MOBILE' : 'SALON'
}

function toStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  return (v as unknown[])
    .map((x) => (typeof x === 'string' ? x : x == null ? '' : String(x)))
    .map((s) => s.trim())
    .filter(Boolean)
}

/** existingStart < requestedEnd AND existingEnd > requestedStart */
function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date) {
  return aStart < bEnd && aEnd > bStart
}

/**
 * Money helpers (route-local; cents-based)
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
  const s = (v as any)?.toString?.()
  return typeof s === 'string' ? moneyStringToCents(s) : 0
}

function centsToMoneyString(cents: number): string {
  const c = Math.max(0, Math.trunc(cents))
  const dollars = Math.trunc(c / 100)
  const rem = c % 100
  return `${dollars}.${String(rem).padStart(2, '0')}`
}

function durationOrDefault(totalDurationMinutes: unknown) {
  const n = Number(totalDurationMinutes ?? 0)
  return Number.isFinite(n) && n > 0 ? n : 60
}

export async function POST(req: Request) {
  try {
    const auth = await requirePro()
    if (auth.res) return auth.res
    const professionalId = auth.professionalId

    const body = (await req.json().catch(() => ({}))) as any

    const clientId = pickString(body?.clientId)
    const scheduledForRaw = pickString(body?.scheduledFor)
    const internalNotes = pickString(body?.internalNotes)

    const locationId = pickString(body?.locationId)
    const locationType = normalizeLocationType(body?.locationType)

    const serviceIds = toStringArray(body?.serviceIds)
    const uniqueServiceIds = Array.from(new Set(serviceIds)).slice(0, 10)

    const bufferMinutesRaw = body?.bufferMinutes
    const totalDurationMinutesRaw = body?.totalDurationMinutes

    if (!clientId) return jsonFail(400, 'Missing clientId.')
    if (!scheduledForRaw) return jsonFail(400, 'Missing scheduledFor.')
    if (!locationId) return jsonFail(400, 'Missing locationId.')
    if (!uniqueServiceIds.length) return jsonFail(400, 'Select at least one service.')

    const scheduledStart = normalizeToMinute(new Date(scheduledForRaw))
    if (!Number.isFinite(scheduledStart.getTime())) return jsonFail(400, 'Invalid scheduledFor.')

    const bufferMinutes = (() => {
      const n = Number(bufferMinutesRaw ?? 0)
      if (!Number.isFinite(n) || n < 0 || n > 180) return 0
      return snap15(n)
    })()

    // ✅ Location is REQUIRED by schema; also gives timezone + snapshots
    const loc = await prisma.professionalLocation.findFirst({
      where: { id: locationId, professionalId, isBookable: true },
      select: {
        id: true,
        timeZone: true,
        formattedAddress: true,
        lat: true,
        lng: true,
      },
    })
    if (!loc) return jsonFail(404, 'Location not found or not bookable.')

    // Offerings for selected services
    const offerings = await prisma.professionalServiceOffering.findMany({
      where: { professionalId, isActive: true, serviceId: { in: uniqueServiceIds } },
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
        return jsonFail(400, 'One or more selected services are not available for this professional.')
      }
    }

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

      const durationMinutesSnapshot = clampInt(snap15(Number(durRaw || 0)), 15, 12 * 60)

      const priceRaw = locationType === 'MOBILE' ? off.mobilePriceStartingAt : off.salonPriceStartingAt
      const priceCents = moneyToCents(priceRaw)

      return {
        serviceId: sid,
        offeringId: off.id,
        serviceName: svc?.name ?? 'Service',
        durationMinutesSnapshot,
        priceCents,
        sortOrder: idx,
      }
    })

    const computedDuration = items.reduce((sum, i) => sum + Number(i.durationMinutesSnapshot || 0), 0)
    const computedSubtotalCents = items.reduce((sum, i) => sum + Number(i.priceCents || 0), 0)

    const uiDuration = Number(totalDurationMinutesRaw)
    const totalDurationMinutes =
      Number.isFinite(uiDuration) && uiDuration >= 15 && uiDuration <= 12 * 60
        ? clampInt(snap15(uiDuration), 15, 12 * 60)
        : clampInt(snap15(computedDuration || 60), 15, 12 * 60)

    const scheduledEnd = addMinutes(scheduledStart, totalDurationMinutes + bufferMinutes)

    // Conflict check with existing bookings
    const windowStart = addMinutes(scheduledStart, -(totalDurationMinutes + bufferMinutes) * 2)
    const windowEnd = addMinutes(scheduledStart, (totalDurationMinutes + bufferMinutes) * 2)

    const others = await prisma.booking.findMany({
      where: {
        professionalId,
        scheduledFor: { gte: windowStart, lte: windowEnd },
        NOT: { status: 'CANCELLED' as any },
      },
      select: { id: true, scheduledFor: true, totalDurationMinutes: true, bufferMinutes: true, status: true },
      take: 200,
    })

    const hasConflict = others.some((b) => {
      if (String(b.status ?? '').toUpperCase() === 'CANCELLED') return false
      const bDur = durationOrDefault(b.totalDurationMinutes)
      const bBuf = Math.max(0, Number(b.bufferMinutes ?? 0))
      const bStart = normalizeToMinute(new Date(b.scheduledFor))
      const bEnd = addMinutes(bStart, bDur + bBuf)
      return overlaps(bStart, bEnd, scheduledStart, scheduledEnd)
    })
    if (hasConflict) return jsonFail(409, 'That time is not available.')

    const subtotalMoney = centsToMoneyString(computedSubtotalCents)
    const primaryItem = items[0] // guaranteed (we required >=1)

    const created = await prisma.booking.create({
      data: {
        professionalId,
        clientId,

        // ✅ schema requires serviceId
        serviceId: primaryItem.serviceId,
        offeringId: primaryItem.offeringId,

        scheduledFor: scheduledStart,
        status: 'ACCEPTED' as any,
        locationType,

        // ✅ schema requires locationId
        locationId: loc.id,
        locationTimeZone: loc.timeZone ?? null,
        locationAddressSnapshot: loc.formattedAddress ? ({ formattedAddress: loc.formattedAddress } as any) : undefined,
        locationLatSnapshot: typeof loc.lat === 'number' ? loc.lat : undefined,
        locationLngSnapshot: typeof loc.lng === 'number' ? loc.lng : undefined,

        internalNotes: internalNotes ?? null,
        bufferMinutes,
        totalDurationMinutes,

        // ✅ Booking-level truth
        subtotalSnapshot: new Prisma.Decimal(subtotalMoney),

        serviceItems: {
          create: items.map((i) => ({
            serviceId: i.serviceId,
            offeringId: i.offeringId,
            priceSnapshot: new Prisma.Decimal(centsToMoneyString(i.priceCents)),
            durationMinutesSnapshot: i.durationMinutesSnapshot,
            sortOrder: i.sortOrder,
          })),
        },
      },
      select: {
        id: true,
        scheduledFor: true,
        totalDurationMinutes: true,
        bufferMinutes: true,
        status: true,
        client: { select: { firstName: true, lastName: true, phone: true, user: { select: { email: true } } } },
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

    return jsonOk(
      {
        booking: {
          id: String(created.id),
          scheduledFor: new Date(created.scheduledFor).toISOString(),
          endsAt: endsAt.toISOString(),
          totalDurationMinutes: Number(created.totalDurationMinutes ?? totalDurationMinutes),
          bufferMinutes: Number(created.bufferMinutes ?? bufferMinutes),
          status: created.status,
          serviceName,
          clientName,
          subtotalCents: computedSubtotalCents,
        },
      },
      200,
    )
  } catch (e: any) {
    console.error('POST /api/pro/bookings error', e)
    const msg = typeof e?.message === 'string' && e.message.trim() ? e.message : 'Failed to create booking.'
    return jsonFail(500, msg, process.env.NODE_ENV !== 'production' ? { name: e?.name, code: e?.code } : undefined)
  }
}
