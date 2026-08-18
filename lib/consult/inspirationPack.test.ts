import { describe, expect, it } from 'vitest'

import type { ConsultInspirationAnswerDTO } from '@/lib/dto/consult'

import {
  buildExactClientDetails,
  buildPossibleProfessionalInterpretation,
  CONSULT_INSPIRATION_QUESTIONS,
  CONSULT_INSPIRATION_REFERENCE_NOTE,
  evaluateConsultInspirationProgress,
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
    expect(CONSULT_INSPIRATION_REFERENCE_NOTE.toLowerCase()).toContain('reference')
    expect(CONSULT_INSPIRATION_REFERENCE_NOTE.toLowerCase()).toContain('not a guarantee')
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
