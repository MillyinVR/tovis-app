import { ConsultServiceFamily } from '@prisma/client'
import { describe, expect, it } from 'vitest'

import { GENERAL_SERVICE_INTAKE_PACK } from './packs/generalService'
import { HAIR_COLOR_INTAKE_PACK } from './packs/hairColor'
import { HAIR_GENERAL_INTAKE_PACK } from './packs/hairGeneral'
import {
  CONSULT_INTAKE_PACKS,
  consultIntakeItems,
  evaluateConsultIntakeProgress,
  findConsultIntakePack,
  normalizeConsultIntakePayload,
  normalizeConsultIntakePayloadForPack,
  resolveConsultIntakePack,
  toConsultIntakeQuestionPackDTO,
  validateConsultIntakeAnswers,
} from './registry'

const completeHairGeneral = {
  service_experience: 'first-time',
  change_scale: 'noticeable',
  current_length: 'shoulder',
  hair_texture: 'wavy',
  chemical_history: 'never',
  prior_lightening: 'over-12-months',
  last_service_timing: '4-6-months',
  prior_reaction: 'no',
}

const completeGeneralService = {
  service_experience: 'had-before',
  change_scale: 'total',
  recent_treatment_timing: 'never',
  skin_sensitivity: 'no',
  known_allergies: 'none-known',
  prior_reaction: 'no',
  last_service_timing: 'never',
}

describe('consult intake registry', () => {
  it('registers three packs with unique ids and the shared schema version', () => {
    expect(CONSULT_INTAKE_PACKS.map((pack) => pack.id)).toEqual([
      'hair-color',
      'hair-general',
      'general-service',
    ])
    expect(new Set(CONSULT_INTAKE_PACKS.map((pack) => pack.id)).size).toBe(3)
    for (const pack of CONSULT_INTAKE_PACKS) {
      expect(pack.schemaVersion).toBe(2)
      expect(findConsultIntakePack(pack.id)).toBe(pack)
      // Every pack asks exactly one CONDITIONAL question, and it is the goal
      // direction rule's question.
      const conditional = pack.questions.filter(
        (question) => question.requirement === 'CONDITIONAL',
      )
      expect(conditional.map((question) => question.key)).toEqual([
        pack.goalDirection?.questionKey,
      ])
      // Keys are unique inside a pack.
      expect(new Set(pack.questions.map((question) => question.key)).size).toBe(
        pack.questions.length,
      )
    }
    expect(findConsultIntakePack('nails-v9')).toBeNull()
  })

  it('resolves the colour pack by slug, the hair pack by family, the general pack otherwise', () => {
    expect(
      resolveConsultIntakePack({
        categorySlug: 'hair-color',
        family: ConsultServiceFamily.HAIR,
      }),
    ).toBe(HAIR_COLOR_INTAKE_PACK)
    // The colour category keeps its pack whatever family an admin files it under.
    expect(
      resolveConsultIntakePack({
        categorySlug: 'hair-color',
        family: ConsultServiceFamily.OTHER,
      }),
    ).toBe(HAIR_COLOR_INTAKE_PACK)
    for (const categorySlug of ['hair-extensions', 'cuts', 'a-category-from-tomorrow']) {
      expect(
        resolveConsultIntakePack({ categorySlug, family: ConsultServiceFamily.HAIR }),
      ).toBe(HAIR_GENERAL_INTAKE_PACK)
    }
    for (const family of [
      ConsultServiceFamily.SKIN,
      ConsultServiceFamily.NAILS,
      ConsultServiceFamily.BROWS_LASHES,
      ConsultServiceFamily.MAKEUP,
      ConsultServiceFamily.BODY,
      ConsultServiceFamily.OTHER,
    ]) {
      expect(
        resolveConsultIntakePack({ categorySlug: 'anything', family }),
      ).toBe(GENERAL_SERVICE_INTAKE_PACK)
    }
  })

  it('serves a pack on the wire without its rules', () => {
    const dto = toConsultIntakeQuestionPackDTO(HAIR_GENERAL_INTAKE_PACK)
    expect(Object.keys(dto).sort()).toEqual([
      'categorySlug',
      'id',
      'questions',
      'schemaVersion',
      'version',
    ])
    expect(dto).toMatchObject({ id: 'hair-general', version: 1, schemaVersion: 2 })
  })

  it('walks the hair pack: required answers, then the conditional goal direction', () => {
    expect(evaluateConsultIntakeProgress(HAIR_GENERAL_INTAKE_PACK, {})).toEqual({
      canComplete: false,
      nextQuestionKey: 'service_experience',
      blocker: 'REQUIRED_ANSWERS_MISSING',
    })
    expect(
      evaluateConsultIntakeProgress(HAIR_GENERAL_INTAKE_PACK, {
        ...completeHairGeneral,
        change_scale: 'subtle',
      }),
    ).toEqual({
      canComplete: false,
      nextQuestionKey: 'goal_direction',
      blocker: 'GOAL_DIRECTION_REQUIRED',
    })
    expect(
      evaluateConsultIntakeProgress(HAIR_GENERAL_INTAKE_PACK, {
        ...completeHairGeneral,
        change_scale: 'subtle',
        goal_direction: 'not-sure',
      }),
    ).toEqual({
      canComplete: false,
      nextQuestionKey: 'goal_direction',
      blocker: 'GOAL_DIRECTION_UNRESOLVED',
    })
    expect(
      evaluateConsultIntakeProgress(HAIR_GENERAL_INTAKE_PACK, {
        ...completeHairGeneral,
        change_scale: 'subtle',
        goal_direction: 'length',
      }),
    ).toEqual({ canComplete: true, nextQuestionKey: null, blocker: null })
    // A noticeable change needs no direction.
    expect(
      evaluateConsultIntakeProgress(HAIR_GENERAL_INTAKE_PACK, completeHairGeneral),
    ).toEqual({ canComplete: true, nextQuestionKey: null, blocker: null })
  })

  it('validates each pack against ITS OWN questions', () => {
    // A colour answer is not a hair-general answer.
    expect(
      validateConsultIntakeAnswers(
        HAIR_GENERAL_INTAKE_PACK,
        { current_color: 'brunette' },
        false,
      ),
    ).toMatchObject({ ok: false, code: 'INVALID_ANSWERS' })
    expect(
      validateConsultIntakeAnswers(
        HAIR_GENERAL_INTAKE_PACK,
        { hair_texture: 'wavy' },
        false,
      ),
    ).toEqual({ ok: true, answers: { hair_texture: 'wavy' } })
    expect(
      validateConsultIntakeAnswers(
        GENERAL_SERVICE_INTAKE_PACK,
        completeGeneralService,
        true,
      ),
    ).toMatchObject({ ok: true })
    expect(
      validateConsultIntakeAnswers(
        GENERAL_SERVICE_INTAKE_PACK,
        { ...completeGeneralService, known_allergies: 'peanuts' },
        true,
      ),
    ).toMatchObject({ ok: false, code: 'INVALID_ANSWERS' })
    expect(
      validateConsultIntakeAnswers(
        GENERAL_SERVICE_INTAKE_PACK,
        { service_experience: 'regular' },
        true,
      ),
    ).toMatchObject({ ok: false, code: 'REQUIRED_ANSWERS_MISSING' })
  })

  it('normalizes a stored payload against the pack it NAMES, at that pack’s current versions', () => {
    const stored = {
      packId: 'general-service',
      packVersion: 1,
      schemaVersion: 2,
      complete: true,
      answers: completeGeneralService,
    }
    expect(normalizeConsultIntakePayload(stored)).toEqual(stored)
    expect(normalizeConsultIntakePayload({ ...stored, packVersion: 2 })).toBeNull()
    expect(normalizeConsultIntakePayload({ ...stored, packId: 'hair-general' })).toBeNull()
    expect(normalizeConsultIntakePayload({ ...stored, packId: 'unknown' })).toBeNull()
    expect(normalizeConsultIntakePayload({ ...stored, extra: 1 })).toBeNull()
    // The for-pack variant refuses a payload written under another pack.
    expect(
      normalizeConsultIntakePayloadForPack(HAIR_COLOR_INTAKE_PACK, stored),
    ).toBeNull()
    expect(
      normalizeConsultIntakePayloadForPack(GENERAL_SERVICE_INTAKE_PACK, stored),
    ).toEqual(stored)
  })

  it('renders intake items in pack order with the labels the client saw', () => {
    const items = consultIntakeItems(GENERAL_SERVICE_INTAKE_PACK, {
      ...completeGeneralService,
      budget: 'over-400',
      mystery: 'x',
    })
    expect(items.map((item) => item.questionKey)).toEqual([
      'service_experience',
      'change_scale',
      'recent_treatment_timing',
      'skin_sensitivity',
      'known_allergies',
      'prior_reaction',
      'last_service_timing',
      'budget',
    ])
    expect(items.find((item) => item.questionKey === 'known_allergies')).toEqual({
      questionKey: 'known_allergies',
      question:
        'Any known allergies to beauty products — adhesives, dyes, fragrances, latex?',
      answerCode: 'none-known',
      answer: 'None that I know of',
    })
  })
})
