// lib/consentForms/loader.ts
//
// K14 — server-side reads for the pro's consent form library and the platform
// templates they can adopt. Extracted from the page (the pro-facing read
// pattern) so the K17 native route can reuse the exact same shaping instead of
// growing a second, drifting copy — the drift K6 and K13-web each had to fix.

import { Prisma, type ClientConsentKind, type PrismaClient } from '@prisma/client'

import { prisma } from '@/lib/prisma'

import {
  describeConsentFormOrigin,
  resolveConsentFormOrigin,
  type ConsentFormOrigin,
} from './origin'

type Db = PrismaClient | Prisma.TransactionClient

const FORM_SELECT = {
  id: true,
  kind: true,
  isActive: true,
  professionalId: true,
  sourceTemplateId: true,
  createdAt: true,
  // The current text is simply the highest-numbered version — there is no
  // "current" pointer to fall out of sync with the versions themselves.
  versions: {
    orderBy: { version: 'desc' },
    take: 1,
    select: {
      id: true,
      version: true,
      title: true,
      body: true,
      publishedAt: true,
      verbatimFromTemplate: true,
      sourceTemplateVersionId: true,
    },
  },
  _count: { select: { versions: true } },
} satisfies Prisma.ConsentFormSelect

type FormRow = Prisma.ConsentFormGetPayload<{ select: typeof FORM_SELECT }>

export type ConsentFormVersionView = {
  id: string
  version: number
  title: string
  body: string
  publishedAt: Date
  verbatimFromTemplate: boolean
}

export type ConsentFormView = {
  id: string
  kind: ClientConsentKind
  isActive: boolean
  origin: ConsentFormOrigin
  originLabel: string
  /** Null only for a form whose versions were never published — never expected. */
  currentVersion: ConsentFormVersionView | null
  versionCount: number
  /** Consent records pointing at ANY version of this form. */
  signatureCount: number
}

export type ProConsentFormLibrary = {
  forms: ConsentFormView[]
  /** Active platform templates, with whether this pro already adopted each. */
  templates: (ConsentFormView & { adopted: boolean })[]
}

function toView(row: FormRow, signatureCount: number): ConsentFormView {
  const origin = resolveConsentFormOrigin(row)
  const current = row.versions[0] ?? null

  return {
    id: row.id,
    kind: row.kind,
    isActive: row.isActive,
    origin,
    originLabel: describeConsentFormOrigin({
      origin,
      verbatim: current?.verbatimFromTemplate ?? false,
    }),
    currentVersion: current
      ? {
          id: current.id,
          version: current.version,
          title: current.title,
          body: current.body,
          publishedAt: current.publishedAt,
          verbatimFromTemplate: current.verbatimFromTemplate,
        }
      : null,
    versionCount: row._count.versions,
    signatureCount,
  }
}

/**
 * How many consent records point at each of these forms. Counted rather than
 * assumed, because it is the number that tells a pro why editing publishes a new
 * version instead of changing the old one.
 */
async function signatureCountsByForm(
  db: Db,
  formIds: string[],
): Promise<Map<string, number>> {
  const counts = new Map<string, number>()
  if (formIds.length === 0) return counts

  const [versions, grouped] = await Promise.all([
    db.consentFormVersion.findMany({
      where: { formId: { in: formIds } },
      take: 2000,
      select: { id: true, formId: true },
    }),
    db.clientConsentRecord.groupBy({
      by: ['formVersionId'],
      where: { formVersion: { formId: { in: formIds } } },
      _count: { _all: true },
    }),
  ])

  const formIdByVersionId = new Map(versions.map((v) => [v.id, v.formId]))
  for (const row of grouped) {
    const formId = row.formVersionId
      ? formIdByVersionId.get(row.formVersionId)
      : undefined
    if (!formId) continue
    counts.set(formId, (counts.get(formId) ?? 0) + row._count._all)
  }

  return counts
}

/**
 * The pro's own forms plus the platform templates on offer. Only invoke when the
 * technical-record gate is on for this pro — the surface is dark otherwise.
 */
export async function loadProConsentFormLibrary(
  professionalId: string,
  db: Db = prisma,
): Promise<ProConsentFormLibrary> {
  const [ownRows, templateRows] = await Promise.all([
    db.consentForm.findMany({
      where: { professionalId },
      orderBy: [{ isActive: 'desc' }, { createdAt: 'desc' }],
      take: 200,
      select: FORM_SELECT,
    }),
    db.consentForm.findMany({
      // Platform templates are offered to every pro; a retired one disappears
      // from the offer but keeps working for anyone who already adopted it.
      where: { professionalId: null, isActive: true },
      orderBy: { createdAt: 'asc' },
      take: 200,
      select: FORM_SELECT,
    }),
  ])

  const counts = await signatureCountsByForm(db, [
    ...ownRows.map((r) => r.id),
    ...templateRows.map((r) => r.id),
  ])

  const adoptedTemplateIds = new Set(
    ownRows.map((r) => r.sourceTemplateId).filter((id): id is string => !!id),
  )

  return {
    forms: ownRows.map((row) => toView(row, counts.get(row.id) ?? 0)),
    templates: templateRows.map((row) => ({
      ...toView(row, counts.get(row.id) ?? 0),
      adopted: adoptedTemplateIds.has(row.id),
    })),
  }
}

/**
 * The choices a pro has when recording a consent record: their ACTIVE forms, each
 * resolved to the version that would be signed today. Retired forms are absent —
 * a form a pro has stopped using should not keep being attached to new records,
 * while records already pointing at it keep resolving their own version.
 */
export type ConsentFormOption = {
  formId: string
  versionId: string
  version: number
  kind: ClientConsentKind
  title: string
}

export async function loadConsentFormOptions(
  professionalId: string,
  db: Db = prisma,
): Promise<ConsentFormOption[]> {
  const rows = await db.consentForm.findMany({
    where: { professionalId, isActive: true },
    orderBy: { createdAt: 'asc' },
    take: 200,
    select: {
      id: true,
      kind: true,
      versions: {
        orderBy: { version: 'desc' },
        take: 1,
        select: { id: true, version: true, title: true },
      },
    },
  })

  const options: ConsentFormOption[] = []
  for (const row of rows) {
    const current = row.versions[0]
    // A form with no published text has nothing to sign.
    if (!current) continue
    options.push({
      formId: row.id,
      versionId: current.id,
      version: current.version,
      kind: row.kind,
      title: current.title,
    })
  }
  return options
}
