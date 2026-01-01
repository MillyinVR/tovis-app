// app/api/pro/bookings/[id]/status/route.ts
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'
import { getProOwnedBooking, ensureNotTerminal, ensurePendingToAccepted, upper } from '@/lib/booking/guards'

export const dynamic = 'force-dynamic'

type Ctx = { params: { id: string } | Promise<{ id: string }> }

function asTrimmedString(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

function jsonError(message: string, status: number) {
  return NextResponse.json({ ok: false, error: message }, { status })
}

export async function PATCH(req: Request, ctx: Ctx) {
  try {
    const user = await getCurrentUser().catch(() => null)
    const proId = user?.role === 'PRO' ? user.professionalProfile?.id : null
    if (!proId) return jsonError('Not authorized', 401)

    const { id } = await Promise.resolve(ctx.params)
    const bookingId = asTrimmedString(id)
    if (!bookingId) return jsonError('Missing booking id', 400)

    const body = (await req.json().catch(() => ({}))) as { status?: unknown }
    const next = upper(body.status)

    if (next !== 'ACCEPTED') {
      return jsonError('Invalid status. Use start/finish/cancel endpoints.', 400)
    }

    const found = await getProOwnedBooking({ bookingId, proId, select: { id: true, professionalId: true, status: true, finishedAt: true } })
    if (!found.ok) return jsonError(found.error, found.status)

    const booking = found.booking

    const nt = ensureNotTerminal(booking)
    if (!nt.ok) return jsonError(nt.error, 409)

    const tr = ensurePendingToAccepted(booking.status)
    if (!tr.ok) return jsonError(tr.error, 409)

    const updated = await prisma.booking.update({
      where: { id: booking.id },
      data: { status: 'ACCEPTED' },
      select: { id: true, status: true },
    })

    return NextResponse.json({ ok: true, booking: updated }, { status: 200 })
  } catch (e) {
    console.error('PATCH /api/pro/bookings/[id]/status error', e)
    return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500 })
  }
}
