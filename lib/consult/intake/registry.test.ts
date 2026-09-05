import { ConsultServiceFamily } from '@prisma/client'
import { describe, expect, it } from 'vitest'

import {
  GENERAL_SERVICE_INTAKE_PACK,
  GENERAL_SERVICE_INTAKE_PACK_V1,
} from './packs/generalService'
import { HAIR_COLOR_INTAKE_PACK, HAIR_COLOR_INTAKE_PACK_V2 } from './packs/hairColor'
import {
  HAIR_GENERAL_INTAKE_PACK,
  HAIR_GENERAL_INTAKE_PACK_V1,
} from './packs/hairGeneral'
import {
  CONSULT_INTAKE_PACKS,
  CONSULT_INTAKE_PACK_ARCHIVE,
  consultIntakeItems,
  evaluateConsultIntakeProgress,
  findConsultIntakePack,
  normalizeConsultIntakePayload,
  normalizeConsultIntakePayloadForPack,
  resolveConsultIntakePack,
  resolveConsultSessionIntakePack,
  toConsultIntakeQuestionPackDTO,
  validateConsultIntakeAnswers,
} from './registry'

const completeHairGeneral = {
  change_scale: 'noticeable',
  chemical_history: 'never',
  prior_lightening: 'over-12-months',
  prior_reaction: 'no',
}

const completeGeneralService = {
  change_scale: 'total',
  recent_treatment_timing: 'never',
  skin_sensitivity: 'no',
  known_allergies: 'none-known',
  prior_reaction: 'no',
}

/** The v1 general-service shape, still stored on sessions that started on it. */
const completeGeneralServiceV1 = {
  service_experience: 'had-before',
  ...completeGeneralService,
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
    for (const pack of [...CONSULT_INTAKE_PACKS, ...CONSULT_INTAKE_PACK_ARCHIVE]) {
      expect(pack.schemaVersion).toBe(2)
      expect(findConsultIntakePack(pack.id, pack.version)).toBe(pack)
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
    // An id alone means "whatever version that pack is on today".
    for (const pack of CONSULT_INTAKE_PACKS) {
      expect(findConsultIntakePack(pack.id)).toBe(pack)
    }
    expect(findConsultIntakePack('nails-v9')).toBeNull()
    expect(findConsultIntakePack('hair-color', 99)).toBeNull()
  })

  // P6, the intake diet. The counts are the point of the change, so they are
  // asserted rather than described: a question quietly re-entering a pack is a
  // regression against the product principle, not a detail.
  it('ships a dieted current version of every pack and keeps the previous one registered', () => {
    expect(HAIR_COLOR_INTAKE_PACK.version).toBe(3)
    expect(HAIR_COLOR_INTAKE_PACK_V2.version).toBe(2)
    expect(HAIR_COLOR_INTAKE_PACK_V2.questions).toHaveLength(15)
    expect(HAIR_COLOR_INTAKE_PACK.questions.map((entry) => entry.key)).toEqual([
      'change_scale',
      'goal_direction',
      'box_dye_history',
      'prior_lightening',
      'henna_plant_dye_history',
      'other_chemical_history',
      'prior_reaction',
    ])

    expect(HAIR_GENERAL_INTAKE_PACK.version).toBe(2)
    expect(HAIR_GENERAL_INTAKE_PACK_V1.questions).toHaveLength(12)
    expect(HAIR_GENERAL_INTAKE_PACK.questions.map((entry) => entry.key)).toEqual([
      'change_scale',
      'goal_direction',
      'chemical_history',
      'prior_lightening',
      'prior_reaction',
    ])

    expect(GENERAL_SERVICE_INTAKE_PACK.version).toBe(2)
    expect(GENERAL_SERVICE_INTAKE_PACK_V1.questions).toHaveLength(11)
    expect(GENERAL_SERVICE_INTAKE_PACK.questions.map((entry) => entry.key)).toEqual([
      'change_scale',
      'goal_direction',
      'recent_treatment_timing',
      'skin_sensitivity',
      'known_allergies',
      'prior_reaction',
    ])

    // service_experience is gone from EVERY pack — it moves to the Brief,
    // phrased with the service name (handoff B6).
    for (const pack of CONSULT_INTAKE_PACKS) {
      expect(pack.questions.some((entry) => entry.key === 'service_experience')).toBe(
        false,
      )
    }
  })

  // The safety policy and the database mirror read intake KEYS and OPTION
  // VALUES. If a dieted pack renamed one, the policy would silently stop
  // routing on it and the analysis would look safer than it is.
  it('keeps every kept question byte-identical to the version it came from', () => {
    const pairs = [
      [HAIR_COLOR_INTAKE_PACK, HAIR_COLOR_INTAKE_PACK_V2],
      [HAIR_GENERAL_INTAKE_PACK, HAIR_GENERAL_INTAKE_PACK_V1],
      [GENERAL_SERVICE_INTAKE_PACK, GENERAL_SERVICE_INTAKE_PACK_V1],
    ] as const
    for (const [current, previous] of pairs) {
      for (const question of current.questions) {
        const before = previous.questions.find((entry) => entry.key === question.key)
        expect(before, `${current.id}.${question.key}`).toBeDefined()
        expect(question.options).toEqual(before?.options)
        expect(question.requirement).toEqual(before?.requirement)
      }
    }
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
    expect(dto).toMatchObject({ id: 'hair-general', version: 2, schemaVersion: 2 })
  })

  it('walks the hair pack: required answers, then the conditional goal direction', () => {
    expect(evaluateConsultIntakeProgress(HAIR_GENERAL_INTAKE_PACK, {})).toEqual({
      canComplete: false,
      nextQuestionKey: 'change_scale',
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

  // The colour pack's rule used to key on the current/dream colour pair as
  // well. Those questions are gone, so "subtle" is the whole rule now.
  it('asks the colour goal direction only on a subtle change', () => {
    const complete = {
      change_scale: 'noticeable',
      box_dye_history: 'never',
      prior_lightening: 'never',
      henna_plant_dye_history: 'never',
      other_chemical_history: 'never',
      prior_reaction: 'no',
    }
    expect(
      evaluateConsultIntakeProgress(HAIR_COLOR_INTAKE_PACK, complete),
    ).toEqual({ canComplete: true, nextQuestionKey: null, blocker: null })
    expect(
      evaluateConsultIntakeProgress(HAIR_COLOR_INTAKE_PACK, {
        ...complete,
        change_scale: 'subtle',
      }),
    ).toEqual({
      canComplete: false,
      nextQuestionKey: 'goal_direction',
      blocker: 'GOAL_DIRECTION_REQUIRED',
    })
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
    // ...and a question the diet removed is no longer one of its own.
    expect(
      validateConsultIntakeAnswers(
        HAIR_GENERAL_INTAKE_PACK,
        { hair_texture: 'wavy' },
        false,
      ),
    ).toMatchObject({ ok: false, code: 'INVALID_ANSWERS' })
    expect(
      validateConsultIntakeAnswers(
        HAIR_GENERAL_INTAKE_PACK_V1,
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
        { change_scale: 'total' },
        true,
      ),
    ).toMatchObject({ ok: false, code: 'REQUIRED_ANSWERS_MISSING' })
  })

  it('normalizes a stored payload against the pack AND VERSION it names', () => {
    const stored = {
      packId: 'general-service',
      packVersion: 2,
      schemaVersion: 2,
      complete: true,
      answers: completeGeneralService,
    }
    expect(normalizeConsultIntakePayload(stored)).toEqual(stored)
    // An archived version still reads — against its OWN question list.
    const storedV1 = {
      packId: 'general-service',
      packVersion: 1,
      schemaVersion: 2,
      complete: true,
      answers: completeGeneralServiceV1,
    }
    expect(normalizeConsultIntakePayload(storedV1)).toEqual(storedV1)
    // v1 answers are not valid v2 answers, and vice versa.
    expect(
      normalizeConsultIntakePayload({ ...storedV1, packVersion: 2 }),
    ).toBeNull()
    expect(normalizeConsultIntakePayload({ ...stored, packVersion: 9 })).toBeNull()
    expect(normalizeConsultIntakePayload({ ...stored, packId: 'hair-general' })).toBeNull()
    expect(normalizeConsultIntakePayload({ ...stored, packId: 'unknown' })).toBeNull()
    expect(normalizeConsultIntakePayload({ ...stored, extra: 1 })).toBeNull()
    // The for-pack variant refuses another pack — and another VERSION of the
    // same pack, because the served pack is the session's pinned one.
    expect(
      normalizeConsultIntakePayloadForPack(HAIR_COLOR_INTAKE_PACK, stored),
    ).toBeNull()
    expect(
      normalizeConsultIntakePayloadForPack(GENERAL_SERVICE_INTAKE_PACK_V1, stored),
    ).toBeNull()
    expect(
      normalizeConsultIntakePayloadForPack(GENERAL_SERVICE_INTAKE_PACK, stored),
    ).toEqual(stored)
  })

  // Revision pinning: a session that already answered keeps the version it
  // answered. Without this, a client mid-intake when a new version ships is
  // told she has no intake and is asked everything again.
  it('pins a session to the pack version its latest readable intake names', () => {
    const v2Payload = {
      packId: 'general-service',
      packVersion: 2,
      schemaVersion: 2,
      complete: false,
      answers: { change_scale: 'total' },
    }
    const v1Payload = {
      packId: 'general-service',
      packVersion: 1,
      schemaVersion: 2,
      complete: true,
      answers: completeGeneralServiceV1,
    }
    // No intake yet → the current version.
    expect(
      resolveConsultSessionIntakePack(GENERAL_SERVICE_INTAKE_PACK, []),
    ).toBe(GENERAL_SERVICE_INTAKE_PACK)
    // Newest-first: the first readable payload wins.
    expect(
      resolveConsultSessionIntakePack(GENERAL_SERVICE_INTAKE_PACK, [v1Payload]),
    ).toBe(GENERAL_SERVICE_INTAKE_PACK_V1)
    expect(
      resolveConsultSessionIntakePack(GENERAL_SERVICE_INTAKE_PACK, [
        v2Payload,
        v1Payload,
      ]),
    ).toBe(GENERAL_SERVICE_INTAKE_PACK)
    // Unreadable rows are skipped, not trusted.
    expect(
      resolveConsultSessionIntakePack(GENERAL_SERVICE_INTAKE_PACK, [
        { packId: 'general-service', packVersion: 99 },
        'nonsense',
        v1Payload,
      ]),
    ).toBe(GENERAL_SERVICE_INTAKE_PACK_V1)
    // A payload from ANOTHER pack (the category changed family) does not pin —
    // that intake starts over on the current pack.
    expect(
      resolveConsultSessionIntakePack(GENERAL_SERVICE_INTAKE_PACK, [
        {
          packId: 'hair-color',
          packVersion: 2,
          schemaVersion: 2,
          complete: false,
          answers: { current_color: 'brunette' },
        },
      ]),
    ).toBe(GENERAL_SERVICE_INTAKE_PACK)
  })

  it('renders intake items in pack order with the labels the client saw', () => {
    const items = consultIntakeItems(GENERAL_SERVICE_INTAKE_PACK, {
      ...completeGeneralService,
      mystery: 'x',
    })
    expect(items.map((item) => item.questionKey)).toEqual([
      'change_scale',
      'recent_treatment_timing',
      'skin_sensitivity',
      'known_allergies',
      'prior_reaction',
    ])
    expect(items.find((item) => item.questionKey === 'known_allergies')).toEqual({
      questionKey: 'known_allergies',
      question:
        'Any known allergies to beauty products — adhesives, dyes, fragrances, latex?',
      answerCode: 'none-known',
      answer: 'None that I know of',
    })
    // An archived revision renders against its own version's labels.
    expect(
      consultIntakeItems(GENERAL_SERVICE_INTAKE_PACK_V1, completeGeneralServiceV1).map(
        (item) => item.questionKey,
      ),
    ).toEqual([
      'service_experience',
      'change_scale',
      'recent_treatment_timing',
      'skin_sensitivity',
      'known_allergies',
      'prior_reaction',
      'last_service_timing',
    ])
  })
})
