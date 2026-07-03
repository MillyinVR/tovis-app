// lib/seo/proProfileJsonLd.test.ts
import { describe, expect, it } from 'vitest'
import { VerificationStatus } from '@prisma/client'

import type { ProProfileSeo } from '@/lib/profiles/proProfileSeo'

import { buildProProfileJsonLd } from './proProfileJsonLd'

function makeSeo(overrides?: Partial<ProProfileSeo>): ProProfileSeo {
  return {
    header: {
      id: 'pro_1',
      userId: 'user_1',
      verificationStatus: VerificationStatus.APPROVED,
      handle: 'tori',
      displayHandle: '@tori',
      isPremium: true,
      isLicenseVerified: true,
      displayName: 'Tori Beauty Studio',
      businessName: 'Tori Beauty Studio',
      bio: 'Balayage specialist.',
      avatarUrl: 'https://cdn.test/avatar.jpg',
      professionType: null,
      professionLabel: 'Hairstylist',
      location: 'Los Angeles, CA',
      timeZone: null,
    },
    reviewCount: 12,
    averageRating: 4.9167,
    city: 'Los Angeles',
    state: 'CA',
    ...overrides,
  }
}

const CANONICAL = 'https://example.test/professionals/pro_1'

describe('buildProProfileJsonLd', () => {
  it('builds a full HealthAndBeautyBusiness node', () => {
    const jsonLd = buildProProfileJsonLd({
      seo: makeSeo(),
      canonicalUrl: CANONICAL,
      brandDisplayName: 'TOVIS',
    })

    expect(jsonLd).toMatchObject({
      '@context': 'https://schema.org',
      '@type': 'HealthAndBeautyBusiness',
      '@id': CANONICAL,
      url: CANONICAL,
      name: 'Tori Beauty Studio',
      description: 'Balayage specialist.',
      image: 'https://cdn.test/avatar.jpg',
      address: {
        '@type': 'PostalAddress',
        addressLocality: 'Los Angeles',
        addressRegion: 'CA',
      },
      aggregateRating: {
        '@type': 'AggregateRating',
        ratingValue: 4.92,
        reviewCount: 12,
        bestRating: 5,
        worstRating: 1,
      },
    })
  })

  it('omits rating, image, and address when data is missing', () => {
    const seo = makeSeo({
      reviewCount: 0,
      averageRating: null,
      city: null,
      state: null,
    })
    seo.header = { ...seo.header, avatarUrl: null, bio: null }

    const jsonLd = buildProProfileJsonLd({
      seo,
      canonicalUrl: CANONICAL,
      brandDisplayName: 'TOVIS',
    })

    expect(jsonLd.aggregateRating).toBeUndefined()
    expect(jsonLd.image).toBeUndefined()
    expect(jsonLd.address).toBeUndefined()
    // Branded fallback description, composed from the tenant brand name.
    expect(jsonLd.description).toBe(
      'Hairstylist accepting bookings on TOVIS.',
    )
  })

  it('emits a state-only address when city is missing', () => {
    const jsonLd = buildProProfileJsonLd({
      seo: makeSeo({ city: null }),
      canonicalUrl: CANONICAL,
      brandDisplayName: 'TOVIS',
    })

    expect(jsonLd.address).toEqual({
      '@type': 'PostalAddress',
      addressRegion: 'CA',
    })
  })
})
