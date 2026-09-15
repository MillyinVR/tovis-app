// lib/dto/proConsentForms.test.ts
//
// The one thing a route test cannot prove: that `publishedAt` LEAVES this
// builder as a string. On the wire a `Date` and its ISO string are
// indistinguishable — `JSON.stringify` renders them identically — so the
// conversion has to be asserted here, on the value itself, before anything
// serializes it.
import { describe, expect, it } from 'vitest'

import {
  CONSENT_FORM_BODY_MAX,
  CONSENT_FORM_TITLE_MAX,
} from '@/lib/consentForms/formText'
import type {
  ConsentFormView,
  ProConsentFormLibrary,
} from '@/lib/consentForms/loader'

import { buildProConsentFormLibraryDTO } from './proConsentForms'

const PUBLISHED_AT = new Date('2026-04-02T09:30:00.000Z')

function view(overrides: Partial<ConsentFormView> = {}): ConsentFormView {
  return {
    id: 'form_1',
    kind: 'SERVICE_WAIVER',
    isActive: true,
    origin: 'PRO_AUTHORED',
    originLabel: 'Written by you',
    currentVersion: {
      id: 'ver_2',
      version: 2,
      title: 'Corrective colour waiver',
      body: 'I understand corrective colour may take several sessions.',
      publishedAt: PUBLISHED_AT,
      verbatimFromTemplate: false,
    },
    versionCount: 2,
    signatureCount: 3,
    ...overrides,
  }
}

function library(
  overrides: Partial<ProConsentFormLibrary> = {},
): ProConsentFormLibrary {
  return {
    forms: [view()],
    templates: [
      {
        ...view({
          id: 'tpl_1',
          kind: 'GENERAL_CONSENT',
          origin: 'PLATFORM_TEMPLATE',
          originLabel: 'Platform template',
          signatureCount: 0,
        }),
        adopted: true,
      },
    ],
    ...overrides,
  }
}

describe('buildProConsentFormLibraryDTO', () => {
  // 🔴 Delete the `.toISOString()` in the builder and this is the assertion
  // that goes red. Nothing downstream can.
  it('converts publishedAt from a Date to an ISO string', () => {
    const dto = buildProConsentFormLibraryDTO(library())
    const published = dto.forms[0]?.currentVersion?.publishedAt

    expect(published).toBe('2026-04-02T09:30:00.000Z')
    expect(published).not.toBeInstanceOf(Date)
    expect(dto.templates[0]?.currentVersion?.publishedAt).toBe(
      '2026-04-02T09:30:00.000Z',
    )
  })

  it('carries provenance and the counts the pro is shown', () => {
    const dto = buildProConsentFormLibraryDTO(library())

    expect(dto.forms[0]).toMatchObject({
      id: 'form_1',
      kind: 'SERVICE_WAIVER',
      isActive: true,
      origin: 'PRO_AUTHORED',
      originLabel: 'Written by you',
      versionCount: 2,
      signatureCount: 3,
    })
    // `adopted` is the template-only field; losing it would re-offer a template
    // the pro already holds, which the create route then 409s.
    expect(dto.templates[0]?.adopted).toBe(true)
  })

  // A form whose versions were never published is not expected, but the loader
  // types it as possible and the library must survive one rather than throwing
  // on a null dereference.
  it('passes a version-less form through as null', () => {
    const dto = buildProConsentFormLibraryDTO(
      library({ forms: [view({ currentVersion: null, versionCount: 0 })] }),
    )
    expect(dto.forms[0]?.currentVersion).toBeNull()
  })

  it('states the limits the write routes actually enforce', () => {
    expect(buildProConsentFormLibraryDTO(library()).limits).toEqual({
      titleMax: CONSENT_FORM_TITLE_MAX,
      bodyMax: CONSENT_FORM_BODY_MAX,
    })
  })

  it('keeps an empty library empty rather than inventing rows', () => {
    const dto = buildProConsentFormLibraryDTO({ forms: [], templates: [] })
    expect(dto.forms).toEqual([])
    expect(dto.templates).toEqual([])
  })
})
