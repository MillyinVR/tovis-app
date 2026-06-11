// lib/phoneInputFormat.test.ts
import { describe, expect, it } from 'vitest'

import {
  compactPhoneInputForSubmit,
  formatPhoneInputValue,
  isLikelyValidPhoneInput,
} from './phoneInputFormat'

describe('formatPhoneInputValue', () => {
  it('formats NANP numbers progressively as the user types', () => {
    expect(formatPhoneInputValue('6')).toBe('(6')
    expect(formatPhoneInputValue('619')).toBe('(619')
    expect(formatPhoneInputValue('6195')).toBe('(619) 5')
    expect(formatPhoneInputValue('619555')).toBe('(619) 555')
    expect(formatPhoneInputValue('6195551')).toBe('(619) 555-1')
    expect(formatPhoneInputValue('6195551234')).toBe('(619) 555-1234')
  })

  it('reformats pasted values with separators', () => {
    expect(formatPhoneInputValue('619-555-1234')).toBe('(619) 555-1234')
    expect(formatPhoneInputValue('(619)5551234')).toBe('(619) 555-1234')
    expect(formatPhoneInputValue(' 619 555 1234 ')).toBe('(619) 555-1234')
  })

  it('keeps the +1 prefix for explicit country-code input', () => {
    expect(formatPhoneInputValue('+16195551234')).toBe('+1 (619) 555-1234')
    expect(formatPhoneInputValue('16195551234')).toBe('+1 (619) 555-1234')
    expect(formatPhoneInputValue('+1')).toBe('+1')
  })

  it('truncates NANP input past ten national digits', () => {
    expect(formatPhoneInputValue('61955512345')).toBe('(619) 555-1234')
  })

  it('leaves international numbers as plain digits', () => {
    expect(formatPhoneInputValue('+447911123456')).toBe('+447911123456')
    expect(formatPhoneInputValue('+44 7911 123456')).toBe('+447911123456')
    expect(formatPhoneInputValue('+')).toBe('+')
  })

  it('returns empty string for empty input', () => {
    expect(formatPhoneInputValue('')).toBe('')
    expect(formatPhoneInputValue('   ')).toBe('')
  })
})

describe('compactPhoneInputForSubmit', () => {
  it('collapses display formatting to digits', () => {
    expect(compactPhoneInputForSubmit('(619) 555-1234')).toBe('6195551234')
    expect(compactPhoneInputForSubmit('+1 (619) 555-1234')).toBe(
      '+16195551234',
    )
    expect(compactPhoneInputForSubmit('+447911123456')).toBe('+447911123456')
  })

  it('returns empty string when there are no digits', () => {
    expect(compactPhoneInputForSubmit('')).toBe('')
    expect(compactPhoneInputForSubmit('+')).toBe('')
    expect(compactPhoneInputForSubmit('abc')).toBe('')
  })
})

describe('isLikelyValidPhoneInput', () => {
  it('accepts complete NANP numbers in display format', () => {
    expect(isLikelyValidPhoneInput('(619) 555-1234')).toBe(true)
    expect(isLikelyValidPhoneInput('+1 (619) 555-1234')).toBe(true)
  })

  it('rejects short or empty input', () => {
    expect(isLikelyValidPhoneInput('')).toBe(false)
    expect(isLikelyValidPhoneInput('(619) 555')).toBe(false)
  })

  it('accepts plausible international numbers', () => {
    expect(isLikelyValidPhoneInput('+447911123456')).toBe(true)
    expect(isLikelyValidPhoneInput('+44791')).toBe(false)
  })
})
