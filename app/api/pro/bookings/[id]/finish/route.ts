// app/api/pro/bookings/[id]/finish/route.ts
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
 * Finish (pro) – long-term behavior:
 * - Does NOT complete the booking (aftercare submission does)
 * - Requires startedAt
 * - Computes next step based on AFTER media:
 *    - if AFTER media exists -> sessionStep = DONE -> nextHref = /aftercare
 *    - else -> sessionStep = AFTER_PHOTOS -> nextHref = /session/after-photos
 */
export async function POST(_req: Request, ctx: Ctx) {
  try {
    const { id } = await Promise.resolve(ctx.params)
    const bookingId = asTrimmedString(id)
    if (!bookingId) return jsonError('Missing booking id.', 400)

    const user = await getCurrentUser().catch(() => null)
    const proId = user?.role === 'PRO' ? user.professionalProfile?.id : null
    if (!proId) return jsonError('Not authorized', 401)

    const result = await prisma.$transaction(async (tx) => {
      const booking = await tx.booking.findUnique({
        where: { id: bookingId },
        select: {
          id: true,
          professionalId: true,
          status: true,
          startedAt: true,
          finishedAt: true,
          sessionStep: true,
        },
      })

      if (!booking) return { ok: false as const, status: 404, error: 'Booking not found.' }
      if (booking.professionalId !== proId) return { ok: false as const, status: 403, error: 'You can only finish your own bookings.' }

      const st = upper(booking.status)
      if (st === 'CANCELLED') return { ok: false as const, status: 409, error: 'Cancelled bookings cannot be finished.' }
      if (st === 'COMPLETED' || booking.finishedAt) return { ok: false as const, status: 409, error: 'This booking is already completed.' }

      if (!booking.startedAt) return { ok: false as const, status: 409, error: 'You can only finish after the session has started.' }

      const afterCount = await tx.mediaAsset.count({
        where: { bookingId: booking.id, phase: 'AFTER' as any },
      })

      const nextStep = afterCount > 0 ? 'DONE' : 'AFTER_PHOTOS'

      const updated = await tx.booking.update({
        where: { id: booking.id },
        data: { sessionStep: nextStep as any },
        select: { id: true, status: true, sessionStep: true },
      })

      const nextHref =
        nextStep === 'DONE'
          ? `/pro/bookings/${encodeURIComponent(booking.id)}/aftercare`
          : `/pro/bookings/${encodeURIComponent(booking.id)}/session/after-photos`

      return { ok: true as const, updated, nextHref, afterCount }
    })

    if (!result.ok) return jsonError(result.error, result.status)

    return NextResponse.json(
      { ok: true, booking: result.updated, nextHref: result.nextHref, afterCount: result.afterCount },
      { status: 200 },
    )
  } catch (err) {
    console.error('POST /api/pro/bookings/[id]/finish error', err)
    return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500 })
  }
}
