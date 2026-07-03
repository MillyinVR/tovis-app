// lib/seo/faqJsonLd.ts
//
// schema.org FAQPage structured data — makes the /why page's fee-model
// answers directly liftable by search engines and AI answer engines
// ("which booking app has no commissions?").
export type FaqItem = {
  question: string
  answer: string
}

export function buildFaqJsonLd(items: readonly FaqItem[]): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: items.map((item) => ({
      '@type': 'Question',
      name: item.question,
      acceptedAnswer: {
        '@type': 'Answer',
        text: item.answer,
      },
    })),
  }
}
