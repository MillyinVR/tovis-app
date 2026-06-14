// lib/queryParams.ts
// Single source of truth for coercing URL query-string parameters.

/** Clamp a number into [min, max]; returns min when the value isn't finite. */
export function clampFloat(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.min(Math.max(value, min), max)
}

/** Parse a query param as a finite float, or null. */
export function parseFloatParam(value: string | null): number | null {
  if (!value) return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

/** Parse a query param as a finite, truncated integer, or null. */
export function parseIntParam(value: string | null): number | null {
  if (!value) return null
  const n = Number(value)
  return Number.isFinite(n) ? Math.trunc(n) : null
}

/** Parse a comma-separated id list, trimmed and de-blanked, capped at `max`. */
export function parseCommaIds(value: string | null, max = 25): string[] {
  if (!value) return []
  return value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, max)
}

/** Parse a query param as a truncated integer, falling back when not finite. */
export function toIntParam(value: string | null, fallback: number): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback
}
