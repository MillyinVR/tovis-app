// lib/env.ts

/**
 * Read an environment variable, trimmed. Returns null when it is unset or blank.
 * Single source of truth for "optional env" reads (replaces the many local
 * readEnv / envOrNull helpers).
 */
export function readOptionalEnv(name: string): string | null {
  const value = process.env[name]?.trim()
  return value && value.length > 0 ? value : null
}

/**
 * Read a required environment variable, trimmed. Throws when it is unset or blank.
 */
export function requireEnv(name: string): string {
  const value = readOptionalEnv(name)
  if (value === null) {
    throw new Error(`Missing required environment variable: ${name}`)
  }
  return value
}

/**
 * True when a boolean feature flag is switched on.
 *
 * Unset, blank, or anything other than the three affirmatives is OFF — which is
 * `.env.example`'s stated contract for this block ("Feature flags (default OFF
 * unless set)") and means a typo'd value fails CLOSED rather than quietly
 * opening a rail nobody meant to open.
 *
 * Single source of truth for the parse. `platformFeesEnabled`,
 * `isProMigrationEnabled`, `isServicePermissionFilterEnabled`,
 * `globalTechnicalRecordFlag` and `clientCreditSpendEnabled` all delegate here.
 * The first four were byte-identical copies of the same four lines and
 * `clientCreditSpendEnabled` would have been a fifth — which is exactly the
 * drift the no-duplicate-logic rule exists to stop.
 */
export function envFlagEnabled(name: string): boolean {
  const raw = readOptionalEnv(name)
  if (raw === null) return false
  const value = raw.toLowerCase()
  return value === '1' || value === 'true' || value === 'yes'
}

/**
 * True on any deployed Vercel surface — production OR preview. Both are real,
 * internet-facing deployments. Local dev (`next dev`) and CI/tests leave
 * VERCEL_ENV unset and return false; `vercel dev` reports 'development' and also
 * returns false.
 *
 * Use this — not NODE_ENV — to fence off dev-only escape hatches (e.g. captcha
 * fail-open) so they can never engage on a deployment, even if their opt-in flag
 * leaks into that environment's config. VERCEL_ENV is the canonical deploy
 * signal across this codebase; NODE_ENV has proven unreliable at runtime.
 */
export function isDeployedRuntime(): boolean {
  const vercelEnv = readOptionalEnv('VERCEL_ENV')
  return vercelEnv === 'production' || vercelEnv === 'preview'
}

/**
 * True when a DEFAULT-ON kill switch is still armed.
 *
 * The mirror of `envFlagEnabled`, for the other kind of flag. An opt-IN feature
 * flag is off until someone affirms it, and a typo there is harmless — it leaves
 * a dormant feature dormant. A default-ON switch guards an action that is
 * ALREADY running, and is reached for in an emergency to stop it, so the
 * asymmetry runs the other way: over-disabling pauses a sweep until someone
 * notices, under-disabling keeps cancelling bookings and moving money.
 *
 * So: unset or blank keeps the default (ON, the deployed behaviour), and any
 * value that is SET must be an explicit affirmative to keep it on. Everything
 * else turns it off — `false`, `0`, `no`, `off`, and equally `disabled`, `n`,
 * `nope`, `stop`, or a fat-fingered `flase`. The switch fails toward safety in
 * the direction an operator was reaching.
 *
 * ⚠️ This is why it cannot be `envFlagEnabled(name) || unset`: the affirmative
 * list is deliberately narrow, so `=on` reads as "not an affirmative" and STOPS
 * the sweep. That is the safe way to be wrong; do not widen the list to make a
 * spelling work.
 *
 * Same reasoning as `claimMergeDisabled` (lib/clients/claimMergeFlag.ts), which
 * is the DISABLE_-named form of the same idea; this is the ENABLED-named form.
 * Single source of truth for the parse — `pendingProximityExpiryEnabled`,
 * `depositAutoReleaseEnabled` and `depositSuccessRecoveryEnabled` all delegate
 * here rather than keeping the local copies that read the other way round.
 */
export function envKillSwitchArmed(name: string): boolean {
  if (readOptionalEnv(name) === null) return true
  return envFlagEnabled(name)
}

/**
 * A positive whole number from the environment, or the fallback.
 *
 * Rejects anything that is not already a positive integer — it does NOT round or
 * truncate. A truncating read is worse than a rejecting one because the value it
 * invents is `0`, and every caller here multiplies that into a duration: a
 * `0.5` meant as "half an hour" became a zero-hour window that silently disarmed
 * the guard it was configuring. Falling back to the documented default is the
 * honest answer to a value nobody can act on.
 */
export function readPositiveIntEnv(name: string, fallback: number): number {
  const raw = readOptionalEnv(name)
  if (raw === null) return fallback
  const parsed = Number(raw)
  if (!Number.isInteger(parsed) || parsed <= 0) return fallback
  return parsed
}
