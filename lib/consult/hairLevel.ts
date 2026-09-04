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
