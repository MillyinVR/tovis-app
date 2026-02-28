// app/api/_utils/pick.ts

export function pickString(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const s = v.trim()
  return s ? s : null
}

export function pickStringOrEmpty(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

/** Alias: sometimes reads nicer in route code */
export function pickNonEmptyString(v: unknown): string | null {
  return pickString(v)
}

/**
 * Pick an integer from string/number.
 * - returns null if missing/invalid
 * - truncates decimals
 */
export function pickInt(v: unknown): number | null {
  const n =
    typeof v === 'number'
      ? v
      : typeof v === 'string'
        ? Number(v.trim())
        : Number.NaN

  if (!Number.isFinite(n)) return null
  return Math.trunc(n)
}

/** Optional clamp helper (useful for limit/take/page sizes) */
export function clampInt(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, Math.trunc(n)))
}

export function pickBool(v: unknown): boolean | null {
  if (typeof v === 'boolean') return v
  if (typeof v === 'number') return v === 1 ? true : v === 0 ? false : null
  if (typeof v !== 'string') return null

  const s = v.trim().toLowerCase()
  if (!s) return null
  if (s === 'true' || s === '1' || s === 'on' || s === 'yes') return true
  if (s === 'false' || s === '0' || s === 'off' || s === 'no') return false
  return null
}

/** Useful for PATCH/DELETE tunneled through formData */
export function pickMethod(v: unknown): string | null {
  const s = pickString(v)
  return s ? s.toUpperCase() : null
}

/** Two-letter state codes (US-style). Returns null if empty/invalid. */
export function pickStateCode(v: unknown): string | null {
  const s = pickString(v)
  if (!s) return null
  const up = s.toUpperCase().replace(/[^A-Z]/g, '')
  if (up.length < 2) return null
  return up.slice(0, 2)
}

/**
 * Pick an enum value from unknown input.
 * Provide allowed values as a readonly array.
 *
 * Behavior:
 * - matches exact value
 * - or matches case-insensitively (useful when clients send lowercase)
 * - returns the canonical value from `allowed`
 */
export function pickEnum<T extends string>(v: unknown, allowed: readonly T[]): T | null {
  const s = pickString(v)
  if (!s) return null

  // exact match first (fast path)
  const exact = allowed.find((a) => a === s)
  if (exact) return exact

  const up = s.toUpperCase()
  const hit = allowed.find((a) => a.toUpperCase() === up)
  return hit ?? null
}

/**
 * Parse an ISO date string into Date (UTC). Returns null if invalid.
 * Note: accepts any Date-parsable string, but intended for ISO.
 */
export function pickIsoDate(v: unknown): Date | null {
  const s = pickString(v)
  if (!s) return null
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? null : d
}