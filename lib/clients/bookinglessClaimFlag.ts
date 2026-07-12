// lib/clients/bookinglessClaimFlag.ts
//
// Gates the PRO-FACING side of booking-less claims: whether the client directory
// surfaces booking-less clients (created via upsertProClient) to their creator
// and offers an "invite to claim" action. Prod leaves ENABLE_BOOKINGLESS_CLAIM
// unset → the directory behaves exactly as before (booking-scoped only) and the
// invite endpoint 404s. Flip the env var on (1/true/yes) to light it up.
//
// The COLD self-serve path (register-time) is intentionally NOT gated by this —
// it only ever fires for a profile that already matches the caller's contact.
//
// Mirrors noShowProtectionEnabled() in lib/noShowProtection/flag.ts.

export function bookinglessClaimEnabled(): boolean {
  const raw = process.env.ENABLE_BOOKINGLESS_CLAIM
  if (typeof raw !== 'string') return false
  const v = raw.trim().toLowerCase()
  return v === '1' || v === 'true' || v === 'yes'
}
