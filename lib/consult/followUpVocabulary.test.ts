// lib/consult/followUpVocabulary.test.ts
//
// P5g — the routing rule, which is the part of this feature that can lose an
// answer. Every case below is about WHERE something is filed, or about a
// question that must not be asked twice.

import { describe, expect, it } from 'vitest'

import { HAIR_COLOR_INTAKE_PACK } from './intake/packs/hairColor'
import { HAIR_GENERAL_INTAKE_PACK } from './intake/packs/hairGeneral'
import { intakeQuestion } from './intake/types'
import {
  consultFollowUpSafetyEntries,
  CONSULT_FOLLOW_UP_SAFETY_KEYS,
  resolveConsultFollowUpVocabulary,
} from './followUpVocabulary'

const COMPLETE_COLOR_INTAKE = {
  change_scale: 'noticeable',
  box_dye_history: 'never',
  prior_lightening: 'over-12-months',
  henna_plant_dye_history: 'never',
  other_chemical_history: 'never',
  prior_reaction: 'no',
}

function vocabulary(
  intakeAnswers: Record<string, string> = {},
  followUpAnswers: Record<string, readonly string[]> = {},
  intakePack = HAIR_COLOR_INTAKE_PACK,
) {
  return resolveConsultFollowUpVocabulary({
    intakePack,
    intakeAnswers,
    serviceName: 'Signature Balayage',
    followUpAnswers,
  })
}

describe('the follow-up vocabulary', () => {
  it('offers optional calibration only when requested and never repeats its answers', () => {
    const args = {
      intakePack: HAIR_COLOR_INTAKE_PACK,
      intakeAnswers: {}, serviceName: null,
      followUpAnswers: { color_jewelry_preference: ['unsure'] },
    }
    expect(resolveConsultFollowUpVocabulary(args).byKey.has('color_sun_response')).toBe(false)
    const enabled = resolveConsultFollowUpVocabulary({ ...args, needsCalibration: true })
    expect(enabled.byKey.has('color_jewelry_preference')).toBe(false)
    expect(enabled.byKey.get('color_sun_response')?.options.map((option) => option.value)).toContain('unsure')
  })

  it('🔴 an INTAKE key is filed in the intake, so the safety policy can read it', () => {
    const found = vocabulary().byKey.get('henna_plant_dye_history')
    expect(found?.home).toBe('INTAKE')
    // If this ever became FOLLOW_UP, a henna answer would be stored where
    // `lib/consult/safetyFlags.ts` and `consult_analysis_payload_guard` cannot
    // see it — an answer collected and then ignored.
    expect(found?.safety).toBe(true)
  })

  it('the follow-up pack’s own keys are filed on the round', () => {
    const found = vocabulary(COMPLETE_COLOR_INTAKE)
    expect(found.byKey.get('event_timing')?.home).toBe('FOLLOW_UP')
    expect(found.byKey.get('budget')?.home).toBe('FOLLOW_UP')
    // B6's question, finally able to name the service it is about.
    expect(found.byKey.get('service_experience')?.packLabel).toBe(
      'Have you had Signature Balayage before?',
    )
  })

  it('🔴 never offers a question she has already answered', () => {
    expect(vocabulary().byKey.has('prior_lightening')).toBe(true)
    expect(
      vocabulary({ prior_lightening: 'never' }).byKey.has('prior_lightening'),
    ).toBe(false)
    // Same for an earlier round's follow-up answer: rounds accumulate, so
    // round 2 cannot re-ask what round 1 got.
    expect(
      vocabulary(COMPLETE_COLOR_INTAKE, { budget: ['under-150'] }).byKey.has('budget'),
    ).toBe(false)
  })

  it('the hair-general pack routes its own keys, and the diet decides which', () => {
    const found = vocabulary({}, {}, HAIR_GENERAL_INTAKE_PACK)
    expect(found.byKey.get('chemical_history')?.home).toBe('INTAKE')
    // P6's diet moved `maintenance_tolerance` OUT of the intake, so its home is
    // the round. This is the assertion that would catch the diet being undone
    // without the routing following it.
    expect(found.byKey.get('maintenance_tolerance')?.home).toBe('FOLLOW_UP')
  })

  it('🔴 one key is never offered from two homes at once', () => {
    // No shipped pack collides today — the diet moved every follow-up key out
    // of its intake. So this exercises the guard DIRECTLY, against a pack that
    // kept one, rather than asserting a property no current input can violate.
    // A defensive branch nothing tests is a branch nobody knows is broken.
    const colliding = {
      ...HAIR_GENERAL_INTAKE_PACK,
      questions: [
        ...HAIR_GENERAL_INTAKE_PACK.questions,
        intakeQuestion('maintenance_tolerance', 'How much upkeep?', 'SKIPPABLE', [
          ['low', 'As little as possible'],
        ]),
      ],
    }
    const found = resolveConsultFollowUpVocabulary({
      intakePack: colliding,
      intakeAnswers: {},
      serviceName: 'Extensions',
      followUpAnswers: {},
    })
    const homes = found.entries
      .filter((item) => item.key === 'maintenance_tolerance')
      .map((item) => item.home)
    // The INTAKE wins, and it appears exactly once. If both survived, the same
    // answer could be written to two places and the two could disagree.
    expect(homes).toEqual(['INTAKE'])
  })

  it('the fallback asks the unanswered SAFETY questions, in pack order', () => {
    const safety = consultFollowUpSafetyEntries(vocabulary()).map((item) => item.key)
    expect(safety).toEqual([
      'box_dye_history',
      'prior_lightening',
      'henna_plant_dye_history',
      'other_chemical_history',
      'prior_reaction',
    ])
    for (const key of safety) {
      expect(CONSULT_FOLLOW_UP_SAFETY_KEYS.has(key)).toBe(true)
    }
  })

  it('🔴 has NO safety question left once the colour intake is complete', () => {
    // The honest state of hair colour today, and the reason the fallback has to
    // be FORCED in a test rather than waited for: intake v3 requires all five
    // safety questions before it can complete, and completion gates the
    // analysis — so by the prep tier they are always answered.
    //
    // ⚠️ Allergies are the gap: the colour pack asks neither `known_allergies`
    // nor `skin_sensitivity`, which is why `ALLERGY_HISTORY_UNKNOWN` is
    // permanently required. Closing it is P5g-2 (a v4 pack plus a safety-policy
    // change), deferred by decision — not overlooked.
    expect(consultFollowUpSafetyEntries(vocabulary(COMPLETE_COLOR_INTAKE))).toEqual([])
    expect(vocabulary(COMPLETE_COLOR_INTAKE).entries.length).toBeGreaterThan(0)
  })

  it('runs out of things to ask, and says so by being empty', () => {
    // 🔴 Each home is checked against ITS OWN store: an intake key is answered
    // when the intake revision holds it, a follow-up key when the round does.
    // Answering an intake key in the round's map must NOT retire it — that
    // would be the "answer stored where its reader cannot see it" bug, hidden
    // behind a vocabulary that looked satisfied.
    const intakeAnswers: Record<string, string> = { ...COMPLETE_COLOR_INTAKE }
    const followUpAnswers: Record<string, string[]> = {}
    for (const item of vocabulary(intakeAnswers).entries) {
      if (item.home === 'INTAKE') intakeAnswers[item.key] = item.options[0]!.value
      else followUpAnswers[item.key] = [item.options[0]!.value]
    }
    expect(vocabulary(intakeAnswers, followUpAnswers).entries).toEqual([])
  })

  it('🔴 an intake key answered in the ROUND’s map is still asked', () => {
    const asFollowUp = vocabulary(
      {},
      { prior_lightening: ['never'] },
    ).byKey.get('prior_lightening')
    expect(asFollowUp?.home).toBe('INTAKE')
  })
})
