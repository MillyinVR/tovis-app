import { describe, expect, it } from 'vitest'

import {
  CONSENT_FORM_BODY_MAX,
  CONSENT_FORM_TITLE_MAX,
  canonicalizeConsentBody,
  canonicalizeConsentTitle,
  consentTextsMatch,
  parseConsentFormText,
} from './formText'

describe('canonicalizeConsentBody', () => {
  it('normalises line endings so the same paste is the same document', () => {
    expect(canonicalizeConsentBody('a\r\nb\rc')).toBe('a\nb\nc')
  })

  it('drops surrounding blank lines but never the author’s indentation', () => {
    // 🔴 String.trim() would eat the FIRST line's indentation too, which is why
    // this is not a one-liner: a numbered clause loses its shape.
    expect(canonicalizeConsentBody('\n\n  1. Clause\n    a) sub\n\n')).toBe(
      '  1. Clause\n    a) sub',
    )
  })

  it('keeps blank lines INSIDE the text — they are paragraph breaks', () => {
    expect(canonicalizeConsentBody('Clause one.\n\nClause two.')).toBe(
      'Clause one.\n\nClause two.',
    )
  })
})

describe('canonicalizeConsentTitle', () => {
  it('flattens a heading to one line', () => {
    expect(canonicalizeConsentTitle('  Corrective\n  colour  waiver ')).toBe(
      'Corrective colour waiver',
    )
  })
})

describe('consentTextsMatch — did the pro change the platform’s words? (D6)', () => {
  it('ignores what a reader cannot see', () => {
    expect(consentTextsMatch('Terms.  \nMore.', 'Terms.\nMore.')).toBe(true)
    expect(consentTextsMatch('Terms.\r\nMore.', 'Terms.\nMore.')).toBe(true)
    expect(consentTextsMatch('Terms.\n\n', 'Terms.')).toBe(true)
  })

  it('counts anything a client could read differently as a change', () => {
    expect(consentTextsMatch('Up to 3 sessions.', 'Up to 5 sessions.')).toBe(
      false,
    )
    // Leading indentation IS visible, so it is a change.
    expect(consentTextsMatch('a\n  b', 'a\nb')).toBe(false)
    // Deleting a whole clause changes the line count, not just whitespace.
    expect(consentTextsMatch('a\n\nb', 'a\nb')).toBe(false)
  })
})

describe('parseConsentFormText', () => {
  it('accepts real text and returns it canonicalised', () => {
    const result = parseConsentFormText({
      title: '  Corrective colour waiver ',
      body: 'I understand.\r\n',
    })
    expect(result).toEqual({
      ok: true,
      value: { title: 'Corrective colour waiver', body: 'I understand.' },
    })
  })

  it('refuses an empty or whitespace-only title or body', () => {
    expect(parseConsentFormText({ title: '   ', body: 'x' }).ok).toBe(false)
    expect(parseConsentFormText({ title: 'x', body: '\n\n' }).ok).toBe(false)
  })

  it('refuses a non-string as missing rather than coercing it', () => {
    expect(parseConsentFormText({ title: 42, body: 'x' }).ok).toBe(false)
    expect(parseConsentFormText({ title: 'x', body: null }).ok).toBe(false)
  })

  it('REFUSES over-long text instead of truncating it', () => {
    // A waiver silently cut off is a document the client never agreed to.
    const long = 'x'.repeat(CONSENT_FORM_BODY_MAX + 1)
    const result = parseConsentFormText({ title: 'ok', body: long })
    expect(result.ok).toBe(false)

    const longTitle = 'y'.repeat(CONSENT_FORM_TITLE_MAX + 1)
    expect(parseConsentFormText({ title: longTitle, body: 'ok' }).ok).toBe(false)
  })

  it('accepts text exactly at the limit', () => {
    const result = parseConsentFormText({
      title: 'y'.repeat(CONSENT_FORM_TITLE_MAX),
      body: 'x'.repeat(CONSENT_FORM_BODY_MAX),
    })
    expect(result.ok).toBe(true)
  })
})
