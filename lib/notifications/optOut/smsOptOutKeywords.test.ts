// lib/notifications/optOut/smsOptOutKeywords.test.ts

import { describe, expect, it } from 'vitest'

import { classifySmsKeyword } from './smsOptOutKeywords'

describe('classifySmsKeyword', () => {
  it.each(['STOP', 'STOPALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT'])(
    'classifies %s as STOP',
    (keyword) => {
      expect(classifySmsKeyword(keyword)).toEqual({ kind: 'STOP', keyword })
    },
  )

  it.each(['START', 'YES', 'UNSTOP'])('classifies %s as START', (keyword) => {
    expect(classifySmsKeyword(keyword)).toEqual({ kind: 'START', keyword })
  })

  it.each(['HELP', 'INFO'])('classifies %s as HELP', (keyword) => {
    expect(classifySmsKeyword(keyword)).toEqual({ kind: 'HELP', keyword })
  })

  it('is case-insensitive and trims surrounding whitespace', () => {
    expect(classifySmsKeyword('  stop  ')).toEqual({
      kind: 'STOP',
      keyword: 'STOP',
    })
    expect(classifySmsKeyword('Help')).toEqual({
      kind: 'HELP',
      keyword: 'HELP',
    })
  })

  it('does not match a keyword embedded in a longer message', () => {
    expect(classifySmsKeyword('stop by later today')).toBeNull()
    expect(classifySmsKeyword('please help me reschedule')).toBeNull()
  })

  it('returns null for unrelated text, empty, or non-string bodies', () => {
    expect(classifySmsKeyword('Thanks so much!')).toBeNull()
    expect(classifySmsKeyword('')).toBeNull()
    expect(classifySmsKeyword('   ')).toBeNull()
    expect(classifySmsKeyword(null)).toBeNull()
    expect(classifySmsKeyword(undefined)).toBeNull()
  })
})
