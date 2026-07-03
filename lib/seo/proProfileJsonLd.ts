// lib/seo/proProfileJsonLd.ts
//
// schema.org structured data for public pro profiles. Pure builder so the
// shape is unit-testable; rendered as an application/ld+json script by the
// profile pages. HealthAndBeautyBusiness is the schema.org LocalBusiness
// subtype for salons/beauty services — it is what makes profiles eligible
// for Google rich results and gives AI answer engines grounded facts.
import type { ProProfileSeo } from '@/lib/profiles/proProfileSeo'

type JsonLdRecord = Record<string, unknown>

export function buildProProfileJsonLd(args: {
  seo: ProProfileSeo
  /** Absolute canonical URL of the profile page. */
  canonicalUrl: string
  /** Tenant-resolved brand display name (never hardcoded). */
  brandDisplayName: string
}): JsonLdRecord {
  const { seo, canonicalUrl, brandDisplayName } = args
  const { header } = seo

  const jsonLd: JsonLdRecord = {
    '@context': 'https://schema.org',
    '@type': 'HealthAndBeautyBusiness',
    '@id': canonicalUrl,
    url: canonicalUrl,
    name: header.displayName,
    // The profession label doubles as the service category for engines that
    // read `knowsAbout`/`description` style hints.
    description:
      header.bio ??
      `${header.professionLabel} accepting bookings on ${brandDisplayName}.`,
  }

  if (header.avatarUrl) {
    jsonLd.image = header.avatarUrl
  }

  if (seo.city || seo.state) {
    jsonLd.address = {
      '@type': 'PostalAddress',
      ...(seo.city ? { addressLocality: seo.city } : {}),
      ...(seo.state ? { addressRegion: seo.state } : {}),
    }
  }

  // Google requires a real rating population; emit only when reviews exist.
  if (seo.reviewCount > 0 && seo.averageRating !== null) {
    jsonLd.aggregateRating = {
      '@type': 'AggregateRating',
      ratingValue: Number(seo.averageRating.toFixed(2)),
      reviewCount: seo.reviewCount,
      bestRating: 5,
      worstRating: 1,
    }
  }

  return jsonLd
}
