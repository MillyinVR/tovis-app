import { describe, expect, it } from 'vitest'

import {
  CONSULT_SAFETY_ROUTING_POLICY_VERSION,
  CONSULT_SAFETY_SERVICE_BOOKING_RULES,
  determineConsultSafetyRouting,
  determineHairColorSafetyRouting,
  hasReportedNonColorTreatment,
  hasUnknownChemicalHistory,
  isStrandTestOptionalAddOn,
  STRAND_TEST_ADD_ON_PROMPT,
} from './safetyRouting'

const safeIntake = {
  change_scale: 'noticeable',
  box_dye_history: 'over-12-months',
  prior_lightening: 'over-12-months',
  henna_plant_dye_history: 'never',
  perm_history: 'never',
  relaxer_texturizer_history: 'never',
  keratin_smoothing_history: 'never',
  other_chemical_history: 'never',
  prior_reaction: 'no',
}

describe('deterministic hair-color safety routing', () => {
  it('pins the policy and leaves ordinary history on the normal recommendation path', () => {
    expect(CONSULT_SAFETY_ROUTING_POLICY_VERSION).toBe(
      'hair-color-safety-routing-v1',
    )
    expect(
      determineHairColorSafetyRouting({
        intake: safeIntake,
        visibleCondition: 'NO_VISIBLE_CONCERN',
      }),
    ).toEqual({ requirements: [], blocksChemicalRecommendations: false })
  })

  it('routes a reported reaction to a Patch Test and blocks chemical directions', () => {
    expect(
      determineHairColorSafetyRouting({
        intake: { ...safeIntake, prior_reaction: 'yes' },
        visibleCondition: 'NO_VISIBLE_CONCERN',
      }),
    ).toEqual({
      requirements: ['PATCH_TEST'],
      blocksChemicalRecommendations: true,
    })
  })

  it.each([
    ['recent lightening', { prior_lightening: 'within-3-months' }],
    ['henna', { henna_plant_dye_history: 'over-12-months' }],
    ['perm', { perm_history: 'within-6-months' }],
    ['relaxer', { relaxer_texturizer_history: '6-12-months' }],
    ['smoothing treatment', { keratin_smoothing_history: 'within-6-months' }],
    ['another treatment', { other_chemical_history: 'over-12-months' }],
    ['unknown history', { other_chemical_history: 'not-sure' }],
    ['major correction goal', { change_scale: 'total' }],
  ])('routes %s to a Strand Test', (_label, intake) => {
    expect(
      determineHairColorSafetyRouting({
        intake: { ...safeIntake, ...intake },
        visibleCondition: 'NO_VISIBLE_CONCERN',
      }),
    ).toEqual({
      requirements: ['STRAND_TEST'],
      blocksChemicalRecommendations: true,
    })
  })

  it('can require both independent tests without duplicating either route', () => {
    expect(
      determineHairColorSafetyRouting({
        intake: {
          ...safeIntake,
          prior_reaction: 'yes',
          henna_plant_dye_history: 'not-sure',
        },
        visibleCondition: 'POSSIBLE_COMPROMISE',
      }),
    ).toEqual({
      requirements: ['PATCH_TEST', 'STRAND_TEST'],
      blocksChemicalRecommendations: true,
    })
  })

  it('reports history state from explicit answer codes only', () => {
    expect(
      hasReportedNonColorTreatment({
        ...safeIntake,
        perm_history: '6-12-months',
      }),
    ).toBe(true)
    expect(
      hasUnknownChemicalHistory({
        ...safeIntake,
        keratin_smoothing_history: 'not-sure',
      }),
    ).toBe(true)
  })

  it('pins the exact free safety-service booking rules', () => {
    expect(CONSULT_SAFETY_SERVICE_BOOKING_RULES).toEqual({
      STRAND_TEST: { name: 'Strand Test', durationMinutes: 15, priceCents: 0 },
      PATCH_TEST: { name: 'Patch Test', durationMinutes: 10, priceCents: 0 },
    })
  })

  it('offers only configured haircut or deep-conditioning add-ons after a Strand Test', () => {
    expect(STRAND_TEST_ADD_ON_PROMPT).toContain(
      'does not include a chemical color service',
    )
    expect(
      isStrandTestOptionalAddOn({
        categorySlug: 'haircut',
        serviceName: 'Haircut & Style',
      }),
    ).toBe(true)
    expect(
      isStrandTestOptionalAddOn({
        categorySlug: 'hair-treatment',
        serviceName: 'Deep Conditioning Treatment',
      }),
    ).toBe(true)
    expect(
      isStrandTestOptionalAddOn({
        categorySlug: 'hair-treatment',
        serviceName: 'Keratin Smoothing Treatment',
      }),
    ).toBe(false)
    expect(
      isStrandTestOptionalAddOn({
        categorySlug: 'hair-color',
        serviceName: 'All-Over Color',
      }),
    ).toBe(false)
  })
})

describe('pack-aware safety routing', () => {
  it('sends the colour pack through the colour policy unchanged', () => {
    expect(
      determineConsultSafetyRouting({
        intakePackId: 'hair-color',
        intake: { ...safeIntake, prior_reaction: 'yes' },
        visibleCondition: 'NO_VISIBLE_CONCERN',
      }),
    ).toEqual(
      determineHairColorSafetyRouting({
        intake: { ...safeIntake, prior_reaction: 'yes' },
        visibleCondition: 'NO_VISIBLE_CONCERN',
      }),
    )
  })

  it('routes a hair service (not colour) to a patch test on a reported reaction only', () => {
    expect(
      determineConsultSafetyRouting({
        intakePackId: 'hair-general',
        intake: { prior_reaction: 'yes', chemical_history: 'never' },
        visibleCondition: 'NO_VISIBLE_CONCERN',
      }),
    ).toEqual({ requirements: ['PATCH_TEST'], blocksChemicalRecommendations: true })
    // Recent chemical history and a compromised look are flags for the
    // professional, not a strand test — the service itself is not chemical.
    expect(
      determineConsultSafetyRouting({
        intakePackId: 'hair-general',
        intake: {
          prior_reaction: 'no',
          chemical_history: 'within-6-months',
          prior_lightening: 'within-3-months',
        },
        visibleCondition: 'POSSIBLE_COMPROMISE',
      }),
    ).toEqual({ requirements: [], blocksChemicalRecommendations: false })
  })

  it('routes a general service to a patch test on a reaction, a known allergy, or reactive skin', () => {
    const routed: Array<Record<string, string>> = [
      { prior_reaction: 'yes' },
      { known_allergies: 'yes' },
      { skin_sensitivity: 'yes' },
    ]
    for (const intake of routed) {
      expect(
        determineConsultSafetyRouting({
          intakePackId: 'general-service',
          intake,
          visibleCondition: 'UNKNOWN',
        }),
      ).toEqual({ requirements: ['PATCH_TEST'], blocksChemicalRecommendations: true })
    }
    expect(
      determineConsultSafetyRouting({
        intakePackId: 'general-service',
        intake: {
          prior_reaction: 'no',
          known_allergies: 'none-known',
          skin_sensitivity: 'sometimes',
        },
        visibleCondition: 'UNKNOWN',
      }),
    ).toEqual({ requirements: [], blocksChemicalRecommendations: false })
  })

  it('routes an unregistered pack to nothing rather than to the colour rules', () => {
    expect(
      determineConsultSafetyRouting({
        intakePackId: 'pack-from-nowhere',
        intake: { prior_reaction: 'yes' },
        visibleCondition: 'UNKNOWN',
      }),
    ).toEqual({ requirements: [], blocksChemicalRecommendations: false })
  })
})
