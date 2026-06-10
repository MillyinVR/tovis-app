// lib/initials.ts
//
// Single source of truth for rendering avatar initials from a display name.

export function initialsForName(name: string, fallback = 'P'): string {
  const parts = name
    .split(/\s+/)
    .map((part) => part.trim())
    .filter(Boolean)

  const first = parts[0]
  if (first === undefined) return fallback
  if (parts.length === 1) return first.slice(0, 2).toUpperCase()

  return `${first.charAt(0)}${parts[1]?.charAt(0) ?? ''}`.toUpperCase()
}
