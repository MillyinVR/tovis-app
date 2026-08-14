// lib/booking/daySupply.ts
//
// How much of a bookable day is left, for the booking sheet's day scroller.
// The frame asks each day in the strip to carry its own supply so a client can
// see a thin day before opening it.
//
// The iOS twin is `BookingSheetPresentation.daySupplyLabel` (TovisKit).
//
// ⚠️ "Full" is currently unreachable from `GET /api/v1/availability/bootstrap`:
// the route skips any day whose slot count is zero (`if (slotCount <= 0)
// continue`), so a full day is absent from `availableDays` rather than present
// with a zero. The branch exists because the function has to be total, not
// because the server sends that shape today.

/** At or below this, a day reads as scarcity ("2 left") rather than supply. */
const SCARCE_SLOT_COUNT = 2

export function daySupplyLabel(slotCount: number): string {
  if (!Number.isFinite(slotCount) || slotCount <= 0) return 'Full'
  if (slotCount <= SCARCE_SLOT_COUNT) return `${slotCount} left`
  return `${slotCount} open`
}

/** True while a day is down to its last couple of starts. */
export function daySupplyIsScarce(slotCount: number): boolean {
  return (
    Number.isFinite(slotCount) && slotCount > 0 && slotCount <= SCARCE_SLOT_COUNT
  )
}
