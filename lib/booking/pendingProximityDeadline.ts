// lib/booking/pendingProximityDeadline.ts
//
// Book the Look, slice B4 — the knobs for PENDING-request proximity expiry
// (docs/product/BOOK-THE-LOOK-DIRECTION.md, "the new safety piece required
// before request-mode impulse is honest").
//
// THE GAP THIS CLOSES, verified 2026-08-31 rather than assumed. The direction
// doc says pending expiry today is "AGE-based only (stale-sessions job, 48h,
// notify + gated auto-cancel)". Only the first half is true:
// app/api/internal/jobs/stale-sessions/route.ts is TELEMETRY-ONLY — it logs
// PENDING bookings older than 48h and mutates nothing, and the
// `STALE_SESSIONS_AUTO_ACT` flag its comment describes exists nowhere in the
// repository. So there is no pending expiry at all today, age-based or
// otherwise, and this is the first one.
//
// TWO thresholds, not one, and the second is load-bearing:
//
//   proximity — expire once the appointment is this close. The point of the
//               rule is that a client is told in time to make other plans,
//               rather than turning up to an appointment nobody confirmed.
//
//   min answer — never expire a request younger than this, however close the
//               slot is. Without it the sacred case breaks: a 3 AM client
//               booking a 1 PM slot is already inside a 6-hour proximity window
//               the moment she commits, and the very next sweep tick would
//               cancel the impulse booking this whole slice exists to enable
//               (decision 3). With it, that booking is safe until 5 AM and
//               expires at 7 AM if the pro never answered — still six hours of
//               notice.
//
// A request made closer to its slot than `min answer` is simply never
// proximity-expired. That tail is deliberate: at that range the honest answer
// is the pro's, not a sweep's, and cancelling a request the pro has had almost
// no chance to see would be worse than leaving it.

import { readOptionalEnv } from '@/lib/env'

export const PENDING_PROXIMITY_EXPIRY_HOURS_DEFAULT = 6
export const PENDING_PROXIMITY_MIN_ANSWER_HOURS_DEFAULT = 2

function readPositiveIntEnv(name: string, fallback: number): number {
  const raw = readOptionalEnv(name)
  if (!raw) return fallback
  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback
  return Math.trunc(parsed)
}

function readBooleanEnv(name: string, fallback: boolean): boolean {
  const raw = readOptionalEnv(name)
  if (raw == null) return fallback
  const v = raw.trim().toLowerCase()
  return v !== 'false' && v !== '0' && v !== 'no' && v !== 'off'
}

/** Hours before the appointment an unanswered request is released. */
export function pendingProximityExpiryHours(): number {
  return readPositiveIntEnv(
    'PENDING_PROXIMITY_EXPIRY_HOURS',
    PENDING_PROXIMITY_EXPIRY_HOURS_DEFAULT,
  )
}

/** Hours a request is safe from expiry no matter how close its slot is. */
export function pendingProximityMinAnswerHours(): number {
  return readPositiveIntEnv(
    'PENDING_PROXIMITY_MIN_ANSWER_HOURS',
    PENDING_PROXIMITY_MIN_ANSWER_HOURS_DEFAULT,
  )
}

/**
 * Kill switch for the expiry ACTION. Default ON — the direction doc makes this
 * a prerequisite for request-mode impulse being honest, so a deployed
 * book-the-look with the sweep off would be shipping the unsafe half.
 * Set PENDING_PROXIMITY_EXPIRY_ENABLED=false to make the sweep observe-only
 * (it still logs how many requests it WOULD release) without a code change.
 */
export function pendingProximityExpiryEnabled(): boolean {
  return readBooleanEnv('PENDING_PROXIMITY_EXPIRY_ENABLED', true)
}
