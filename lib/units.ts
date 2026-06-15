// lib/units.ts
//
// Single source of truth for unit conversions. Pure math, client-safe.

export const MILES_PER_KM = 0.621371

/** Convert kilometers to whole miles (rounded). */
export function kmToMiles(km: number): number {
  return Math.round(km * MILES_PER_KM)
}
