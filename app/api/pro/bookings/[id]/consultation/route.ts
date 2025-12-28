// app/api/pro/bookings/[id]/consultation/route.ts
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'

export const dynamic = 'force-dynamic'

type Ctx = { params: { id: string } | Promise<{ id: string }> }

function pickString(v: unknown) {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

function parseMoneyToNumber(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === '') return null
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null
  if (typeof raw !== 'string') return null

  const cleaned = raw.replace(/\$/g, '').replace(/,/g, '').trim()
  if (!cleaned) return null

  // allow "350", "350.00", ".99"
  const normalized = cleaned.startsWith('.') ? `0${cleaned}` : cleaned
  const n = Number(normalized)
  if (!Number.isFinite(n) || n < 0) return null

  // clamp to 2 decimals (avoid floating garbage)
  return Math.round(n * 100) / 100
}

export async function POST(request: Request, ctx: Ctx) {
  try {
    const { id } = await Promise.resolve(ctx.params)
    const bookingId = pickString(id)
    if (!bookingId) return NextResponse.json({ error: 'Missing booking id.' }, { status: 400 })

    const user = await getCurrentUser().catch(() => null)
    if (!user || user.role !== 'PRO' || !user.professionalProfile?.id) {
      return NextResponse.json({ error: 'Not authorized' }, { status: 401 })
    }

    const body = (await request.json().catch(() => ({}))) as any

    const notes = typeof body?.notes === 'string' ? body.notes.trim() : ''

    // accept either key to reduce “client/server mismatch” misery
    const proposedTotal =
      parseMoneyToNumber(body?.proposedTotal) ?? parseMoneyToNumber(body?.price)

    if (proposedTotal === null) {
      return NextResponse.json({ error: 'Enter a valid consultation price.' }, { status: 400 })
    }

    const proposedServicesJson =
      body?.proposedServicesJson && typeof body.proposedServicesJson === 'object'
        ? body.proposedServicesJson
        : null

    // Confirm booking exists + belongs to this pro
    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      select: {
        id: true,
        professionalId: true,
        status: true,
        sessionStep: true,
      },
    })

    if (!booking) return NextResponse.json({ error: 'Booking not found.' }, { status: 404 })
    if (booking.professionalId !== user.professionalProfile.id) {
      return NextResponse.json({ error: 'You can only edit your own bookings.' }, { status: 403 })
    }

    if (booking.status === 'CANCELLED') {
      return NextResponse.json({ error: 'Cancelled bookings cannot be updated.' }, { status: 409 })
    }

    if (booking.status === 'COMPLETED') {
      return NextResponse.json({ error: 'Completed bookings cannot be updated.' }, { status: 409 })
    }

    const now = new Date()

    // One transaction: save consultation + create/update approval + advance session step
    const result = await prisma.$transaction(async (tx) => {
      const updatedBooking = await tx.booking.update({
        where: { id: bookingId },
        data: {
          consultationNotes: notes || null,
          consultationPrice: proposedTotal, // Decimal or Float in Prisma is fine with number
          consultationConfirmedAt: now,
          sessionStep: 'CONSULTATION_PENDING_CLIENT',
        },
        select: {
          id: true,
          consultationNotes: true,
          consultationPrice: true,
          consultationConfirmedAt: true,
          sessionStep: true,
        },
      })

      const approval = await tx.consultationApproval.upsert({
        where: { bookingId: bookingId },
        create: {
          bookingId: bookingId,
          status: 'PENDING',
          proposedTotal: proposedTotal,
          proposedServicesJson: proposedServicesJson,
          notes: notes || null,
        },
        update: {
          status: 'PENDING',
          proposedTotal: proposedTotal,
          proposedServicesJson: proposedServicesJson,
          notes: notes || null,
        },
        select: {
          id: true,
          bookingId: true,
          status: true,
          proposedTotal: true,
        },
      })

      return { updatedBooking, approval }
    })

    return NextResponse.json(
      {
        ok: true,
        booking: {
          id: result.updatedBooking.id,
          sessionStep: result.updatedBooking.sessionStep,
          consultationNotes: result.updatedBooking.consultationNotes,
          consultationPrice: result.updatedBooking.consultationPrice,
          consultationConfirmedAt: result.updatedBooking.consultationConfirmedAt,
        },
        consultationApproval: result.approval,
      },
      { status: 200 },
    )
  } catch (error) {
    console.error('POST /api/pro/bookings/[id]/consultation error', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
