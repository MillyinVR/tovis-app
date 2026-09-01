// lib/format/duration.ts
//
// "How long is this appointment", as a person reads it.
//
// ⚠️ Single source of truth for the minutes → label rule. Two client surfaces
// had already forked it byte-for-byte (the booking add-ons / consult review
// step and the consult booking door), which is exactly the drift
// `lib/format/compactCount` was extracted to stop. B7 needed a THIRD caller —
// the server composing an enhancement's "+20 min" — so the rule was extracted
// instead of copied again.
//
// Returns null when there is no duration worth printing, which every caller
// renders as its own dash or omission rather than "0 min".

export function formatDurationLabel(
  minutes: number | null | undefined,
): string | null {
  if (typeof minutes !== 'number') return null
  if (!Number.isFinite(minutes) || minutes <= 0) return null

  const whole = Math.round(minutes)
  if (whole < 60) return `${whole} min`

  const hours = Math.floor(whole / 60)
  const rest = whole % 60

  return rest ? `${hours}h ${rest}m` : `${hours}h`
}
