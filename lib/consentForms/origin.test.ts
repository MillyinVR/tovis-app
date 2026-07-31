import { describe, expect, it } from 'vitest'

import { describeConsentFormOrigin, resolveConsentFormOrigin } from './origin'

describe('resolveConsentFormOrigin', () => {
  it('a null owner is the platform’s template', () => {
    expect(
      resolveConsentFormOrigin({ professionalId: null, sourceTemplateId: null }),
    ).toBe('PLATFORM_TEMPLATE')
  })

  it('a pro’s form with a source is adopted; without one it is their own', () => {
    expect(
      resolveConsentFormOrigin({ professionalId: 'p1', sourceTemplateId: 't1' }),
    ).toBe('ADOPTED_TEMPLATE')
    expect(
      resolveConsentFormOrigin({ professionalId: 'p1', sourceTemplateId: null }),
    ).toBe('PRO_AUTHORED')
  })
})

describe('describeConsentFormOrigin', () => {
  it('an adopted template says whether the words were changed (D6)', () => {
    expect(
      describeConsentFormOrigin({ origin: 'ADOPTED_TEMPLATE', verbatim: true }),
    ).toBe('Platform template, unchanged')
    expect(
      describeConsentFormOrigin({ origin: 'ADOPTED_TEMPLATE', verbatim: false }),
    ).toBe('Platform template, edited')
  })

  it('an edited adoption never reads the same as an untouched one', () => {
    // The whole point of the provenance columns: "based on a platform template"
    // must not let edited text borrow the platform's authority.
    expect(
      describeConsentFormOrigin({ origin: 'ADOPTED_TEMPLATE', verbatim: true }),
    ).not.toBe(
      describeConsentFormOrigin({ origin: 'ADOPTED_TEMPLATE', verbatim: false }),
    )
  })

  it('a pro-authored form never claims template provenance', () => {
    for (const verbatim of [true, false]) {
      expect(
        describeConsentFormOrigin({ origin: 'PRO_AUTHORED', verbatim }),
      ).toBe('Written by you')
    }
  })

  it('the platform’s own template is named as such', () => {
    expect(
      describeConsentFormOrigin({ origin: 'PLATFORM_TEMPLATE', verbatim: false }),
    ).toBe('Platform template')
  })
})
