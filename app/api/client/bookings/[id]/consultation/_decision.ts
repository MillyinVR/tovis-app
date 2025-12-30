// app/api/client/bookings/[id]/consultation/_decision.ts
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'

export type ConsultationDecisionAction = 'APPROVE' | 'REJECT'

export type ConsultationDecisionCtx = {
  params: { id: string } | Promise<{ id: string }>
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
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id } = await Promise.resolve(ctx.params as any)
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
        finishedAt: true,
        startedAt: true,
        consultationApproval: { select: { id: true, status: true } },
      },
    })

    if (!booking) return NextResponse.json({ error: 'Booking not found.' }, { status: 404 })
    if (booking.clientId !== clientId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const bookingStatus = upper(booking.status)

    if (isFinalBooking({ status: booking.status, finishedAt: booking.finishedAt })) {
      return NextResponse.json({ error: 'This booking is finalized.' }, { status: 409 })
    }

    if (bookingStatus === 'CANCELLED') {
      return NextResponse.json({ error: 'This booking is cancelled.' }, { status: 409 })
    }

    if (!booking.consultationApproval?.id) {
      return NextResponse.json({ error: 'No consultation proposal found for this booking yet.' }, { status: 409 })
    }

    const approvalStatus = upper(booking.consultationApproval.status)

    // ✅ Idempotent behavior
    if (action === 'APPROVE' && approvalStatus === 'APPROVED') {
      return NextResponse.json(
        { ok: true, alreadyApproved: true, sessionStep: booking.sessionStep, status: booking.status },
        { status: 200 },
      )
    }
    if (action === 'REJECT' && approvalStatus === 'REJECTED') {
      return NextResponse.json(
        { ok: true, alreadyRejected: true, sessionStep: booking.sessionStep, status: booking.status },
        { status: 200 },
      )
    }

    // MVP rule: once approved, don’t allow reject via this endpoint
    if (action === 'REJECT' && approvalStatus === 'APPROVED') {
      return NextResponse.json({ error: 'Consultation is already approved.' }, { status: 409 })
    }

    if (approvalStatus !== 'PENDING') {
      return NextResponse.json({ error: `Consultation is not pending (status=${approvalStatus}).` }, { status: 409 })
    }

    // ✅ Be forgiving: allow approval/reject while in CONSULTATION or CONSULTATION_PENDING_CLIENT
    const step = upper(booking.sessionStep)
    const allowed = step === 'CONSULTATION_PENDING_CLIENT' || step === 'CONSULTATION' || step === ''
    if (!allowed) {
      return NextResponse.json(
        { error: `Booking is not waiting for client decision (step=${step || 'UNKNOWN'}).` },
        { status: 409 },
      )
    }

    // IMPORTANT:
    // We intentionally do NOT hard-block based on startedAt here.
    // If you later guarantee startedAt only sets when service truly begins, we can reintroduce a strict gate.

    const now = new Date()

    if (action === 'APPROVE') {
      const updated = await prisma.$transaction(async (tx) => {
        await tx.consultationApproval.update({
          where: { bookingId },
          data: {
            status: 'APPROVED',
            approvedAt: now,
            rejectedAt: null,
            clientId,
          } as any,
        })

        const b = await tx.booking.update({
          where: { id: bookingId },
          data: {
            consultationConfirmedAt: now,
            sessionStep: 'BEFORE_PHOTOS',
            status: bookingStatus === 'PENDING' ? 'ACCEPTED' : (booking.status as any),
          } as any,
          select: { id: true, sessionStep: true, status: true },
        })

        return b
      })

      return NextResponse.json(
        { ok: true, bookingId: updated.id, sessionStep: updated.sessionStep, status: updated.status },
        { status: 200 },
      )
    }

    // action === 'REJECT'
    const updated = await prisma.$transaction(async (tx) => {
      await tx.consultationApproval.update({
        where: { bookingId },
        data: {
          status: 'REJECTED',
          rejectedAt: now,
          approvedAt: null,
          clientId,
        } as any,
      })

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
    console.error('handleConsultationDecision error', e)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
