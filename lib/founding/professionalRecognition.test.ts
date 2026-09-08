import { describe, expect, it } from 'vitest'

import { formatFoundingMemberNumber } from './professionalRecognition'

describe('formatFoundingMemberNumber', () => {
  it.each([
    [1, '001'],
    [9, '009'],
    [10, '010'],
    [99, '099'],
    [100, '100'],
  ])('formats founding member %i as %s', (value, expected) => {
    expect(formatFoundingMemberNumber(value)).toBe(expected)
  })
})
