// lib/booking/holdCountdown.ts
//
// THE format for "how long is left on this hold".
//
// A hold is one reservation seen from two sides: the client watching their own
// checkout clock, and the pro watching someone else's on their calendar. Tori's
// ask was explicit — the pro sees "the same countdown the client is seeing" —
// so the two must not be allowed to render the same ten minutes differently.
// Formatting lives here, in `lib/`, because it is shared by a client component,
// a pro component and (mirrored) the iOS tile.
//
// Pure and clock-free on purpose: callers own the ticking, this owns the shape.

/** Below this, the remaining time is worth calling out. */
export const HOLD_COUNTDOWN_URGENT_MS = 2 * 60_000

/**
 * `mm:ss`, never negative and never a partial digit — the label a client and a
 * pro both read off the same reservation. A lapsed hold reads `00:00` rather
 * than counting into the negative; callers decide whether to keep showing it.
 */
export function formatHoldCountdown(millisecondsRemaining: number): string {
  const clamped = Number.isFinite(millisecondsRemaining)
    ? Math.max(0, millisecondsRemaining)
    : 0
  const totalSeconds = Math.floor(clamped / 1000)
  const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, '0')
  const seconds = String(totalSeconds % 60).padStart(2, '0')

  return `${minutes}:${seconds}`
}

/** Whether a hold is close enough to lapsing to deserve a louder tone. */
export function isHoldCountdownUrgent(millisecondsRemaining: number): boolean {
  if (!Number.isFinite(millisecondsRemaining)) return false

  return (
    millisecondsRemaining > 0 &&
    millisecondsRemaining <= HOLD_COUNTDOWN_URGENT_MS
  )
}
