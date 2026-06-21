// app/api/_utils/auth/requireProBooking.ts
//
// Shared pro-side booking ownership gate. Loads a booking scoped to the authed
// professional in a single query, so a booking owned by another pro is never
// fetched and is indistinguishable from a missing one: both yield a uniform
// 404. This deliberately unifies the historical 403-vs-404 split across pro
// booking routes so the API never leaks whether a foreign booking exists.
//
// Import jsonFail from the package barrel (not ./responses directly) so route
// tests that mock '@/app/api/_utils' also intercept the call made here.
import { Prisma } from '@prisma/client'

import { jsonFail } from '@/app/api/_utils'
import { prisma } from '@/lib/prisma'

export type RequireProBookingResult<TBooking> =
  | { ok: true; booking: TBooking }
  | { ok: false; res: Response }

export async function requireProBooking<S extends Prisma.BookingSelect>(
  bookingId: string,
  proId: string,
  select: S,
): Promise<RequireProBookingResult<Prisma.BookingGetPayload<{ select: S }>>> {
  const booking = await prisma.booking.findFirst({
    where: { id: bookingId, professionalId: proId },
    select,
  })

  if (!booking) return { ok: false, res: jsonFail(404, 'Booking not found.') }

  return { ok: true, booking }
}
