// app/api/pro/bookings/[id]/start/route.ts
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'

export const dynamic = 'force-dynamic'

type Ctx = { params: { id: string } | Promise<{ id: string }> }

function upper(v: unknown) {
  return typeof v === 'string' ? v.trim().toUpperCase() : ''
}

export async function POST(_request: Request, ctx: Ctx) {
  try {
    const { id } = await Promise.resolve(ctx.params)
    const bookingId = String(id || '').trim()
    if (!bookingId) return NextResponse.json({ error: 'Missing booking id.' }, { status: 400 })

    const user = await getCurrentUser().catch(() => null)
    if (!user || user.role !== 'PRO' || !user.professionalProfile?.id) {
      return NextResponse.json({ error: 'Not authorized' }, { status: 401 })
    }

    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      select: {
        id: true,
        professionalId: true,
        status: true,
        startedAt: true,
        finishedAt: true,
        sessionStep: true,
        consultationApproval: { select: { status: true } },
      },
    })

    if (!booking) return NextResponse.json({ error: 'Booking not found.' }, { status: 404 })
    if (booking.professionalId !== user.professionalProfile.id) {
      return NextResponse.json({ error: 'You can only start your own bookings.' }, { status: 403 })
    }

    const status = upper(booking.status)

    if (status === 'CANCELLED') {
      return NextResponse.json({ error: 'Cancelled bookings cannot be started.' }, { status: 409 })
    }
    if (status === 'COMPLETED' || booking.finishedAt) {
      return NextResponse.json({ error: 'This session is already finished.' }, { status: 409 })
    }

    // ✅ Gate: client must approve consultation before pro can start
    const approvalStatus = upper(booking.consultationApproval?.status)
    if (approvalStatus !== 'APPROVED') {
      return NextResponse.json(
        { error: 'Waiting for client to approve services and pricing before you can start.' },
        { status: 409 },
      )
    }

    // ✅ Idempotent: already started is fine
    if (booking.startedAt) {
      return NextResponse.json(
        { id: booking.id, startedAt: booking.startedAt, status: booking.status, sessionStep: booking.sessionStep },
        { status: 200 },
      )
    }

    const now = new Date()

    const updated = await prisma.booking.update({
      where: { id: booking.id },
      data: {
        startedAt: now,
        status: status === 'PENDING' ? 'ACCEPTED' : (booking.status as any),
        // ✅ Once started, we are in the session.
        sessionStep: 'SERVICE_IN_PROGRESS',
      } as any,
      select: { id: true, startedAt: true, status: true, sessionStep: true },
    })

    return NextResponse.json(updated, { status: 200 })
  } catch (err) {
    console.error('Booking start error', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
