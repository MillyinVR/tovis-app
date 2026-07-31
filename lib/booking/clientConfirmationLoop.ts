// lib/booking/clientConfirmationLoop.ts
//
// Master switch for the K12 client-confirmation loop (the WRITERS for K11's
// three Booking timestamps: the reminder-borne ask, the public
// /client/appointment/<token> action page and its confirm/decline/cancel/
// reschedule routes).
//
// Prod leaves ENABLE_CLIENT_CONFIRMATION_LOOP unset → reminders keep their
// pre-K12 copy and login-gated href, no APPOINTMENT_CONFIRMATION tokens are
// minted, nothing ever stamps clientConfirmationRequestedAt, and the token
// routes/page answer "unavailable" — so every booking keeps reading
// NOT_REQUESTED and no surface renders a glyph (K11's ship-dark state).
// Flip the env var on (1/true/yes) to light the loop up without a code change.
//
// Mirrors noShowProtectionEnabled() in lib/noShowProtection/flag.ts.

export function clientConfirmationLoopEnabled(): boolean {
  const raw = process.env.ENABLE_CLIENT_CONFIRMATION_LOOP
  if (typeof raw !== 'string') return false
  const v = raw.trim().toLowerCase()
  return v === '1' || v === 'true' || v === 'yes'
}
