// lib/looks/personalizedFlag.ts
//
// Cohort/env switch for the personalized Looks feed (social-first B1).
// Prod leaves ENABLE_PERSONALIZED_FEED unset → the default Look tab stays purely
// chronological (RECENT); nothing about discovery changes. Flip the env var on
// (1/true/yes) to make the default feed request a personalized RANKED blend for
// signed-in viewers — a query-time boost of followed pros + liked/saved
// categories over the persisted rankScore, with no new tables.
//
// The flag gates the DEFAULT only, never the capability: an explicit
// `sort=recent` always returns the chronological feed, flag on or off.
//
// Mirrors noShowProtectionEnabled() (lib/noShowProtection/flag.ts) and
// membershipEnforcementEnabled() (lib/membership/enforcement.ts). Per the
// runtime-flags convention, this stays an env var until the first deliberate
// flip; only then does it graduate to the admin runtime-flags surface.

export function personalizedFeedEnabled(): boolean {
  const raw = process.env.ENABLE_PERSONALIZED_FEED
  if (typeof raw !== 'string') return false
  const v = raw.trim().toLowerCase()
  return v === '1' || v === 'true' || v === 'yes'
}
