import type { ConsultIntakeAnswerMapDTO } from '@/lib/dto/consult'

export const CONSULT_SAFETY_ROUTING_POLICY_VERSION =
  'hair-color-safety-routing-v1'

export const CONSULT_SAFETY_SERVICE_REQUIREMENTS = [
  'PATCH_TEST',
  'STRAND_TEST',
] as const

export type ConsultSafetyServiceRequirement =
  (typeof CONSULT_SAFETY_SERVICE_REQUIREMENTS)[number]

export const CONSULT_SAFETY_SERVICE_BOOKING_RULES = {
  STRAND_TEST: { name: 'Strand Test', durationMinutes: 15, priceCents: 0 },
  PATCH_TEST: { name: 'Patch Test', durationMinutes: 10, priceCents: 0 },
} as const satisfies Readonly<
  Record<
    ConsultSafetyServiceRequirement,
    { name: string; durationMinutes: number; priceCents: number }
  >
>

export const STRAND_TEST_ADD_ON_PROMPT =
  'A Strand Test does not include a chemical color service. Would you also like to book a haircut or deep conditioning treatment for the same visit?'

/**
 * A Strand Test can surface only the neutral, non-chemical choices Tori
 * approved. The offering still has to be explicitly configured by the pro.
 */
export function isStrandTestOptionalAddOn(args: {
  categorySlug: string
  serviceName: string
}): boolean {
  if (args.categorySlug === 'haircut') return true
  return (
    args.categorySlug === 'hair-treatment' &&
    /\bdeep condition(?:ing)?\b/i.test(args.serviceName.trim())
  )
}

const NON_COLOR_TREATMENT_KEYS = [
  'henna_plant_dye_history',
  'perm_history',
  'relaxer_texturizer_history',
  'keratin_smoothing_history',
  'other_chemical_history',
] as const

export function hasReportedNonColorTreatment(
  intake: Readonly<ConsultIntakeAnswerMapDTO>,
): boolean {
  return NON_COLOR_TREATMENT_KEYS.some((key) => {
    const value = intake[key]
    return Boolean(value && value !== 'never' && value !== 'not-sure')
  })
}

export function hasUnknownChemicalHistory(
  intake: Readonly<ConsultIntakeAnswerMapDTO>,
): boolean {
  return [
    'box_dye_history',
    'prior_lightening',
    ...NON_COLOR_TREATMENT_KEYS,
  ].some((key) => intake[key] === 'not-sure')
}

/**
 * Deterministic safety policy. It uses only explicit intake codes and the
 * bounded C4 cosmetic visible-condition output; it never infers a client trait.
 */
export function determineHairColorSafetyRouting(args: {
  intake: Readonly<ConsultIntakeAnswerMapDTO>
  visibleCondition: 'NO_VISIBLE_CONCERN' | 'POSSIBLE_COMPROMISE' | 'UNKNOWN'
}): {
  requirements: ConsultSafetyServiceRequirement[]
  blocksChemicalRecommendations: boolean
} {
  const requirements: ConsultSafetyServiceRequirement[] = []
  if (args.intake.prior_reaction === 'yes') {
    requirements.push('PATCH_TEST')
  }

  const strandTestRequired =
    args.intake.change_scale === 'total' ||
    args.intake.box_dye_history === 'within-6-months' ||
    args.intake.box_dye_history === 'not-sure' ||
    args.intake.prior_lightening === 'within-3-months' ||
    args.intake.prior_lightening === '3-6-months' ||
    args.intake.prior_lightening === 'not-sure' ||
    hasReportedNonColorTreatment(args.intake) ||
    hasUnknownChemicalHistory(args.intake) ||
    args.visibleCondition === 'POSSIBLE_COMPROMISE'

  if (strandTestRequired) requirements.push('STRAND_TEST')

  return {
    requirements,
    blocksChemicalRecommendations: requirements.length > 0,
  }
}

/**
 * Did this analysis route to SAFETY PREREQUISITES — did it decline to recommend
 * a chemical service until a test has been done and reviewed?
 *
 * Read from the STORED recommendations rather than re-derived from the intake:
 * `resolveRecommendations` REPLACES the entire recommendation list with the
 * required tests plus a professional color review whenever
 * `blocksChemicalRecommendations` is true, so a PATCH_TEST or STRAND_TEST
 * intent in a stored analysis is present if and only if that happened. Reading
 * what was actually stored means a later intake edit cannot make a served
 * analysis look safer than the one the pro was shown.
 *
 * 🔴 DO NOT ask this question of `safetyFlags` instead. Every hair-color
 * analysis carries at least one — `addRequiredSafetyFlags` adds
 * ALLERGY_HISTORY_UNKNOWN unconditionally, because the intake never asks about
 * allergies, so it is a standing disclosure rather than a routing signal. A
 * caller gating on "any safety flag" refuses 100% of consults and looks, from
 * the outside, exactly like a feature that simply does not work.
 *
 * Book the Look, B4 is the first caller: an estimate for a safety-routed
 * analysis is the honest PRO-facing answer — the test lines AND the chemical
 * floor — and is precisely not a price a client may commit to unattended.
 */
export function analysisRoutedToSafetyPrerequisites(
  recommendations: ReadonlyArray<{ serviceIntent: string }>,
): boolean {
  const prerequisites = new Set<string>(CONSULT_SAFETY_SERVICE_REQUIREMENTS)
  return recommendations.some((item) => prerequisites.has(item.serviceIntent))
}
