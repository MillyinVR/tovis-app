// app/api/client/bookings/[id]/consultation/approve/route.ts
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'
import { ConsultationApprovalStatus, SessionStep, BookingStatus } from '@prisma/client'

export const dynamic = 'force-dynamic'

type Ctx = { params: { id: string } | Promise<{ id: string }> }

function pickString(v: unknown) {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

function moneyNumber(v: any): number | null {
  if (v == null) return null
  const s = typeof v === 'string' ? v : typeof v === 'number' ? String(v) : String(v?.toString?.() ?? '')
  const n = Number(String(s).replace(/[^0-9.]/g, ''))
  if (!Number.isFinite(n) || n < 0) return null
  return Math.round(n * 100) / 100
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
        discountAmount: true,
        consultationApproval: {
          select: { id: true, status: true, proposedTotal: true, proposedServicesJson: true },
        },
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

    // Allow approving even if someone nudged the step slightly, but it should usually be pending-client
    if (booking.sessionStep !== SessionStep.CONSULTATION_PENDING_CLIENT && booking.sessionStep !== SessionStep.CONSULTATION) {
      return NextResponse.json({ error: 'No consultation approval is pending for this booking.' }, { status: 409 })
    }

    const proposedTotalNum = moneyNumber(booking.consultationApproval.proposedTotal)
    if (proposedTotalNum == null || proposedTotalNum <= 0) {
      return NextResponse.json({ error: 'Proposed total is missing or invalid.' }, { status: 409 })
    }

    const now = new Date()

    const result = await prisma.$transaction(async (tx) => {
      const approval = await tx.consultationApproval.update({
        where: { id: booking.consultationApproval!.id },
        data: {
          status: ConsultationApprovalStatus.APPROVED,
          approvedAt: now,
          rejectedAt: null,
          clientId,
          proId: booking.professionalId,
        },
        select: { id: true, status: true, approvedAt: true, rejectedAt: true },
      })

      // Apply the approved consult total as the canonical booking price snapshot
      // This is what makes the rest of the app show the correct price without rewriting every UI component.
      const updatedBooking = await tx.booking.update({
        where: { id: booking.id },
        data: {
          sessionStep: SessionStep.BEFORE_PHOTOS,
          consultationConfirmedAt: now,
          consultationPrice: proposedTotalNum as any,

          priceSnapshot: proposedTotalNum as any,
          totalAmount: proposedTotalNum as any,

          status: booking.status === BookingStatus.PENDING ? BookingStatus.ACCEPTED : booking.status,
        } as any,
        select: { id: true, sessionStep: true, status: true },
      })

      return { approval, booking: updatedBooking }
    })

    return NextResponse.json({ ok: true, approval: result.approval, booking: result.booking }, { status: 200 })
  } catch (e) {
    console.error('POST /api/client/bookings/[id]/consultation/approve error', e)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
