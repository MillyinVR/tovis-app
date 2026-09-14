// lib/consult/hairLevel.ts
//
// The salon level scale, in one place, because two artefacts now report it and
// they have to mean the same thing by it.
//
// 🔴 The bug this file exists to close: before P4a, "level" was reported once
// per artefact and each one meant something different.
//
//   * The INSPIRATION read had a single `level`, prompted as "the depth of the
//     lightest dominant colour". One number for a photograph that may be a
//     shadow root at 5 melting into ends at 9.
//   * The CAPTURE analysis had `currentLevel: { min, max }`, and nothing ever
//     said what min and max WERE. The provider was never told; the sanitizer
//     read them as an ordered pair; the DB guard read them as two integers in
//     1..10; and the client screen rendered them as "Level 5–7" — which a
//     colourist reads as "base 5, lightest 7", while the schema's own
//     neighbouring `confidence: {min, max}` says min/max means "how sure",
//     not "how dark to how light". Two readings of the same field, and the
//     one on screen was never the one the model was asked for.
//
// So the pair is named instead of positional: `baseLevel` is the depth at the
// root / the darkest dominant colour, `lightestLevel` the lightest dominant
// colour. A solid single-process reports the SAME value in both; that is the
// honest answer, not a degenerate one. Uncertainty lives where it always
// belonged — in each observation's own confidence range.
//
// Carried as an enum rather than a number because the structured-output
// grammar charges by STRUCTURE, not by vocabulary: an eleven-member enum and a
// three-member one cost the same, while an integer plus its null union costs
// twice a plain enum. See lib/consult/providerSchema.ts for the measurements.

/** LEVEL_1 (black) … LEVEL_10 (lightest blonde), plus an honest UNKNOWN. */
export const CONSULT_HAIR_LEVELS = [
  'LEVEL_1',
  'LEVEL_2',
  'LEVEL_3',
  'LEVEL_4',
  'LEVEL_5',
  'LEVEL_6',
  'LEVEL_7',
  'LEVEL_8',
  'LEVEL_9',
  'LEVEL_10',
  'UNKNOWN',
] as const

export type ConsultHairLevel = (typeof CONSULT_HAIR_LEVELS)[number]

/**
 * The depth each level names, on the standard salon scale.
 *
 * 🔴 Why this exists: until 2026-09-13 the ONLY thing any model was told about
 * the scale was "1 is black and 10 is the lightest blonde" — and the capture
 * analysis was told nothing at all. Levels 2 through 9, which is where every
 * real client sits, were undefined. The model was being asked to place hair on
 * a ten-point scale having been given two of the ten points, and the reference
 * readings came back hedged across the board: every attribute of the
 * 2026-09-13 production read sat below `isSupportedConsultObservation`'s 0.5
 * confidence floor.
 *
 * These are the depth names the 1–10 International Colour Level System uses,
 * which every major professional line (Wella, Redken, Matrix, L'Oréal
 * Professionnel) shares. Restating an industry scale in our own words carries
 * no licensing question — a numbering system and its depth names are facts,
 * not anyone's artwork — and it is deliberately the SALON vocabulary rather
 * than the plainer client-facing wording in `lib/brand`, because this text is
 * read by a model that was trained on salon terminology.
 *
 * ⚠️ These are NOT the words shown to a client. `defaultClientConsultInspiration
 * Copy.ts` carries a separate, deliberately plainer mapping, and from level 4
 * up it is one step darker than this one (it calls LEVEL_7 "dark blonde" where
 * the salon scale calls that LEVEL_6). That divergence is a product decision,
 * not an accident to be silently reconciled here — see the handoff note.
 */
export const CONSULT_HAIR_LEVEL_DEPTH: Readonly<
  Record<Exclude<ConsultHairLevel, 'UNKNOWN'>, string>
> = {
  LEVEL_1: 'black',
  LEVEL_2: 'darkest brown',
  LEVEL_3: 'dark brown',
  LEVEL_4: 'medium brown',
  LEVEL_5: 'light brown',
  LEVEL_6: 'dark blonde',
  LEVEL_7: 'medium blonde',
  LEVEL_8: 'light blonde',
  LEVEL_9: 'very light blonde',
  LEVEL_10: 'lightest blonde',
}

/** What lifting to a level exposes, and what cancels it. */
export type ConsultHairUnderlyingPigment = {
  /** The contributing pigment lifting to this level uncovers. */
  exposes: string
  /** Its complement — the tone that neutralizes it. */
  neutralizedBy: string
}

/**
 * The underlying (contributing) pigment at each level, and the complementary
 * pigment that cancels it.
 *
 * 🔴 Why this exists: without it the plan can say "a 4 to an 8" but not what
 * that COSTS. Lifting does not remove pigment evenly — it uncovers warmth in a
 * fixed order, and a colourist plans around that order. "4 to 8 goes through
 * red and orange, cancelled with green then blue" is real formulation and an
 * honest multi-session answer; "4 to 8" on its own invites a cheerful
 * single-visit promise the chemistry does not support.
 *
 * 🔴 SOURCE: Tori's physical Ashlee Norman Hair swatch ring, read off the card
 * on 2026-09-14. This is deliberately NOT what the web charts say — they run
 * about one level warm (they put orange at 6 and orange-yellow at 7, where the
 * card puts red-orange at 6 and orange at 7). The card is a professional tool
 * and she is the colourist; the websites are neither. Do not "correct" this
 * table back towards a chart. The numbering and its pigment order are industry
 * facts, freely restatable — no swatch imagery is reproduced here.
 *
 * ⚠️ LEVEL_1 is null on purpose: the card's scale STARTS at level 2, so we
 * have no professional source for what black exposes. Null means "not on the
 * card", and `consultHairUnderlyingPigmentPromptText` says so out loud rather
 * than letting a model fill the gap.
 */
export const CONSULT_HAIR_LEVEL_UNDERLYING_PIGMENT: Readonly<
  Record<Exclude<ConsultHairLevel, 'UNKNOWN'>, ConsultHairUnderlyingPigment | null>
> = {
  LEVEL_1: null,
  LEVEL_2: { exposes: 'red', neutralizedBy: 'green' },
  LEVEL_3: { exposes: 'red', neutralizedBy: 'green' },
  LEVEL_4: { exposes: 'red', neutralizedBy: 'green' },
  LEVEL_5: { exposes: 'red-orange', neutralizedBy: 'blue-green' },
  LEVEL_6: { exposes: 'red-orange', neutralizedBy: 'blue-green' },
  LEVEL_7: { exposes: 'orange', neutralizedBy: 'blue' },
  LEVEL_8: { exposes: 'yellow-orange', neutralizedBy: 'blue-violet' },
  LEVEL_9: { exposes: 'yellow', neutralizedBy: 'violet' },
  LEVEL_10: { exposes: 'pale yellow', neutralizedBy: 'violet' },
}

/**
 * The pigment table as prompt text, built from the map above for the same
 * reason the depth scale is: two readers must not drift on what a level
 * exposes.
 *
 * The "every level it passes THROUGH" sentence is the load-bearing one. A lift
 * from 4 to 8 does not expose yellow-orange and stop; it travels red, then
 * red-orange, then orange, and what the hair holds at the end is the sum of
 * that journey. A model given only the destination row will formulate for the
 * destination and promise one visit.
 */
export function consultHairUnderlyingPigmentPromptText(): string {
  const rungs = (
    Object.keys(CONSULT_HAIR_LEVEL_UNDERLYING_PIGMENT) as Exclude<
      ConsultHairLevel,
      'UNKNOWN'
    >[]
  )
    .map((level) => {
      const pigment = CONSULT_HAIR_LEVEL_UNDERLYING_PIGMENT[level]
      if (!pigment) return null
      return `${consultHairLevelNumber(level)} exposes ${pigment.exposes} (cancelled by ${pigment.neutralizedBy})`
    })
    .filter((rung): rung is string => rung !== null)
    .join('; ')
  return (
    'Lifting hair uncovers warmth in a fixed order — the underlying or ' +
    `contributing pigment. On this scale: ${rungs}. ` +
    'Level 1 is not on this list and you have not been told what it exposes; ' +
    'do not guess one. ' +
    'A lift passes through every level between where she is and where she is ' +
    'going, and exposes each of their pigments on the way, so the warmth left ' +
    'to cancel at the end is the sum of that journey and not just the ' +
    'destination row. The wider the lift, the more of it there is, and the ' +
    'more likely the honest answer is more than one visit plus a toner. Never ' +
    'promise that a wide lift will be clean, cool or single-session because ' +
    'the destination level sounds light.'
  )
}

/**
 * The scale as one block of prompt text, built from the map above so the
 * inspiration read and the capture analysis cannot drift apart on what a level
 * MEANS — the whole reason this file exists.
 *
 * The "depth only" sentence is load-bearing, not filler: `tone` is a separate
 * observation in both schemas, and a model that folds warmth into depth will
 * read a warm level 6 as a level 7 and hand the plan a lift it does not need.
 */
export function consultHairLevelScalePromptText(): string {
  const rungs = (
    Object.keys(CONSULT_HAIR_LEVEL_DEPTH) as Exclude<
      ConsultHairLevel,
      'UNKNOWN'
    >[]
  )
    .map((level) => `${consultHairLevelNumber(level)} ${CONSULT_HAIR_LEVEL_DEPTH[level]}`)
    .join(', ')
  return (
    `The salon depth scale runs 1 (darkest) to 10 (lightest): ${rungs}. ` +
    'Level describes DEPTH ONLY — how dark or light the hair is. It never ' +
    'describes warmth, ash, gold, copper, red or violet; those are tone, and ' +
    'tone has its own field. A level 6 can be neutral, golden, ash or copper ' +
    'and is still a level 6, because the depth has not changed. ' +
    '6 and 7 are the brown-to-blonde boundary: something most people would ' +
    'call light brown is usually a 6 on this scale, not a 5.'
  )
}

/** `LEVEL_7` → 7; `UNKNOWN` → null. The only place the string is decoded. */
export function consultHairLevelNumber(level: ConsultHairLevel): number | null {
  if (level === 'UNKNOWN') return null
  const digits = level.slice('LEVEL_'.length)
  const value = Number.parseInt(digits, 10)
  return Number.isInteger(value) ? value : null
}

/**
 * Is this pair orderable? A base darker than the lightest is the only
 * combination the scale forbids; either being UNKNOWN is simply unobserved.
 */
export function consultHairLevelPairIsOrdered(
  baseLevel: ConsultHairLevel,
  lightestLevel: ConsultHairLevel,
): boolean {
  const base = consultHairLevelNumber(baseLevel)
  const lightest = consultHairLevelNumber(lightestLevel)
  if (base === null || lightest === null) return true
  return base <= lightest
}
