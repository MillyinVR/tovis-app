// lib/booking/guards.ts
import { prisma } from '@/lib/prisma'
import type { Prisma } from '@prisma/client'

export function upper(v: unknown): string {
  return typeof v === 'string' ? v.trim().toUpperCase() : ''
}

// `isTerminalStatus` / `ensureNotTerminal` used to live here. Both had ZERO
// callers and both hard-coded CANCELLED|COMPLETED, so they silently disagreed
// with the lifecycle contract about NO_SHOW. Deleted rather than fixed: a dead
// helper encoding a wrong rule is a trap for whoever wires it up next. Use
// `isTerminalBookingStatus` from '@/lib/booking/lifecycleContract', which
// derives the answer from the transition map.

export function ensurePendingToAccepted(status: unknown) {
  const s = upper(status)
  if (s !== 'PENDING') {
    return { ok: false as const, error: 'Only PENDING bookings can be accepted.' }
  }
  return { ok: true as const }
}

export function ensureConsultApproved(approvalStatus: unknown) {
  const s = upper(approvalStatus)
  if (s !== 'APPROVED') {
    return {
      ok: false as const,
      error: 'Waiting for client to approve services and pricing before you can start.',
    }
  }
  return { ok: true as const }
}

/**
 * Loads booking + checks pro ownership.
 * Keep select small so routes stay fast.
 */
export async function getProOwnedBooking(args: {
  bookingId: string
  proId: string
  select?: Prisma.BookingSelect
}) {
  const { bookingId, proId, select } = args

  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    select:
      select ??
      ({
        id: true,
        professionalId: true,
        status: true,
        startedAt: true,
        finishedAt: true,
        sessionStep: true,
        consultationApproval: { select: { status: true } },
      } satisfies Prisma.BookingSelect),
  })

  if (!booking) return { ok: false as const, status: 404, error: 'Booking not found.' }
  if (booking.professionalId !== proId) {
    // Foreign booking → uniform 404 (no existence leak), matching the rest of
    // the booking-ownership surfaces.
    return { ok: false as const, status: 404, error: 'Booking not found.' }
  }

  return { ok: true as const, booking }
}
