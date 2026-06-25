// lib/profiles/publicProfileFormatting.test.ts
import { describe, expect, it } from 'vitest'

import {
  formatPublicProfileDisplayName,
  formatPublicReviewerName,
} from '@/lib/profiles/publicProfileFormatting'

describe('formatPublicReviewerName', () => {
  it('renders first name + last initial', () => {
    expect(formatPublicReviewerName({ firstName: 'Jane', lastName: 'Doe' })).toBe(
      'Jane D.',
    )
  })

  it('uppercases the last initial', () => {
    expect(
      formatPublicReviewerName({ firstName: 'Jane', lastName: 'doe' }),
    ).toBe('Jane D.')
  })

  it('shows only the first name when there is no last name', () => {
    expect(formatPublicReviewerName({ firstName: 'Jane', lastName: null })).toBe(
      'Jane',
    )
  })

  it('never exposes the full last name', () => {
    expect(
      formatPublicReviewerName({ firstName: 'Jane', lastName: 'Doe' }),
    ).not.toContain('Doe')
  })

  it('falls back to a generic label when no name is set (never an email)', () => {
    expect(formatPublicReviewerName({ firstName: null, lastName: null })).toBe(
      'Client',
    )
    expect(formatPublicReviewerName({ firstName: '  ', lastName: 'Smith' })).toBe(
      'Client',
    )
  })
})

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

  it('defaults to "Professional" without a fallback', () => {
    expect(formatPublicProfileDisplayName({ businessName: null })).toBe(
      'Professional',
    )
  })
})
