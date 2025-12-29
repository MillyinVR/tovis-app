// app/api/client/bookings/[id]/consultation/_decision.ts
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'

export type ConsultationDecisionAction = 'APPROVE' | 'REJECT'

/**
 * Next route handlers commonly pass:
 * - { params: { id: string } }
 * - { params: Promise<{ id: string }> }
 */
export type ConsultationDecisionCtx = {
  params: { id: string } | Promise<{ id: string }>
}

type BookingRow = {
  id: string
  clientId: string
  status: string | null
  startedAt: Date | null
  finishedAt: Date | null
  sessionStep: string | null
}

type ApprovalRow = {
  id: string
  status: string | null
}

function pickString(v: unknown) {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

function upper(v: unknown) {
  return typeof v === 'string' ? v.trim().toUpperCase() : ''
}

function isFinalBooking(b: { status: string | null; finishedAt: Date | null }) {
  const s = upper(b.status)
  return s === 'CANCELLED' || s === 'COMPLETED' || Boolean(b.finishedAt)
}

export async function handleConsultationDecision(action: ConsultationDecisionAction, ctx: ConsultationDecisionCtx) {
  try {
    const user = await getCurrentUser().catch(() => null)
    if (!user || user.role !== 'CLIENT' || !user.clientProfile?.id) {
      return NextResponse.json({ error: 'Not authorized' }, { status: 401 })
    }

    // ✅ Folder is [id], so ctx.params must provide id
    const { id: rawId } = await Promise.resolve(ctx.params as any)
    const bookingId = pickString(rawId)
    if (!bookingId) {
      return NextResponse.json({ error: 'Missing booking id.' }, { status: 400 })
    }

    const booking = (await prisma.booking.findUnique({
      where: { id: bookingId },
      select: {
        id: true,
        clientId: true,
        status: true,
        startedAt: true,
        finishedAt: true,
        sessionStep: true,
      },
    })) as BookingRow | null

    if (!booking) return NextResponse.json({ error: 'Booking not found.' }, { status: 404 })
    if (booking.clientId !== user.clientProfile.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    if (isFinalBooking({ status: booking.status, finishedAt: booking.finishedAt })) {
      return NextResponse.json({ error: 'This booking is finalized.' }, { status: 409 })
    }

    // Product policy: if pro already started the session, freeze consult decision.
    if (booking.startedAt) {
      return NextResponse.json(
        { error: "Session already started. Consultation can't be changed." },
        { status: 409 },
      )
    }

    const approval = (await prisma.consultationApproval.findUnique({
      where: { bookingId: booking.id },
      select: { id: true, status: true },
    })) as ApprovalRow | null

    if (!approval) return NextResponse.json({ error: 'No consultation proposal found.' }, { status: 404 })

    if (upper(approval.status) !== 'PENDING') {
      return NextResponse.json({ error: 'This consultation is already decided.' }, { status: 409 })
    }

    const step = upper(booking.sessionStep)
    const expected = 'CONSULTATION_PENDING_CLIENT'
    if (step && step !== expected) {
      return NextResponse.json(
        { error: `Not expecting client approval right now (step: ${step}).` },
        { status: 409 },
      )
    }

    const now = new Date()

    if (action === 'APPROVE') {
      const result = await prisma.$transaction(async (tx) => {
        const updatedApproval = await tx.consultationApproval.update({
          where: { id: approval.id },
          data: { status: 'APPROVED', approvedAt: now },
          select: { status: true, approvedAt: true },
        })

        const updatedBooking = await tx.booking.update({
          where: { id: booking.id },
          data: { sessionStep: 'BEFORE_PHOTOS' },
          select: { sessionStep: true },
        })

        return { updatedApproval, updatedBooking }
      })

      return NextResponse.json(
        {
          ok: true,
          status: result.updatedApproval.status,
          approvedAt: result.updatedApproval.approvedAt,
          sessionStep: result.updatedBooking.sessionStep,
        },
        { status: 200 },
      )
    }

    // action === 'REJECT'
    const result = await prisma.$transaction(async (tx) => {
      const updatedApproval = await tx.consultationApproval.update({
        where: { id: approval.id },
        data: { status: 'REJECTED', rejectedAt: now },
        select: { status: true, rejectedAt: true },
      })

      const updatedBooking = await tx.booking.update({
        where: { id: booking.id },
        data: { sessionStep: 'CONSULTATION' },
        select: { sessionStep: true },
      })

      return { updatedApproval, updatedBooking }
    })

    return NextResponse.json(
      {
        ok: true,
        status: result.updatedApproval.status,
        rejectedAt: result.updatedApproval.rejectedAt,
        sessionStep: result.updatedBooking.sessionStep,
      },
      { status: 200 },
    )
  } catch (e) {
    console.error('handleConsultationDecision error', e)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
