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
