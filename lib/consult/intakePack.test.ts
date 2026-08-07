import { BoardType } from '@prisma/client'
import { describe, expect, it } from 'vitest'

import { BOARD_QUESTION_SETS } from '@/lib/boards/context'

import {
  HAIR_COLOR_INTAKE_PACK,
  HAIR_COLOR_INTAKE_PACK_VERSION,
  HAIR_COLOR_INTAKE_SCHEMA_VERSION,
  normalizeHairColorIntakePayload,
  validateHairColorIntakeAnswers,
} from './intakePack'

const completeAnswers = {
  current_color: 'brunette',
  desired_color: 'red',
  change_scale: 'noticeable',
  box_dye_history: 'over-12-months',
  prior_lightening: '6-12-months',
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
      'last_color_service_timing',
      'prior_reaction',
    ])
    expect(
      HAIR_COLOR_INTAKE_PACK.questions.filter(
        (question) => question.requirement === 'SKIPPABLE',
      ).map((question) => question.key),
    ).toEqual(['event_timing', 'budget'])
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
