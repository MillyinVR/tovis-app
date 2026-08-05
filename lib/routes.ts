// lib/routes.ts

import { professionalProfileHref } from '@/lib/profiles/profileHrefs'

export const PRO_PUBLIC_PROFILE_PATH = '/pro/profile/public-profile' as const

/**
 * Canonical path to a pro's PUBLIC profile — the one a client lands on when they
 * tap a pro's name or avatar. One builder so the id always gets encoded and the
 * route lives in exactly one place (`/p/[handle]` is the vanity alias of the
 * same page; id-keyed is the canonical form and always resolvable).
 *
 * Returns null for a missing/blank id so callers render inert text instead of a
 * link to `/professionals/`.
 *
 * The `/professionals/[id]` shape itself lives in `lib/profiles/profileHrefs` —
 * this is the nullable, blank-tolerant wrapper the UI links call, not a second
 * copy of the route. (It was a copy until now; the two could have drifted.)
 */
export function proPublicProfilePath(
  proId: string | null | undefined,
): string | null {
  const trimmed = typeof proId === 'string' ? proId.trim() : ''
  if (!trimmed) return null
  return professionalProfileHref(trimmed)
}
