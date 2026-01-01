// app/api/pro/bookings/[id]/consultation/route.ts
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'

export const dynamic = 'force-dynamic'

type Ctx = { params: { id: string } | Promise<{ id: string }> }

function asTrimmedString(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

function upper(v: unknown): string {
  return typeof v === 'string' ? v.trim().toUpperCase() : ''
}

function jsonError(message: string, status: number) {
  return NextResponse.json({ ok: false, error: message }, { status })
}

/**
 * Parses money-ish input into a number with 2 decimals max.
 * Accepts: 350, "350", "350.00", "$350", "1,200.50", ".99"
 */
function parseMoneyToNumber(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === '') return null
  if (typeof raw === 'number') return Number.isFinite(raw) && raw >= 0 ? Math.round(raw * 100) / 100 : null
  if (typeof raw !== 'string') return null

  const cleaned = raw.replace(/\$/g, '').replace(/,/g, '').trim()
  if (!cleaned) return null

  const normalized = cleaned.startsWith('.') ? `0${cleaned}` : cleaned
  const n = Number(normalized)
  if (!Number.isFinite(n) || n < 0) return null

  return Math.round(n * 100) / 100
}

export async function POST(request: Request, ctx: Ctx) {
  try {
    const { id } = await Promise.resolve(ctx.params)
    const bookingId = asTrimmedString(id)
    if (!bookingId) return jsonError('Missing booking id.', 400)

    const user = await getCurrentUser().catch(() => null)
    const proId = user?.role === 'PRO' ? user.professionalProfile?.id : null
    if (!proId) return jsonError('Not authorized', 401)

    const body = (await request.json().catch(() => ({}))) as any

    const notes = typeof body?.notes === 'string' ? body.notes.trim() : ''

    // accept either key to reduce “client/server mismatch” misery
    const proposedTotal = parseMoneyToNumber(body?.proposedTotal) ?? parseMoneyToNumber(body?.price)
    if (proposedTotal === null) return jsonError('Enter a valid consultation price.', 400)

    const proposedServicesJson =
      body?.proposedServicesJson && typeof body.proposedServicesJson === 'object' ? body.proposedServicesJson : null

    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      select: { id: true, professionalId: true, status: true, finishedAt: true, sessionStep: true },
    })

    if (!booking) return jsonError('Booking not found.', 404)
    if (booking.professionalId !== proId) return jsonError('You can only edit your own bookings.', 403)

    const st = upper(booking.status)
    if (st === 'CANCELLED') return jsonError('Cancelled bookings cannot be updated.', 409)
    if (st === 'COMPLETED' || booking.finishedAt) return jsonError('Completed bookings cannot be updated.', 409)

    const now = new Date()

    const result = await prisma.$transaction(async (tx) => {
      // booking stores a client-visible snapshot
      const updatedBooking = await tx.booking.update({
        where: { id: bookingId },
        data: {
          consultationNotes: notes || null,
          consultationPrice: proposedTotal,
          consultationConfirmedAt: now,
          sessionStep: 'CONSULTATION_PENDING_CLIENT' as any,
        },
        select: {
          id: true,
          consultationNotes: true,
          consultationPrice: true,
          consultationConfirmedAt: true,
          sessionStep: true,
        },
      })

      // approval is the “state machine” for approve/reject
      const approval = await tx.consultationApproval.upsert({
        where: { bookingId },
        create: {
          bookingId,
          status: 'PENDING',
          proposedTotal,
          proposedServicesJson,
          notes: notes || null,
        },
        update: {
          status: 'PENDING',
          proposedTotal,
          proposedServicesJson,
          notes: notes || null,
          approvedAt: null,
          rejectedAt: null,
        },
        select: {
          id: true,
          bookingId: true,
          status: true,
          proposedTotal: true,
          proposedServicesJson: true,
          notes: true,
          approvedAt: true,
          rejectedAt: true,
        },
      })

      return { updatedBooking, approval }
    })

    return NextResponse.json(
      {
        ok: true,
        booking: result.updatedBooking,
        consultationApproval: result.approval,
      },
      { status: 200 },
    )
  } catch (error) {
    console.error('POST /api/pro/bookings/[id]/consultation error', error)
    return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500 })
  }
}
