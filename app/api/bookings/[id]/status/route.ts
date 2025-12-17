// app/api/bookings/[id]/status/route.ts
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'

type BookingStatus = 'PENDING' | 'ACCEPTED' | 'COMPLETED' | 'CANCELLED'

function isBookingStatus(x: unknown): x is BookingStatus {
  return x === 'PENDING' || x === 'ACCEPTED' || x === 'COMPLETED' || x === 'CANCELLED'
}

function allowedTransition(from: BookingStatus, to: BookingStatus): boolean {
  if (from === to) return true
  switch (from) {
    case 'PENDING':
      return to === 'ACCEPTED' || to === 'CANCELLED'
    case 'ACCEPTED':
      return to === 'COMPLETED' || to === 'CANCELLED'
    case 'COMPLETED':
    case 'CANCELLED':
      return false
    default:
      return false
  }
}

type Ctx = { params: { id: string } | Promise<{ id: string }> }

export async function PATCH(req: Request, { params }: Ctx) {
  try {
    const user = await getCurrentUser()
    if (!user || user.role !== 'PRO' || !user.professionalProfile) {
      return NextResponse.json({ error: 'Not authorized' }, { status: 401 })
    }

    const { id } = await Promise.resolve(params)
    if (!id) {
      return NextResponse.json({ error: 'Missing booking id' }, { status: 400 })
    }

    const body = (await req.json().catch(() => ({}))) as { status?: unknown }
    const nextStatusRaw = body.status

    if (!isBookingStatus(nextStatusRaw)) {
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
    }

    const booking = await prisma.booking.findUnique({
      where: { id },
      select: {
        id: true,
        professionalId: true,
        status: true,
        startedAt: true,
        finishedAt: true,
      },
    })

    if (!booking) {
      return NextResponse.json({ error: 'Booking not found' }, { status: 404 })
    }

    if (booking.professionalId !== user.professionalProfile.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const currentStatus = booking.status as BookingStatus
    const nextStatus = nextStatusRaw

    if (!allowedTransition(currentStatus, nextStatus)) {
      return NextResponse.json(
        { error: `Invalid transition: ${currentStatus} → ${nextStatus}` },
        { status: 409 },
      )
    }

    const now = new Date()

    // Optional but support-ticket-saving:
    // - When completing: ensure startedAt exists, set finishedAt.
    // - When cancelling: if they never started, keep times null.
    // - Never let someone “uncomplete” or “uncancel” (blocked above).
    const data: any = { status: nextStatus }

    if (nextStatus === 'COMPLETED') {
      data.startedAt = booking.startedAt ?? now
      data.finishedAt = booking.finishedAt ?? now
    }

    if (nextStatus === 'CANCELLED') {
      // If already started, leave startedAt; clear finishedAt so it isn't "finished".
      data.finishedAt = null
    }

    const updated = await prisma.booking.update({
      where: { id },
      data,
      select: { id: true, status: true },
    })

    return NextResponse.json(
      { id: updated.id, status: updated.status },
      { status: 200 },
    )
  } catch (error) {
    console.error('Booking status update error', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
