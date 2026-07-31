// lib/consentForms/publish.ts
//
// K14 — the ONE writer of ConsentFormVersion rows. Every surface that changes a
// consent form's words (the pro's form library, template adoption, the admin
// template route) goes through `publishConsentFormVersion`, so version numbering
// and D6 provenance cannot be computed two slightly different ways.
//
// 🔴 There is no "update a version" path, here or anywhere. Editing a form
// publishes version n+1; the database refuses UPDATEs on published versions
// outright (migration 20260822000000). That is what makes "the client signed
// this text on the 3rd" survive the pro editing the form on the 5th.

import { Prisma, type PrismaClient } from '@prisma/client'

import {
  canonicalizeConsentBody,
  canonicalizeConsentTitle,
  consentTextsMatch,
} from './formText'

type Db = PrismaClient | Prisma.TransactionClient

export const CONSENT_FORM_VERSION_SELECT = {
  id: true,
  formId: true,
  version: true,
  title: true,
  body: true,
  publishedAt: true,
  publishedByProfessionalId: true,
  sourceTemplateVersionId: true,
  verbatimFromTemplate: true,
} satisfies Prisma.ConsentFormVersionSelect

export type ConsentFormVersionRow = Prisma.ConsentFormVersionGetPayload<{
  select: typeof CONSENT_FORM_VERSION_SELECT
}>

export class ConsentFormPublishConflictError extends Error {
  constructor() {
    super('This form was changed somewhere else. Reload and try again.')
    this.name = 'ConsentFormPublishConflictError'
  }
}

/**
 * Publish the next version of an existing form.
 *
 * Provenance carries FORWARD rather than being re-derived against whatever the
 * template says today: a form adopted from template v1 stays a form based on
 * template v1, even after the platform publishes v2. Re-pointing it would make a
 * pro's untouched form silently report itself as "edited" the moment someone
 * else changed the template.
 */
export async function publishConsentFormVersion(
  db: Db,
  args: {
    formId: string
    title: string
    body: string
    /** Null when the platform (an admin) publishes. */
    publishedByProfessionalId: string | null
  },
): Promise<ConsentFormVersionRow> {
  const title = canonicalizeConsentTitle(args.title)
  const body = canonicalizeConsentBody(args.body)

  const latest = await db.consentFormVersion.findFirst({
    where: { formId: args.formId },
    orderBy: { version: 'desc' },
    select: {
      version: true,
      sourceTemplateVersionId: true,
      sourceTemplateVersion: { select: { id: true, title: true, body: true } },
    },
  })

  const source = latest?.sourceTemplateVersion ?? null

  try {
    return await db.consentFormVersion.create({
      data: {
        formId: args.formId,
        version: (latest?.version ?? 0) + 1,
        title,
        body,
        publishedByProfessionalId: args.publishedByProfessionalId,
        sourceTemplateVersionId: source?.id ?? null,
        verbatimFromTemplate: source
          ? consentTextsMatch(source.title, title) &&
            consentTextsMatch(source.body, body)
          : false,
      },
      select: CONSENT_FORM_VERSION_SELECT,
    })
  } catch (e) {
    // Two publishes raced for the same version number; the unique index on
    // (formId, version) is the arbiter. Refuse rather than retry — the loser
    // wrote their edit against text that is no longer current.
    if (
      e instanceof Prisma.PrismaClientKnownRequestError &&
      e.code === 'P2002'
    ) {
      throw new ConsentFormPublishConflictError()
    }
    throw e
  }
}

/**
 * Create a form and its first version together. The verbatim flag is computed
 * from the words rather than taken on trust.
 *
 * Two writes, so callers PASS A TRANSACTION CLIENT — both routes do. Without one
 * a failure between them leaves a form with no published text; the loader renders
 * that honestly ("no text published") rather than crashing, but it is debris.
 */
export async function createConsentFormWithFirstVersion(
  db: Db,
  args: {
    /** Null creates a PLATFORM template (admin only). */
    professionalId: string | null
    kind: Prisma.ConsentFormCreateInput['kind']
    title: string
    body: string
    sourceTemplateId?: string | null
    sourceTemplateVersion?: { id: string; title: string; body: string } | null
  },
): Promise<{ formId: string; version: ConsentFormVersionRow }> {
  const title = canonicalizeConsentTitle(args.title)
  const body = canonicalizeConsentBody(args.body)
  const source = args.sourceTemplateVersion ?? null

  const form = await db.consentForm.create({
    data: {
      professionalId: args.professionalId,
      kind: args.kind,
      sourceTemplateId: args.sourceTemplateId ?? null,
    },
    select: { id: true },
  })

  const version = await db.consentFormVersion.create({
    data: {
      formId: form.id,
      version: 1,
      title,
      body,
      publishedByProfessionalId: args.professionalId,
      sourceTemplateVersionId: source?.id ?? null,
      verbatimFromTemplate: source
        ? consentTextsMatch(source.title, title) &&
          consentTextsMatch(source.body, body)
        : false,
    },
    select: CONSENT_FORM_VERSION_SELECT,
  })

  return { formId: form.id, version }
}
