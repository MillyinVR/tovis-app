// lib/aftercare/aftercareVisibility.ts
//
// The single gate for whether the client's aftercare surface (the featured
// before/after pair + care notes) should show for a booking: the session has
// happened (booking COMPLETED) or the pro has SENT an aftercare summary. Shared
// by the web booking-detail view-model (`canShowAftercareTab`) and the native
// aftercare read DTO (`buildClientAftercareDetailDTO`) so both platforms gate
// the surface identically and can't drift.

/**
 * @param status the booking's lifecycle status (case-insensitive).
 * @param hasSentAftercare whether a SENT aftercare summary exists for it.
 */
export function isClientAftercareVisible(input: {
  status: string | null | undefined
  hasSentAftercare: boolean
}): boolean {
  return (
    (input.status ?? '').toUpperCase() === 'COMPLETED' || input.hasSentAftercare
  )
}
