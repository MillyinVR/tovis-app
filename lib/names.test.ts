import { describe, expect, it } from 'vitest'

import { fullName } from './names'

describe('fullName', () => {
  it('joins first and last with a single space', () => {
    expect(fullName('Jane', 'Doe')).toBe('Jane Doe')
  })

  it('drops the missing part without leaving a stray space', () => {
    expect(fullName('Jane', null)).toBe('Jane')
    expect(fullName(null, 'Doe')).toBe('Doe')
    expect(fullName('Jane', undefined)).toBe('Jane')
    expect(fullName(undefined, 'Doe')).toBe('Doe')
  })

  it('returns an empty string when both parts are missing', () => {
    expect(fullName(null, null)).toBe('')
    expect(fullName(undefined, undefined)).toBe('')
    expect(fullName('', '')).toBe('')
  })
})
