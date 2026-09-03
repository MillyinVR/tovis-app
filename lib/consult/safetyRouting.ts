import type { ConsultIntakeAnswerMapDTO } from '@/lib/dto/consult'

import { GENERAL_SERVICE_INTAKE_PACK_ID } from './intake/packs/generalService'
import { HAIR_COLOR_INTAKE_PACK_ID } from './intake/packs/hairColor'
import { HAIR_GENERAL_INTAKE_PACK_ID } from './intake/packs/hairGeneral'

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

type ConsultSafetyRouting = ReturnType<typeof determineHairColorSafetyRouting>

/**
 * The safety policy for the OTHER intake packs, keyed on the pack rather than
 * the family because the questions a policy can read are the pack's.
 *
 *   * hair-general (extensions, cuts, any hair service that is not colour):
 *     a reported reaction routes to a patch test. No strand test — that is a
 *     chemical-service check, and these services are not chemical.
 *   * general-service (every non-hair family): a reported reaction, a known
 *     product allergy, or skin that reacts easily routes to a patch test.
 *
 * As with colour, a routed consult declines to recommend the service itself
 * until the test has happened.
 */
function determinePackSafetyRouting(args: {
  intakePackId: string
  intake: Readonly<ConsultIntakeAnswerMapDTO>
}): ConsultSafetyRouting {
  const requirements: ConsultSafetyServiceRequirement[] = []
  if (args.intakePackId === HAIR_GENERAL_INTAKE_PACK_ID) {
    if (args.intake.prior_reaction === 'yes') requirements.push('PATCH_TEST')
  } else if (args.intakePackId === GENERAL_SERVICE_INTAKE_PACK_ID) {
    if (
      args.intake.prior_reaction === 'yes' ||
      args.intake.known_allergies === 'yes' ||
      args.intake.skin_sensitivity === 'yes'
    ) {
      requirements.push('PATCH_TEST')
    }
  }
  return {
    requirements,
    blocksChemicalRecommendations: requirements.length > 0,
  }
}

/**
 * The one entry point the analysis uses: the colour policy for the colour
 * pack, the pack policy above for every other pack. An unregistered pack id
 * routes to NOTHING rather than to the colour rules — the intake keys it
 * would read do not exist on such a pack, so the colour rules would silently
 * pass everyone.
 */
export function determineConsultSafetyRouting(args: {
  intakePackId: string
  intake: Readonly<ConsultIntakeAnswerMapDTO>
  visibleCondition: 'NO_VISIBLE_CONCERN' | 'POSSIBLE_COMPROMISE' | 'UNKNOWN'
}): ConsultSafetyRouting {
  if (args.intakePackId === HAIR_COLOR_INTAKE_PACK_ID) {
    return determineHairColorSafetyRouting({
      intake: args.intake,
      visibleCondition: args.visibleCondition,
    })
  }
  return determinePackSafetyRouting(args)
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
