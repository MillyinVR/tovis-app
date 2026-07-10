// lib/clients/technicalRecordLoader.ts
//
// Server-side loader for the client technical record (PR4 — flagged, legal-gated):
// author-scoped formula history + scope-redacted consent/patch-test records + the
// client's photo-release state. Extracted from the `/pro/clients/[id]` page so the
// native read route (`GET /pro/clients/[id]/technical`) can reuse the exact same
// decrypt + access-matrix logic instead of duplicating it. Only invoke when the
// technical-record flag is on for the viewing pro.
import { Prisma } from '@prisma/client'
import type { PhotoReleaseStatus } from '@prisma/client'

import { prisma } from '@/lib/prisma'
import { readEncryptedNoteOrFallback } from '@/lib/security/notesPrivacy'
import {
  filterFormulaEntriesForViewer,
  scopeConsentRecordsForViewer,
} from '@/lib/clients/technicalRecord'
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

export type ConsentView = {
  id: string
  scope: 'full' | 'safety'
  kind: string
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
}

export type TechnicalRecordData = {
  formula: FormulaView[]
  consents: ConsentView[]
  photoReleaseStatus: PhotoReleaseStatus
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
  const [formulaRows, consentRows, client] = await Promise.all([
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
  }
}
