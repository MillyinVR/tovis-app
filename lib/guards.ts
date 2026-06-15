// lib/guards.ts
export type UnknownRecord = Record<string, unknown>

export function isRecord(v: unknown): v is UnknownRecord {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}

export function isArray(v: unknown): v is unknown[] {
  return Array.isArray(v)
}

export function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0
}

export function asTrimmedString(v: unknown): string | null {
  return isNonEmptyString(v) ? v.trim() : null
}

/**
 * Returns the trimmed value, or throws `${name} is required.` when it is blank.
 * For required id/string fields where an empty value is a programmer error.
 */
export function normalizeRequiredId(name: string, value: string): string {
  const trimmed = value.trim()
  if (!trimmed) {
    throw new Error(`${name} is required.`)
  }
  return trimmed
}

export function asNumber(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

export function asInt(v: unknown): number | null {
  const n =
    typeof v === 'number'
      ? v
      : typeof v === 'string'
        ? Number(v.trim())
        : Number.NaN

  return Number.isFinite(n) ? Math.trunc(n) : null
}

export function getRecordProp(obj: UnknownRecord, key: string): unknown {
  return obj[key]
}

export function hasOwn(obj: UnknownRecord, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key)
}

export function hasOwnKey<K extends string>(
  obj: UnknownRecord,
  key: K,
): obj is UnknownRecord & Record<K, unknown> {
  return Object.prototype.hasOwnProperty.call(obj, key)
}

/**
 * Narrow away `undefined`/`null` for values that are logically guaranteed to
 * exist (e.g. indexing a non-empty array) but that the type system cannot
 * prove under `noUncheckedIndexedAccess`. Throws instead of asserting, so an
 * impossible case fails loudly rather than propagating `undefined`.
 */
export function requireDefined<T>(
  value: T | null | undefined,
  label = 'value',
): T {
  if (value === null || value === undefined) {
    throw new Error(`Expected ${label} to be defined`)
  }
  return value
}

// Back-compat: some files import clampInt from guards.
// Keep one implementation only.
export { clampInt } from '@/lib/pick'