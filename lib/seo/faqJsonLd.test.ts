// lib/seo/faqJsonLd.test.ts
import { describe, expect, it } from 'vitest'

import { buildFaqJsonLd } from './faqJsonLd'

describe('buildFaqJsonLd', () => {
  it('builds a schema.org FAQPage node', () => {
    expect(
      buildFaqJsonLd([
        { question: 'Q1?', answer: 'A1.' },
        { question: 'Q2?', answer: 'A2.' },
      ]),
    ).toEqual({
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: [
        {
          '@type': 'Question',
          name: 'Q1?',
          acceptedAnswer: { '@type': 'Answer', text: 'A1.' },
        },
        {
          '@type': 'Question',
          name: 'Q2?',
          acceptedAnswer: { '@type': 'Answer', text: 'A2.' },
        },
      ],
    })
  })
})
