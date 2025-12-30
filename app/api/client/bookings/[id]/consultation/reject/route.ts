// app/api/client/bookings/[id]/consultation/reject/route.ts
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
      return NextResponse.json(
        { error: 'No consultation proposal found for this booking yet.' },
        { status: 409 },
      )
    }

    const approvalStatus = upper(booking.consultationApproval.status)

    // If it was already rejected, don’t freak out. Just be idempotent.
    if (approvalStatus === 'REJECTED') {
      return NextResponse.json(
        { ok: true, alreadyRejected: true, sessionStep: booking.sessionStep },
        { status: 200 },
      )
    }

    // MVP rule: once approved, you can’t reject later via this endpoint.
    if (approvalStatus === 'APPROVED') {
      return NextResponse.json(
        { error: 'Consultation is already approved.' },
        { status: 409 },
      )
    }

    if (approvalStatus !== 'PENDING') {
      return NextResponse.json(
        { error: `Consultation is not pending (status=${approvalStatus}).` },
        { status: 409 },
      )
    }

    // Allow rejecting when waiting OR still in consultation
    const step = upper(booking.sessionStep)
    const allowed = step === 'CONSULTATION_PENDING_CLIENT' || step === 'CONSULTATION'
    if (!allowed) {
      return NextResponse.json(
        { error: `Booking is not in a rejectable step (step=${step}).` },
        { status: 409 },
      )
    }

    const updated = await prisma.$transaction(async (tx) => {
      await tx.consultationApproval.update({
        where: { bookingId },
        data: {
          status: 'REJECTED',
          rejectedAt: new Date(),
          approvedAt: null,
          clientId,
        } as any,
      })

      // Kick it back to the pro to revise + resend
      const b = await tx.booking.update({
        where: { id: bookingId },
        data: {
          sessionStep: 'CONSULTATION',
          consultationConfirmedAt: null,
        } as any,
        select: { id: true, sessionStep: true, status: true },
      })

      return b
    })

    return NextResponse.json(
      { ok: true, bookingId: updated.id, sessionStep: updated.sessionStep, status: updated.status },
      { status: 200 },
    )
  } catch (e) {
    console.error('POST /api/client/bookings/[id]/consultation/reject error', e)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
