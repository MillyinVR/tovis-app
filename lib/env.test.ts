import { afterEach, describe, expect, it } from 'vitest'
import {
  envKillSwitchArmed,
  readOptionalEnv,
  readPositiveIntEnv,
  requireEnv,
} from './env'

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

describe('envKillSwitchArmed', () => {
  it('stays armed when unset or blank — the deployed default is ON', () => {
    expect(envKillSwitchArmed(KEY)).toBe(true)
    process.env[KEY] = '   '
    expect(envKillSwitchArmed(KEY)).toBe(true)
  })

  it('stays armed only for an explicit affirmative', () => {
    for (const value of ['1', 'true', 'TRUE', 'yes', ' Yes ']) {
      process.env[KEY] = value
      expect(envKillSwitchArmed(KEY), value).toBe(true)
    }
  })

  it('disarms on the ordinary negatives, in any case', () => {
    for (const value of ['false', 'FALSE', '0', 'no', 'off', ' Off ']) {
      process.env[KEY] = value
      expect(envKillSwitchArmed(KEY), value).toBe(false)
    }
  })

  // The reason this helper exists. Every value below left the old local parser
  // fully ARMED, because it only recognised a four-item deny-list — so an
  // operator reaching for the kill switch mid-incident kept the sweep
  // cancelling bookings and moving money.
  it('disarms on anything an operator might reach for, including a typo', () => {
    for (const value of [
      'disabled',
      'disable',
      'n',
      'nope',
      'stop',
      'killed',
      'f',
      'flase',
      'on', // narrow affirmative list, deliberately: unrecognised means STOP
    ]) {
      process.env[KEY] = value
      expect(envKillSwitchArmed(KEY), value).toBe(false)
    }
  })
})

describe('readPositiveIntEnv', () => {
  it('returns the fallback when unset or blank', () => {
    expect(readPositiveIntEnv(KEY, 6)).toBe(6)
    process.env[KEY] = '  '
    expect(readPositiveIntEnv(KEY, 6)).toBe(6)
  })

  it('reads a positive whole number', () => {
    process.env[KEY] = '12'
    expect(readPositiveIntEnv(KEY, 6)).toBe(12)
    process.env[KEY] = ' 3 '
    expect(readPositiveIntEnv(KEY, 6)).toBe(3)
  })

  // The bug this replaced: Number('0.5') is finite and > 0, so it passed the
  // guard and Math.trunc turned it into 0 — a zero-hour window that disarmed
  // the min-answer guard entirely. A fractional value now falls back instead.
  it('falls back on a fractional value rather than truncating it to zero', () => {
    for (const value of ['0.5', '0.9', '0.001', '1.5']) {
      process.env[KEY] = value
      expect(readPositiveIntEnv(KEY, 2), value).toBe(2)
    }
  })

  it('falls back on zero, negatives and non-numbers', () => {
    for (const value of ['0', '-1', '-0.5', 'abc', 'Infinity', 'NaN', '']) {
      process.env[KEY] = value
      expect(readPositiveIntEnv(KEY, 2), value).toBe(2)
    }
  })

  it('accepts an integer written with a trailing zero', () => {
    process.env[KEY] = '6.0'
    expect(readPositiveIntEnv(KEY, 2)).toBe(6)
  })
})
