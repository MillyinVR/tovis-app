// app/api/_utils/auth/requireClientBookingOwnership.ts
//
// Shared client-side booking ownership gate. Loads a booking by id and verifies
// the authed client owns it. Returns 404 when the booking does not exist and 403
// when it belongs to another client (preserving the historical client-route
// behavior; the existence/forbidden split is intentional here).
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

  if (!booking) return { ok: false, res: jsonFail(404, 'Booking not found.') }
  if (booking.clientId !== clientId) {
    return { ok: false, res: jsonFail(403, 'Forbidden.') }
  }

  return { ok: true }
}
