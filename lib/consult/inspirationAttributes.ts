// lib/consult/inspirationAttributes.ts
//
// The inspiration reading's attribute VOCABULARY — the eight fields and the
// enum each one answers with.
//
// Split out of lib/consult/inspirationVision.ts in P5d for one reason: that
// file imports the Anthropic SDK, and the vocabulary is now read by the CARD
// layer (lib/consult/inspiration/), which has no business pulling a provider
// client in behind it. Nothing here is duplicated — `inspirationVision.ts`
// re-exports these, so there is still exactly one definition of each list and
// the schema the provider is sent is built from the same arrays the cards are
// named from.

import { CONSULT_HAIR_LEVELS } from './hairLevel'

export const CONSULT_INSPIRATION_TONES = ['WARM', 'COOL', 'NEUTRAL', 'UNKNOWN'] as const
export const CONSULT_INSPIRATION_TECHNIQUES = [
  'SINGLE_PROCESS',
  'BALAYAGE',
  'FOIL_HIGHLIGHTS',
  'BABYLIGHTS',
  'LOWLIGHTS',
  'COLOR_MELT',
  'GLOSS_ONLY',
  'DOUBLE_PROCESS',
  'NATURAL_UNCOLORED',
  'UNKNOWN',
] as const
export const CONSULT_INSPIRATION_PLACEMENTS = [
  'ALL_OVER',
  'FACE_FRAMING',
  'MIDS_TO_ENDS',
  'ENDS_ONLY',
  'SURFACE_ONLY',
  'UNDERNEATH',
  'PANELS',
  'UNKNOWN',
] as const
export const CONSULT_INSPIRATION_ROOT_BLENDS = [
  'SOLID_TO_ROOT',
  'SHADOW_ROOT',
  'SEAMLESS_MELT',
  'GROWN_OUT',
  'UNKNOWN',
] as const
export const CONSULT_INSPIRATION_FINISHES = [
  'HIGH_SHINE',
  'SATIN',
  'MATTE',
  'UNKNOWN',
] as const
export const CONSULT_INSPIRATION_DIMENSIONS = [
  'FLAT',
  'SUBTLE',
  'MEDIUM',
  'HIGH_CONTRAST',
  'UNKNOWN',
] as const

export const CONSULT_INSPIRATION_ANALYSIS_FIELDS = [
  'baseLevel',
  'lightestLevel',
  'tone',
  'technique',
  'placement',
  'rootBlend',
  'finish',
  'dimension',
] as const
export type ConsultInspirationAnalysisField =
  (typeof CONSULT_INSPIRATION_ANALYSIS_FIELDS)[number]

export const CONSULT_INSPIRATION_FIELD_VALUES: Readonly<
  Record<ConsultInspirationAnalysisField, readonly string[]>
> = {
  baseLevel: CONSULT_HAIR_LEVELS,
  lightestLevel: CONSULT_HAIR_LEVELS,
  tone: CONSULT_INSPIRATION_TONES,
  technique: CONSULT_INSPIRATION_TECHNIQUES,
  placement: CONSULT_INSPIRATION_PLACEMENTS,
  rootBlend: CONSULT_INSPIRATION_ROOT_BLENDS,
  finish: CONSULT_INSPIRATION_FINISHES,
  dimension: CONSULT_INSPIRATION_DIMENSIONS,
}

/**
 * C2-6b (gap G2) — what about the PHOTOGRAPH, as opposed to the hair in it,
 * a colourist would want to know before trusting the reading. The three
 * consult guides name these as the single most-cited cause of a failed
 * consult: filters, colour grading, extensions, wind machines, AI images.
 *
 * A flag is a NOTE, never a refusal: a flagged reference is still read into
 * the eight attributes, and it is the client's and the pro's sentences that
 * change, not whether there is a reading. Enum on the wire, sentences on read
 * (lib/consult/inspirationCredibility.ts); the words live in the copy tables,
 * so nothing here ever reaches a screen as a code.
 */
export const CONSULT_INSPIRATION_CREDIBILITY_FLAGS = [
  'LIKELY_EDITED',
  'LIKELY_AI_GENERATED',
  'EXTENSIONS_LIKELY',
  'PRO_LIGHTING',
  'FINISH_HIDES_CUT',
  'SINGLE_ANGLE',
] as const
export type ConsultInspirationCredibilityFlag =
  (typeof CONSULT_INSPIRATION_CREDIBILITY_FLAGS)[number]

