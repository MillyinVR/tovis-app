// K16-A: the privacy export boundary, proved against real Postgres.
//
// The unit suite runs entirely on a mocked Prisma client, so it can prove which
// `select` object we hand to Prisma but NOT that the query is valid or that the
// assembled payload actually carries the rows. This file drives the real thing:
//
//   1. A client's own consent signature and allergy record REACH the export.
//   2. The professional-authored parts of that consent record — the encrypted
//      notes, the author-scoped proof reference, the single-use signature token
//      id — are absent from the assembled payload, not merely unselected.
//   3. Pro-authored feedback (ClientProfessionalNote) and per-client policy
//      (ProClientPolicy) never appear anywhere in the payload, for either the
//      client OR the professional (Tori, 2026-07-31; K16 neutrality rule).
//
// Point 3 is asserted over the SERIALIZED payload rather than a named key,
// because the failure that matters is the value surfacing anywhere at all.

import { PrismaClient, Role } from '@prisma/client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { exportUserData } from '@/lib/privacy/exportUserData'

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) {
  throw new Error('Missing DATABASE_URL. Run with: pnpm test:integration')
}

const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } })

const tag = `privacy_export_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

// Distinctive sentinels: if any of these strings appears in the payload, the
// corresponding record leaked.
const PRO_NOTE_BODY = `${tag}__PRO_AUTHORED_NOTE_BODY`
const PRO_NOTE_TITLE = `${tag}__PRO_AUTHORED_NOTE_TITLE`
const CONSENT_PROOF_REF = `${tag}__AUTHOR_SCOPED_PROOF_REF`
const ALLERGY_LABEL = `${tag}__ALLERGY_LABEL`
const CONSENT_SCOPE = `${tag}__CONSENT_SCOPE`

type Fixtures = {
  tenantId: string
  proUserId: string
  professionalId: string
  clientUserId: string
  clientId: string
}

let fx: Fixtures

beforeAll(async () => {
  const tenant = await db.tenant.create({
    data: { slug: `${tag}-tenant`, name: 'Privacy export', isActive: true },
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

  const pro = await db.professionalProfile.create({
    data: {
      userId: proUser.id,
      firstName: 'Export',
      lastName: 'Pro',
      businessName: `${tag} studio`,
      homeTenantId: tenant.id,
      timeZone: 'America/Los_Angeles',
    },
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
      firstName: 'Export',
      lastName: 'Client',
      homeTenantId: tenant.id,
    },
    select: { id: true },
  })

  fx = {
    tenantId: tenant.id,
    proUserId: proUser.id,
    professionalId: pro.id,
    clientUserId: clientUser.id,
    clientId: client.id,
  }

  // The client's own signature — with pro-authored parts attached.
  await db.clientConsentRecord.create({
    data: {
      clientId: fx.clientId,
      professionalId: fx.professionalId,
      kind: 'SERVICE_WAIVER',
      serviceScope: CONSENT_SCOPE,
      signedAt: new Date('2026-05-01T00:00:00.000Z'),
      proofMethod: 'CLIENT_TOKEN',
      proofRef: CONSENT_PROOF_REF,
      notesEncrypted: { v: 1, ct: `${tag}__ENCRYPTED_CONSENT_NOTES` },
    },
  })

  // The client's own health disclosure.
  await db.clientAllergy.create({
    data: {
      clientId: fx.clientId,
      label: ALLERGY_LABEL,
      severity: 'HIGH',
      recordedByProfessionalId: fx.professionalId,
    },
  })

  // Pro-authored feedback about the client — must never be disclosed.
  await db.clientProfessionalNote.create({
    data: {
      clientId: fx.clientId,
      professionalId: fx.professionalId,
      title: PRO_NOTE_TITLE,
      body: PRO_NOTE_BODY,
    },
  })

  // Per-client booking requirements — the client must not learn this exists.
  await db.proClientPolicy.create({
    data: {
      clientId: fx.clientId,
      professionalId: fx.professionalId,
      requireDeposit: true,
    },
  })
})

afterAll(async () => {
  if (fx) {
    await db.proClientPolicy.deleteMany({ where: { clientId: fx.clientId } })
    await db.clientProfessionalNote.deleteMany({
      where: { clientId: fx.clientId },
    })
    await db.clientAllergy.deleteMany({ where: { clientId: fx.clientId } })
    await db.clientConsentRecord.deleteMany({ where: { clientId: fx.clientId } })
    await db.clientProfile.deleteMany({ where: { id: fx.clientId } })
    await db.professionalProfile.deleteMany({
      where: { id: fx.professionalId },
    })
    await db.user.deleteMany({
      where: { id: { in: [fx.clientUserId, fx.proUserId] } },
    })
    await db.tenant.deleteMany({ where: { id: fx.tenantId } })
  }

  await db.$disconnect()
})

describe('privacy export boundary (real Postgres)', () => {
  it("carries the client's own consent signature and allergy record", async () => {
    const exported = await exportUserData({ db, userId: fx.clientUserId })

    expect(exported.data.clientConsentRecords).toHaveLength(1)
    expect(exported.data.clientConsentRecords[0]).toMatchObject({
      clientId: fx.clientId,
      professionalId: fx.professionalId,
      kind: 'SERVICE_WAIVER',
      serviceScope: CONSENT_SCOPE,
      proofMethod: 'CLIENT_TOKEN',
    })

    expect(exported.data.clientAllergies).toHaveLength(1)
    expect(exported.data.clientAllergies[0]).toMatchObject({
      clientId: fx.clientId,
      label: ALLERGY_LABEL,
      severity: 'HIGH',
    })
  })

  it('excludes the professional-authored parts of the consent record', async () => {
    const exported = await exportUserData({ db, userId: fx.clientUserId })
    const serialized = JSON.stringify(exported)

    expect(serialized).not.toContain(CONSENT_PROOF_REF)
    expect(serialized).not.toContain('ENCRYPTED_CONSENT_NOTES')

    const [record] = exported.data.clientConsentRecords
    expect(record).not.toHaveProperty('proofRef')
    expect(record).not.toHaveProperty('notesEncrypted')
    expect(record).not.toHaveProperty('signatureTokenId')
  })

  it("never discloses pro-authored feedback or per-client policy to the client", async () => {
    const exported = await exportUserData({ db, userId: fx.clientUserId })
    const serialized = JSON.stringify(exported)

    // Tori, 2026-07-31 — pro feedback is never visible to clients.
    expect(serialized).not.toContain(PRO_NOTE_BODY)
    expect(serialized).not.toContain(PRO_NOTE_TITLE)

    // K16 neutrality: the client feels a requirement, never learns of the row.
    expect(exported.data).not.toHaveProperty('proClientPolicies')
    expect(serialized).not.toContain('requireDeposit')
  })

  it('does not disclose them on the PROFESSIONAL side either', async () => {
    const exported = await exportUserData({ db, userId: fx.proUserId })
    const serialized = JSON.stringify(exported)

    expect(serialized).not.toContain(PRO_NOTE_BODY)
    expect(serialized).not.toContain(PRO_NOTE_TITLE)
    expect(serialized).not.toContain('requireDeposit')

    // The pro DOES see the consent records they hold, minus the same parts.
    expect(exported.data.clientConsentRecords).toHaveLength(1)
    expect(serialized).not.toContain(CONSENT_PROOF_REF)
  })

  it('returns empty consent/allergy arrays for a user with neither profile', async () => {
    const bareUser = await db.user.create({
      data: {
        email: `${tag}_bare@example.com`,
        password: 'test-password',
        role: Role.CLIENT,
      },
      select: { id: true },
    })

    try {
      const exported = await exportUserData({ db, userId: bareUser.id })
      expect(exported.data.clientConsentRecords).toEqual([])
      expect(exported.data.clientAllergies).toEqual([])
    } finally {
      await db.user.deleteMany({ where: { id: bareUser.id } })
    }
  })
})
