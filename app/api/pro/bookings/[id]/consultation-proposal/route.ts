// app/api/pro/bookings/[id]/consultation-proposal/route.ts
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'

export const dynamic = 'force-dynamic'

type Ctx = { params: { id: string } | Promise<{ id: string }> }

function pickString(v: unknown) {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

function pickOptionalString(v: unknown) {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

function parseMoneyLike(v: unknown): number | null {
  // Accept number or string like "350", "$350", "350.00"
  if (v === null || v === undefined || v === '') return null

  const num =
    typeof v === 'number'
      ? v
      : typeof v === 'string'
        ? parseFloat(v.replace(/[^0-9.]/g, ''))
        : parseFloat(String(v).replace(/[^0-9.]/g, ''))

  if (!Number.isFinite(num) || num < 0) return null

  // Keep as a number (dollars) because your ConsultationApproval.proposedTotal
  // appears to be a numeric field storing dollars (based on your client UI).
  // If you later move to cents, adjust here.
  return Math.round(num * 100) / 100
}

export async function POST(req: Request, ctx: Ctx) {
  try {
    const user = await getCurrentUser().catch(() => null)
    if (!user || user.role !== 'PRO' || !user.professionalProfile?.id) {
      return NextResponse.json({ error: 'Not authorized' }, { status: 401 })
    }

    const { id } = await Promise.resolve(ctx.params)
    const bookingId = pickString(id)
    if (!bookingId) return NextResponse.json({ error: 'Missing booking id.' }, { status: 400 })

    const body = (await req.json().catch(() => ({}))) as {
      proposedServicesJson?: unknown
      proposedTotal?: unknown
      notes?: unknown
    }

    if (!body?.proposedServicesJson) {
      return NextResponse.json({ error: 'Missing proposed services.' }, { status: 400 })
    }

    const notes = pickOptionalString(body.notes)
    const proposedTotal = parseMoneyLike(body.proposedTotal)

    // Load booking and permissions
    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      select: {
        id: true,
        professionalId: true,
        clientId: true,
        status: true,
        finishedAt: true,
        sessionStep: true,
      },
    })

    if (!booking) return NextResponse.json({ error: 'Booking not found.' }, { status: 404 })
    if (booking.professionalId !== user.professionalProfile.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    if (booking.status === 'CANCELLED' || booking.status === 'COMPLETED' || booking.finishedAt) {
      return NextResponse.json({ error: 'This booking is finalized.' }, { status: 409 })
    }

    // ✅ Atomic: approval + sessionStep must move together
    const result = await prisma.$transaction(async (tx) => {
      const approval = await tx.consultationApproval.upsert({
        where: { bookingId: booking.id },
        create: {
          bookingId: booking.id,
          clientId: booking.clientId,
          proId: booking.professionalId,
          status: 'PENDING',
          proposedServicesJson: body.proposedServicesJson as any,
          proposedTotal,
          notes,
          approvedAt: null,
          rejectedAt: null,
        },
        update: {
          status: 'PENDING',
          proposedServicesJson: body.proposedServicesJson as any,
          proposedTotal,
          notes,
          approvedAt: null,
          rejectedAt: null,
        },
        select: { id: true, status: true, createdAt: true },
      })

      // Move booking into "waiting for client approval"
      const updatedBooking = await tx.booking.update({
        where: { id: booking.id },
        data: { sessionStep: 'CONSULTATION_PENDING_CLIENT' },
        select: { id: true, sessionStep: true },
      })

      return { approval, updatedBooking }
    })

    return NextResponse.json(
      {
        ok: true,
        approval: result.approval,
        sessionStep: result.updatedBooking.sessionStep,
      },
      { status: 200 },
    )
  } catch (e) {
    console.error('POST /api/pro/bookings/[id]/consultation-proposal error', e)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
