import { describe, expect, it } from 'vitest'

import {
  consultLookHistoryStoredItems,
  parseConsultLookHistoryItems,
} from './lookHistory'

// 🔴 `ConsultLookBriefVersion.additionalClientAnswers` is a FROZEN shape.
//
// `parseConsultLookHistoryItems` refuses any key it does not know, and it is on
// the professional's plan read. A fifth key stored by deployment N+1 therefore
// 500s that read on a ROLLED-BACK deployment N, for exactly the consults where
// a client had typed something — the worst possible population to break.
//
// These two tests are the pair that keeps that true: one proves what is
// STORED, the other proves what the reader would do if it ever stopped being
// true. Adding a field to `ConsultAnalysisIntakeItem` is fine; letting it reach
// this column is not.
describe('consult look history stored shape', () => {
  const item = {
    questionKey: 'box_dye_history',
    question: 'Client follow-up: When did you last use box dye?',
    answerCode: 'never',
    answer: 'Never',
    clientWords: 'at a salon abroad, I do not know what they used',
  }

  it('stores exactly the four keys the reader knows, dropping her note', () => {
    const [stored] = consultLookHistoryStoredItems([item])
    expect(stored && Object.keys(stored).sort()).toEqual([
      'answer',
      'answerCode',
      'question',
      'questionKey',
    ])
    // Round-trips through the reader that runs on the professional's plan.
    expect(parseConsultLookHistoryItems(consultLookHistoryStoredItems([item]))).toEqual([
      {
        questionKey: item.questionKey,
        question: item.question,
        answerCode: item.answerCode,
        answer: item.answer,
      },
    ])
  })

  it('refuses a row carrying her note, which is what a rolled-back build does', () => {
    expect(() => parseConsultLookHistoryItems([item])).toThrow(
      /Saved client history is unavailable/,
    )
  })

  it('keeps her sentence on the escape hatch, where it IS the answer', () => {
    const [stored] = consultLookHistoryStoredItems([
      {
        questionKey: 'prior_reaction',
        question: 'Client follow-up: Have you ever had a reaction?',
        answerCode: 'client-words',
        answer: 'a reaction once, I am not sure to what',
        clientWords: 'a reaction once, I am not sure to what',
      },
    ])
    expect(stored?.answer).toBe('a reaction once, I am not sure to what')
  })
})
