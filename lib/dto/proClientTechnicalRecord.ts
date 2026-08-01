// The client technical-record wire contract —
// GET /api/v1/pro/clients/{id}/technical.
//
// This route has been on the wire since PR4 and, until now, had NO declared
// shape at all: the handler built an inline object literal, nothing was
// `satisfies`-checked, and `schema/api/tovis-api.schema.json` carried no
// definition for it. So K14 could add `formVersion` and `consentForms` to the
// response (#809) and the generated schema never learned either field existed —
// the same silence the calendar's `consentRequirement` sat in until K17-web,
// arrived at by a different route (a conditional spread there, a missing DTO
// here). A native client had to hand-write these shapes with nothing to check
// them against, which is exactly how K17-A found the record sheet still offering
// a proof method the server refuses.
//
// 🔴 The two K14 types below are ALIASES of the loader's, not copies. Both are
// already JSON-safe (every field is a string or a number — no Date, no Decimal),
// so the loader type IS the wire type, and aliasing means a field added to the
// loader cannot go undeclared here. Re-declaring them would look safer and be
// weaker: a nested value read from a variable gets no excess-property check, so
// a drifted copy would keep compiling ([[a-spread-hides-a-field-from-the-dto]]).
//
// The entries that DO get their own declaration are the ones the route
// transforms — `Date | null` becomes an ISO string, and `whenLocationTimeZone`
// is renamed to `timeZone` on the way out.

import type { ClientConsentKind, PhotoReleaseStatus } from '@prisma/client'

import type { ConsentFormOption } from '@/lib/consentForms/loader'
import type { ConsentFormVersionAttestation } from '@/lib/clients/technicalRecordLoader'

/**
 * K14 — the exact form text a consent record attests to, resolved as it was
 * signed. Author scope only: it travels with the proof fields, so a patch test's
 * safety fields reaching another pro never carries the waiver text with them.
 */
export type ProConsentFormVersionDTO = ConsentFormVersionAttestation

/**
 * K14 — one of the pro's ACTIVE consent forms, resolved to the version that
 * would be signed today. This list is what lets a native record-entry surface
 * offer the same choices web does; a picker that exists on one platform only is
 * how a record ends up form-less on the other.
 */
export type ProConsentFormOptionDTO = ConsentFormOption

/** A formula entry, author-scoped — free text is decrypted for its author only. */
export type ProClientFormulaEntryDTO = {
  id: string
  /** ISO instant of the booking this was recorded against, else its createdAt. */
  when: string | null
  /** IANA zone of that booking's location — render `when` in it, never the device's. */
  timeZone: string | null
  serviceName: string | null
  brand: string | null
  developer: string | null
  ratio: string | null
  processingTimeMinutes: number | null
  resultNotes: string | null
}

/**
 * A consent / patch-test record, ALREADY REDACTED by scope.
 *
 * `scope` is the redaction that produced this row, not a display hint: `'full'`
 * means the reading pro authored it and gets the proof fields, the notes and the
 * form text; `'safety'` means it is another pro's patch test, reaching this pro
 * only so they don't skin-test over someone else's result — result and validity
 * travel, everything else is already null and `byName` names the other pro.
 */
export type ProClientConsentRecordDTO = {
  id: string
  scope: 'full' | 'safety'
  kind: ClientConsentKind
  when: string | null
  timeZone: string | null
  /** Full scope only. */
  serviceScope: string | null
  /** Full scope only. */
  signedAt: string | null
  /** Full scope only — `IN_PERSON` | `CLIENT_TOKEN` | `PAPER_ON_FILE`. */
  proofMethod: string | null
  /** Full scope only. */
  proofRef: string | null
  patchTestResult: string | null
  validUntil: string | null
  /** Full scope only. */
  notes: string | null
  /** Safety scope only — the pro whose record this is. */
  byName: string | null
  /**
   * K14 — null on every pre-K14 record, on any record whose pro attached no
   * form, and on every safety-scoped row.
   */
  formVersion: ProConsentFormVersionDTO | null
}

export type ProClientTechnicalRecordResponseDTO = {
  formula: ProClientFormulaEntryDTO[]
  consents: ProClientConsentRecordDTO[]
  photoReleaseStatus: PhotoReleaseStatus
  consentForms: ProConsentFormOptionDTO[]
}
