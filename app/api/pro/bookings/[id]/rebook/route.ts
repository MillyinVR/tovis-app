// app/api/pro/bookings/[id]/rebook/route.ts
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'

export const dynamic = 'force-dynamic'

type RebookMode = 'BOOK' | 'RECOMMEND_WINDOW' | 'CLEAR'

type Body = {
  mode?: unknown // 'BOOK' | 'RECOMMEND_WINDOW' | 'CLEAR'
  // BOOK
  scheduledFor?: unknown // ISO string (required for BOOK)

  // RECOMMEND_WINDOW
  windowStart?: unknown // ISO string (required for RECOMMEND_WINDOW)
  windowEnd?: unknown // ISO string (required for RECOMMEND_WINDOW)
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

export async function POST(req: Request, { params }: Ctx) {
  try {
    const user = await getCurrentUser().catch(() => null)
    if (!user || user.role !== 'PRO' || !user.professionalProfile?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id: originalBookingId } = await Promise.resolve(params)
    if (!originalBookingId?.trim()) return badRequest('Missing booking id.')

    const body = (await req.json().catch(() => ({}))) as Body
    const modeRaw = body.mode ?? 'BOOK'
    const mode: RebookMode = isMode(modeRaw) ? modeRaw : 'BOOK'

    const booking = await prisma.booking.findUnique({
      where: { id: originalBookingId },
      select: {
        id: true,
        status: true,
        clientId: true,
        professionalId: true,
        serviceId: true,
        offeringId: true,
        priceSnapshot: true,
        durationMinutesSnapshot: true,
        locationType: true,
      },
    })

    if (!booking) return NextResponse.json({ error: 'Booking not found.' }, { status: 404 })
    if (booking.professionalId !== user.professionalProfile.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Policy: only completed bookings can produce aftercare-driven rebooks
    if (booking.status !== 'COMPLETED') {
      return NextResponse.json({ error: 'Only COMPLETED bookings can be rebooked.' }, { status: 409 })
    }

    // ✅ CLEAR mode: wipe rebook guidance (sometimes pros change their mind)
    if (mode === 'CLEAR') {
      const aftercare = await prisma.aftercareSummary.upsert({
        where: { bookingId: booking.id },
        create: {
          bookingId: booking.id,
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

      if (!windowStart || !windowEnd) {
        return badRequest('windowStart and windowEnd are required ISO strings for RECOMMEND_WINDOW.')
      }
      if (windowEnd <= windowStart) {
        return badRequest('windowEnd must be after windowStart.')
      }

      const aftercare = await prisma.aftercareSummary.upsert({
        where: { bookingId: booking.id },
        create: {
          bookingId: booking.id,
          rebookMode: 'RECOMMENDED_WINDOW' as any,
          rebookWindowStart: windowStart,
          rebookWindowEnd: windowEnd,
          rebookedFor: null, // important: don’t pretend there’s a booked date
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

      return NextResponse.json(
        {
          ok: true,
          mode,
          aftercare,
        },
        { status: 200 },
      )
    }

    // ✅ BOOK mode: create the next booking now
    const scheduledFor = parseISODate(body.scheduledFor)
    if (!scheduledFor) {
      return badRequest('scheduledFor is required (ISO string) for BOOK mode.')
    }

    const now = new Date()
    if (scheduledFor.getTime() < now.getTime() - 60_000) {
      return badRequest('scheduledFor must be in the future.')
    }

    const created = await prisma.$transaction(async (tx) => {
      const nextBooking = await tx.booking.create({
        data: {
          clientId: booking.clientId,
          professionalId: booking.professionalId,
          serviceId: booking.serviceId,
          offeringId: booking.offeringId,
          scheduledFor,
          status: 'ACCEPTED',
          locationType: booking.locationType,
          priceSnapshot: booking.priceSnapshot,
          durationMinutesSnapshot: booking.durationMinutesSnapshot,

          source: 'AFTERCARE',
          rebookOfBookingId: booking.id,
        } as any,
        select: { id: true, scheduledFor: true, status: true },
      })

      const aftercare = await tx.aftercareSummary.upsert({
        where: { bookingId: booking.id },
        create: {
          bookingId: booking.id,
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
      {
        ok: true,
        mode,
        nextBookingId: created.nextBooking.id,
        aftercare: created.aftercare,
      },
      { status: 201 },
    )
  } catch (e) {
    console.error('POST /api/pro/bookings/[id]/rebook error', e)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
