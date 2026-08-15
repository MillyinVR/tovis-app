// lib/format/pad2.ts
//
// Zero-pad a number to two digits — the "09" in "09:30" and "2026-08-09".
//
// Client-safe pure string formatting, deliberately NOT part of `@/lib/time`:
// that barrel is about timezone-correct display, and this does no timezone work
// at all. Callers building a `datetime-local` value or a YYYY-MM-DD key use
// this; callers rendering an instant for a human use `@/lib/time`.

export function pad2(value: number): string {
  return String(value).padStart(2, '0')
}
