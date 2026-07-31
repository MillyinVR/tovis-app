// lib/consentForms/formText.ts
//
// K14 — the words on a consent form version, and the two questions worth asking
// about them: is this input publishable, and is it still the platform's text?
//
// Pure: no Prisma, no request objects. The publish helper and both write routes
// share these, so a form created through the admin route and one created through
// the pro route can never disagree about what "the same text" means.

/** Titles are a heading, not a document. */
export const CONSENT_FORM_TITLE_MAX = 200

/**
 * A waiver, not a contract library. Generous enough for real salon consent text
 * (a long corrective-colour waiver runs ~4k characters) and small enough that a
 * version row stays cheap to read on every chart render.
 */
export const CONSENT_FORM_BODY_MAX = 20_000

/**
 * Canonicalise a form BODY for storage. Line endings are normalised (a textarea
 * posts `\r\n` on Windows and `\n` everywhere else, and storing that difference
 * would make the same paste read as two different documents) and surrounding
 * BLANK LINES are dropped.
 *
 * Indentation inside the text is left exactly as the author typed it, including
 * on the first line — `String.trim()` would eat it, and indentation can be
 * meaningful in a numbered clause. This is a legal artifact, not a code file.
 */
export function canonicalizeConsentBody(raw: string): string {
  const lines = raw.replace(/\r\n?/g, '\n').split('\n')
  while (lines.length > 0 && (lines[0] ?? '').trim() === '') lines.shift()
  while (lines.length > 0 && (lines[lines.length - 1] ?? '').trim() === '') {
    lines.pop()
  }
  return lines.join('\n')
}

/**
 * Canonicalise a form TITLE: one line, no runs of whitespace. A heading pasted
 * out of a document can arrive with newlines in it, and a title is rendered on a
 * single line wherever it appears.
 */
export function canonicalizeConsentTitle(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim()
}

/**
 * Compare two pieces of consent text for the "did this pro change the platform's
 * words?" question (D6). Deliberately more forgiving than byte equality: trailing
 * spaces and blank-line padding are invisible to a reader, so a paste that picked
 * some up must not be reported as an EDIT of the template. Anything a client
 * could actually read differently counts as a change.
 */
export function consentTextsMatch(a: string, b: string): boolean {
  return comparableConsentText(a) === comparableConsentText(b)
}

function comparableConsentText(raw: string): string {
  return canonicalizeConsentBody(raw)
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/, ''))
    .join('\n')
}

export type ConsentFormTextInput = { title: string; body: string }

export type ConsentFormTextParseResult =
  | { ok: true; value: ConsentFormTextInput }
  | { ok: false; error: string }

/**
 * Narrow untrusted request input into publishable text, or say why not. Refuses
 * rather than truncating: a waiver silently cut off at 20,000 characters is a
 * document the client never agreed to, which is the exact failure this model
 * exists to prevent.
 */
export function parseConsentFormText(args: {
  title: unknown
  body: unknown
}): ConsentFormTextParseResult {
  const title =
    typeof args.title === 'string' ? canonicalizeConsentTitle(args.title) : ''
  const body =
    typeof args.body === 'string' ? canonicalizeConsentBody(args.body) : ''

  if (!title) return { ok: false, error: 'A form title is required.' }
  if (title.length > CONSENT_FORM_TITLE_MAX) {
    return {
      ok: false,
      error: `Title must be ${CONSENT_FORM_TITLE_MAX} characters or fewer.`,
    }
  }
  if (!body) return { ok: false, error: 'Form text is required.' }
  if (body.length > CONSENT_FORM_BODY_MAX) {
    return {
      ok: false,
      error: `Form text must be ${CONSENT_FORM_BODY_MAX} characters or fewer.`,
    }
  }

  return { ok: true, value: { title, body } }
}
