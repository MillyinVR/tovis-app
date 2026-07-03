// lib/noShowProtection/flag.ts
//
// Master switch for Phase 2 revenue protection (card-on-file + no-show fees).
// Prod leaves ENABLE_NO_SHOW_PROTECTION unset → the client save-card surface and
// (later) fee charging stay dark; nothing about today's booking flow changes.
// Flip the env var on (1/true/yes) to light up the flow without a code change.
//
// Mirrors membershipEnforcementEnabled() in lib/membership/enforcement.ts.

export function noShowProtectionEnabled(): boolean {
  const raw = process.env.ENABLE_NO_SHOW_PROTECTION
  if (typeof raw !== 'string') return false
  const v = raw.trim().toLowerCase()
  return v === '1' || v === 'true' || v === 'yes'
}
