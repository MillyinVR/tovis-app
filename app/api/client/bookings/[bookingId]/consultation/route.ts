// app/api/client/bookings/[bookingId]/consultation/route.ts
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'

export const dynamic = 'force-dynamic'

type Ctx = { params: { bookingId: string } | Promise<{ bookingId: string }> }

function pickString(v: unknown) {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

function isFinalBooking(b: { status: string; finishedAt: unknown }) {
  const s = String(b.status || '').toUpperCase()
  return s === 'CANCELLED' || s === 'COMPLETED' || Boolean(b.finishedAt)
}

export async function GET(_req: Request, ctx: Ctx) {
  try {
    const user = await getCurrentUser().catch(() => null)
    if (!user || user.role !== 'CLIENT' || !user.clientProfile?.id) {
      return NextResponse.json({ error: 'Not authorized' }, { status: 401 })
    }

    const { bookingId } = await Promise.resolve(ctx.params)
    const id = pickString(bookingId)
    if (!id) return NextResponse.json({ error: 'Missing booking id.' }, { status: 400 })

    const booking = await prisma.booking.findUnique({
      where: { id },
      select: {
        id: true,
        clientId: true,
        professionalId: true,
        status: true,
        startedAt: true,
        finishedAt: true,
        sessionStep: true,
      },
    })

    if (!booking) return NextResponse.json({ error: 'Booking not found.' }, { status: 404 })
    if (booking.clientId !== user.clientProfile.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const approval = await prisma.consultationApproval.findUnique({
      where: { bookingId: booking.id },
      select: {
        id: true,
        status: true,
        proposedServicesJson: true,
        proposedTotal: true,
        notes: true,
        createdAt: true,
        approvedAt: true,
        rejectedAt: true,
      },
    })

    if (!approval) {
      return NextResponse.json({ error: 'No consultation proposal found.' }, { status: 404 })
    }

    return NextResponse.json({ ok: true, booking, approval }, { status: 200 })
  } catch (e) {
    console.error('GET /api/client/bookings/[bookingId]/consultation error', e)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(req: Request, ctx: Ctx) {
  try {
    const user = await getCurrentUser().catch(() => null)
    if (!user || user.role !== 'CLIENT' || !user.clientProfile?.id) {
      return NextResponse.json({ error: 'Not authorized' }, { status: 401 })
    }

    const { bookingId } = await Promise.resolve(ctx.params)
    const id = pickString(bookingId)
    if (!id) return NextResponse.json({ error: 'Missing booking id.' }, { status: 400 })

    const body = (await req.json().catch(() => ({}))) as { action?: unknown }
    const action = typeof body.action === 'string' ? body.action.toUpperCase() : ''
    if (action !== 'APPROVE' && action !== 'REJECT') {
      return NextResponse.json({ error: 'Invalid action.' }, { status: 400 })
    }

    const booking = await prisma.booking.findUnique({
      where: { id },
      select: {
        id: true,
        clientId: true,
        status: true,
        startedAt: true,
        finishedAt: true,
        sessionStep: true,
      },
    })

    if (!booking) return NextResponse.json({ error: 'Booking not found.' }, { status: 404 })
    if (booking.clientId !== user.clientProfile.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    if (isFinalBooking({ status: booking.status, finishedAt: booking.finishedAt })) {
      return NextResponse.json({ error: 'This booking is finalized.' }, { status: 409 })
    }

    // If the pro already started, client should not be able to approve/reject retroactively.
    if (booking.startedAt) {
      return NextResponse.json({ error: 'Session already started. Consultation can’t be changed.' }, { status: 409 })
    }

    const approval = await prisma.consultationApproval.findUnique({
      where: { bookingId: booking.id },
      select: { id: true, status: true },
    })

    if (!approval) return NextResponse.json({ error: 'No consultation proposal found.' }, { status: 404 })
    if (approval.status !== 'PENDING') {
      return NextResponse.json({ error: 'This consultation is already decided.' }, { status: 409 })
    }

    // Enforce step sanity (keeps the flow clean)
    const step = String(booking.sessionStep || '').toUpperCase()
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

    // REJECT
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
    console.error('POST /api/client/bookings/[bookingId]/consultation error', e)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
