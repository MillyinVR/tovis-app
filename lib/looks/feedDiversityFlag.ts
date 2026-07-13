// lib/looks/feedDiversityFlag.ts
//
// Env switch for the personalized feed's diversity-injection slice (spec §4.3.1
// anti-filter-bubble). Prod leaves ENABLE_FEED_DIVERSITY_INJECTION unset → the
// personalized feed serves exactly as before (no reserved exploration slots, no
// extra query), so the deploy is byte-identical. Flip it on (1/true/yes) to
// reserve a small share of every entry load for high-quality content OUTSIDE a
// confident viewer's established taste graph.
//
// Unlike the availability primitive (dark until a cron populates data) or the
// hide control (dark until a viewer acts), diversity injection is a genuine —
// if small and softly-gated — behavior change the moment it's on, so it earns
// its own flag: the anti-filter-bubble slice is Tori's call to turn on, separate
// from the personalized feed itself (which is already ON in prod).
//
// The session-intent ratio shift (§4.3.2) and the composition metric (§4.3) are
// NOT gated by this flag — they default to neutral (multiplier 1.0, no client
// intent param) and stay dark on their own until availability data + intent
// hints exist. This flag only gates the one mechanism that adds rows.
//
// Mirrors personalizedFeedEnabled() (lib/looks/personalizedFlag.ts). Per the
// runtime-flags convention, this stays an env var until the first deliberate
// flip; only then does it graduate to the admin runtime-flags surface.

export function feedDiversityInjectionEnabled(): boolean {
  const raw = process.env.ENABLE_FEED_DIVERSITY_INJECTION
  if (typeof raw !== 'string') return false
  const v = raw.trim().toLowerCase()
  return v === '1' || v === 'true' || v === 'yes'
}
