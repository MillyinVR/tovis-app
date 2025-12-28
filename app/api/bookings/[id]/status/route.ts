// app/api/bookings/[id]/status/route.ts
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'

export const dynamic = 'force-dynamic'

type BookingStatus = 'PENDING' | 'ACCEPTED' | 'COMPLETED' | 'CANCELLED'
type Ctx = { params: { id: string } | Promise<{ id: string }> }

function isBookingStatus(x: unknown): x is BookingStatus {
  return x === 'PENDING' || x === 'ACCEPTED' || x === 'COMPLETED' || x === 'CANCELLED'
}

export async function PATCH(req: Request, { params }: Ctx) {
  try {
    const user = await getCurrentUser().catch(() => null)
    if (!user || user.role !== 'PRO' || !user.professionalProfile?.id) {
      return NextResponse.json({ error: 'Not authorized' }, { status: 401 })
    }

    const { id } = await Promise.resolve(params)
    if (!id?.trim()) return NextResponse.json({ error: 'Missing booking id' }, { status: 400 })

    const body = (await req.json().catch(() => ({}))) as { status?: unknown }
    if (!isBookingStatus(body.status)) {
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
    }

    const nextStatus = body.status

    // Enforce the new flow:
    if (nextStatus === 'CANCELLED') {
      return NextResponse.json({ error: 'Use POST /api/bookings/[id]/cancel' }, { status: 409 })
    }
    if (nextStatus === 'COMPLETED') {
      return NextResponse.json({ error: 'Use POST /api/pro/bookings/[id]/finish' }, { status: 409 })
    }

    const booking = await prisma.booking.findUnique({
      where: { id },
      select: { id: true, professionalId: true, status: true, finishedAt: true },
    })

    if (!booking) return NextResponse.json({ error: 'Booking not found' }, { status: 404 })
    if (booking.professionalId !== user.professionalProfile.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    if (booking.status === 'CANCELLED' || booking.status === 'COMPLETED' || booking.finishedAt) {
      return NextResponse.json({ error: 'Cannot change status after completion/cancel.' }, { status: 409 })
    }

    // Only allow: PENDING -> ACCEPTED (manual accept)
    if (!(booking.status === 'PENDING' && nextStatus === 'ACCEPTED')) {
      return NextResponse.json({ error: `Invalid transition: ${booking.status} → ${nextStatus}` }, { status: 409 })
    }

    const updated = await prisma.booking.update({
      where: { id: booking.id },
      data: { status: 'ACCEPTED' },
      select: { id: true, status: true },
    })

    return NextResponse.json({ id: updated.id, status: updated.status }, { status: 200 })
  } catch (e) {
    console.error('PATCH /api/bookings/[id]/status error', e)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
