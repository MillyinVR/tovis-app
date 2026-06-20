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
