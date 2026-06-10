/**
 * Typed access to module-level singletons stashed on `globalThis`.
 *
 * `globalThis` has no typed extension point, so reading or writing
 * app-specific keys on it requires a type assertion somewhere. This helper
 * is the single allowed home for that assertion. Callers receive a
 * `Partial<T>` view, which forces them to handle the "not yet initialized"
 * case instead of trusting a value that may not exist.
 */
export function globalRegistry<T extends object>(): Partial<T> {
  return globalThis as unknown as Partial<T>
}
