// app/api/pro/bookings/[id]/rebook/route.ts
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requirePro } from '@/app/api/_utils'
import { Prisma } from '@prisma/client'

export const dynamic = 'force-dynamic'

type RebookMode = 'BOOK' | 'RECOMMEND_WINDOW' | 'CLEAR'

type Body = {
  mode?: unknown
  scheduledFor?: unknown
  windowStart?: unknown
  windowEnd?: unknown
}

type Ctx = { params: { id: string } | Promise<{ id: string }> }

function pickString(v: unknown) {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

function parseISODate(v: unknown): Date | null {
  const s = pickString(v)
  if (!s) return null
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? null : d
}

function isMode(x: unknown): x is RebookMode {
  return x === 'BOOK' || x === 'RECOMMEND_WINDOW' || x === 'CLEAR'
}

function badRequest(msg: string) {
  return NextResponse.json({ error: msg }, { status: 400 })
}

const bookingSelect = {
  id: true,
  status: true,
  clientId: true,
  professionalId: true,

  locationType: true,
  locationId: true,
  locationTimeZone: true,
  locationAddressSnapshot: true,
  locationLatSnapshot: true,
  locationLngSnapshot: true,

  bufferMinutes: true,

  serviceItems: {
    orderBy: { sortOrder: 'asc' },
    select: {
      serviceId: true,
      offeringId: true,
      priceSnapshot: true,
      durationMinutesSnapshot: true,
      sortOrder: true,
    },
  },
} satisfies Prisma.BookingSelect

type BookingPayload = Prisma.BookingGetPayload<{ select: typeof bookingSelect }>

export async function POST(req: Request, ctx: Ctx) {
  try {
    const auth = await requirePro()
    if (auth.res) return auth.res
    const proId = auth.professionalId

    const { id: originalBookingId } = await Promise.resolve(ctx.params)
    if (!originalBookingId?.trim()) return badRequest('Missing booking id.')

    const body = (await req.json().catch(() => ({}))) as Body
    const modeRaw = body.mode ?? 'BOOK'
    const mode: RebookMode = isMode(modeRaw) ? modeRaw : 'BOOK'

    const booking = (await prisma.booking.findUnique({
      where: { id: originalBookingId },
      select: bookingSelect,
    })) as BookingPayload | null

    if (!booking) return NextResponse.json({ error: 'Booking not found.' }, { status: 404 })
    if (booking.professionalId !== proId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const bookingId: string = booking.id

    if (String(booking.status) !== 'COMPLETED') {
      return NextResponse.json({ error: 'Only COMPLETED bookings can be rebooked.' }, { status: 409 })
    }

    // ✅ CLEAR mode
    if (mode === 'CLEAR') {
      const aftercare = await prisma.aftercareSummary.upsert({
        where: { bookingId },
        create: {
          bookingId,
          rebookMode: 'NONE' as any,
          rebookedFor: null,
          rebookWindowStart: null,
          rebookWindowEnd: null,
        } as any,
        update: {
          rebookMode: 'NONE' as any,
          rebookedFor: null,
          rebookWindowStart: null,
          rebookWindowEnd: null,
        } as any,
        select: { id: true },
      })

      return NextResponse.json({ ok: true, mode, aftercareId: aftercare.id }, { status: 200 })
    }

    // ✅ RECOMMEND_WINDOW mode
    if (mode === 'RECOMMEND_WINDOW') {
      const windowStart = parseISODate(body.windowStart)
      const windowEnd = parseISODate(body.windowEnd)

      if (!windowStart || !windowEnd) return badRequest('windowStart and windowEnd are required ISO strings for RECOMMEND_WINDOW.')
      if (windowEnd <= windowStart) return badRequest('windowEnd must be after windowStart.')

      const aftercare = await prisma.aftercareSummary.upsert({
        where: { bookingId },
        create: {
          bookingId,
          rebookMode: 'RECOMMENDED_WINDOW' as any,
          rebookWindowStart: windowStart,
          rebookWindowEnd: windowEnd,
          rebookedFor: null,
        } as any,
        update: {
          rebookMode: 'RECOMMENDED_WINDOW' as any,
          rebookWindowStart: windowStart,
          rebookWindowEnd: windowEnd,
          rebookedFor: null,
        } as any,
        select: {
          id: true,
          rebookMode: true,
          rebookWindowStart: true,
          rebookWindowEnd: true,
          rebookedFor: true,
        },
      })

      return NextResponse.json({ ok: true, mode, aftercare }, { status: 200 })
    }

    // ✅ BOOK mode
    const scheduledFor = parseISODate(body.scheduledFor)
    if (!scheduledFor) return badRequest('scheduledFor is required (ISO string) for BOOK mode.')

    const now = new Date()
    if (scheduledFor.getTime() < now.getTime() - 60_000) return badRequest('scheduledFor must be in the future.')

    const items = booking.serviceItems ?? []
    const primary = items[0] ?? null
    if (!primary?.serviceId || !primary?.offeringId) {
      return NextResponse.json({ error: 'This booking has no service items to rebook.' }, { status: 409 })
    }

    const z = new Prisma.Decimal(0)
    const subtotal = items.reduce((sum, i) => sum.plus(i.priceSnapshot ?? z), new Prisma.Decimal(0))
    const duration = items.reduce((sum, i) => sum + Number(i.durationMinutesSnapshot ?? 0), 0)

    const created = await prisma.$transaction(async (tx) => {
      const nextBooking = await tx.booking.create({
        data: {
          clientId: booking.clientId,
          professionalId: booking.professionalId,

          // ✅ required
          serviceId: primary.serviceId,
          offeringId: primary.offeringId,

          scheduledFor,
          status: 'ACCEPTED' as any,
          locationType: booking.locationType as any,

          // ✅ required by schema
          locationId: booking.locationId,
          locationTimeZone: booking.locationTimeZone ?? null,
          locationAddressSnapshot: booking.locationAddressSnapshot ?? undefined,
          locationLatSnapshot: booking.locationLatSnapshot ?? undefined,
          locationLngSnapshot: booking.locationLngSnapshot ?? undefined,

          // ✅ pricing + duration truth
          subtotalSnapshot: subtotal,
          totalDurationMinutes: Math.max(15, Math.round(duration || 60)),
          bufferMinutes: Math.max(0, Number(booking.bufferMinutes ?? 0)),

          source: 'AFTERCARE' as any,
          rebookOfBookingId: bookingId,

          // ✅ copy items (no legacy)
          serviceItems: {
            create: items.map((i) => ({
              serviceId: i.serviceId,
              offeringId: i.offeringId,
              priceSnapshot: i.priceSnapshot ?? z,
              durationMinutesSnapshot: Math.max(15, Math.round(Number(i.durationMinutesSnapshot ?? 60))),
              sortOrder: Number.isFinite(Number(i.sortOrder)) ? Number(i.sortOrder) : 0,
            })),
          },
        } as any,
        select: { id: true, scheduledFor: true, status: true },
      })

      const aftercare = await tx.aftercareSummary.upsert({
        where: { bookingId },
        create: {
          bookingId,
          rebookMode: 'BOOKED_NEXT_APPOINTMENT' as any,
          rebookedFor: scheduledFor,
          rebookWindowStart: null,
          rebookWindowEnd: null,
        } as any,
        update: {
          rebookMode: 'BOOKED_NEXT_APPOINTMENT' as any,
          rebookedFor: scheduledFor,
          rebookWindowStart: null,
          rebookWindowEnd: null,
        } as any,
        select: { id: true, rebookMode: true, rebookedFor: true },
      })

      return { nextBooking, aftercare }
    })

    return NextResponse.json(
      { ok: true, mode, nextBookingId: created.nextBooking.id, aftercare: created.aftercare },
      { status: 201 },
    )
  } catch (e) {
    console.error('POST /api/pro/bookings/[id]/rebook error', e)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
