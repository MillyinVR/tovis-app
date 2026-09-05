import { describe, expect, it } from 'vitest'

import { defaultClientConsultInspirationCopy } from '@/lib/brand/defaultClientConsultInspirationCopy'

import { GENERAL_SERVICE_INSPIRATION_PACK } from './packs/generalService'
import { HAIR_COLOR_INSPIRATION_PACK } from './packs/hairColor'
import { HAIR_GENERAL_INSPIRATION_PACK } from './packs/hairGeneral'
import {
  assertConsultInspirationPackWritable,
  buildConsultInspirationExactDetails,
  buildConsultInspirationPossibleInterpretation,
  CONSULT_INSPIRATION_PACKS,
  CONSULT_INSPIRATION_PACK_ARCHIVE,
  deriveConsultInspirationCatalogDetails,
  evaluateConsultInspirationProgress,
  findConsultInspirationPack,
  resolveConsultInspirationPack,
  resolveConsultInspirationPayloadV2,
  resolveConsultSessionInspirationPack,
  toConsultInspirationJsonPayloadV2,
  toConsultInspirationReviewV2,
  validateConsultInspirationAnswer,
} from './registry'
import { inspirationQuestion, type ConsultInspirationPackDefinition } from './types'

const copy = defaultClientConsultInspirationCopy

/** Every question answered with its first non-neutral option. */
function fullAnswers(pack: ConsultInspirationPackDefinition) {
  const answers: Record<string, readonly string[]> = {}
  for (const question of pack.questions) {
    const option =
      question.options.find(
        (candidate) => !['none', 'not-sure', 'not-part-of-goal'].includes(candidate.value),
      ) ?? question.options[0]
    answers[question.key] = [option!.value]
  }
  return answers
}

function payload(pack: ConsultInspirationPackDefinition, extra: Record<string, unknown> = {}) {
  return {
    packId: pack.id,
    packVersion: pack.version,
    schemaVersion: pack.schemaVersion,
    source: 'PLATFORM_LOOK',
    inspirationId: 'insp_1',
    complete: true,
    answers: fullAnswers(pack),
    catalogGuidance: deriveConsultInspirationCatalogDetails(pack, fullAnswers(pack)),
    ...extra,
  }
}

describe('inspiration pack registry', () => {
  it('serves the colour pack by slug, the hair pack by family, and the general pack to everything else', () => {
    expect(
      resolveConsultInspirationPack({ categorySlug: 'hair-color', family: 'HAIR' }).id,
    ).toBe(HAIR_COLOR_INSPIRATION_PACK.id)
    expect(
      resolveConsultInspirationPack({ categorySlug: 'hair-extensions', family: 'HAIR' }).id,
    ).toBe(HAIR_GENERAL_INSPIRATION_PACK.id)
    for (const family of ['SKIN', 'NAILS', 'BROWS_LASHES', 'MAKEUP', 'BODY', 'OTHER'] as const) {
      expect(
        resolveConsultInspirationPack({ categorySlug: 'anything-new', family }).id,
      ).toBe(GENERAL_SERVICE_INSPIRATION_PACK.id)
    }
  })

  it('looks a pack up by id, and by id AND version', () => {
    expect(findConsultInspirationPack(HAIR_COLOR_INSPIRATION_PACK.id)?.version).toBe(1)
    expect(findConsultInspirationPack(HAIR_COLOR_INSPIRATION_PACK.id, 1)?.id).toBe(
      HAIR_COLOR_INSPIRATION_PACK.id,
    )
    expect(findConsultInspirationPack(HAIR_COLOR_INSPIRATION_PACK.id, 99)).toBeNull()
    expect(findConsultInspirationPack('no-such-pack')).toBeNull()
  })

  it('🔴 every registered pack is WRITABLE — the database guard would accept it', () => {
    for (const pack of [...CONSULT_INSPIRATION_PACKS, ...CONSULT_INSPIRATION_PACK_ARCHIVE]) {
      expect(() => assertConsultInspirationPackWritable(pack)).not.toThrow()
    }
  })

  it('🔴 refuses a pack whose value the database guard would reject', () => {
    // The guard's content regex treats a HYPHEN as a word boundary, so this
    // value matches `\mface\M` and is refused at the write — after passing
    // typecheck and every other test. Proven against the live guard in
    // tests/integration/consult-inspiration-contract-v2.test.ts.
    const trap: ConsultInspirationPackDefinition = {
      ...HAIR_GENERAL_INSPIRATION_PACK,
      id: 'trap-pack',
      questions: [
        inspirationQuestion({
          key: 'favorite_details',
          label: 'What do you like?',
          kind: 'MULTI_SELECT',
          options: [['face-framing', 'The pieces around the front']],
          minSelections: 1,
          maxSelections: 1,
          detailSentiment: 'LIKE',
        }),
      ],
      possibleMeanings: {},
    }
    expect(() => assertConsultInspirationPackWritable(trap)).toThrow(/guard refuses/)
  })

  it('validates one answer against its own pack', () => {
    const pack = HAIR_COLOR_INSPIRATION_PACK
    expect(
      validateConsultInspirationAnswer(pack, {
        questionKey: 'favorite_colors',
        selectedValues: ['warm-golden', 'cool-smoky'],
      }),
    ).toEqual({
      ok: true,
      questionKey: 'favorite_colors',
      selectedValues: ['warm-golden', 'cool-smoky'],
    })
    // A key this pack does not ask, a value it does not offer, a duplicate, too
    // many picks, and a neutral value mixed with a real one.
    for (const raw of [
      { questionKey: 'other_detail', selectedValues: ['nothing-else'] },
      { questionKey: 'favorite_colors', selectedValues: ['teal'] },
      { questionKey: 'favorite_colors', selectedValues: ['warm-golden', 'warm-golden'] },
      { questionKey: 'length_goal', selectedValues: ['longer', 'shorter'] },
      { questionKey: 'avoid_colors', selectedValues: ['none', 'copper-red'] },
      { questionKey: 'favorite_colors', selectedValues: [] },
    ]) {
      expect(validateConsultInspirationAnswer(pack, raw).ok).toBe(false)
    }
  })

  it('🔴 completes on the questions alone — there is no three-detail gate', () => {
    const pack = HAIR_COLOR_INSPIRATION_PACK
    // Every answer neutral: under contract v1 this client could never finish.
    const answers: Record<string, readonly string[]> = {
      favorite_colors: ['not-sure'],
      avoid_colors: ['none'],
      length_goal: ['not-part-of-goal'],
      fullness_goal: ['not-part-of-goal'],
      current_styling: ['not-sure'],
      styling_walkthrough: ['not-sure'],
    }
    const progress = evaluateConsultInspirationProgress(pack, answers)
    expect(progress.specificDetailCount).toBe(0)
    expect(progress).toMatchObject({
      currentQuestion: null,
      answeredQuestionCount: pack.questions.length,
      canComplete: true,
      blocker: null,
    })
  })

  it('asks one question at a time, in pack order', () => {
    const pack = HAIR_GENERAL_INSPIRATION_PACK
    const answers: Record<string, readonly string[]> = {}
    for (const question of pack.questions) {
      const progress = evaluateConsultInspirationProgress(pack, answers)
      expect(progress.currentQuestion?.key).toBe(question.key)
      expect(progress.canComplete).toBe(false)
      expect(progress.blocker).toBe('QUESTIONS_REMAINING')
      answers[question.key] = [question.options[0]!.value]
    }
    expect(evaluateConsultInspirationProgress(pack, answers).canComplete).toBe(true)
  })

  it('derives her words, the possible reading, and the catalogue enums from the pack', () => {
    const pack = HAIR_COLOR_INSPIRATION_PACK
    const answers = {
      favorite_colors: ['warm-golden'],
      avoid_colors: ['none'],
      length_goal: ['longer'],
    }
    const details = buildConsultInspirationExactDetails(pack, answers)
    expect(details).toEqual([
      {
        questionKey: 'favorite_colors',
        value: 'warm-golden',
        clientWords: 'The warm or golden colors',
        sentiment: 'LIKE',
      },
      {
        questionKey: 'length_goal',
        value: 'longer',
        clientWords: 'Yes, but I want it longer',
        sentiment: 'GOAL',
      },
    ])
    expect(buildConsultInspirationPossibleInterpretation(pack, details)).toEqual([
      {
        clientDetailValue: 'warm-golden',
        possibleMeaning:
          'May point to a preference for warmer or golden-looking hair color.',
        confidence: 'POSSIBLE',
        evidence: 'CLIENT_SELECTION',
      },
      {
        clientDetailValue: 'longer',
        possibleMeaning: 'The client may want more length than the reference shows.',
        confidence: 'POSSIBLE',
        evidence: 'CLIENT_SELECTION',
      },
    ])
    expect(deriveConsultInspirationCatalogDetails(pack, answers)).toEqual(['LENGTH'])
  })

  it('normalizes a stored payload back to the pack it names', () => {
    const pack = HAIR_COLOR_INSPIRATION_PACK
    const stored = toConsultInspirationJsonPayloadV2(
      resolveConsultInspirationPayloadV2(payload(pack))!.payload,
    )
    const resolved = resolveConsultInspirationPayloadV2(stored)
    expect(resolved?.pack.id).toBe(pack.id)
    expect(resolved?.payload.complete).toBe(true)
    expect(resolved?.payload.answers.favorite_colors).toEqual(['lightest-pieces'])
  })

  it('refuses a stored payload that disagrees with itself', () => {
    const pack = HAIR_COLOR_INSPIRATION_PACK
    const cases: Record<string, unknown> = {
      'unregistered pack': payload(pack, { packId: 'no-such-pack' }),
      'unregistered version': payload(pack, { packVersion: 99 }),
      'wrong schema version': payload(pack, { schemaVersion: 1 }),
      'extra key': { ...payload(pack), notes: 'x' },
      'missing key': (() => {
        const withoutCatalogue: Record<string, unknown> = { ...payload(pack) }
        delete withoutCatalogue.catalogGuidance
        return withoutCatalogue
      })(),
      'answer the pack does not ask': payload(pack, {
        answers: { ...fullAnswers(pack), other_detail: ['nothing-else'] },
      }),
      'complete disagrees with the answers': payload(pack, {
        answers: { favorite_colors: ['warm-golden'] },
        catalogGuidance: [],
      }),
      'skip carrying answers': payload(pack, {
        source: 'NONE',
        inspirationId: null,
        answers: { favorite_colors: ['warm-golden'] },
        catalogGuidance: [],
      }),
      'source without an inspiration id': payload(pack, { inspirationId: null }),
      'catalogue detail her answers never pointed at': payload(pack, {
        catalogGuidance: ['LENGTH', 'FULLNESS', 'STYLING'],
        answers: { ...fullAnswers(pack), length_goal: ['not-part-of-goal'] },
      }),
      'repeated catalogue detail': payload(pack, { catalogGuidance: ['LENGTH', 'LENGTH'] }),
    }
    for (const [label, raw] of Object.entries(cases)) {
      expect(resolveConsultInspirationPayloadV2(raw), label).toBeNull()
    }
  })

  it('renders the read view with the brand sentence, and no free text', () => {
    const pack = HAIR_COLOR_INSPIRATION_PACK
    const resolved = resolveConsultInspirationPayloadV2(payload(pack))!
    const review = toConsultInspirationReviewV2(pack, resolved.payload, copy)
    expect(review.contractVersion).toBe(2)
    expect(review.packId).toBe(pack.id)
    expect(review.answers.every((answer) => answer.text === null)).toBe(true)
    expect(review.answers.every((answer) => answer.sentiment === null)).toBe(true)
    expect(review.answers.map((answer) => answer.questionKey)).toEqual(
      pack.questions.map((question) => question.key),
    )
    for (const guidance of review.catalogGuidance) {
      expect(guidance.message).toBe(copy.catalogGuidanceNote)
      expect(guidance.contextOnly).toBe(true)
      expect(guidance.automaticallyAdded).toBe(false)
    }
  })

  describe('the session pin', () => {
    const pack = HAIR_COLOR_INSPIRATION_PACK

    it('serves the current pack to a consult that has written nothing', () => {
      expect(resolveConsultSessionInspirationPack(pack, [])?.id).toBe(pack.id)
    })

    it('🔴 keeps a consult that started on contract v1 ON v1', () => {
      const v1Row = {
        contractId: 'hair-color-guided-inspiration',
        contractVersion: 1,
        schemaVersion: 1,
        source: 'NONE',
        inspirationId: null,
        complete: true,
        answers: [],
        exactClientDetails: [],
        possibleProfessionalInterpretation: [],
        catalogGuidance: [],
      }
      expect(resolveConsultSessionInspirationPack(pack, [v1Row])).toBeNull()
    })

    it('keeps a consult on the pack VERSION it started on', () => {
      const archived: ConsultInspirationPackDefinition = { ...pack, version: 1 }
      expect(
        resolveConsultSessionInspirationPack(pack, [payload(archived)])?.version,
      ).toBe(1)
    })

    it('skips rows that do not normalize and reads the next one', () => {
      expect(
        resolveConsultSessionInspirationPack(pack, [{ garbage: true }, payload(pack)])?.id,
      ).toBe(pack.id)
    })
  })
})
