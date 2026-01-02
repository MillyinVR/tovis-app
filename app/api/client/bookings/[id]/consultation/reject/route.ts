// app/api/client/bookings/[id]/consultation/reject/route.ts
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'
import { ConsultationApprovalStatus, SessionStep, BookingStatus } from '@prisma/client'

export const dynamic = 'force-dynamic'

type Ctx = { params: { id: string } | Promise<{ id: string }> }

function pickString(v: unknown) {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

export async function POST(_req: Request, ctx: Ctx) {
  try {
    const user = await getCurrentUser().catch(() => null)
    if (!user || user.role !== 'CLIENT' || !user.clientProfile?.id) {
      return NextResponse.json({ error: 'Not authorized' }, { status: 401 })
    }

    const { id } = await Promise.resolve(ctx.params)
    const bookingId = pickString(id)
    if (!bookingId) return NextResponse.json({ error: 'Missing booking id.' }, { status: 400 })

    const clientId = user.clientProfile.id

    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      select: {
        id: true,
        clientId: true,
        professionalId: true,
        status: true,
        sessionStep: true,
        finishedAt: true,
        consultationApproval: { select: { id: true, status: true } },
      },
    })

    if (!booking) return NextResponse.json({ error: 'Booking not found.' }, { status: 404 })
    if (booking.clientId !== clientId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    if (booking.status === BookingStatus.CANCELLED) {
      return NextResponse.json({ error: 'This booking is cancelled.' }, { status: 409 })
    }
    if (booking.status === BookingStatus.COMPLETED || booking.finishedAt) {
      return NextResponse.json({ error: 'This booking is completed.' }, { status: 409 })
    }

    if (!booking.consultationApproval?.id) {
      return NextResponse.json({ error: 'Missing consultation approval record.' }, { status: 409 })
    }
    if (booking.consultationApproval.status !== ConsultationApprovalStatus.PENDING) {
      return NextResponse.json({ error: 'This consultation is not pending.' }, { status: 409 })
    }

    const now = new Date()

    const result = await prisma.$transaction(async (tx) => {
      const approval = await tx.consultationApproval.update({
        where: { id: booking.consultationApproval!.id },
        data: {
          status: ConsultationApprovalStatus.REJECTED,
          rejectedAt: now,
          approvedAt: null,
          clientId,
          proId: booking.professionalId,
        },
        select: { id: true, status: true, approvedAt: true, rejectedAt: true },
      })

      const updatedBooking = await tx.booking.update({
        where: { id: booking.id },
        data: {
          sessionStep: SessionStep.CONSULTATION,
          consultationConfirmedAt: null,
        } as any,
        select: { id: true, sessionStep: true, status: true },
      })

      return { approval, booking: updatedBooking }
    })

    return NextResponse.json({ ok: true, approval: result.approval, booking: result.booking }, { status: 200 })
  } catch (e) {
    console.error('POST /api/client/bookings/[id]/consultation/reject error', e)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
