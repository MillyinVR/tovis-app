import { ProfessionType } from '@prisma/client'

/**
 * Starting labels for the care plan's sections, per profession.
 *
 * 🔴 THESE ARE EDITOR PREFILL, NOT SCHEMA (Tori, 2026-08-14: *"we need to find a
 * different way to do it since it wont just be hairstylist on the app this is
 * for all beauty pros"*).
 *
 * The reference design hardcoded "Wash" and "Heat & styling" — a colourist's
 * vocabulary, and meaningless to a nail tech, a lash artist or an electrologist.
 * So `AftercareCareSection.label` is a free TEXT column the pro writes, and this
 * file only offers a place to start. Nothing validates a label against this
 * list; a pro may delete every suggestion and write their own, and a profession
 * missing from the map falls back to `DEFAULT_CARE_SECTION_LABELS` rather than
 * showing nothing.
 *
 * Adding a ProfessionType must never require a migration — only, at most, an
 * entry here, and even that is optional.
 */

/**
 * Used for any profession without its own entry. Deliberately generic: these
 * two questions ("what do I do now" / "what do I avoid") apply to every service
 * in the product.
 */
export const DEFAULT_CARE_SECTION_LABELS: readonly string[] = [
  'First 24 hours',
  'Keeping it looking good',
  'What to avoid',
]

const BY_PROFESSION: Partial<Record<ProfessionType, readonly string[]>> = {
  [ProfessionType.HAIRSTYLIST]: [
    'Wash',
    'Heat & styling',
    'Keeping the colour',
  ],
  [ProfessionType.COSMETOLOGIST]: [
    'Wash',
    'Heat & styling',
    'Keeping the colour',
  ],
  [ProfessionType.BARBER]: [
    'Washing & drying',
    'Keeping the shape',
    'When to come back',
  ],
  [ProfessionType.HAIR_BRAIDER]: [
    'Washing',
    'Sleeping & wrapping',
    'Edges & tension',
  ],
  [ProfessionType.MANICURIST]: [
    'First 24 hours',
    'Cuticle oil',
    'Water & gloves',
  ],
  [ProfessionType.ESTHETICIAN]: [
    'First 24 hours',
    'Cleansing',
    'Sun & actives',
  ],
  [ProfessionType.LASH_TECHNICIAN]: [
    'First 24 hours',
    'Cleansing',
    'What to avoid',
  ],
  [ProfessionType.MAKEUP_ARTIST]: [
    'Through the day',
    'Removing it',
    'Touch-ups',
  ],
  [ProfessionType.PERMANENT_MAKEUP_ARTIST]: [
    'Healing week one',
    'Cleansing & balm',
    'Sun & swimming',
  ],
  [ProfessionType.ELECTROLOGIST]: [
    'First 24 hours',
    'Soothing the area',
    'Sun & products',
  ],
  [ProfessionType.MASSAGE_THERAPIST]: [
    'Right after',
    'Water & rest',
    'Soreness',
  ],
}

/**
 * Suggested section labels for a pro, in the order they should be offered.
 *
 * Returns a copy so a caller that sorts or splices cannot mutate the table.
 */
export function careSectionSuggestions(
  profession: ProfessionType | null | undefined,
): string[] {
  const suggestions = profession ? BY_PROFESSION[profession] : undefined
  return [...(suggestions ?? DEFAULT_CARE_SECTION_LABELS)]
}
