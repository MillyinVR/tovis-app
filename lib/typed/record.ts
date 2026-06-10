/**
 * Widen a typed object to `Record<string, unknown>` for generic key-based
 * consumers, without the double cast that hides mistakes.
 *
 * TypeScript will not implicitly assign an interface to
 * `Record<string, unknown>` because interfaces lack an index signature,
 * which historically forced `as unknown as Record<string, unknown>` at
 * call sites. The runtime check here rejects the values that widening
 * would silently mishandle (arrays and null-ish inputs smuggled past the
 * type system).
 */
export function toRecord(value: object): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('toRecord expects a non-null, non-array object')
  }

  return value as Record<string, unknown>
}
