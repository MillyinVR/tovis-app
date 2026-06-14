import { afterEach, describe, expect, it } from 'vitest'
import { readOptionalEnv, requireEnv } from './env'

const KEY = '__ENV_TEST_KEY__'

afterEach(() => {
  delete process.env[KEY]
})

describe('readOptionalEnv', () => {
  it('returns null when unset', () => {
    expect(readOptionalEnv(KEY)).toBeNull()
  })

  it('returns null when blank / whitespace-only', () => {
    process.env[KEY] = '   '
    expect(readOptionalEnv(KEY)).toBeNull()
  })

  it('returns the trimmed value when present', () => {
    process.env[KEY] = '  hello  '
    expect(readOptionalEnv(KEY)).toBe('hello')
  })
})

describe('requireEnv', () => {
  it('returns the trimmed value when present', () => {
    process.env[KEY] = ' secret '
    expect(requireEnv(KEY)).toBe('secret')
  })

  it('throws when unset or blank', () => {
    expect(() => requireEnv(KEY)).toThrow(/Missing required environment variable/)
    process.env[KEY] = '  '
    expect(() => requireEnv(KEY)).toThrow(/Missing required environment variable/)
  })
})
