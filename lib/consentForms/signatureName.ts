// lib/consentForms/signatureName.ts
//
// K15 — the client's typed name, which IS the signature on a click-wrap consent
// form. Pure, so the page's enable/disable rule and the route's refusal are the
// same rule rather than two that drift.
//
// Stored in `ClientConsentRecord.proofRef`, whose schema comment already scopes
// it: author-scoped, never surfaced to another pro. No new exposure — this pro
// already knows their own client's name.

/** Long enough for a real legal name; short enough that proofRef stays a name. */
export const CONSENT_SIGNATURE_NAME_MAX = 120

/**
 * A typed signature must look like a person deliberately typing their name, not
 * an accidental keypress. Two characters is the floor (initials exist); runs of
 * whitespace collapse so " a  b " and "a b" are one signature.
 */
export const CONSENT_SIGNATURE_NAME_MIN = 2

/**
 * Narrow untrusted input to a signature, or null. Refuses rather than
 * truncating: a name silently cut in half is a signature the client did not
 * give.
 */
export function parseConsentSignatureName(value: unknown): string | null {
  if (typeof value !== 'string') return null

  const normalized = value.replace(/\s+/g, ' ').trim()

  if (normalized.length < CONSENT_SIGNATURE_NAME_MIN) return null
  if (normalized.length > CONSENT_SIGNATURE_NAME_MAX) return null

  return normalized
}
