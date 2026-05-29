import { describe, expect, it } from 'vitest'

import {
  isNormalizedEmail,
  isNormalizedPhone,
  normalizeContactForLookup,
  normalizeContactInput,
  normalizeEmail,
  normalizeEmailForHash,
  normalizeEmailForLookup,
  normalizePhone,
  normalizePhoneForHash,
  normalizePhoneForLookup,
  normalizePhoneForVerification,
} from './contactNormalization'

describe('contactNormalization', () => {
  describe('normalizeEmail', () => {
    it('normalizes valid email values', () => {
      expect(normalizeEmail('  TORI@Example.COM  ')).toBe('tori@example.com')
    })

    it('rejects invalid email values', () => {
      expect(normalizeEmail(null)).toBeNull()
      expect(normalizeEmail('')).toBeNull()
      expect(normalizeEmail('tori')).toBeNull()
      expect(normalizeEmail('tori@example')).toBeNull()
      expect(normalizeEmail('tori@@example.com')).toBeNull()
      expect(normalizeEmail('tori @example.com')).toBeNull()
      expect(normalizeEmail('tori@example..com')).toBeNull()
      expect(normalizeEmail('.tori@example.com')).toBeNull()
      expect(normalizeEmail('tori.@example.com')).toBeNull()
    })

    it('delegates legacy email helper names to canonical email normalization', () => {
      expect(normalizeEmailForLookup('TORI@Example.COM')).toBe('tori@example.com')
      expect(normalizeEmailForHash('TORI@Example.COM')).toBe('tori@example.com')
    })
  })

  describe('normalizePhone', () => {
    it('normalizes NANP phone values to E.164-like values', () => {
      expect(normalizePhone('(555) 123-4567')).toBe('+15551234567')
      expect(normalizePhone('1-555-123-4567')).toBe('+15551234567')
      expect(normalizePhone('+1 555 123 4567')).toBe('+15551234567')
    })

    it('normalizes international-looking phone values', () => {
      expect(normalizePhone('+44 20 7946 0958')).toBe('+442079460958')
    })

    it('rejects invalid phone values', () => {
      expect(normalizePhone(null)).toBeNull()
      expect(normalizePhone('')).toBeNull()
      expect(normalizePhone('555-FLOWERS')).toBeNull()
      expect(normalizePhone('555-123-4567 ext 9')).toBeNull()
      expect(normalizePhone('0000000000')).toBeNull()
      expect(normalizePhone('123')).toBeNull()
      expect(normalizePhone('1234567890123456')).toBeNull()
    })

    it('delegates legacy phone helper names to canonical phone normalization', () => {
      expect(normalizePhoneForLookup('(555) 123-4567')).toBe('+15551234567')
      expect(normalizePhoneForHash('(555) 123-4567')).toBe('+15551234567')
      expect(normalizePhoneForVerification('(555) 123-4567')).toBe('+15551234567')
    })
  })

  it('normalizes contact input objects', () => {
    expect(
      normalizeContactInput({
        email: ' TORI@Example.COM ',
        phone: '(555) 123-4567',
      }),
    ).toEqual({
      email: 'tori@example.com',
      phone: '+15551234567',
    })
  })

  it('normalizes by lookup kind', () => {
    expect(normalizeContactForLookup('EMAIL', 'TORI@Example.COM')).toBe('tori@example.com')
    expect(normalizeContactForLookup('PHONE', '(555) 123-4567')).toBe('+15551234567')
  })

  it('detects already-normalized contact values', () => {
    expect(isNormalizedEmail('tori@example.com')).toBe(true)
    expect(isNormalizedEmail('TORI@example.com')).toBe(false)

    expect(isNormalizedPhone('+15551234567')).toBe(true)
    expect(isNormalizedPhone('(555) 123-4567')).toBe(false)
  })
})