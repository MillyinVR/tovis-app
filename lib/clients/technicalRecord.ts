// lib/clients/technicalRecord.ts
//
// Client technical record (PR4 — legal-gated). The feature flag keeps the whole
// surface dark until prod is ready (the migration is also applied separately),
// and the pure access helpers encode the design doc access matrix:
//
//   * Formula history — author-only, NEVER public.
//   * Consent / patch-test — the signed artifact stays author-scoped, but
//     patch-test SAFETY fields (result + validity) TRAVEL to any pro with access.
//
// Keep these Prisma-light so the policy is unit-testable in isolation.

import { ClientConsentKind } from '@prisma/client'

/**
 * Long-tier retention for pro-authored technical records. Decision (2026-06-21):
 * INDEFINITE — records persist for the authoring pro independent of the 30-day
 * ambient window. Structured as a single constant so a future legal call (e.g.
 * 18 months) is a one-line change plus a cleanup job.
 */
export const TECHNICAL_RECORD_RETENTION = 'INDEFINITE' as const

// ⚠️ TEMPORARY personal-dogfood allowlist. Pros listed here get the
// technical-record surface in prod even while the global flag is OFF (the
// feature is still legal-gated). These are professionalProfile ids (not PII).
//
// 🔴 REMOVE EVERY ID HERE before opening the feature to other pros / public
//    testing — see the "Personal-testing flags to revert" checklist in
//    docs/design/client-chart-record.md. Emptying this array (one line) fully
//    re-darkens the feature; no other change needed.
export const TECHNICAL_RECORD_PRO_ALLOWLIST: readonly string[] = [
  'cmq9p645v0002jp04fttoatlq', // amara619@gmail.com — founder personal testing
]

function globalTechnicalRecordFlag(): boolean {
  const raw = process.env.ENABLE_CLIENT_TECHNICAL_RECORD
  if (typeof raw !== 'string') return false
  const v = raw.trim().toLowerCase()
  return v === '1' || v === 'true' || v === 'yes'
}

/**
 * Gate for the entire technical-record surface (UI + write routes). Enabled when
 * the global flag is on (every pro) OR the acting pro is on the dogfood allowlist
 * above (just them). Pass the acting professionalId so allowlisting works.
 */
export function isClientTechnicalRecordEnabled(professionalId?: string): boolean {
  if (globalTechnicalRecordFlag()) return true
  if (!professionalId) return false
  return TECHNICAL_RECORD_PRO_ALLOWLIST.includes(professionalId)
}

/** Formula history is author-only and never public. */
export function canViewFormulaEntry(args: {
  entryProfessionalId: string
  viewerProfessionalId: string
}): boolean {
  return args.entryProfessionalId === args.viewerProfessionalId
}

export function filterFormulaEntriesForViewer<
  T extends { professionalId: string },
>(entries: T[], viewerProfessionalId: string): T[] {
  return entries.filter((entry) =>
    canViewFormulaEntry({
      entryProfessionalId: entry.professionalId,
      viewerProfessionalId,
    }),
  )
}

export type ConsentViewScope = 'full' | 'safety' | 'none'

/**
 * How much of a consent record a viewing pro may see:
 *  - 'full'   — the authoring pro: every field incl. the signed artifact/proof.
 *  - 'safety' — another pro, but only for PATCH_TEST records: the result +
 *               validity travel (liability), proof stays hidden.
 *  - 'none'   — another pro's non-patch-test record: not visible.
 */
export function consentScopeForViewer(args: {
  recordProfessionalId: string
  recordKind: ClientConsentKind
  viewerProfessionalId: string
}): ConsentViewScope {
  if (args.recordProfessionalId === args.viewerProfessionalId) return 'full'
  if (args.recordKind === ClientConsentKind.PATCH_TEST) return 'safety'
  return 'none'
}

export type ScopedConsentRecord<T> = { record: T; scope: 'full' | 'safety' }

/** Map records to the viewer's allowed scope, dropping any they can't see. */
export function scopeConsentRecordsForViewer<
  T extends { professionalId: string; kind: ClientConsentKind },
>(records: T[], viewerProfessionalId: string): ScopedConsentRecord<T>[] {
  const out: ScopedConsentRecord<T>[] = []
  for (const record of records) {
    const scope = consentScopeForViewer({
      recordProfessionalId: record.professionalId,
      recordKind: record.kind,
      viewerProfessionalId,
    })
    if (scope !== 'none') out.push({ record, scope })
  }
  return out
}

/** A patch test is "current" when it has a validity date still in the future. */
export function isPatchTestCurrent(
  validUntil: Date | null | undefined,
  now: Date,
): boolean {
  return validUntil instanceof Date && validUntil.getTime() > now.getTime()
}
