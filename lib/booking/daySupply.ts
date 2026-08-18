// lib/booking/daySupply.ts
//
// How much of a bookable day is left, for the booking sheet's day scroller.
// The frame asks each day in the strip to carry its own supply so a client can
// see a thin day before opening it.
//
// The iOS twin is `BookingSheetPresentation.daySupplyLabel` (TovisKit).
//
// A zero-slot day is a real "Full" day (Tori, 2026-08-18): the bootstrap
// route keeps it in `availableDays` at `slotCount: 0` rather than dropping it,
// and the day scroller renders it dimmed and disabled — never auto-selected,
// but visible in its real calendar position instead of silently vanishing.

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
