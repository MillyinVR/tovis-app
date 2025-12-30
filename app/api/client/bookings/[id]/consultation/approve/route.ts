// app/api/client/bookings/[id]/consultation/approve/route.ts
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'

export const dynamic = 'force-dynamic'

type Ctx = { params: { id: string } | Promise<{ id: string }> }

function pickString(v: unknown) {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

function upper(v: unknown) {
  return typeof v === 'string' ? v.trim().toUpperCase() : ''
}

export async function POST(_req: Request, ctx: Ctx) {
  try {
    const user = await getCurrentUser().catch(() => null)
    if (!user || user.role !== 'CLIENT' || !user.clientProfile?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id } = await Promise.resolve(ctx.params)
    const bookingId = pickString(id)
    if (!bookingId) return NextResponse.json({ error: 'Missing booking id.' }, { status: 400 })

    const clientId = user.clientProfile.id

    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      select: {
        id: true,
        status: true,
        clientId: true,
        professionalId: true,
        sessionStep: true,
        consultationApproval: {
          select: { id: true, status: true },
        },
      },
    })

    if (!booking) return NextResponse.json({ error: 'Booking not found.' }, { status: 404 })
    if (booking.clientId !== clientId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const bookingStatus = upper(booking.status)
    if (bookingStatus === 'CANCELLED') {
      return NextResponse.json({ error: 'This booking is cancelled.' }, { status: 409 })
    }

    if (!booking.consultationApproval?.id) {
      // This is the most common cause of your exact symptom.
      return NextResponse.json(
        { error: 'No consultation proposal found for this booking yet.' },
        { status: 409 },
      )
    }

    const approvalStatus = upper(booking.consultationApproval.status)

    // ✅ Idempotent behavior: approving twice is not a crime.
    if (approvalStatus === 'APPROVED') {
      return NextResponse.json(
        { ok: true, alreadyApproved: true, sessionStep: booking.sessionStep },
        { status: 200 },
      )
    }

    if (approvalStatus !== 'PENDING') {
      return NextResponse.json(
        { error: `Consultation is not pending (status=${approvalStatus}).` },
        { status: 409 },
      )
    }

    // If you want to be strict, keep this.
    // If you want to be forgiving, allow CONSULTATION too.
    const step = upper(booking.sessionStep)
    const allowed = step === 'CONSULTATION_PENDING_CLIENT' || step === 'CONSULTATION'
    if (!allowed) {
      return NextResponse.json(
        { error: `Booking is not waiting for client approval (step=${step}).` },
        { status: 409 },
      )
    }

    const result = await prisma.$transaction(async (tx) => {
      await tx.consultationApproval.update({
        where: { bookingId: bookingId },
        data: {
          status: 'APPROVED',
          approvedAt: new Date(),
          rejectedAt: null,
          clientId,
        } as any,
      })

      const updatedBooking = await tx.booking.update({
        where: { id: bookingId },
        data: {
          consultationConfirmedAt: new Date(),
          sessionStep: 'BEFORE_PHOTOS',
          status: bookingStatus === 'PENDING' ? 'ACCEPTED' : (booking.status as any),
        } as any,
        select: { id: true, sessionStep: true, status: true },
      })

      return updatedBooking
    })

    return NextResponse.json(
      { ok: true, bookingId: result.id, sessionStep: result.sessionStep, status: result.status },
      { status: 200 },
    )
  } catch (e) {
    console.error('POST /api/client/bookings/[id]/consultation/approve error', e)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
