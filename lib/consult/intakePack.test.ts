import { BoardType } from '@prisma/client'
import { describe, expect, it } from 'vitest'

import { BOARD_QUESTION_SETS } from '@/lib/boards/context'

import { HAIR_COLOR_INTAKE_PACK_V2 } from './intake/packs/hairColor'
import { validateConsultIntakeAnswers } from './intake/registry'
import {
  evaluateHairColorIntakeProgress,
  HAIR_COLOR_INTAKE_PACK,
  HAIR_COLOR_INTAKE_PACK_VERSION,
  HAIR_COLOR_INTAKE_SCHEMA_VERSION,
  normalizeHairColorIntakePayload,
  validateHairColorC5EvaluationIntakeAnswers,
  validateHairColorIntakeAnswers,
} from './intakePack'

/** A complete answer set for the CURRENT (v3) colour pack. */
const completeAnswers = {
  change_scale: 'noticeable',
  box_dye_history: 'over-12-months',
  prior_lightening: '6-12-months',
  henna_plant_dye_history: 'never',
  other_chemical_history: 'never',
  prior_reaction: 'no',
}

/** The v2 set, still stored on sessions that started before the P6 diet. */
const completeAnswersV2 = {
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
      'change_scale',
      'box_dye_history',
      'prior_lightening',
      'henna_plant_dye_history',
      'other_chemical_history',
      'prior_reaction',
    ])
    // The diet left nothing optional in the pre-analysis intake: every
    // question is either something the analysis needs or it moved to the
    // post-booking follow-up.
    expect(
      HAIR_COLOR_INTAKE_PACK.questions.filter(
        (question) => question.requirement === 'SKIPPABLE',
      ),
    ).toEqual([])
  })

  it('keeps v2 frozen for the sessions that stored it', () => {
    expect(HAIR_COLOR_INTAKE_PACK_V2.version).toBe(2)
    expect(
      HAIR_COLOR_INTAKE_PACK_V2.questions.filter(
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
      HAIR_COLOR_INTAKE_PACK_V2.questions.filter(
        (question) => question.requirement === 'SKIPPABLE',
      ).map((question) => question.key),
    ).toEqual(['event_timing', 'budget'])
    expect(
      validateConsultIntakeAnswers(HAIR_COLOR_INTAKE_PACK_V2, completeAnswersV2, true),
    ).toMatchObject({ ok: true })
  })

  // v2 also treated an unsure dream colour and a same-as-today colour as
  // ambiguous. Both of those questions are gone, so "subtle" is the whole rule.
  it('requires a resolved direction for a subtle goal', () => {
    const ambiguous = { ...completeAnswers, change_scale: 'subtle' }
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
    expect(
      validateHairColorIntakeAnswers(
        { ...ambiguous, goal_direction: 'not-sure' },
        true,
      ),
    ).toMatchObject({ ok: false, code: 'GOAL_DIRECTION_UNRESOLVED' })
    // A noticeable change never needs the direction question.
    expect(validateHairColorIntakeAnswers(completeAnswers, true)).toMatchObject({
      ok: true,
    })
  })

  it('provides one-question progress and plain-language treatment context', () => {
    expect(evaluateHairColorIntakeProgress({})).toEqual({
      canComplete: false,
      nextQuestionKey: 'change_scale',
      blocker: 'REQUIRED_ANSWERS_MISSING',
    })
    expect(
      evaluateHairColorIntakeProgress({
        ...completeAnswers,
        change_scale: 'subtle',
      }),
    ).toEqual({
      canComplete: false,
      nextQuestionKey: 'goal_direction',
      blocker: 'GOAL_DIRECTION_REQUIRED',
    })
    // The two treatment-history questions the diet left: henna keeps its own
    // question (it is a hard incompatibility), and the rest fold into
    // `other_chemical_history` — which now names them.
    for (const key of ['henna_plant_dye_history', 'other_chemical_history']) {
      const treatment = HAIR_COLOR_INTAKE_PACK.questions.find(
        (question) => question.key === key,
      )
      expect(treatment?.helpText).toContain('besides hair color')
      expect(treatment?.options.some((option) => option.value === 'not-sure')).toBe(
        true,
      )
    }
    expect(
      HAIR_COLOR_INTAKE_PACK.questions.find(
        (question) => question.key === 'other_chemical_history',
      )?.label,
    ).toBe(
      'When did you last have a perm, relaxer, keratin or other chemical treatment?',
    )
  })

  it('reuses the approved board color copy and option values', () => {
    const boardQuestions = BOARD_QUESTION_SETS[BoardType.COLOR_TRANSFORMATION]
    // v2 asked all three; v3 keeps only the scale question, and it keeps the
    // board's exact copy.
    for (const [pack, pairs] of [
      [
        HAIR_COLOR_INTAKE_PACK_V2,
        [
          ['current_color', 'current_color'],
          ['desired_color', 'dream_color'],
          ['change_scale', 'change_scale'],
        ],
      ],
      [HAIR_COLOR_INTAKE_PACK, [['change_scale', 'change_scale']]],
    ] as const) {
      for (const [intakeKey, boardKey] of pairs) {
        const intake = pack.questions.find((question) => question.key === intakeKey)
        const board = boardQuestions.find((question) => question.key === boardKey)
        expect(intake?.label).toBe(board?.label)
        expect(intake?.options).toEqual(board?.options)
      }
    }
  })

  it('allows validated partial saves but requires every required answer to complete', () => {
    expect(
      validateHairColorIntakeAnswers({ change_scale: 'noticeable' }, false),
    ).toEqual({ ok: true, answers: { change_scale: 'noticeable' } })
    expect(validateHairColorIntakeAnswers({}, false)).toMatchObject({
      ok: false,
      code: 'INVALID_ANSWERS',
    })
    expect(validateHairColorIntakeAnswers(completeAnswers, true)).toMatchObject({
      ok: true,
    })
    expect(
      validateHairColorIntakeAnswers({ change_scale: 'noticeable' }, true),
    ).toMatchObject({ ok: false, code: 'REQUIRED_ANSWERS_MISSING' })
  })

  it('rejects unknown keys, wrong value types, and unknown options', () => {
    for (const answers of [
      { unknown: 'value' },
      { change_scale: ['subtle'] },
      { change_scale: 'enormous' },
      // A question the diet removed is an UNKNOWN key on the current pack —
      // never a silently ignored one.
      { current_color: 'brunette' },
      { budget: 'under-150' },
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
    // The C5 fixture contract is frozen at its own v1 shape; against the
    // current product pack its colour and timing keys do not exist at all.
    expect(validateHairColorIntakeAnswers(c5Answers, true)).toMatchObject({
      ok: false,
      code: 'INVALID_ANSWERS',
    })
  })

  it('normalizes the current payload version, and refuses an unregistered one', () => {
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
    // v2 is registered, but this helper serves the CURRENT pack — a v2 payload
    // belongs to a session pinned to v2, and is read through that pack.
    expect(
      normalizeHairColorIntakePayload({
        ...payload,
        packVersion: 2,
        answers: completeAnswersV2,
      }),
    ).toBeNull()
    expect(
      normalizeHairColorIntakePayload({ ...payload, extra: true }),
    ).toBeNull()
    expect(
      normalizeHairColorIntakePayload({
        ...payload,
        answers: { ...completeAnswers, other_chemical_history: 'unbounded' },
      }),
    ).toBeNull()
  })
})
