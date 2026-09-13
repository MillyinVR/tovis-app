import { describe, expect, it } from 'vitest'

import {
  ConsultAnalysisProviderError,
  type ConsultAnalysisProviderOutput,
} from './analysisEngine'
import {
  applyConsultSafetyFlagPolicy,
  CONSULT_SAFETY_FLAG_COPY,
  deriveConsultSafetyFlagPolicy,
} from './safetyFlags'

const codes = (set: ReadonlySet<string>) => [...set].sort()

function analysisWith(args: {
  flags?: Array<{ code: ConsultAnalysisProviderOutput['safetyFlags'][number]['code'] }>
  constraints?: string
  maintenance?: string
}): ConsultAnalysisProviderOutput {
  const observation = {
    value: 'UNKNOWN' as const,
    confidence: { min: 0, max: 0.2 },
    evidence: [],
  }
  return {
    profile: {} as ConsultAnalysisProviderOutput['profile'],
    styleDirections: [],
    core: {
      baseLevel: { value: 'UNKNOWN', confidence: { min: 0, max: 0.2 }, evidence: [] },
      lightestLevel: { value: 'UNKNOWN', confidence: { min: 0, max: 0.2 }, evidence: [] },
      currentTone: observation,
      visibleCondition: observation,
      density: observation,
      texture: observation,
    },
    serviceLens: {
      goal: 'g',
      history: 'h',
      constraints: args.constraints ?? 'Constraints were not collected and are unknown.',
      maintenance: args.maintenance ?? 'Maintenance tolerance was not collected and is unknown.',
      appointmentContext: 'a',
      achievability: 'UNKNOWN',
      achievabilityReason: 'r',
      discussWithProfessional: true,
    },
    safetyFlags: (args.flags ?? []).map((flag) => ({
      code: flag.code,
      summary: 'provider summary',
      discussWithProfessional: true as const,
    })),
    recommendations: [],
  }
}

describe('consult safety flag policy', () => {
  it('keeps the colour rules exactly: allergy always, the rest from the intake and the photos', () => {
    const quiet = deriveConsultSafetyFlagPolicy({
      intakePackId: 'hair-color',
      intake: { prior_reaction: 'no', box_dye_history: 'never', prior_lightening: 'never' },
      visibleCondition: 'NO_VISIBLE_CONCERN',
    })
    expect(codes(quiet.required)).toEqual(['ALLERGY_HISTORY_UNKNOWN'])
    expect(codes(quiet.supported)).toEqual(['ALLERGY_HISTORY_UNKNOWN'])
    expect(quiet.lensMustSayUnknown).toEqual({ constraints: true, maintenance: true })

    const loud = deriveConsultSafetyFlagPolicy({
      intakePackId: 'hair-color',
      intake: {
        prior_reaction: 'yes',
        box_dye_history: 'within-6-months',
        prior_lightening: 'not-sure',
      },
      visibleCondition: 'POSSIBLE_COMPROMISE',
    })
    expect(codes(loud.required)).toEqual([
      'ALLERGY_HISTORY_UNKNOWN',
      'CHEMICAL_HISTORY_UNKNOWN',
      'PRIOR_REACTION',
      'RECENT_BOX_DYE',
      'VISIBLE_COMPROMISE',
    ])
  })

  it('reads the hair pack’s own keys and stops demanding "unknown" once maintenance was asked', () => {
    const policy = deriveConsultSafetyFlagPolicy({
      intakePackId: 'hair-general',
      intake: {
        prior_reaction: 'not-sure',
        chemical_history: 'within-6-months',
        prior_lightening: '3-6-months',
        maintenance_tolerance: 'low',
      },
      visibleCondition: 'UNKNOWN',
    })
    expect(codes(policy.required)).toEqual([
      'ALLERGY_HISTORY_UNKNOWN',
      'REACTION_HISTORY_UNKNOWN',
      'RECENT_CHEMICAL_SERVICE',
      'RECENT_LIGHTENING',
    ])
    expect(policy.lensMustSayUnknown).toEqual({ constraints: true, maintenance: false })
  })

  it('on the general pack, a collected allergy answer replaces the standing "unknown" disclosure', () => {
    const known = deriveConsultSafetyFlagPolicy({
      intakePackId: 'general-service',
      intake: {
        prior_reaction: 'no',
        recent_treatment_timing: 'never',
        known_allergies: 'yes',
        skin_sensitivity: 'sometimes',
        maintenance_tolerance: 'medium',
      },
      visibleCondition: 'UNKNOWN',
    })
    expect(codes(known.required)).toEqual(['KNOWN_ALLERGY', 'SENSITIVITY_REPORTED'])
    expect(known.lensMustSayUnknown).toEqual({ constraints: false, maintenance: false })

    const unsure = deriveConsultSafetyFlagPolicy({
      intakePackId: 'general-service',
      intake: { known_allergies: 'not-sure', recent_treatment_timing: 'not-sure' },
      visibleCondition: 'UNKNOWN',
    })
    expect(codes(unsure.required)).toEqual([
      'ALLERGY_HISTORY_UNKNOWN',
      'CHEMICAL_HISTORY_UNKNOWN',
    ])
    expect(unsure.lensMustSayUnknown.constraints).toBe(true)
  })

  it('supports nothing on an unregistered pack, so any provider flag is refused', () => {
    const policy = deriveConsultSafetyFlagPolicy({
      intakePackId: 'pack-from-nowhere',
      intake: { prior_reaction: 'yes' },
      visibleCondition: 'UNKNOWN',
    })
    expect(policy.supported.size).toBe(0)
    expect(() =>
      applyConsultSafetyFlagPolicy(
        analysisWith({ flags: [{ code: 'PRIOR_REACTION' }] }),
        policy,
      ),
    ).toThrowError(ConsultAnalysisProviderError)
  })

  it('adds missing required flags with fixed copy, keeps the provider’s own wording, refuses unsupported ones', () => {
    const policy = deriveConsultSafetyFlagPolicy({
      intakePackId: 'hair-color',
      intake: { prior_reaction: 'yes' },
      visibleCondition: 'UNKNOWN',
    })
    const applied = applyConsultSafetyFlagPolicy(
      analysisWith({ flags: [{ code: 'PRIOR_REACTION' }] }),
      policy,
    )
    expect(applied.safetyFlags).toEqual([
      { code: 'PRIOR_REACTION', summary: 'provider summary', discussWithProfessional: true },
      {
        code: 'ALLERGY_HISTORY_UNKNOWN',
        summary: CONSULT_SAFETY_FLAG_COPY.ALLERGY_HISTORY_UNKNOWN,
        discussWithProfessional: true,
      },
    ])
    expect(() =>
      applyConsultSafetyFlagPolicy(
        analysisWith({ flags: [{ code: 'RECENT_BOX_DYE' }] }),
        policy,
      ),
    ).toThrowError(ConsultAnalysisProviderError)
  })

  it('refuses a lens that claims to know what the intake never asked', () => {
    const colour = deriveConsultSafetyFlagPolicy({
      intakePackId: 'hair-color',
      intake: {},
      visibleCondition: 'UNKNOWN',
    })
    expect(() =>
      applyConsultSafetyFlagPolicy(
        analysisWith({ maintenance: 'Happy with monthly visits.' }),
        colour,
      ),
    ).toThrowError(ConsultAnalysisProviderError)

    const general = deriveConsultSafetyFlagPolicy({
      intakePackId: 'general-service',
      intake: { known_allergies: 'none-known', maintenance_tolerance: 'high' },
      visibleCondition: 'UNKNOWN',
    })
    expect(() =>
      applyConsultSafetyFlagPolicy(
        analysisWith({
          constraints: 'No known product allergies.',
          maintenance: 'Happy with regular upkeep.',
        }),
        general,
      ),
    ).not.toThrow()
  })
})

// ── Free text on a safety question ──────────────────────────────────────────
//
// Tori's decision, 2026-09-13, asked and answered: the model can FLAG, never
// CLEAR. These cases are the mirror of the `supported_codes` arm the
// accompanying migration adds to `consult_analysis_payload_guard` — a policy
// that widened here and not there is a 23514 on the app's own write.
describe('consult safety flags and the client’s own words', () => {
  it('reads a typed safety answer as UNKNOWN, whatever code sits beside it', () => {
    // She tapped "no" and then wrote a sentence next to it. The tap does not
    // survive the sentence: nothing downstream can read the sentence, so the
    // professional confirms it with her.
    const beside = deriveConsultSafetyFlagPolicy({
      intakePackId: 'hair-color',
      intake: { prior_reaction: 'no', box_dye_history: 'never', prior_lightening: 'never' },
      intakeTextAnswers: { prior_reaction: 'no, but my scalp burned once' },
      visibleCondition: 'NO_VISIBLE_CONCERN',
    })
    expect(codes(beside.required)).toEqual([
      'ALLERGY_HISTORY_UNKNOWN',
      'REACTION_HISTORY_UNKNOWN',
    ])
    // ...and the model MAY additionally say what her words report.
    expect(codes(beside.supported)).toEqual([
      'ALLERGY_HISTORY_UNKNOWN',
      'PRIOR_REACTION',
      'REACTION_HISTORY_UNKNOWN',
    ])
  })

  it('never lets her words CLEAR a question she answered only in words', () => {
    const hatch = deriveConsultSafetyFlagPolicy({
      intakePackId: 'hair-color',
      intake: {
        prior_reaction: 'client-words',
        box_dye_history: 'never',
        prior_lightening: 'never',
      },
      intakeTextAnswers: { prior_reaction: 'I have never had any reaction at all' },
      visibleCondition: 'NO_VISIBLE_CONCERN',
    })
    // Reassuring words are still not an answer any routing rule can read.
    expect(codes(hatch.required)).toContain('REACTION_HISTORY_UNKNOWN')
  })

  it('admits a flag her words support, and still refuses one nothing backs', () => {
    const policy = deriveConsultSafetyFlagPolicy({
      intakePackId: 'hair-color',
      intake: { prior_reaction: 'no', box_dye_history: 'never', prior_lightening: 'never' },
      intakeTextAnswers: { prior_reaction: 'my scalp burned last time' },
      visibleCondition: 'NO_VISIBLE_CONCERN',
    })
    const applied = applyConsultSafetyFlagPolicy(
      analysisWith({
        flags: [{ code: 'PRIOR_REACTION' }],
        constraints: 'Allergy history is unknown.',
        maintenance: 'Upkeep tolerance is unknown.',
      }),
      policy,
    )
    expect(applied.safetyFlags.map((flag) => flag.code).sort()).toEqual([
      'ALLERGY_HISTORY_UNKNOWN',
      'PRIOR_REACTION',
      'REACTION_HISTORY_UNKNOWN',
    ])
    // A code her words could not mean is still a concern invented about a real
    // person: the whole analysis is refused, exactly as before.
    expect(() =>
      applyConsultSafetyFlagPolicy(
        analysisWith({
          flags: [{ code: 'RECENT_BOX_DYE' }],
          constraints: 'Allergy history is unknown.',
          maintenance: 'Upkeep tolerance is unknown.',
        }),
        policy,
      ),
    ).toThrow(ConsultAnalysisProviderError)
  })

  it('leaves a consult with no typed words exactly as it was', () => {
    const before = deriveConsultSafetyFlagPolicy({
      intakePackId: 'general-service',
      intake: { prior_reaction: 'no', known_allergies: 'none-known' },
      visibleCondition: 'UNKNOWN',
    })
    const after = deriveConsultSafetyFlagPolicy({
      intakePackId: 'general-service',
      intake: { prior_reaction: 'no', known_allergies: 'none-known' },
      intakeTextAnswers: {},
      visibleCondition: 'UNKNOWN',
    })
    expect(codes(after.required)).toEqual(codes(before.required))
    expect(codes(after.supported)).toEqual(codes(before.supported))
  })
})
