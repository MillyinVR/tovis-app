// lib/profiles/publicProfileFormatting.test.ts
import { describe, expect, it } from 'vitest'

import { formatPublicProfileDisplayName } from '@/lib/profiles/publicProfileFormatting'

describe('formatPublicProfileDisplayName', () => {
  it('prefers the business name when present', () => {
    expect(
      formatPublicProfileDisplayName({
        businessName: 'Glow Studio',
        firstName: 'Amara',
        lastName: 'Okafor',
      }),
    ).toBe('Glow Studio')
  })

  it('trims the business name', () => {
    expect(
      formatPublicProfileDisplayName({ businessName: '  Glow Studio  ' }),
    ).toBe('Glow Studio')
  })

  it('falls back to "First Last" when the business name is missing', () => {
    expect(
      formatPublicProfileDisplayName({
        businessName: null,
        firstName: 'Amara',
        lastName: 'Okafor',
      }),
    ).toBe('Amara Okafor')
  })

  it('treats a whitespace-only business name as missing', () => {
    expect(
      formatPublicProfileDisplayName({
        businessName: '   ',
        firstName: 'Amara',
        lastName: 'Okafor',
      }),
    ).toBe('Amara Okafor')
  })

  it('uses a lone first name', () => {
    expect(
      formatPublicProfileDisplayName({
        businessName: null,
        firstName: 'Amara',
        lastName: '',
      }),
    ).toBe('Amara')
  })

  it('uses a lone last name', () => {
    expect(
      formatPublicProfileDisplayName({
        businessName: undefined,
        firstName: null,
        lastName: ' Okafor ',
      }),
    ).toBe('Okafor')
  })

  it('uses the provided fallback when no name parts exist', () => {
    expect(
      formatPublicProfileDisplayName({
        businessName: null,
        firstName: '  ',
        lastName: '',
        fallback: 'Professional',
      }),
    ).toBe('Professional')
  })

  it('defaults to "Beauty professional" without a fallback', () => {
    expect(formatPublicProfileDisplayName({ businessName: null })).toBe(
      'Beauty professional',
    )
  })
})
