// lib/names.ts
//
// Single source of truth for composing a person's full name from separate
// first / last fields. Missing parts are treated as empty and the result is
// trimmed, so a missing first or last name never leaves a stray space.

export function fullName(
  firstName: string | null | undefined,
  lastName: string | null | undefined,
): string {
  return `${firstName ?? ''} ${lastName ?? ''}`.trim()
}
