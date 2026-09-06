// lib/seo/homeJsonLd.ts
//
// schema.org SoftwareApplication structured data for the homepage — the
// machine-readable half of the "checkable marketing" rule. `featureList` is
// built ONLY from features whose state is 'live': a rolling-out row can appear
// on the page with its label, but it never reaches a search engine or answer
// engine as a bare capability claim. The test pins this.
import type { BrandHomeCopy, BrandHomeFeature } from '@/lib/brand/types'

export function liveHomeFeatures(copy: BrandHomeCopy): BrandHomeFeature[] {
  return [
    ...copy.loop.steps,
    ...copy.clients.features,
    // Spotlight rows are ordinary feature rows that have been promoted, so
    // they answer to this filter like any other. Both are rolling out today,
    // which is exactly why they must be listed here rather than skipped: the
    // day one is promoted to live, it reaches the featureList automatically
    // instead of waiting for someone to remember this file.
    ...copy.spotlight.features,
    ...copy.pros.features,
    copy.money,
  ].filter((feature) => feature.state === 'live')
}

export function buildHomeJsonLd(args: {
  brandDisplayName: string
  url: string
  copy: BrandHomeCopy
}): Record<string, unknown> {
  const { brandDisplayName, url, copy } = args

  return {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: brandDisplayName,
    url,
    applicationCategory: 'BusinessApplication',
    operatingSystem: 'Web',
    description: copy.hero.intro,
    // The free tier is live: taking bookings needs no subscription
    // (lib/membership/plans.ts, `free`).
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
    featureList: liveHomeFeatures(copy).map((feature) => feature.title),
  }
}
