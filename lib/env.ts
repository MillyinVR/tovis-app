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
