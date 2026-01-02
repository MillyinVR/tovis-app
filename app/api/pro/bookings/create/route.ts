// app/api/pro/bookings/create/route.ts
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'
import type { ServiceLocationType } from '@prisma/client'

export const dynamic = 'force-dynamic'

function isProRole(role: unknown) {
  const r = typeof role === 'string' ? role.toUpperCase() : ''
  return r === 'PROFESSIONAL' || r === 'PRO'
}

function pickString(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

function toInt(v: any, fallback: number) {
  const n = Number(v)
  return Number.isFinite(n) ? Math.trunc(n) : fallback
}

function snap15(n: number) {
  return Math.round(n / 15) * 15
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n))
}

function toNumberFromDecimalish(v: any): number | null {
  if (v == null) return null
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'string') {
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }
  if (typeof v?.toNumber === 'function') {
    const n = v.toNumber()
    return Number.isFinite(n) ? n : null
  }
  try {
    const n = Number(String(v))
    return Number.isFinite(n) ? n : null
  } catch {
    return null
  }
}

function normalizeLocationType(v: unknown): ServiceLocationType {
  const s = typeof v === 'string' ? v.trim().toUpperCase() : ''
  return s === 'MOBILE' ? 'MOBILE' : 'SALON'
}

function pickBasePrice(args: {
  locationType: ServiceLocationType
  offering: { salonPriceStartingAt: any | null; mobilePriceStartingAt: any | null }
  service: { minPrice: any }
}) {
  const offeringPrice =
    args.locationType === 'MOBILE'
      ? toNumberFromDecimalish(args.offering.mobilePriceStartingAt)
      : toNumberFromDecimalish(args.offering.salonPriceStartingAt)

  if (offeringPrice != null) return offeringPrice
  const min = toNumberFromDecimalish(args.service.minPrice)
  return min != null ? min : 0
}

export async function POST(req: Request) {
  try {
    const user = await getCurrentUser().catch(() => null)
    if (!user || !isProRole((user as any).role) || !(user as any).professionalProfile?.id) {
      return NextResponse.json({ error: 'Only professionals can create bookings.' }, { status: 401 })
    }

    const professionalId = (user as any).professionalProfile.id as string
    const body = (await req.json().catch(() => ({}))) as any

    const clientId = pickString(body?.clientId)
    const scheduledForRaw = pickString(body?.scheduledFor)
    const locationType = normalizeLocationType(body?.locationType)

    const serviceIds: string[] = Array.isArray(body?.serviceIds)
      ? body.serviceIds.map((x: any) => String(x || '').trim()).filter(Boolean)
      : []

    const bufferMinutes = body?.bufferMinutes != null ? clamp(snap15(toInt(body.bufferMinutes, 0)), 0, 180) : 0
    const internalNotes = typeof body?.notes === 'string' ? body.notes.trim().slice(0, 2000) : null

    if (!clientId) return NextResponse.json({ error: 'Missing clientId.' }, { status: 400 })
    if (!scheduledForRaw) return NextResponse.json({ error: 'Missing scheduledFor.' }, { status: 400 })
    if (!serviceIds.length) return NextResponse.json({ error: 'Pick at least one service.' }, { status: 400 })

    const scheduledFor = new Date(scheduledForRaw)
    if (!Number.isFinite(scheduledFor.getTime())) {
      return NextResponse.json({ error: 'Invalid scheduledFor.' }, { status: 400 })
    }
    scheduledFor.setSeconds(0, 0)

    // Verify client exists
    const client = await prisma.clientProfile.findUnique({
      where: { id: clientId },
      select: { id: true },
    })
    if (!client) return NextResponse.json({ error: 'Client not found.' }, { status: 404 })

    // Load offerings for the chosen services (must belong to this pro)
    const offerings = await prisma.professionalServiceOffering.findMany({
      where: { professionalId, isActive: true, serviceId: { in: serviceIds }, service: { isActive: true } },
      select: {
        id: true,
        serviceId: true,
        offersInSalon: true,
        offersMobile: true,
        salonPriceStartingAt: true,
        salonDurationMinutes: true,
        mobilePriceStartingAt: true,
        mobileDurationMinutes: true,
        service: { select: { id: true, defaultDurationMinutes: true, minPrice: true, name: true } },
      },
      take: 50,
    })

    // Ensure every requested service is actually offered
    const byService = new Map<string, typeof offerings[number]>()
    for (const o of offerings) byService.set(o.serviceId, o)

    for (const sid of serviceIds) {
      if (!byService.has(sid)) {
        return NextResponse.json({ error: `Service not offered by this professional: ${sid}` }, { status: 400 })
      }
      const o = byService.get(sid)!
      if (locationType === 'SALON' && !o.offersInSalon) return NextResponse.json({ error: 'One of the services is not available in-salon.' }, { status: 400 })
      if (locationType === 'MOBILE' && !o.offersMobile) return NextResponse.json({ error: 'One of the services is not available as mobile.' }, { status: 400 })
    }

    // Build booking service items
    let subtotal = 0
    let totalDuration = 0

    const itemsData = serviceIds.map((sid, idx) => {
      const o = byService.get(sid)!
      const duration =
        locationType === 'MOBILE'
          ? Number(o.mobileDurationMinutes ?? o.service.defaultDurationMinutes)
          : Number(o.salonDurationMinutes ?? o.service.defaultDurationMinutes)

      const snappedDur = clamp(snap15(Number(duration || 0)), 15, 12 * 60)

      const price = pickBasePrice({
        locationType,
        offering: { salonPriceStartingAt: o.salonPriceStartingAt, mobilePriceStartingAt: o.mobilePriceStartingAt },
        service: { minPrice: o.service.minPrice },
      })

      subtotal += price
      totalDuration += snappedDur

      return {
        serviceId: sid,
        offeringId: o.id,
        priceSnapshot: price as any,
        durationMinutesSnapshot: snappedDur,
        sortOrder: idx,
      }
    })

    totalDuration = clamp(snap15(totalDuration), 15, 12 * 60)

    const endsAt = new Date(scheduledFor.getTime() + (totalDuration + bufferMinutes) * 60_000)

    // Conflict check (do NOT allow double-booking even for the pro)
    const windowStart = new Date(scheduledFor.getTime() - (totalDuration + bufferMinutes) * 2 * 60_000)
    const windowEnd = new Date(scheduledFor.getTime() + (totalDuration + bufferMinutes) * 2 * 60_000)

    const others = await prisma.booking.findMany({
      where: {
        professionalId,
        scheduledFor: { gte: windowStart, lte: windowEnd },
        NOT: { status: 'CANCELLED' as any },
      },
      select: { id: true, scheduledFor: true, totalDurationMinutes: true, bufferMinutes: true, durationMinutesSnapshot: true },
      take: 150,
    })

    const overlaps = (aStart: Date, aEnd: Date, bStart: Date, bEnd: Date) => aStart < bEnd && aEnd > bStart

    const conflict = others.some((b: any) => {
      const bStart = new Date(b.scheduledFor)
      bStart.setSeconds(0, 0)
      const dur = Number(b.totalDurationMinutes ?? 0) > 0 ? Number(b.totalDurationMinutes) : Number(b.durationMinutesSnapshot ?? 60)
      const buf = Number(b.bufferMinutes ?? 0)
      const bEnd = new Date(bStart.getTime() + (dur + buf) * 60_000)
      return overlaps(bStart, bEnd, scheduledFor, endsAt)
    })

    if (conflict) {
      return NextResponse.json({ error: 'That time overlaps an existing appointment.' }, { status: 409 })
    }

    // Primary service = first item (required by Booking schema)
    const primary = byService.get(serviceIds[0])!

    const created = await prisma.booking.create({
      data: {
        clientId,
        professionalId,
        serviceId: primary.serviceId,
        offeringId: primary.id,
        scheduledFor,
        status: 'ACCEPTED', // pro-created should be confirmed
        locationType,

        // legacy snapshots (keep them consistent to avoid UI weirdness elsewhere)
        priceSnapshot: subtotal as any,
        durationMinutesSnapshot: totalDuration,

        subtotalSnapshot: subtotal as any,
        totalDurationMinutes: totalDuration,
        bufferMinutes,

        source: 'REQUESTED', // closest match to "pro scheduled it"
        serviceNotes: internalNotes,

        serviceItems: {
          createMany: { data: itemsData },
        },
      },
      select: {
        id: true,
        scheduledFor: true,
        totalDurationMinutes: true,
        bufferMinutes: true,
        service: { select: { name: true } },
        client: { select: { firstName: true, lastName: true } },
      },
    })

    // Client notification (so it shows up in their “bookings page” AND they get a notice)
    try {
      await prisma.clientNotification.create({
        data: {
          clientId,
          type: 'BOOKING',
          title: 'New appointment scheduled',
          body: 'Your professional scheduled an appointment for you.',
          bookingId: created.id,
          dedupeKey: `PRO_CREATED:${created.id}`,
        },
      })
    } catch (e) {
      // ignore dedupe collisions
      console.error('Client notification failed (create):', e)
    }

    const clientName = `${created.client.firstName} ${created.client.lastName}`.trim()

    return NextResponse.json(
      {
        ok: true,
        booking: {
          id: created.id,
          scheduledFor: created.scheduledFor.toISOString(),
          endsAt: new Date(created.scheduledFor.getTime() + (created.totalDurationMinutes + (created.bufferMinutes ?? 0)) * 60_000).toISOString(),
          durationMinutes: created.totalDurationMinutes,
          title: created.service.name,
          clientName,
        },
      },
      { status: 200 },
    )
  } catch (e) {
    console.error('POST /api/pro/bookings/create error:', e)
    return NextResponse.json({ error: 'Failed to create booking.' }, { status: 500 })
  }
}
