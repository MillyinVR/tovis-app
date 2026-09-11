import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/prisma', () => ({ prisma: {} }))

import { ConsultWriteError } from './errors'
import {
  CONSULT_PRO_FOLLOW_UP_MAX_TEXT_LENGTH,
  isConsultProFollowUpKey,
  mintConsultProFollowUpOptions,
  parseConsultProFollowUpAsk,
  projectConsultProFollowUp,
  readStoredConsultProFollowUpOptions,
} from './proFollowUp'

const valid = {
  priority: 'HELPFUL_FOR_PREP',
  text: '  Have you had a keratin treatment in the last year?  ',
  options: [' Yes ', 'No', 'Not sure'],
}

describe('the ask body', () => {
  it('trims and accepts a well-formed ask', () => {
    expect(parseConsultProFollowUpAsk(valid)).toEqual({
      priority: 'HELPFUL_FOR_PREP',
      text: 'Have you had a keratin treatment in the last year?',
      optionLabels: ['Yes', 'No', 'Not sure'],
    })
  })

  it.each([
    ['not an object', null],
    ['an unknown priority', { ...valid, priority: 'URGENT' }],
    ['empty text', { ...valid, text: '   ' }],
    ['text past the cap', { ...valid, text: 'x'.repeat(CONSULT_PRO_FOLLOW_UP_MAX_TEXT_LENGTH + 1) }],
    ['one option', { ...valid, options: ['Yes'] }],
    ['seven options', { ...valid, options: ['1', '2', '3', '4', '5', '6', '7'] }],
    ['a blank option', { ...valid, options: ['Yes', '   '] }],
    ['an option past the cap', { ...valid, options: ['Yes', 'n'.repeat(121)] }],
    ['duplicate options, case-insensitively', { ...valid, options: ['Yes', 'yes'] }],
    ['options that are not strings', { ...valid, options: ['Yes', 2] }],
  ])('refuses %s as INVALID_REQUEST', (_label, body) => {
    expect(() => parseConsultProFollowUpAsk(body)).toThrowError(ConsultWriteError)
    try {
      parseConsultProFollowUpAsk(body)
    } catch (error) {
      expect((error as ConsultWriteError).code).toBe('INVALID_REQUEST')
    }
  })

  it('never reads a professionalId off the body', () => {
    // Identity is the session's; a body that names a pro is simply a body
    // with an extra key, not a way to ask as someone else.
    const parsed = parseConsultProFollowUpAsk({ ...valid, professionalId: 'someone-else' })
    expect(Object.keys(parsed)).toEqual(['priority', 'text', 'optionLabels'])
  })
})

describe('option values', () => {
  it('are server-minted in the grammar the database pins', () => {
    expect(mintConsultProFollowUpOptions(['Yes', 'No'])).toEqual([
      { value: 'option-1', label: 'Yes' },
      { value: 'option-2', label: 'No' },
    ])
  })

  it('narrows a stored column and drops anything written around the guard', () => {
    expect(readStoredConsultProFollowUpOptions([{ value: 'option-1', label: 'Yes' }])).toEqual([
      { value: 'option-1', label: 'Yes' },
    ])
    expect(readStoredConsultProFollowUpOptions('nope')).toEqual([])
    expect(readStoredConsultProFollowUpOptions([{ value: 1, label: 'Yes' }])).toEqual([])
    expect(readStoredConsultProFollowUpOptions([{ value: 'option-1' }])).toEqual([])
  })
})

describe('the routing key', () => {
  it.each(['pro_1', 'pro_12', 'pro_9999'])('accepts %s', (key) => {
    expect(isConsultProFollowUpKey(key)).toBe(true)
  })
  it.each(['pro_0', 'pro_', 'pro_01', 'pro_10000', 'box_dye_history', 'PRO_1', 'pro_1 '])(
    'refuses %s',
    (key) => {
      expect(isConsultProFollowUpKey(key)).toBe(false)
    },
  )
})

describe('the pro-facing projection', () => {
  const row = {
    id: 'q1',
    consultSessionId: 's1',
    professionalId: 'p1',
    questionKey: 'pro_1',
    priority: 'NEED_BEFORE_APPOINTMENT' as const,
    clientText: 'Any allergies to hair dye?',
    options: [
      { value: 'option-1', label: 'Yes' },
      { value: 'option-2', label: 'No' },
    ],
    planVersion: 2,
    selectedValue: null,
    answeredAt: null,
    createdAt: new Date('2026-09-11T06:00:00.000Z'),
  }

  it('shows an open question with no answer', () => {
    expect(projectConsultProFollowUp(row)).toEqual({
      id: 'q1',
      questionKey: 'pro_1',
      priority: 'NEED_BEFORE_APPOINTMENT',
      text: 'Any allergies to hair dye?',
      options: row.options,
      selectedValue: null,
      selectedLabel: null,
      planVersion: 2,
      askedAt: '2026-09-11T06:00:00.000Z',
      answeredAt: null,
    })
  })

  it('resolves the tapped label once answered', () => {
    const answered = projectConsultProFollowUp({
      ...row,
      selectedValue: 'option-2',
      answeredAt: new Date('2026-09-11T07:00:00.000Z'),
    })
    expect(answered.selectedLabel).toBe('No')
    expect(answered.answeredAt).toBe('2026-09-11T07:00:00.000Z')
  })
})
