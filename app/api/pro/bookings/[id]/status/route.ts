// app/api/pro/bookings/[id]/status/route.ts
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'

export const dynamic = 'force-dynamic'

type Ctx = { params: { id: string } | Promise<{ id: string }> }

function pickString(v: unknown) {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

export async function PATCH(req: Request, { params }: Ctx) {
  try {
    const user = await getCurrentUser().catch(() => null)
    if (!user || user.role !== 'PRO' || !user.professionalProfile?.id) {
      return NextResponse.json({ ok: false, error: 'Not authorized' }, { status: 401 })
    }

    const { id } = await Promise.resolve(params)
    const bookingId = pickString(id)
    if (!bookingId) {
      return NextResponse.json({ ok: false, error: 'Missing booking id' }, { status: 400 })
    }

    const body = (await req.json().catch(() => ({}))) as { status?: unknown }
    const next = pickString(body.status)?.toUpperCase()

    // This endpoint is ACCEPT-only. Start/finish/cancel are separate routes.
    if (next !== 'ACCEPTED') {
      return NextResponse.json(
        { ok: false, error: 'Invalid status. Use start/finish/cancel endpoints.' },
        { status: 400 },
      )
    }

    const proId = user.professionalProfile.id

    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      select: { id: true, professionalId: true, status: true, finishedAt: true },
    })

    if (!booking) return NextResponse.json({ ok: false, error: 'Booking not found' }, { status: 404 })
    if (booking.professionalId !== proId) return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 })

    if (booking.status === 'CANCELLED' || booking.status === 'COMPLETED' || booking.finishedAt) {
      return NextResponse.json(
        { ok: false, error: 'Cannot accept a completed/cancelled booking.' },
        { status: 409 },
      )
    }

    if (booking.status !== 'PENDING') {
      return NextResponse.json(
        { ok: false, error: `Invalid transition: ${booking.status} -> ACCEPTED` },
        { status: 409 },
      )
    }

    const updated = await prisma.booking.update({
      where: { id: booking.id },
      data: { status: 'ACCEPTED' },
      select: { id: true, status: true },
    })

    return NextResponse.json({ ok: true, booking: updated }, { status: 200 })
  } catch (e) {
    console.error('PATCH /api/pro/bookings/[id]/status error', e)
    return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500 })
  }
}
