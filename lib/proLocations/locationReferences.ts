// lib/proLocations/locationReferences.ts
//
// Whether a ProfessionalLocation is referenced by any row whose FK to it is
// `onDelete: Restrict` — i.e. a row that would block a hard delete. These are
// the historical/active booking artifacts we must never destroy:
//   - Booking            (Booking.location            Restrict)
//   - BookingHold        (BookingHold.location        Restrict)
//   - LastMinuteOpening  (LastMinuteOpening.location   Restrict)
//   - AftercareRebookSlot(AftercareRebookSlot.location Restrict)
// CalendarBlock (SetNull) and ProfessionalSearchIndex (Cascade) do NOT block a
// delete, so they are intentionally excluded.
//
// When this returns true the location is archived (soft-deleted) instead of
// hard-deleted. When false the location can be safely hard-deleted.

import type { PrismaClient } from '@prisma/client'

type LocationReferenceDb = Pick<
  PrismaClient,
  'booking' | 'bookingHold' | 'lastMinuteOpening' | 'aftercareRebookSlot'
>

export async function locationHasBlockingReferences(
  db: LocationReferenceDb,
  locationId: string,
): Promise<boolean> {
  const [booking, hold, lastMinuteOpening, aftercareRebookSlot] =
    await Promise.all([
      db.booking.findFirst({ where: { locationId }, select: { id: true } }),
      db.bookingHold.findFirst({ where: { locationId }, select: { id: true } }),
      db.lastMinuteOpening.findFirst({
        where: { locationId },
        select: { id: true },
      }),
      db.aftercareRebookSlot.findFirst({
        where: { locationId },
        select: { id: true },
      }),
    ])

  return Boolean(booking || hold || lastMinuteOpening || aftercareRebookSlot)
}
