// lib/security/redaction.test.ts
import { describe, expect, it } from 'vitest'

import {
  redactAddress,
  redactEmail,
  redactNotes,
  redactPhone,
  redactSignedUrl,
  redactToken,
  redactValue,
  redactionLabels,
} from './redaction'

describe('redactEmail', () => {
  it('redacts an email while preserving the domain', () => {
    expect(redactEmail('tori@example.com')).toBe('t***@example.com')
  })

  it('trims and lowercases email values', () => {
    expect(redactEmail('  TORI@EXAMPLE.COM  ')).toBe('t***@example.com')
  })

  it('redacts longer local parts consistently', () => {
    expect(redactEmail('first.last+tag@example.com')).toBe(
      'f***@example.com',
    )
  })

  it('handles malformed values safely', () => {
    expect(redactEmail('not-an-email')).toBe(redactionLabels.email)
    expect(redactEmail('@example.com')).toBe(redactionLabels.email)
    expect(redactEmail('tori@')).toBe(redactionLabels.email)
    expect(redactEmail('tori@@example.com')).toBe(redactionLabels.email)
    expect(redactEmail('tori @example.com')).toBe(redactionLabels.email)
  })

  it('handles nullish and non-string values safely', () => {
    expect(redactEmail(null)).toBe(redactionLabels.email)
    expect(redactEmail(undefined)).toBe(redactionLabels.email)
    expect(redactEmail(123)).toBe(redactionLabels.email)
    expect(redactEmail({ email: 'tori@example.com' })).toBe(
      redactionLabels.email,
    )
  })
})

describe('redactPhone', () => {
  it('redacts a formatted phone number to the last four digits', () => {
    expect(redactPhone('(555) 123-4567')).toBe('***4567')
  })

  it('redacts E.164 phone numbers to the last four digits', () => {
    expect(redactPhone('+15551234567')).toBe('***4567')
  })

  it('redacts messy phone-like strings without requiring canonical phone validity', () => {
    expect(redactPhone('call me at 555.123.4567 ext 89')).toBe('***6789')
    expect(redactPhone('phone: +1 (555) 123-4567!!!')).toBe('***4567')
  })

  it('redacts values with unicode and punctuation while preserving only the final decimal digits', () => {
    expect(redactPhone('☎️ +1 — 555 — 123 — 4567')).toBe('***4567')
  })

  it('handles malformed values safely', () => {
    expect(redactPhone('abc')).toBe(redactionLabels.phone)
    expect(redactPhone('123')).toBe(redactionLabels.phone)
    expect(redactPhone('')).toBe(redactionLabels.phone)
    expect(redactPhone('   ')).toBe(redactionLabels.phone)
  })

  it('handles nullish and non-string values safely', () => {
    expect(redactPhone(null)).toBe(redactionLabels.phone)
    expect(redactPhone(undefined)).toBe(redactionLabels.phone)
    expect(redactPhone(5551234567)).toBe(redactionLabels.phone)
  })
})

describe('redactToken', () => {
  it('fully redacts tokens by default', () => {
    expect(redactToken('secret-token-value')).toBe(redactionLabels.token)
  })

  it('can optionally preserve a small prefix and suffix for debugging', () => {
    expect(
      redactToken('secret-token-value', {
        visiblePrefix: 2,
        visibleSuffix: 4,
      }),
    ).toBe('se***alue')
  })

  it('redacts short tokens instead of revealing them', () => {
    expect(
      redactToken('short', {
        visiblePrefix: 2,
        visibleSuffix: 4,
      }),
    ).toBe(redactionLabels.redacted)
  })

  it('handles nullish and non-string values safely', () => {
    expect(redactToken(null)).toBe(redactionLabels.token)
    expect(redactToken(undefined)).toBe(redactionLabels.token)
    expect(redactToken(123)).toBe(redactionLabels.token)
  })
})

describe('redactSignedUrl', () => {
  it('preserves origin and path while removing signed query params', () => {
    expect(
      redactSignedUrl(
        'https://example.supabase.co/storage/v1/object/sign/media-private/a.jpg?token=secret&expires=123',
      ),
    ).toBe(
      `https://example.supabase.co/storage/v1/object/sign/media-private/a.jpg?${redactionLabels.signedUrl}`,
    )
  })

  it('preserves origin and path when no query/hash exists', () => {
    expect(redactSignedUrl('https://example.com/path/to/file.jpg')).toBe(
      'https://example.com/path/to/file.jpg',
    )
  })

  it('redacts malformed URLs', () => {
    expect(redactSignedUrl('not a url')).toBe(redactionLabels.signedUrl)
  })

  it('handles nullish and non-string values safely', () => {
    expect(redactSignedUrl(null)).toBe(redactionLabels.signedUrl)
    expect(redactSignedUrl(undefined)).toBe(redactionLabels.signedUrl)
    expect(redactSignedUrl(123)).toBe(redactionLabels.signedUrl)
  })
})

describe('redactAddress', () => {
  it('always redacts address content', () => {
    expect(redactAddress('123 Main St, San Diego, CA')).toBe(
      redactionLabels.address,
    )
  })

  it('handles nullish and non-string values safely', () => {
    expect(redactAddress(null)).toBe(redactionLabels.address)
    expect(redactAddress(undefined)).toBe(redactionLabels.address)
    expect(redactAddress({ line1: '123 Main St' })).toBe(
      redactionLabels.address,
    )
  })
})

describe('redactNotes', () => {
  it('always redacts note content', () => {
    expect(redactNotes('Client has sensitive aftercare instructions.')).toBe(
      redactionLabels.notes,
    )
  })

  it('handles nullish and non-string values safely', () => {
    expect(redactNotes(null)).toBe(redactionLabels.notes)
    expect(redactNotes(undefined)).toBe(redactionLabels.notes)
    expect(redactNotes(['private note'])).toBe(redactionLabels.notes)
  })
})

describe('redactValue', () => {
  it('returns the generic redaction label', () => {
    expect(redactValue('anything')).toBe(redactionLabels.redacted)
  })

  it('handles nullish and non-string values safely', () => {
    expect(redactValue(null)).toBe(redactionLabels.redacted)
    expect(redactValue(undefined)).toBe(redactionLabels.redacted)
    expect(redactValue({ value: 'secret' })).toBe(redactionLabels.redacted)
  })
})

describe('redaction helpers safety', () => {
  it('never throws for weird inputs', () => {
    const circular: Record<string, unknown> = {}
    circular.self = circular

    const weirdValues: unknown[] = [
      null,
      undefined,
      '',
      '   ',
      0,
      123,
      Number.NaN,
      true,
      false,
      Symbol('secret'),
      BigInt(1),
      {},
      [],
      circular,
      () => 'secret',
    ]

    for (const value of weirdValues) {
      expect(() => redactEmail(value)).not.toThrow()
      expect(() => redactPhone(value)).not.toThrow()
      expect(() => redactToken(value)).not.toThrow()
      expect(() => redactSignedUrl(value)).not.toThrow()
      expect(() => redactAddress(value)).not.toThrow()
      expect(() => redactNotes(value)).not.toThrow()
      expect(() => redactValue(value)).not.toThrow()
    }
  })
})