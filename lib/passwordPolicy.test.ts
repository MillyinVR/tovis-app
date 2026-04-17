import { describe, expect, it } from 'vitest'
import breachedPasswords from './data/breached-passwords-10k.json'
import { PASSWORD_MIN_LEN, validatePassword } from './passwordPolicy'

const COMMON_PASSWORD_ERROR =
  'This password is too common. Choose something less predictable.'

describe('lib/passwordPolicy.ts', () => {
  it('rejects passwords shorter than the minimum length', () => {
    expect(PASSWORD_MIN_LEN).toBe(10)
    expect(validatePassword('123456789')).toBe(
      'Password must be at least 10 characters.',
    )
  })

  it('rejects breached/common passwords from the static dataset', () => {
    expect(validatePassword('password123')).toBe(COMMON_PASSWORD_ERROR)
    expect(validatePassword('iloveyou123')).toBe(COMMON_PASSWORD_ERROR)
    expect(validatePassword('qwerty12345')).toBe(COMMON_PASSWORD_ERROR)
  })

  it('normalizes trim + lowercase before breached-password lookup', () => {
    expect(validatePassword(' PASSWORD123 ')).toBe(COMMON_PASSWORD_ERROR)
  })

  it('allows a strong random password', () => {
    expect(validatePassword('Xk9mP2vLqRnW')).toBeNull()
  })

  it('does not require mixed character classes', () => {
    expect(validatePassword('fjordcactus')).toBeNull()
  })

  it('loads the static breached-password dataset in the test runtime', () => {
    expect(breachedPasswords.length).toBeGreaterThanOrEqual(10_000)
    expect(breachedPasswords).toContain('password123')
    expect(breachedPasswords).toContain('iloveyou123')
    expect(breachedPasswords).toContain('qwerty12345')
  })
})