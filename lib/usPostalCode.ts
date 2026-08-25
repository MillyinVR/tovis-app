// lib/usPostalCode.ts
//
// "Is this a US ZIP?" — one regex, one home.
//
// It had five copies under two names: `isUsZip` in the Places autocomplete
// route, the search map, the client address settings and the signup location
// helper, plus `isValidUsZip` in the pro locations screen. The renamed one is
// why this needed a sweep by the PRIMITIVE (the `\d{5}` regex) rather than by
// the helper name — a fork under a new name is invisible to the fork guard that
// exists to catch exactly this.

/**
 * A US ZIP: five digits, optionally +4. Trims first, so a pasted value with
 * surrounding whitespace is accepted rather than silently rejected.
 *
 * Deliberately shape-only — it says nothing about whether the ZIP EXISTS. That
 * is the geocoder's job, and every caller here follows a true result with a
 * lookup.
 */
export function isUsZip(value: string): boolean {
  return /^\d{5}(?:-\d{4})?$/.test(value.trim())
}
