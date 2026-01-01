// lib/booking/guards.ts
import { prisma } from '@/lib/prisma'
import type { Prisma } from '@prisma/client'

export function upper(v: unknown): string {
  return typeof v === 'string' ? v.trim().toUpperCase() : ''
}

export function isTerminalStatus(status: unknown): boolean {
  const s = upper(status)
  return s === 'CANCELLED' || s === 'COMPLETED'
}

export function ensureNotTerminal(booking: { status: unknown; finishedAt?: Date | null }) {
  if (isTerminalStatus(booking.status) || booking.finishedAt) {
    return { ok: false as const, error: 'Booking is completed/cancelled.' }
  }
  return { ok: true as const }
}

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
    return { ok: false as const, status: 403, error: 'Forbidden' }
  }

  return { ok: true as const, booking }
}
