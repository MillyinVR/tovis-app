// app/api/pro/bookings/[id]/finish/route.ts
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requirePro } from '@/app/api/_utils'
import { BookingStatus, MediaPhase, Role, SessionStep } from '@prisma/client'

export const dynamic = 'force-dynamic'

type Ctx = { params: { id: string } | Promise<{ id: string }> }

function trimmed(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

function jsonError(message: string, status: number) {
  return NextResponse.json({ ok: false, error: message }, { status })
}

function bookingBase(bookingId: string) {
  return `/pro/bookings/${encodeURIComponent(bookingId)}`
}

function sessionHubHref(bookingId: string) {
  return `${bookingBase(bookingId)}/session`
}

function afterPhotosHref(bookingId: string) {
  return `${bookingBase(bookingId)}/session/after-photos`
}

function aftercareHref(bookingId: string) {
  return `${bookingBase(bookingId)}/aftercare`
}

/**
 * Finish (pro)
 * - Does NOT complete the booking (aftercare send does)
 * - Requires startedAt
 * - Canonical behavior: move session into FINISH_REVIEW (confirm services/price/products)
 * - Idempotent: if already in FINISH_REVIEW/AFTER_PHOTOS/DONE, returns a stable nextHref
 */
export async function POST(_req: Request, ctx: Ctx) {
  try {
    const auth = await requirePro()
    if (auth.res) return auth.res
    const proId = auth.professionalId

    const { id } = await Promise.resolve(ctx.params)
    const bookingId = trimmed(id)
    if (!bookingId) return jsonError('Missing booking id.', 400)

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

      if (!booking) return { ok: false as const, http: 404, error: 'Booking not found.' }
      if (booking.professionalId !== proId) {
        return { ok: false as const, http: 403, error: 'You can only finish your own bookings.' }
      }

      if (booking.status === BookingStatus.CANCELLED) {
        return { ok: false as const, http: 409, error: 'Cancelled bookings cannot be finished.' }
      }
      if (booking.status === BookingStatus.COMPLETED || booking.finishedAt) {
        return { ok: false as const, http: 409, error: 'This booking is already completed.' }
      }
      if (!booking.startedAt) {
        return { ok: false as const, http: 409, error: 'You can only finish after the session has started.' }
      }

      // If they're already beyond finish-review, be idempotent and route appropriately.
      const step = booking.sessionStep ?? SessionStep.NONE

      // PRO-only AFTER media count (used for a smart nextHref in wrap-up states)
      const afterCount = await tx.mediaAsset.count({
        where: { bookingId: booking.id, phase: MediaPhase.AFTER, uploadedByRole: Role.PRO },
      })

      if (step === SessionStep.DONE) {
        return {
          ok: true as const,
          booking,
          nextHref: aftercareHref(booking.id),
          afterCount,
        }
      }

      if (step === SessionStep.AFTER_PHOTOS) {
        return {
          ok: true as const,
          booking,
          nextHref: afterCount > 0 ? aftercareHref(booking.id) : afterPhotosHref(booking.id),
          afterCount,
        }
      }

      if (step === SessionStep.FINISH_REVIEW) {
        return {
          ok: true as const,
          booking,
          nextHref: sessionHubHref(booking.id),
          afterCount,
        }
      }

      // Canonical: Finish moves into FINISH_REVIEW (price/services/products confirmation)
      const updated = await tx.booking.update({
        where: { id: booking.id },
        data: { sessionStep: SessionStep.FINISH_REVIEW },
        select: { id: true, status: true, startedAt: true, finishedAt: true, sessionStep: true },
      })

      return {
        ok: true as const,
        booking: updated,
        nextHref: sessionHubHref(updated.id),
        afterCount,
      }
    })

    if (!result.ok) return jsonError(result.error, result.http)

    return NextResponse.json(
      { ok: true, booking: result.booking, nextHref: result.nextHref, afterCount: result.afterCount },
      { status: 200 },
    )
  } catch (err) {
    console.error('POST /api/pro/bookings/[id]/finish error', err)
    return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500 })
  }
}