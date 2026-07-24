// lib/observability/sweepObservation.ts
//
// The one structured log line a background sweep writes about its own run.
//
// Deliberately NOT in bookingEvents.ts alongside the `capture*` family: those
// PAGE a human (Sentry), and suites mock that whole module to assert what paged.
// A sweep observation is routine bookkeeping — what it scanned, what it acted on,
// what it capped — read after the fact, never alerted on. Keeping it in its own
// module means a sweep's log line does not ride on the paging module's mock, and
// anything a sweep finds that genuinely needs an owner still goes through
// `capture*` instead.

import { safeLogMeta } from '@/lib/security/logging'

/**
 * Emit one redacted, structured warn line for a sweep run. `payload` is spread
 * flat into the envelope (falling back to a nested `payload` key when it is not a
 * plain object, which is what `safeLogMeta` can return for odd input).
 *
 * The deposit-release and deposit-success-recovery sweeps each carried a
 * byte-identical private copy of this, differing only in the event name.
 */
export function logSweepObservation(
  event: string,
  payload: Record<string, unknown>,
): void {
  const safe = safeLogMeta(payload)
  console.warn(
    JSON.stringify({
      level: 'warn',
      app: 'tovis',
      namespace: 'booking',
      event,
      ...(safe && typeof safe === 'object' && !Array.isArray(safe)
        ? safe
        : { payload: safe }),
    }),
  )
}
