// tests/auth/bearerToken.test.ts
import { describe, expect, it } from 'vitest'

import { parseBearerToken } from '@/lib/auth/bearerToken'

describe('parseBearerToken', () => {
  it('extracts the token from a well-formed header', () => {
    expect(parseBearerToken('Bearer abc.def.ghi')).toBe('abc.def.ghi')
  })

  it('is case-insensitive on the scheme', () => {
    expect(parseBearerToken('bearer abc.def.ghi')).toBe('abc.def.ghi')
    expect(parseBearerToken('BEARER abc.def.ghi')).toBe('abc.def.ghi')
  })

  it('tolerates surrounding and multiple separating whitespace', () => {
    expect(parseBearerToken('  Bearer   abc.def.ghi  ')).toBe('abc.def.ghi')
    expect(parseBearerToken('Bearer\tabc.def.ghi')).toBe('abc.def.ghi')
  })

  it('returns null for missing / empty headers', () => {
    expect(parseBearerToken(null)).toBeNull()
    expect(parseBearerToken(undefined)).toBeNull()
    expect(parseBearerToken('')).toBeNull()
    expect(parseBearerToken('   ')).toBeNull()
  })

  it('returns null when the scheme is present but the token is absent', () => {
    expect(parseBearerToken('Bearer')).toBeNull()
    expect(parseBearerToken('Bearer ')).toBeNull()
  })

  it('does not match other auth schemes', () => {
    expect(parseBearerToken('Basic abc123')).toBeNull()
    expect(parseBearerToken('Bearerabc')).toBeNull()
    expect(parseBearerToken('token abc')).toBeNull()
  })
})
