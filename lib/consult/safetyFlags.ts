// lib/consult/safetyFlags.ts
//
// The deterministic half of `safetyFlags`: which codes an analysis MAY carry
// and which it MUST carry, given the intake pack, the answers, and the
// model's visible-condition read. The provider proposes flags; this policy is
// what makes them structurally honest — a flag the intake cannot support is
// rejected, a flag the intake demands is added with fixed copy.
//
// Keyed on the intake PACK because the keys a policy can read are the pack's
// (lib/consult/intake/). The same three rules are mirrored, per pack, in the
// database guard `consult_analysis_payload_guard`.

import {
  CONSULT_ANALYSIS_SAFETY_CODES,
  ConsultAnalysisProviderError,
  type ConsultAnalysisProviderOutput,
  type ConsultAnalysisSafetyCode,
} from './analysisEngine'
import { GENERAL_SERVICE_INTAKE_PACK_ID } from './intake/packs/generalService'
import { HAIR_COLOR_INTAKE_PACK_ID } from './intake/packs/hairColor'
import { HAIR_GENERAL_INTAKE_PACK_ID } from './intake/packs/hairGeneral'

export const CONSULT_SAFETY_FLAG_COPY: Readonly<Record<ConsultAnalysisSafetyCode, string>> = {
  PRIOR_REACTION:
    'The intake reports a prior reaction to a service. Discuss this history and appropriate precautions with your professional before any chemical service.',
  REACTION_HISTORY_UNKNOWN:
    'Reaction history is uncertain. Discuss prior sensitivities and appropriate precautions with your professional before any chemical service.',
  RECENT_BOX_DYE:
    'Recent box dye can affect color predictability and achievability. Discuss the exact product and timing with your professional.',
  RECENT_LIGHTENING:
    'Recent lightening can affect the next safe, achievable direction. Discuss timing and strand-condition checks with your professional.',
  RECENT_CHEMICAL_SERVICE:
    'A recent chemical service or treatment can change how the hair or skin responds. Discuss the exact service and timing with your professional.',
  CHEMICAL_HISTORY_UNKNOWN:
    'Some chemical or treatment history is uncertain. Review prior services and treatments with your professional before choosing a service.',
  ALLERGY_HISTORY_UNKNOWN:
    'Allergy information was not collected in this intake. Discuss known allergies, sensitivities, and appropriate precautions with your professional.',
  KNOWN_ALLERGY:
    'The intake reports a known allergy to beauty products. Discuss it with your professional before any product is applied.',
  SENSITIVITY_REPORTED:
    'The intake reports skin that reacts easily. Discuss precautions and a patch test with your professional before service.',
  VISIBLE_COMPROMISE:
    'The photos may show cosmetic signs of compromised hair. Have your professional assess condition before setting a chemical-service plan.',
}

export type ConsultSafetyFlagPolicy = {
  /** Codes the provider may raise on this intake. */
  supported: ReadonlySet<ConsultAnalysisSafetyCode>
  /** Codes the analysis must carry; added with fixed copy when missing. */
  required: ReadonlySet<ConsultAnalysisSafetyCode>
  /**
   * The service lens must SAY these were not collected. The colour intake
   * never asks about allergies or maintenance, so its lens must not pretend
   * to know; a pack that asked is free to summarise the answer.
   */
  lensMustSayUnknown: { constraints: boolean; maintenance: boolean }
}

type VisibleCondition = 'NO_VISIBLE_CONCERN' | 'POSSIBLE_COMPROMISE' | 'UNKNOWN'

const RECENT_TREATMENT_VALUES = new Set(['within-6-months'])
const RECENT_LIGHTENING_VALUES = new Set(['within-3-months', '3-6-months'])

function policy(
  supported: Iterable<ConsultAnalysisSafetyCode>,
  required: Iterable<ConsultAnalysisSafetyCode>,
  lensMustSayUnknown: ConsultSafetyFlagPolicy['lensMustSayUnknown'],
): ConsultSafetyFlagPolicy {
  return {
    supported: new Set(supported),
    required: new Set(required),
    lensMustSayUnknown,
  }
}

/**
 * The colour policy, byte-for-byte the rules the founder pilot shipped
 * (formerly inline in lib/consult/analysisContract.ts) — the colour guard
 * branch in the database mirrors exactly these.
 */
function hairColorPolicy(
  intake: Readonly<Record<string, string>>,
  visibleCondition: VisibleCondition,
): ConsultSafetyFlagPolicy {
  const required = new Set<ConsultAnalysisSafetyCode>(['ALLERGY_HISTORY_UNKNOWN'])
  if (intake.prior_reaction === 'yes') required.add('PRIOR_REACTION')
  if (intake.prior_reaction === 'not-sure') required.add('REACTION_HISTORY_UNKNOWN')
  if (intake.box_dye_history === 'within-6-months') required.add('RECENT_BOX_DYE')
  if (intake.box_dye_history === 'not-sure') required.add('CHEMICAL_HISTORY_UNKNOWN')
  if (RECENT_LIGHTENING_VALUES.has(intake.prior_lightening ?? '')) {
    required.add('RECENT_LIGHTENING')
  }
  if (intake.prior_lightening === 'not-sure') required.add('CHEMICAL_HISTORY_UNKNOWN')
  if (visibleCondition === 'POSSIBLE_COMPROMISE') required.add('VISIBLE_COMPROMISE')
  // On the colour pack every supported flag is also required — the intake
  // either demands it or cannot support it.
  return policy(required, required, { constraints: true, maintenance: true })
}

/** Extensions, cuts, any hair service that is not colour. */
function hairGeneralPolicy(
  intake: Readonly<Record<string, string>>,
  visibleCondition: VisibleCondition,
): ConsultSafetyFlagPolicy {
  const required = new Set<ConsultAnalysisSafetyCode>(['ALLERGY_HISTORY_UNKNOWN'])
  if (intake.prior_reaction === 'yes') required.add('PRIOR_REACTION')
  if (intake.prior_reaction === 'not-sure') required.add('REACTION_HISTORY_UNKNOWN')
  if (RECENT_TREATMENT_VALUES.has(intake.chemical_history ?? '')) {
    required.add('RECENT_CHEMICAL_SERVICE')
  }
  if (intake.chemical_history === 'not-sure') required.add('CHEMICAL_HISTORY_UNKNOWN')
  if (RECENT_LIGHTENING_VALUES.has(intake.prior_lightening ?? '')) {
    required.add('RECENT_LIGHTENING')
  }
  if (intake.prior_lightening === 'not-sure') required.add('CHEMICAL_HISTORY_UNKNOWN')
  if (visibleCondition === 'POSSIBLE_COMPROMISE') required.add('VISIBLE_COMPROMISE')
  return policy(required, required, {
    constraints: true,
    maintenance: !intake.maintenance_tolerance,
  })
}

/** Every non-hair family. */
function generalServicePolicy(
  intake: Readonly<Record<string, string>>,
  visibleCondition: VisibleCondition,
): ConsultSafetyFlagPolicy {
  const required = new Set<ConsultAnalysisSafetyCode>()
  if (intake.prior_reaction === 'yes') required.add('PRIOR_REACTION')
  if (intake.prior_reaction === 'not-sure') required.add('REACTION_HISTORY_UNKNOWN')
  if (RECENT_TREATMENT_VALUES.has(intake.recent_treatment_timing ?? '')) {
    required.add('RECENT_CHEMICAL_SERVICE')
  }
  if (intake.recent_treatment_timing === 'not-sure') {
    required.add('CHEMICAL_HISTORY_UNKNOWN')
  }
  if (intake.known_allergies === 'yes') required.add('KNOWN_ALLERGY')
  if (!intake.known_allergies || intake.known_allergies === 'not-sure') {
    required.add('ALLERGY_HISTORY_UNKNOWN')
  }
  if (intake.skin_sensitivity === 'yes' || intake.skin_sensitivity === 'sometimes') {
    required.add('SENSITIVITY_REPORTED')
  }
  if (visibleCondition === 'POSSIBLE_COMPROMISE') required.add('VISIBLE_COMPROMISE')
  return policy(required, required, {
    constraints: !intake.known_allergies || intake.known_allergies === 'not-sure',
    maintenance: !intake.maintenance_tolerance,
  })
}

export function deriveConsultSafetyFlagPolicy(args: {
  intakePackId: string
  intake: Readonly<Record<string, string>>
  visibleCondition: VisibleCondition
}): ConsultSafetyFlagPolicy {
  switch (args.intakePackId) {
    case HAIR_COLOR_INTAKE_PACK_ID:
      return hairColorPolicy(args.intake, args.visibleCondition)
    case HAIR_GENERAL_INTAKE_PACK_ID:
      return hairGeneralPolicy(args.intake, args.visibleCondition)
    case GENERAL_SERVICE_INTAKE_PACK_ID:
      return generalServicePolicy(args.intake, args.visibleCondition)
    default:
      // An unregistered pack supports NOTHING: a provider flag on it is
      // unverifiable, and an analysis that carries one is refused rather than
      // trusted.
      return policy([], [], { constraints: true, maintenance: true })
  }
}

const UNKNOWN_WORDING = /\b(unknown|not collected|not provided)\b/i

/**
 * Apply the policy to a provider result: refuse unsupported flags and lens
 * text that claims knowledge the intake never gave, then add every required
 * flag that is missing, with fixed copy.
 */
export function applyConsultSafetyFlagPolicy(
  analysis: ConsultAnalysisProviderOutput,
  policyForIntake: ConsultSafetyFlagPolicy,
): ConsultAnalysisProviderOutput {
  if (
    (policyForIntake.lensMustSayUnknown.constraints &&
      !UNKNOWN_WORDING.test(analysis.serviceLens.constraints)) ||
    (policyForIntake.lensMustSayUnknown.maintenance &&
      !UNKNOWN_WORDING.test(analysis.serviceLens.maintenance))
  ) {
    throw new ConsultAnalysisProviderError('bad_output')
  }
  if (analysis.safetyFlags.some((flag) => !policyForIntake.supported.has(flag.code))) {
    throw new ConsultAnalysisProviderError('bad_output')
  }
  const flags = [...analysis.safetyFlags]
  for (const code of policyForIntake.required) {
    if (!flags.some((flag) => flag.code === code)) {
      flags.push({
        code,
        summary: CONSULT_SAFETY_FLAG_COPY[code],
        discussWithProfessional: true,
      })
    }
  }
  if (flags.length > CONSULT_ANALYSIS_SAFETY_CODES.length) {
    throw new ConsultAnalysisProviderError('bad_output')
  }
  return { ...analysis, safetyFlags: flags }
}
