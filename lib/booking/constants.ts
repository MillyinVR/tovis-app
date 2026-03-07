// lib/booking/constants.ts
export const MAX_SLOT_DURATION_MINUTES = 12 * 60
export const MAX_BUFFER_MINUTES = 180
export const DEFAULT_DURATION_MINUTES = 60

export const MAX_OTHER_OVERLAP_MINUTES =
  MAX_SLOT_DURATION_MINUTES + MAX_BUFFER_MINUTES

export const MAX_ADVANCE_NOTICE_MINUTES = 24 * 60
export const MAX_DAYS_AHEAD = 3650
export const HOLD_MINUTES = 10

export const ALLOWED_STEP_MINUTES = [5, 10, 15, 20, 30, 60] as const

// Temporary compat aliases while routes are migrated.
// Delete these once everything imports the canonical names above.
export const MAX_BOOKING_BUFFER_MINUTES = MAX_BUFFER_MINUTES
export const MAX_LOCATION_BUFFER_MINUTES = MAX_BUFFER_MINUTES