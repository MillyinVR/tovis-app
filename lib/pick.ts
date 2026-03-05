// lib/pick.ts

const TRUE_SET = new Set(['true', '1', 'yes', 'on'])
const FALSE_SET = new Set(['false', '0', 'no', 'off'])

export function pickString(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const s = v.trim()
  return s ? s : null
}

export function pickStringOrEmpty(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

export function pickNonEmptyString(v: unknown): string | null {
  return pickString(v)
}


export function pickNumber(v: unknown): number | null {
  const n =
    typeof v === 'number'
      ? v
      : typeof v === 'string'
        ? Number(v.trim())
        : Number.NaN

  return Number.isFinite(n) ? n : null
}

export function pickInt(v: unknown): number | null {
  const n = pickNumber(v)
  return n == null ? null : Math.trunc(n)
}

/**
 * Clamp integer.
 * Overloads:
 * - clampInt(value, min, max) -> fallback=min
 * - clampInt(value, fallback, min, max)
 */
export function clampInt(n: unknown, min: number, max: number): number
export function clampInt(n: unknown, fallback: number, min: number, max: number): number
export function clampInt(n: unknown, a: number, b: number, c?: number): number {
  const fallback = c === undefined ? a : a
  const min = c === undefined ? a : b
  const max = c === undefined ? b : c

  const raw = pickInt(n)
  if (raw == null) return fallback
  return Math.min(Math.max(raw, min), max)
}

export function pickBool(v: unknown): boolean | null {
  if (typeof v === 'boolean') return v
  if (typeof v === 'number') return v === 1 ? true : v === 0 ? false : null
  if (typeof v !== 'string') return null

  const s = v.trim().toLowerCase()
  if (!s) return null
  if (TRUE_SET.has(s)) return true
  if (FALSE_SET.has(s)) return false
  return null
}

export function pickMethod(v: unknown): string | null {
  const s = pickString(v)
  return s ? s.toUpperCase() : null
}

export function pickStateCode(v: unknown): string | null {
  const s = pickString(v)
  if (!s) return null
  const up = s.toUpperCase().replace(/[^A-Z]/g, '')
  if (up.length < 2) return null
  return up.slice(0, 2)
}

export function pickEnum<T extends string>(v: unknown, allowed: readonly T[]): T | null {
  const s = pickString(v)
  if (!s) return null

  const exact = allowed.find((a) => a === s)
  if (exact) return exact

  const up = s.toUpperCase()
  const hit = allowed.find((a) => a.toUpperCase() === up)
  return hit ?? null
}

export function pickIsoDate(v: unknown): Date | null {
  const s = pickString(v)
  if (!s) return null
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? null : d
}