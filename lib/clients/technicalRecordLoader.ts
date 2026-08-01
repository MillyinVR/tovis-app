// lib/clients/technicalRecordLoader.ts
//
// Server-side loader for the client technical record (PR4 — flagged, legal-gated):
// author-scoped formula history + scope-redacted consent/patch-test records + the
// client's photo-release state. Extracted from the `/pro/clients/[id]` page so the
// native read route (`GET /pro/clients/[id]/technical`) can reuse the exact same
// decrypt + access-matrix logic instead of duplicating it. Only invoke when the
// technical-record flag is on for the viewing pro.
import { Prisma } from '@prisma/client'
import type { ClientConsentKind, PhotoReleaseStatus } from '@prisma/client'

import { prisma } from '@/lib/prisma'
import { readEncryptedNoteOrFallback } from '@/lib/security/notesPrivacy'
import {
  filterFormulaEntriesForViewer,
  scopeConsentRecordsForViewer,
} from '@/lib/clients/technicalRecord'
import {
  describeConsentFormOrigin,
  resolveConsentFormOrigin,
} from '@/lib/consentForms/origin'
import {
  loadConsentFormOptions,
  type ConsentFormOption,
} from '@/lib/consentForms/loader'
import { formatPublicProfileDisplayName } from '@/lib/profiles/publicProfileFormatting'

// Technical record (PR4 — flagged). Queried only when the flag is on.
const FORMULA_SELECT = {
  id: true,
  createdAt: true,
  professionalId: true,
  brand: true,
  developer: true,
  ratio: true,
  processingTimeMinutes: true,
  resultNotesEncrypted: true,
  booking: {
    select: {
      scheduledFor: true,
      locationTimeZone: true,
      service: { select: { name: true } },
    },
  },
} satisfies Prisma.ClientFormulaEntrySelect

const CONSENT_SELECT = {
  id: true,
  createdAt: true,
  professionalId: true,
  kind: true,
  serviceScope: true,
  signedAt: true,
  proofMethod: true,
  proofRef: true,
  patchTestResult: true,
  validUntil: true,
  notesEncrypted: true,
  // K14 — the exact text this record attests to. Immutable: the pro can publish
  // a newer version of the form, and this row keeps resolving the one that was
  // actually put in front of the client.
  formVersion: {
    select: {
      id: true,
      version: true,
      title: true,
      body: true,
      verbatimFromTemplate: true,
      form: { select: { professionalId: true, sourceTemplateId: true } },
    },
  },
  professional: {
    select: { businessName: true, firstName: true, lastName: true },
  },
  booking: {
    select: {
      scheduledFor: true,
      locationTimeZone: true,
      service: { select: { name: true } },
    },
  },
} satisfies Prisma.ClientConsentRecordSelect

type FormulaRow = Prisma.ClientFormulaEntryGetPayload<{
  select: typeof FORMULA_SELECT
}>

type ConsentRow = Prisma.ClientConsentRecordGetPayload<{
  select: typeof CONSENT_SELECT
}>

export type FormulaView = {
  id: string
  when: Date | null
  whenLocationTimeZone: string | null
  serviceName: string | null
  brand: string | null
  developer: string | null
  ratio: string | null
  processingTimeMinutes: number | null
  resultNotes: string | null
}

/**
 * K14 — the form version a record attests to, resolved as it was signed. Null on
 * every pre-K14 row (free-text records, which stay readable) and on any record a
 * pro chose not to attach a form to.
 */
export type ConsentFormVersionAttestation = {
  id: string
  version: number
  title: string
  body: string
  originLabel: string
}

export type ConsentView = {
  id: string
  scope: 'full' | 'safety'
  /** The Prisma enum, not a widened string — it is the wire value verbatim. */
  kind: ClientConsentKind
  when: Date | null
  whenLocationTimeZone: string | null
  serviceScope: string | null
  signedAt: Date | null
  proofMethod: string | null
  proofRef: string | null
  patchTestResult: string | null
  validUntil: Date | null
  notes: string | null
  byName: string | null
  formVersion: ConsentFormVersionAttestation | null
}

export type TechnicalRecordData = {
  formula: FormulaView[]
  consents: ConsentView[]
  photoReleaseStatus: PhotoReleaseStatus
  /**
   * K14 — the pro's active consent forms, so the record-entry surface can pin a
   * new record to real text. Loaded HERE rather than in the page so the native
   * read route offers the same choices; a picker that exists on one platform
   * only is how a record ends up form-less on the other.
   */
  consentForms: ConsentFormOption[]
}

function toFormulaView(row: FormulaRow): FormulaView {
  return {
    id: row.id,
    when: row.booking?.scheduledFor ?? row.createdAt,
    whenLocationTimeZone: row.booking?.locationTimeZone ?? null,
    serviceName: row.booking?.service?.name ?? null,
    brand: row.brand,
    developer: row.developer,
    ratio: row.ratio,
    processingTimeMinutes: row.processingTimeMinutes,
    // Author-only entries; decrypt the free-text result for the authoring pro.
    resultNotes: readEncryptedNoteOrFallback(row.resultNotesEncrypted, null),
  }
}

function toConsentView(row: ConsentRow, scope: 'full' | 'safety'): ConsentView {
  const full = scope === 'full'
  return {
    id: row.id,
    scope,
    kind: row.kind,
    when: row.booking?.scheduledFor ?? row.createdAt,
    whenLocationTimeZone: row.booking?.locationTimeZone ?? null,
    // Safety scope (another pro's patch test): only result + validity travel.
    serviceScope: full ? row.serviceScope : null,
    signedAt: full ? row.signedAt : null,
    proofMethod: full ? row.proofMethod : null,
    proofRef: full ? row.proofRef : null,
    patchTestResult: row.patchTestResult,
    validUntil: row.validUntil,
    notes: full ? readEncryptedNoteOrFallback(row.notesEncrypted, null) : null,
    // The signed text is part of the artifact, so it travels with the proof
    // fields — author only. A patch test's SAFETY fields reaching another pro
    // never means that pro gets to read the waiver text.
    formVersion:
      full && row.formVersion
        ? {
            id: row.formVersion.id,
            version: row.formVersion.version,
            title: row.formVersion.title,
            body: row.formVersion.body,
            originLabel: describeConsentFormOrigin({
              origin: resolveConsentFormOrigin(row.formVersion.form),
              verbatim: row.formVersion.verbatimFromTemplate,
            }),
          }
        : null,
    byName: full
      ? null
      : formatPublicProfileDisplayName({
          businessName: row.professional?.businessName,
          firstName: row.professional?.firstName,
          lastName: row.professional?.lastName,
          fallback: 'Another pro',
        }),
  }
}

// Author-scoped formula history + scoped consent/patch-test records + the
// client's photo-release state. Only invoked when the flag is on.
export async function loadTechnicalRecord(
  clientId: string,
  proId: string,
): Promise<TechnicalRecordData> {
  const [formulaRows, consentRows, client, consentForms] = await Promise.all([
    prisma.clientFormulaEntry.findMany({
      where: { clientId, professionalId: proId },
      orderBy: { createdAt: 'desc' },
      take: 500,
      select: FORMULA_SELECT,
    }),
    prisma.clientConsentRecord.findMany({
      // Own records + any pro's PATCH_TEST (safety travels); scope is applied below.
      where: { clientId, OR: [{ professionalId: proId }, { kind: 'PATCH_TEST' }] },
      orderBy: { createdAt: 'desc' },
      take: 500,
      select: CONSENT_SELECT,
    }),
    prisma.clientProfile.findUnique({
      where: { id: clientId },
      select: { photoReleaseStatus: true },
    }),
    loadConsentFormOptions(proId),
  ])

  const formula = filterFormulaEntriesForViewer(formulaRows, proId).map(
    toFormulaView,
  )
  const consents = scopeConsentRecordsForViewer(consentRows, proId).map(
    ({ record, scope }) => toConsentView(record, scope),
  )

  return {
    formula,
    consents,
    photoReleaseStatus: client?.photoReleaseStatus ?? 'NOT_SET',
    consentForms,
  }
}
