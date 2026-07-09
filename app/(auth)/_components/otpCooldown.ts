// app/(auth)/_components/otpCooldown.ts
//
// Shared resend-cooldown helpers for the SMS one-time-code auth surfaces
// (phone verification + passwordless phone login). Pure functions — no React,
// no DOM — so both callers stay behaviour-identical and testable in isolation.

/** Default client-side resend cooldown after a code is sent, in seconds. */
export const RESEND_COOLDOWN_SECONDS = 60

/** Seconds → `m:ss`, for resend countdown labels. */
export function formatCooldown(seconds: number): string {
  const safe = Math.max(0, Math.ceil(seconds))
  const mins = Math.floor(safe / 60)
  const secs = safe % 60
  return `${mins}:${String(secs).padStart(2, '0')}`
}

/**
 * Pull a `retryAfterSeconds` hint out of a JSON error body (the shape our
 * rate-limit responses use). Accepts a number or numeric string; returns a
 * non-negative whole number of seconds, or null when absent/unparseable.
 */
export function readRetryAfterSeconds(
  data: Record<string, unknown> | null,
): number | null {
  if (!data) return null

  const value = data.retryAfterSeconds
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(0, Math.ceil(value))
  }

  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) {
      return Math.max(0, Math.ceil(parsed))
    }
  }

  return null
}
