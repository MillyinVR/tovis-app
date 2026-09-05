import { describe, expect, it } from 'vitest'

import { defaultClientConsultInspirationCopy } from '@/lib/brand/defaultClientConsultInspirationCopy'

import { resolveConsultInspirationPayloadV2 } from './inspiration/registry'
import type { ConsultInspirationAnswerDTO } from '@/lib/dto/consult'

import {
  buildExactClientDetails,
  buildPossibleProfessionalInterpretation,
  CONSULT_INSPIRATION_QUESTIONS,
  evaluateConsultInspirationProgress,
  normalizeStoredInspirationPayload,
  normalizeStoredInspirationPayloadV1,
  validateConsultInspirationAnswer,
} from './inspirationPack'

function answer(
  questionKey: ConsultInspirationAnswerDTO['questionKey'],
  selectedValues: string[],
  text: string | null = null,
  sentiment: ConsultInspirationAnswerDTO['sentiment'] = null,
): ConsultInspirationAnswerDTO {
  return validateConsultInspirationAnswer({
    questionKey,
    selectedValues,
    text,
    sentiment,
  })
}

describe('guided inspiration pack', () => {
  it('has exactly seven neutral hair-only questions in the fixed order', () => {
    expect(CONSULT_INSPIRATION_QUESTIONS.map(({ key }) => key)).toEqual([
      'favorite_colors',
      'avoid_colors',
      'length_goal',
      'fullness_goal',
      'current_styling',
      'styling_walkthrough',
      'other_detail',
    ])
    expect(CONSULT_INSPIRATION_QUESTIONS).toHaveLength(7)
    expect(JSON.stringify(CONSULT_INSPIRATION_QUESTIONS).toLowerCase()).not.toMatch(
      /\b(face|facial|skin|undertone|identity|ethnic|race|health|attractive)\b|\beye\s+(color|shape)\b/,
    )
    const referenceNote =
      defaultClientConsultInspirationCopy.referenceNote.toLowerCase()
    expect(referenceNote).toContain('reference')
    expect(referenceNote).toContain('not a guarantee')
  })

  it('advances one question at a time and requires three specific details', () => {
    const answers = [
      answer('favorite_colors', ['warm-golden']),
      answer('avoid_colors', ['none']),
      answer('length_goal', ['not-part-of-goal']),
      answer('fullness_goal', ['more-full']),
      answer('current_styling', ['not-sure']),
      answer('styling_walkthrough', ['no']),
      answer('other_detail', [], 'I like the soft bend near the ends.', 'GOOD'),
    ]

    for (let count = 0; count < answers.length; count += 1) {
      const progress = evaluateConsultInspirationProgress(answers.slice(0, count))
      expect(progress.currentQuestion?.key).toBe(
        CONSULT_INSPIRATION_QUESTIONS[count]?.key,
      )
      expect(progress.answeredQuestionCount).toBe(count)
      expect(progress.canComplete).toBe(false)
    }

    expect(evaluateConsultInspirationProgress(answers)).toMatchObject({
      currentQuestion: null,
      answeredQuestionCount: 7,
      specificDetailCount: 3,
      canComplete: true,
      blocker: null,
    })
  })

  it('does not count neutral choices or a walkthrough response as specifics', () => {
    const progress = evaluateConsultInspirationProgress([
      answer('favorite_colors', ['not-sure']),
      answer('avoid_colors', ['none']),
      answer('length_goal', ['not-part-of-goal']),
      answer('fullness_goal', ['not-sure']),
      answer('current_styling', ['not-sure']),
      answer('styling_walkthrough', ['yes']),
      answer('other_detail', ['nothing-else'], null, 'NONE'),
    ])
    expect(progress).toMatchObject({
      specificDetailCount: 0,
      canComplete: false,
      blocker: 'AT_LEAST_THREE_DETAILS_REQUIRED',
    })
  })

  it('keeps exact client words separate from bounded possible interpretation', () => {
    const exact = buildExactClientDetails([
      answer('favorite_colors', ['cool-smoky']),
      answer('other_detail', [], 'I like the loose wave.', 'GOOD'),
    ])
    const possible = buildPossibleProfessionalInterpretation(exact)

    expect(exact).toEqual([
      expect.objectContaining({
        value: 'cool-smoky',
        clientWords: 'The cool or smoky colors',
      }),
      expect.objectContaining({
        value: 'client-text',
        clientWords: 'I like the loose wave.',
      }),
    ])
    expect(possible).toEqual([
      expect.objectContaining({
        clientDetailValue: 'cool-smoky',
        confidence: 'POSSIBLE',
        evidence: 'CLIENT_SELECTION',
      }),
    ])
    expect(possible[0]?.possibleMeaning.toLowerCase()).toMatch(/may|possible/)
    expect(JSON.stringify(possible)).not.toContain('I like the loose wave.')
  })

  it('rejects unsupported trait inference and contradictory neutral choices', () => {
    expect(() =>
      answer('other_detail', [], 'Match this to my skin undertone.', 'GOOD'),
    ).toThrow('Invalid inspiration answer.')
    expect(() =>
      answer('favorite_colors', ['not-sure', 'warm-golden']),
    ).toThrow('Invalid inspiration answer.')
  })
})

/**
 * P5c — the ONE door every reader of a stored guided inspiration comes
 * through. It must keep answering for contract-v1 rows exactly as it did
 * before packs existed, and answer for contract-v2 rows as well.
 */
describe('normalizeStoredInspirationPayload across both contracts', () => {
  const v1Row = {
    contractId: 'hair-color-guided-inspiration',
    contractVersion: 1,
    schemaVersion: 1,
    source: 'PLATFORM_LOOK',
    inspirationId: 'insp_1',
    complete: false,
    answers: [
      {
        questionKey: 'favorite_colors',
        selectedValues: ['warm-golden'],
        text: null,
        sentiment: null,
      },
    ],
    exactClientDetails: [
      {
        questionKey: 'favorite_colors',
        value: 'warm-golden',
        clientWords: 'The warm or golden colors',
        sentiment: 'LIKE',
      },
    ],
    possibleProfessionalInterpretation: [
      {
        clientDetailValue: 'warm-golden',
        possibleMeaning:
          'May point to a preference for warmer or golden-looking hair color.',
        confidence: 'POSSIBLE',
        evidence: 'CLIENT_SELECTION',
      },
    ],
    catalogGuidance: [],
  }

  const v2Row = {
    packId: 'hair-color-inspiration',
    packVersion: 1,
    schemaVersion: 2,
    source: 'PLATFORM_LOOK',
    inspirationId: 'insp_1',
    complete: false,
    answers: { favorite_colors: ['warm-golden'] },
    catalogGuidance: [],
  }

  it('🔴 still reads a contract-v1 row, unchanged', () => {
    const review = normalizeStoredInspirationPayload(v1Row)
    expect(review).toMatchObject({
      contractVersion: 1,
      schemaVersion: 1,
      packId: null,
      packVersion: null,
      source: 'PLATFORM_LOOK',
      inspirationId: 'insp_1',
      complete: false,
    })
    expect(review?.exactClientDetails).toEqual(v1Row.exactClientDetails)
    expect(review?.possibleProfessionalInterpretation).toEqual(
      v1Row.possibleProfessionalInterpretation,
    )
    // v1's own words survive: they are IN the row.
    expect(review?.answers[0]?.text).toBeNull()
  })

  it('reads a contract-v2 row, deriving what v1 stored', () => {
    const review = normalizeStoredInspirationPayload(v2Row)
    expect(review).toMatchObject({
      contractVersion: 2,
      schemaVersion: 2,
      packId: 'hair-color-inspiration',
      packVersion: 1,
      source: 'PLATFORM_LOOK',
      complete: false,
    })
    // The SAME derived arrays the v1 row carried in the row itself.
    expect(review?.exactClientDetails).toEqual(v1Row.exactClientDetails)
    expect(review?.possibleProfessionalInterpretation).toEqual(
      v1Row.possibleProfessionalInterpretation,
    )
  })

  it('🔴 the two contracts are DISJOINT, which is what the arm order rests on', () => {
    // The migration and the dispatcher both say a stored row can satisfy only
    // one contract, so trying v1 first can never change how a v2 row reads (or
    // the reverse). Asserted rather than assumed.
    expect(normalizeStoredInspirationPayloadV1(v1Row)).not.toBeNull()
    expect(resolveConsultInspirationPayloadV2(v1Row)).toBeNull()
    expect(resolveConsultInspirationPayloadV2(v2Row)).not.toBeNull()
    expect(normalizeStoredInspirationPayloadV1(v2Row)).toBeNull()
  })

  it('refuses a row that is neither', () => {
    expect(normalizeStoredInspirationPayload({ ...v1Row, contractId: 'other' })).toBeNull()
    expect(normalizeStoredInspirationPayload({ ...v2Row, packId: 'other' })).toBeNull()
    // A row carrying BOTH contracts' marker keys satisfies neither exact shape.
    expect(normalizeStoredInspirationPayload({ ...v1Row, ...v2Row })).toBeNull()
    expect(normalizeStoredInspirationPayload(null)).toBeNull()
  })
})
