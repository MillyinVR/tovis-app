// app/api/_utils/auth/requireClientBookingOwnership.ts
//
// Shared client-side booking ownership gate. Loads a booking by id and verifies
// the authed client owns it. A booking owned by another client is treated
// identically to a missing one: both yield a uniform 404, so the API never
// leaks whether a foreign booking exists. This matches requireProBooking and
// the booking write boundary, which all converge on the same no-leak contract.
//
// Import jsonFail from the package barrel (not ./responses directly) so route
// tests that mock '@/app/api/_utils' also intercept the call made here.
import { jsonFail } from '@/app/api/_utils'
import { prisma } from '@/lib/prisma'

export type RequireClientBookingOwnershipResult =
  | { ok: true }
  | { ok: false; res: Response }

export async function requireClientBookingOwnership(
  bookingId: string,
  clientId: string,
): Promise<RequireClientBookingOwnershipResult> {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: { id: true, clientId: true },
  })

  if (!booking || booking.clientId !== clientId) {
    return { ok: false, res: jsonFail(404, 'Booking not found.') }
  }

  return { ok: true }
}
