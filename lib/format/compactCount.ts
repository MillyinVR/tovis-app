// lib/format/compactCount.ts
//
// Single source of truth for abbreviated counts ("1.5K", "1.2M") across every
// surface that shows a like/follower/review/comment total. Before this module
// four hand-rolled copies disagreed with each other — the public profile said
// "1M" where the pro-profile manager said "1000K", the looks rail did not
// abbreviate below 10,000 at all and clamped everything above 999,999 to
// "1000K", and the comments drawer emitted a trailing ".0" ("1.0K").
//
// The canonical rule is `Intl.NumberFormat` compact notation (en-US): uppercase
// K/M/B, at most one fraction digit, no trailing ".0", and correct rollover
// (999,999 → "1M", not "1000K"). iOS's `CompactCount` renders the same
// uppercase shape, so the two platforms agree.
//
// ⚠️ The formatter is built ONCE at module scope on purpose. Each Intl instance
// carries ~31KB of native ICU state that is invisible to V8's heap accounting
// and never collected — constructing one per item/render is the leak that took
// down the e2e suite (see docs + `lib/time` for the same rule on dates).
const COMPACT_COUNT_FORMATTER = new Intl.NumberFormat('en-US', {
  compactDisplay: 'short',
  maximumFractionDigits: 1,
  notation: 'compact',
})

/**
 * Abbreviate a count for display. Negative, fractional, null/undefined and
 * non-finite inputs all normalize to a safe whole number ("0" at worst), so
 * callers can hand this raw API values without pre-guarding.
 */
export function formatCompactCount(value: number | null | undefined): string {
  if (typeof value !== 'number') return '0'
  if (!Number.isFinite(value)) return '0'

  return COMPACT_COUNT_FORMATTER.format(Math.max(0, Math.trunc(value)))
}
