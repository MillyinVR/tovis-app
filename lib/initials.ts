// lib/initials.ts
//
// Single source of truth for rendering avatar initials from a display name.
//
// Format: first + last word ("Jane Anne Doe" -> "JD"); a single-word name
// yields one letter ("Sasha" -> "S"); blank input yields `fallback`.

export function initialsForName(name: string, fallback = 'P'): string {
  const parts = name
    .split(/\s+/)
    .map((part) => part.trim())
    .filter(Boolean)

  const first = parts[0]
  if (first === undefined) return fallback
  if (parts.length === 1) return first.charAt(0).toUpperCase()

  const last = parts[parts.length - 1]
  return `${first.charAt(0)}${last?.charAt(0) ?? ''}`.toUpperCase()
}
