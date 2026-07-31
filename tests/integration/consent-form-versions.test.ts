// K14: consent form templates + APPEND-ONLY versions.
//
// The DoD this suite exists to prove, against real Postgres and through the real
// read path (`loadTechnicalRecord`):
//
//   1. Editing a form cannot change what an already-signed record says.
//   2. A signature made against v1 still resolves v1's text after v2 publishes.
//   3. The migration leaves every existing free-text consent row readable.
//
// RED-PROOF — all three were RUN against this suite, not reasoned about:
//   * Implement the pointer as a `formId` (the obvious cheaper design): the
//     loader resolves the FORM's current version instead of the record's own.
//     → test 3 fails, "expected 2 to be 1" — the chart reads v2's words out of a
//     record signed against v1. Tests 1, 2 and 4 stay green, because they assert
//     at the DB, which is exactly why the loader needs its own test.
//   * Drop the migration's BEFORE UPDATE trigger → test 1 fails; a plain SQL
//     UPDATE rewrites published text with nothing to stop it.
//   * Swap the RESTRICT foreign key for SET NULL → test 4 fails; the signed
//     version deletes cleanly and the record is left pointing at nothing.

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  ClientConsentKind,
  ConsentProofMethod,
  Prisma,
  PrismaClient,
  Role,
} from '@prisma/client'

import { loadTechnicalRecord } from '@/lib/clients/technicalRecordLoader'
import {
  loadConsentFormOptions,
  loadProConsentFormLibrary,
} from '@/lib/consentForms/loader'
import {
  createConsentFormWithFirstVersion,
  publishConsentFormVersion,
} from '@/lib/consentForms/publish'

const databaseUrl = process.env.DATABASE_URL

if (!databaseUrl) {
  throw new Error(
    'Missing DATABASE_URL. Run this test with: pnpm test:integration',
  )
}

const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } })

const V1_TITLE = 'Corrective colour waiver'
const V1_BODY = 'I understand corrective colour may take several sessions.'
const V2_TITLE = 'Corrective colour waiver (2026)'
const V2_BODY = 'I understand corrective colour may take up to five sessions.'

type Fixtures = {
  tenantId: string
  clientId: string
  clientUserId: string
  professionalId: string
  proUserId: string
  otherProfessionalId: string
  otherProUserId: string
}

let fx: Fixtures

async function seedFixtures(): Promise<Fixtures> {
  const tag = `consent_forms_${Date.now()}_${Math.random()
    .toString(36)
    .slice(2, 8)}`

  const tenant = await db.tenant.upsert({
    where: { slug: 'tovis-root' },
    update: {},
    create: { slug: 'tovis-root', name: 'TOVIS', isActive: true },
    select: { id: true },
  })

  const clientUser = await db.user.create({
    data: {
      email: `${tag}_client@example.com`,
      password: 'test-password',
      role: Role.CLIENT,
    },
    select: { id: true },
  })

  const client = await db.clientProfile.create({
    data: {
      userId: clientUser.id,
      homeTenantId: tenant.id,
      firstName: 'Consent',
      lastName: 'Client',
    },
    select: { id: true },
  })

  const proUser = await db.user.create({
    data: {
      email: `${tag}_pro@example.com`,
      password: 'test-password',
      role: Role.PRO,
    },
    select: { id: true },
  })

  const professional = await db.professionalProfile.create({
    data: {
      userId: proUser.id,
      homeTenantId: tenant.id,
      firstName: 'Consent',
      lastName: 'Pro',
      businessName: 'Consent Studio',
      timeZone: 'America/Los_Angeles',
    },
    select: { id: true },
  })

  const otherProUser = await db.user.create({
    data: {
      email: `${tag}_other@example.com`,
      password: 'test-password',
      role: Role.PRO,
    },
    select: { id: true },
  })

  const otherProfessional = await db.professionalProfile.create({
    data: {
      userId: otherProUser.id,
      homeTenantId: tenant.id,
      firstName: 'Other',
      lastName: 'Pro',
      businessName: 'Other Studio',
      timeZone: 'America/Los_Angeles',
    },
    select: { id: true },
  })

  return {
    tenantId: tenant.id,
    clientId: client.id,
    clientUserId: clientUser.id,
    professionalId: professional.id,
    proUserId: proUser.id,
    otherProfessionalId: otherProfessional.id,
    otherProUserId: otherProUser.id,
  }
}

/** A pro-owned form carrying v1's words. */
async function seedProForm(): Promise<{ formId: string; v1Id: string }> {
  const created = await createConsentFormWithFirstVersion(db, {
    professionalId: fx.professionalId,
    kind: ClientConsentKind.SERVICE_WAIVER,
    title: V1_TITLE,
    body: V1_BODY,
  })
  return { formId: created.formId, v1Id: created.version.id }
}

async function signRecord(formVersionId: string | null): Promise<string> {
  const record = await db.clientConsentRecord.create({
    data: {
      clientId: fx.clientId,
      professionalId: fx.professionalId,
      kind: ClientConsentKind.SERVICE_WAIVER,
      formVersionId,
      signedAt: new Date(),
      proofMethod: ConsentProofMethod.IN_PERSON,
    },
    select: { id: true },
  })
  return record.id
}

beforeAll(async () => {
  fx = await seedFixtures()
}, 60_000)

afterAll(async () => {
  // Leaf-first: records reference versions with ON DELETE RESTRICT, so the
  // signatures have to go before the text they point at.
  await db.clientConsentRecord.deleteMany({
    where: { professionalId: fx.professionalId },
  })
  await db.consentFormVersion.deleteMany({
    where: {
      form: {
        OR: [
          { professionalId: { in: [fx.professionalId, fx.otherProfessionalId] } },
          { professionalId: null, versions: { some: { title: { contains: 'K14 platform' } } } },
        ],
      },
    },
  })
  await db.consentForm.deleteMany({
    where: {
      professionalId: { in: [fx.professionalId, fx.otherProfessionalId] },
    },
  })
  await db.consentForm.deleteMany({
    where: { professionalId: null, versions: { none: {} }, sourceTemplateId: null },
  })
  await db.clientProfile.deleteMany({ where: { id: fx.clientId } })
  await db.professionalProfile.deleteMany({
    where: { id: { in: [fx.professionalId, fx.otherProfessionalId] } },
  })
  await db.user.deleteMany({
    where: { id: { in: [fx.clientUserId, fx.proUserId, fx.otherProUserId] } },
  })
  await db.$disconnect()
}, 60_000)

describe('the database itself refuses to rewrite published text', () => {
  it('1. every UPDATE on a published version is rejected, whatever issues it', async () => {
    const { formId, v1Id } = await seedProForm()

    // Raw SQL, deliberately: the promise has to hold against a psql session and
    // a future migration, not only against this repo's write helpers.
    await expect(
      db.$executeRaw`UPDATE "ConsentFormVersion" SET "body" = 'rewritten' WHERE "id" = ${v1Id}`,
    ).rejects.toThrow(/append-only/i)

    const stored = await db.consentFormVersion.findUniqueOrThrow({
      where: { id: v1Id },
      select: { body: true, version: true },
    })
    expect(stored.body).toBe(V1_BODY)
    expect(stored.version).toBe(1)

    // The title is no safer than the body: a form renamed after signature would
    // put new words above old text.
    await expect(
      db.$executeRaw`UPDATE "ConsentFormVersion" SET "title" = 'Something else' WHERE "id" = ${v1Id}`,
    ).rejects.toThrow(/append-only/i)

    await db.consentForm.delete({ where: { id: formId } })
  })

  it('2. editing a form cannot change what an already-signed record says', async () => {
    const { formId, v1Id } = await seedProForm()
    const recordId = await signRecord(v1Id)

    await publishConsentFormVersion(db, {
      formId,
      title: V2_TITLE,
      body: V2_BODY,
      publishedByProfessionalId: fx.professionalId,
    })

    const record = await db.clientConsentRecord.findUniqueOrThrow({
      where: { id: recordId },
      select: {
        formVersion: { select: { version: true, title: true, body: true } },
      },
    })

    expect(record.formVersion?.version).toBe(1)
    expect(record.formVersion?.title).toBe(V1_TITLE)
    expect(record.formVersion?.body).toBe(V1_BODY)

    // ...while the form itself HAS moved on: this is an edit that took effect,
    // not an edit that silently failed.
    const versions = await db.consentFormVersion.findMany({
      where: { formId },
      orderBy: { version: 'asc' },
      select: { version: true, body: true },
    })
    expect(versions.map((v) => v.version)).toEqual([1, 2])
    expect(versions[1]?.body).toBe(V2_BODY)
  })

  it('3. the chart still resolves v1 for that record after v2 publishes', async () => {
    // Reads through the REAL loader the chart page and the native route share.
    const data = await loadTechnicalRecord(fx.clientId, fx.professionalId)
    const signed = data.consents.filter((c) => c.formVersion !== null)

    expect(signed.length).toBeGreaterThan(0)
    for (const consent of signed) {
      expect(consent.formVersion?.version).toBe(1)
      expect(consent.formVersion?.title).toBe(V1_TITLE)
      expect(consent.formVersion?.body).toBe(V1_BODY)
      expect(consent.formVersion?.originLabel).toBe('Written by you')
    }
  })

  it('4. a signed version cannot be deleted out from under its record', async () => {
    const { formId, v1Id } = await seedProForm()
    await signRecord(v1Id)

    await expect(
      db.consentFormVersion.delete({ where: { id: v1Id } }),
    ).rejects.toThrow()

    // ...and neither can the form, because deleting it would cascade into that
    // version. Retiring is `isActive`, never a delete.
    await expect(
      db.consentForm.delete({ where: { id: formId } }),
    ).rejects.toThrow()

    const stillThere = await db.consentFormVersion.findUnique({
      where: { id: v1Id },
      select: { body: true },
    })
    expect(stillThere?.body).toBe(V1_BODY)
  })
})

describe('records written before K14 keep reading', () => {
  it('5. a free-text record with no form resolves with formVersion null, notes intact', async () => {
    const record = await db.clientConsentRecord.create({
      data: {
        clientId: fx.clientId,
        professionalId: fx.professionalId,
        kind: ClientConsentKind.GENERAL_CONSENT,
        serviceScope: 'colour services',
        // Exactly the shape every pre-K14 row has: no form, no version.
        formVersionId: null,
        signedAt: new Date(),
        proofMethod: ConsentProofMethod.PAPER_ON_FILE,
      },
      select: { id: true },
    })

    const data = await loadTechnicalRecord(fx.clientId, fx.professionalId)
    const view = data.consents.find((c) => c.id === record.id)

    expect(view).toBeDefined()
    expect(view?.formVersion).toBeNull()
    expect(view?.serviceScope).toBe('colour services')
    expect(view?.proofMethod).toBe(ConsentProofMethod.PAPER_ON_FILE)
  })
})

describe('D6 provenance: adopted verbatim vs adopted and edited', () => {
  it('6. an adopted template reports verbatim, then reports edited, and keeps pointing at the version it came from', async () => {
    const platform = await createConsentFormWithFirstVersion(db, {
      professionalId: null,
      kind: ClientConsentKind.SERVICE_WAIVER,
      title: 'K14 platform waiver',
      body: 'Platform words.',
    })

    // Adoption copies the template's CURRENT text into a form of the pro's own.
    const adopted = await createConsentFormWithFirstVersion(db, {
      professionalId: fx.professionalId,
      kind: ClientConsentKind.SERVICE_WAIVER,
      title: 'K14 platform waiver',
      body: 'Platform words.',
      sourceTemplateId: platform.formId,
      sourceTemplateVersion: {
        id: platform.version.id,
        title: 'K14 platform waiver',
        body: 'Platform words.',
      },
    })

    expect(adopted.version.verbatimFromTemplate).toBe(true)
    expect(adopted.version.sourceTemplateVersionId).toBe(platform.version.id)

    const edited = await publishConsentFormVersion(db, {
      formId: adopted.formId,
      title: 'K14 platform waiver',
      body: 'Platform words, plus my own clause.',
      publishedByProfessionalId: fx.professionalId,
    })

    expect(edited.verbatimFromTemplate).toBe(false)
    // Provenance carries FORWARD: still derived from the template version it was
    // adopted from, now visibly changed.
    expect(edited.sourceTemplateVersionId).toBe(platform.version.id)

    // The platform publishing new text does not retro-label the pro's untouched
    // history, because the pointer is to a VERSION, not to the template.
    await publishConsentFormVersion(db, {
      formId: platform.formId,
      title: 'K14 platform waiver',
      body: 'Platform words, revised.',
      publishedByProfessionalId: null,
    })

    const reread = await db.consentFormVersion.findUniqueOrThrow({
      where: { id: adopted.version.id },
      select: { verbatimFromTemplate: true, sourceTemplateVersionId: true },
    })
    expect(reread.verbatimFromTemplate).toBe(true)
    expect(reread.sourceTemplateVersionId).toBe(platform.version.id)

    const library = await loadProConsentFormLibrary(fx.professionalId)
    const view = library.forms.find((f) => f.id === adopted.formId)
    expect(view?.originLabel).toBe('Platform template, edited')
    expect(view?.currentVersion?.version).toBe(2)
  })

  it('7. editing back to the template’s exact words reports verbatim again', async () => {
    const platform = await createConsentFormWithFirstVersion(db, {
      professionalId: null,
      kind: ClientConsentKind.GENERAL_CONSENT,
      title: 'K14 platform consent',
      body: 'Agreed terms.',
    })

    const adopted = await createConsentFormWithFirstVersion(db, {
      professionalId: fx.professionalId,
      kind: ClientConsentKind.GENERAL_CONSENT,
      title: 'K14 platform consent',
      body: 'Agreed terms.',
      sourceTemplateId: platform.formId,
      sourceTemplateVersion: {
        id: platform.version.id,
        title: 'K14 platform consent',
        body: 'Agreed terms.',
      },
    })

    await publishConsentFormVersion(db, {
      formId: adopted.formId,
      title: 'K14 platform consent',
      body: 'My own terms.',
      publishedByProfessionalId: fx.professionalId,
    })

    const back = await publishConsentFormVersion(db, {
      formId: adopted.formId,
      title: 'K14 platform consent',
      body: 'Agreed terms.',
      publishedByProfessionalId: fx.professionalId,
    })

    expect(back.version).toBe(3)
    expect(back.verbatimFromTemplate).toBe(true)
  })
})

describe('version numbering and the options a pro is offered', () => {
  it('8. two writers cannot both claim the same version number', async () => {
    const { formId } = await seedProForm()

    await publishConsentFormVersion(db, {
      formId,
      title: V2_TITLE,
      body: V2_BODY,
      publishedByProfessionalId: fx.professionalId,
    })

    // The unique index is the arbiter, not the helper's arithmetic.
    await expect(
      db.consentFormVersion.create({
        data: {
          formId,
          version: 2,
          title: 'Race',
          body: 'Race',
        },
      }),
    ).rejects.toBeInstanceOf(Prisma.PrismaClientKnownRequestError)
  })

  it('9. a retired form is no longer offered, while its signed records still resolve', async () => {
    const { formId, v1Id } = await seedProForm()
    const recordId = await signRecord(v1Id)

    const before = await loadConsentFormOptions(fx.professionalId)
    expect(before.some((o) => o.formId === formId)).toBe(true)

    await db.consentForm.update({
      where: { id: formId },
      data: { isActive: false },
    })

    const after = await loadConsentFormOptions(fx.professionalId)
    expect(after.some((o) => o.formId === formId)).toBe(false)

    const record = await db.clientConsentRecord.findUniqueOrThrow({
      where: { id: recordId },
      select: { formVersion: { select: { body: true } } },
    })
    expect(record.formVersion?.body).toBe(V1_BODY)
  })

  it('10. another pro cannot see this pro’s forms', async () => {
    await seedProForm()

    const theirs = await loadProConsentFormLibrary(fx.otherProfessionalId)
    expect(theirs.forms).toHaveLength(0)
    // Platform templates ARE offered to them — that is what makes one adoptable.
    expect(theirs.templates.length).toBeGreaterThan(0)
    expect(theirs.templates.every((t) => t.adopted === false)).toBe(true)
  })
})
