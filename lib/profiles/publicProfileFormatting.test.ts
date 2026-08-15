// lib/profiles/publicProfileFormatting.test.ts
import { describe, expect, it } from 'vitest'

import {
  buildPublicProfileBookBar,
  buildPublicProfileTabLabels,
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

describe('buildPublicProfileBookBar', () => {
  it('composes the CTA as "Book · From $X" — never a bare figure', () => {
    const bar = buildPublicProfileBookBar({
      isPendingVerification: false,
      isSignedIn: true,
      availabilityLine: 'Available tomorrow',
      priceFromLabel: '$85',
      cheapestServiceName: 'Cut & style',
      serviceCount: 5,
    })

    // 🔴 `priceFromLabel` is a bare "$85" on purpose — the word "From" is added
    // HERE and in formatPricingLine, never in formatMoneyLabel, which would
    // make this read "From From $85".
    expect(bar.ctaLabel).toBe('Book · From $85')
    expect(bar.headline).toBe('Available tomorrow')
    expect(bar.subline).toBe('Cut & style from $85 · 5 services')
    expect(bar.inert).toBe(false)
    expect(bar.footnote).toBeNull()
  })

  it('goes inert and explains itself for a pending pro', () => {
    const bar = buildPublicProfileBookBar({
      isPendingVerification: true,
      isSignedIn: true,
      availabilityLine: 'Available today',
      priceFromLabel: '$85',
      cheapestServiceName: 'Cut & style',
      serviceCount: 5,
    })

    expect(bar.inert).toBe(true)
    expect(bar.ctaLabel).toBe('Unavailable')
    expect(bar.headline).toBe('Not bookable yet')
    // A pending pro never advertises availability, even when the stat exists.
    expect(bar.subline).toBe('Profile is live, booking opens after review')
    expect(bar.footnote).toBe('Verification usually takes 2 business days')
  })

  it('keeps the time-slot promise for a signed-out viewer', () => {
    const bar = buildPublicProfileBookBar({
      isPendingVerification: false,
      isSignedIn: false,
      availabilityLine: null,
      priceFromLabel: '$85',
      cheapestServiceName: 'Cut & style',
      serviceCount: 1,
    })

    expect(bar.footnote).toBe('You can pick a time before signing in')
    expect(bar.subline).toBe('Cut & style from $85 · 1 service')
  })

  it('invents no urgency when there is no fresh opening', () => {
    const bar = buildPublicProfileBookBar({
      isPendingVerification: false,
      isSignedIn: true,
      availabilityLine: null,
      priceFromLabel: null,
      cheapestServiceName: null,
      serviceCount: 0,
    })

    expect(bar.headline).toBe('Book with this pro')
    expect(bar.subline).toBe('See services and availability')
    expect(bar.ctaLabel).toBe('Book')
  })
})

describe('buildPublicProfileTabLabels', () => {
  it('appends a count only when there is one to show', () => {
    expect(
      buildPublicProfileTabLabels({ portfolio: 200, services: 5, reviews: 0 }),
    ).toEqual({
      portfolio: 'Portfolio · 200',
      services: 'Services · 5',
      // "Reviews · 0" would label the emptiness twice.
      reviews: 'Reviews',
    })
  })
})
