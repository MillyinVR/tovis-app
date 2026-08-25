// lib/professions.ts
//
// What a profession is CALLED, in one place.
//
// The map lived privately in lib/profiles/publicProfileFormatting.ts while the
// pro signup screen carried its own hand-written list of the same eleven
// options — and the two had already drifted: `HAIRSTYLIST` was "Hair stylist"
// on every customer-facing surface (public profile, search, looks) and
// "Hairstylist" in the dropdown a pro picked it from. One profession, two
// names, depending which screen you were looking at.
//
// `satisfies Record<ProfessionType, string>` is the load-bearing part: adding a
// profession to the Prisma enum fails this file to compile rather than silently
// dropping out of a dropdown that was written by hand.

import type { ProfessionType } from '@prisma/client'

export const PROFESSION_LABEL_BY_TYPE = {
  COSMETOLOGIST: 'Cosmetologist',
  BARBER: 'Barber',
  ESTHETICIAN: 'Esthetician',
  MANICURIST: 'Manicurist',
  HAIRSTYLIST: 'Hair stylist',
  ELECTROLOGIST: 'Electrologist',
  MASSAGE_THERAPIST: 'Massage therapist',
  MAKEUP_ARTIST: 'Makeup artist',
  LASH_TECHNICIAN: 'Lash technician',
  HAIR_BRAIDER: 'Hair braider',
  PERMANENT_MAKEUP_ARTIST: 'Permanent makeup artist',
} satisfies Record<ProfessionType, string>

/**
 * The label for a profession, or the generic fallback when there is none —
 * a professional profile can exist before its type is set.
 */
export function formatProfessionLabel(
  professionType: ProfessionType | null | undefined,
): string {
  return professionType
    ? PROFESSION_LABEL_BY_TYPE[professionType]
    : 'Beauty professional'
}

/**
 * Every profession as a pickable option, in the order the signup form offers
 * them (most common first, not alphabetical). DERIVED from the map, so a new
 * profession appears in the dropdown by adding it there and nowhere else.
 */
export const PROFESSION_OPTIONS: ReadonlyArray<{
  value: ProfessionType
  label: string
}> = (
  Object.keys(PROFESSION_LABEL_BY_TYPE) as ProfessionType[]
).map((value) => ({ value, label: PROFESSION_LABEL_BY_TYPE[value] }))
