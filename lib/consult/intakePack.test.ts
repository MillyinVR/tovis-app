import { BoardType } from '@prisma/client'
import { describe, expect, it } from 'vitest'

import { BOARD_QUESTION_SETS } from '@/lib/boards/context'

import {
  evaluateHairColorIntakeProgress,
  HAIR_COLOR_INTAKE_PACK,
  HAIR_COLOR_INTAKE_PACK_VERSION,
  HAIR_COLOR_INTAKE_SCHEMA_VERSION,
  normalizeHairColorIntakePayload,
  validateHairColorC5EvaluationIntakeAnswers,
  validateHairColorIntakeAnswers,
} from './intakePack'

const completeAnswers = {
  current_color: 'brunette',
  desired_color: 'red',
  change_scale: 'noticeable',
  box_dye_history: 'over-12-months',
  prior_lightening: '6-12-months',
  henna_plant_dye_history: 'never',
  perm_history: 'never',
  relaxer_texturizer_history: 'never',
  keratin_smoothing_history: 'never',
  other_chemical_history: 'never',
  last_color_service_timing: '4-6-months',
  prior_reaction: 'no',
}

describe('hair-color intake pack', () => {
  it('pins exact pack/schema versions and explicit requirement semantics', () => {
    expect(HAIR_COLOR_INTAKE_PACK).toMatchObject({
      id: 'hair-color',
      categorySlug: 'hair-color',
      version: HAIR_COLOR_INTAKE_PACK_VERSION,
      schemaVersion: HAIR_COLOR_INTAKE_SCHEMA_VERSION,
    })
    expect(
      HAIR_COLOR_INTAKE_PACK.questions.filter(
        (question) => question.requirement === 'REQUIRED',
      ).map((question) => question.key),
    ).toEqual([
      'current_color',
      'desired_color',
      'change_scale',
      'box_dye_history',
      'prior_lightening',
      'henna_plant_dye_history',
      'perm_history',
      'relaxer_texturizer_history',
      'keratin_smoothing_history',
      'other_chemical_history',
      'last_color_service_timing',
      'prior_reaction',
    ])
    expect(
      HAIR_COLOR_INTAKE_PACK.questions.filter(
        (question) => question.requirement === 'SKIPPABLE',
      ).map((question) => question.key),
    ).toEqual(['event_timing', 'budget'])
  })

  it('requires a resolved direction for subtle, same-color, and unsure goals', () => {
    for (const ambiguous of [
      { ...completeAnswers, change_scale: 'subtle' },
      {
        ...completeAnswers,
        current_color: 'red',
        desired_color: 'red',
      },
      { ...completeAnswers, desired_color: 'not-sure' },
    ]) {
      expect(validateHairColorIntakeAnswers(ambiguous, true)).toMatchObject({
        ok: false,
        code: 'GOAL_DIRECTION_REQUIRED',
      })
      expect(
        validateHairColorIntakeAnswers(
          { ...ambiguous, goal_direction: 'lighter' },
          true,
        ),
      ).toMatchObject({ ok: true })
    }
    expect(
      validateHairColorIntakeAnswers(
        {
          ...completeAnswers,
          change_scale: 'subtle',
          goal_direction: 'not-sure',
        },
        true,
      ),
    ).toMatchObject({ ok: false, code: 'GOAL_DIRECTION_UNRESOLVED' })
  })

  it('provides one-question progress and plain-language treatment context', () => {
    expect(evaluateHairColorIntakeProgress({})).toEqual({
      canComplete: false,
      nextQuestionKey: 'current_color',
      blocker: 'REQUIRED_ANSWERS_MISSING',
    })
    expect(
      evaluateHairColorIntakeProgress({
        current_color: 'brunette',
        desired_color: 'brunette',
        change_scale: 'subtle',
      }),
    ).toEqual({
      canComplete: false,
      nextQuestionKey: 'goal_direction',
      blocker: 'GOAL_DIRECTION_REQUIRED',
    })
    for (const key of [
      'henna_plant_dye_history',
      'perm_history',
      'relaxer_texturizer_history',
      'keratin_smoothing_history',
      'other_chemical_history',
    ]) {
      const treatment = HAIR_COLOR_INTAKE_PACK.questions.find(
        (question) => question.key === key,
      )
      expect(treatment?.helpText).toContain('besides hair color')
      expect(treatment?.options.some((option) => option.value === 'not-sure')).toBe(
        true,
      )
    }
  })

  it('reuses the approved board color copy and option values', () => {
    const boardQuestions = BOARD_QUESTION_SETS[BoardType.COLOR_TRANSFORMATION]
    for (const [intakeKey, boardKey] of [
      ['current_color', 'current_color'],
      ['desired_color', 'dream_color'],
      ['change_scale', 'change_scale'],
    ] as const) {
      const intake = HAIR_COLOR_INTAKE_PACK.questions.find(
        (question) => question.key === intakeKey,
      )
      const board = boardQuestions.find((question) => question.key === boardKey)
      expect(intake?.label).toBe(board?.label)
      expect(intake?.options).toEqual(board?.options)
    }
  })

  it('allows validated partial saves but requires every required answer to complete', () => {
    expect(
      validateHairColorIntakeAnswers(
        { current_color: 'brunette' },
        false,
      ),
    ).toEqual({ ok: true, answers: { current_color: 'brunette' } })
    expect(validateHairColorIntakeAnswers({}, false)).toMatchObject({
      ok: false,
      code: 'INVALID_ANSWERS',
    })
    expect(
      validateHairColorIntakeAnswers(
        { ...completeAnswers, budget: 'under-150' },
        true,
      ),
    ).toMatchObject({ ok: true })
    expect(
      validateHairColorIntakeAnswers(
        { current_color: 'brunette' },
        true,
      ),
    ).toMatchObject({ ok: false, code: 'REQUIRED_ANSWERS_MISSING' })
  })

  it('rejects unknown keys, wrong value types, and unknown options', () => {
    for (const answers of [
      { unknown: 'value' },
      { current_color: ['brunette'] },
      { current_color: 'purple' },
    ]) {
      expect(validateHairColorIntakeAnswers(answers, false)).toMatchObject({
        ok: false,
        code: 'INVALID_ANSWERS',
      })
    }
  })

  it('keeps the pinned C5 v1 fixture intake separate from current product intake', () => {
    const c5Answers = {
      current_color: 'blonde',
      desired_color: 'red',
      change_scale: 'noticeable',
      box_dye_history: 'never',
      prior_lightening: 'over-12-months',
      last_color_service_timing: 'over-12-months',
      prior_reaction: 'no',
    }
    expect(validateHairColorC5EvaluationIntakeAnswers(c5Answers).ok).toBe(true)
    expect(validateHairColorIntakeAnswers(c5Answers, true)).toMatchObject({
      ok: false,
      code: 'REQUIRED_ANSWERS_MISSING',
    })
  })

  it('normalizes only the exact current payload version', () => {
    const payload = {
      packId: 'hair-color',
      packVersion: HAIR_COLOR_INTAKE_PACK_VERSION,
      schemaVersion: HAIR_COLOR_INTAKE_SCHEMA_VERSION,
      complete: true,
      answers: completeAnswers,
    }
    expect(normalizeHairColorIntakePayload(payload)).toEqual(payload)
    expect(
      normalizeHairColorIntakePayload({ ...payload, packVersion: 0 }),
    ).toBeNull()
    expect(
      normalizeHairColorIntakePayload({ ...payload, extra: true }),
    ).toBeNull()
    expect(
      normalizeHairColorIntakePayload({
        ...payload,
        answers: { ...completeAnswers, budget: 'unbounded' },
      }),
    ).toBeNull()
  })
})
