import { describe, expect, it } from 'vitest'
import { PASSWORD_MIN_LEN, validatePassword } from './passwordPolicy'

describe('lib/passwordPolicy.ts', () => {
  it('rejects passwords shorter than the minimum length', () => {
    expect(PASSWORD_MIN_LEN).toBe(10)
    expect(validatePassword('123456789')).toBe(
      'Password must be at least 10 characters.',
    )
  })

  it('rejects top-common / breached passwords', () => {
    expect(validatePassword(' password123 ')).toBe(
      'Please choose a less common password.',
    )
    expect(validatePassword('1234567890')).toBe(
      'Please choose a less common password.',
    )
  })

  it('does not require mixed character classes', () => {
    expect(validatePassword('longpassword')).toBeNull()
    expect(validatePassword('beautyrules')).toBeNull()
  })
})