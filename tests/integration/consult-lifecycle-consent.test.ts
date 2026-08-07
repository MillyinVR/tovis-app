import {
  BookingStatus,
  ConsultActorType,
  ConsultAgreementKind,
  ConsultAuditAction,
  ConsultRevisionKind,
  ConsultSessionStatus,
  Prisma,
  PrismaClient,
  ProfessionalLocationType,
  Role,
  ServiceLocationType,
} from '@prisma/client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  acceptConsultAgreement,
  appendConsultRevision,
  revokeConsultAgreement,
  transitionConsultSession,
} from '@/lib/consult/writeBoundary'

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) {
  throw new Error('Missing DATABASE_URL. Run with: pnpm test:integration')
}

const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } })
const tag = `consult_legal_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

let tenantId: string
let userId: string
let clientId: string
let proUserId: string
let professionalId: string
let locationId: string
let categoryId: string
let browsCategoryId: string
let serviceId: string
let bookingId: string
let sessionId: string
let consentVersionId: string
let adultVersionId: string

beforeAll(async () => {
  const tenant = await db.tenant.create({
    data: { slug: `${tag}-tenant`, name: 'Consult legal', isActive: true },
    select: { id: true },
  })
  tenantId = tenant.id

  const user = await db.user.create({
    data: {
      email: `${tag}@example.com`,
      password: 'test-password',
      role: Role.CLIENT,
    },
    select: { id: true },
  })
  userId = user.id

  const client = await db.clientProfile.create({
    data: {
      userId,
      firstName: 'Consult',
      lastName: 'Client',
      homeTenantId: tenantId,
    },
    select: { id: true },
  })
  clientId = client.id

  const proUser = await db.user.create({
    data: {
      email: `${tag}_pro@example.com`,
      password: 'test-password',
      role: Role.PRO,
    },
    select: { id: true },
  })
  proUserId = proUser.id

  const professional = await db.professionalProfile.create({
    data: {
      userId: proUserId,
      homeTenantId: tenantId,
      firstName: 'Consult',
      lastName: 'Professional',
      timeZone: 'America/Los_Angeles',
    },
    select: { id: true },
  })
  professionalId = professional.id

  const location = await db.professionalLocation.create({
    data: {
      professionalId,
      type: ProfessionalLocationType.SALON,
      name: 'Consult studio',
      timeZone: 'America/Los_Angeles',
      workingHours: {},
    },
    select: { id: true },
  })
  locationId = location.id

  const category = await db.serviceCategory.create({
    data: { name: `${tag} hair color`, slug: 'hair-color' },
    select: { id: true },
  })
  categoryId = category.id

  const browsCategory = await db.serviceCategory.create({
    data: { name: `${tag} brows`, slug: `${tag}-brows` },
    select: { id: true },
  })
  browsCategoryId = browsCategory.id

  const service = await db.service.create({
    data: {
      name: `${tag} color service`,
      categoryId,
      defaultDurationMinutes: 60,
      minPrice: new Prisma.Decimal('100.00'),
    },
    select: { id: true },
  })
  serviceId = service.id

  const booking = await db.booking.create({
    data: {
      clientId,
      professionalId,
      serviceId,
      proTenantId: tenantId,
      clientHomeTenantId: tenantId,
      scheduledFor: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      status: BookingStatus.ACCEPTED,
      locationType: ServiceLocationType.SALON,
      locationId,
      locationTimeZone: 'America/Los_Angeles',
      subtotalSnapshot: new Prisma.Decimal('100.00'),
      totalAmount: new Prisma.Decimal('100.00'),
      totalDurationMinutes: 60,
    },
    select: { id: true },
  })
  bookingId = booking.id

  const session = await db.consultSession.create({
    data: {
      clientId,
      bookingId,
      professionalId,
      serviceCategoryId: categoryId,
      auditEvents: {
        create: {
          action: ConsultAuditAction.SESSION_CREATED,
          actorType: ConsultActorType.CLIENT,
          actorId: userId,
          toStatus: ConsultSessionStatus.CONSENT_REQUIRED,
        },
      },
    },
    select: { id: true },
  })
  sessionId = session.id

  const [consentVersion, adultVersion] = await Promise.all([
    db.consultAgreementVersion.create({
      data: {
        kind: ConsultAgreementKind.SENSITIVE_DATA_CONSENT,
        version: 1,
        title: 'Sensitive data consent',
        body: 'Test-only exact consent words.',
      },
      select: { id: true },
    }),
    db.consultAgreementVersion.create({
      data: {
        kind: ConsultAgreementKind.ADULT_18_PLUS_ATTESTATION,
        version: 1,
        title: '18+ attestation',
        body: 'I attest that I am at least 18 years old.',
      },
      select: { id: true },
    }),
  ])
  consentVersionId = consentVersion.id
  adultVersionId = adultVersion.id
})

afterAll(async () => {
  if (sessionId) {
    await db.consultSession.deleteMany({ where: { id: sessionId } })
  }
  if (consentVersionId && adultVersionId) {
    await db.consultAgreementVersion.deleteMany({
      where: { id: { in: [consentVersionId, adultVersionId] } },
    })
  }
  if (bookingId) await db.booking.deleteMany({ where: { id: bookingId } })
  if (locationId) {
    await db.professionalLocation.deleteMany({ where: { id: locationId } })
  }
  if (serviceId) await db.service.deleteMany({ where: { id: serviceId } })
  if (categoryId) {
    await db.serviceCategory.deleteMany({ where: { id: categoryId } })
  }
  if (browsCategoryId) {
    await db.serviceCategory.deleteMany({ where: { id: browsCategoryId } })
  }
  if (clientId) await db.clientProfile.deleteMany({ where: { id: clientId } })
  if (professionalId) {
    await db.professionalProfile.deleteMany({ where: { id: professionalId } })
  }
  if (userId) await db.user.deleteMany({ where: { id: userId } })
  if (proUserId) await db.user.deleteMany({ where: { id: proUserId } })
  if (tenantId) await db.tenant.deleteMany({ where: { id: tenantId } })
  await db.$disconnect()
})

const actor = (): {
  type: typeof ConsultActorType.CLIENT
  id: string
} => ({
  type: ConsultActorType.CLIENT,
  id: userId,
})

describe('AI consult lifecycle and legal foundation', () => {
  it('starts consent-required and rejects sensitive states before both prerequisites', async () => {
    const session = await db.consultSession.findUniqueOrThrow({
      where: { id: sessionId },
    })
    expect(session.status).toBe(ConsultSessionStatus.CONSENT_REQUIRED)

    await expect(
      db.consultSession.update({
        where: { id: sessionId },
        data: { serviceCategoryId: browsCategoryId },
      }),
    ).rejects.toThrow()

    await expect(
      transitionConsultSession({
        consultSessionId: sessionId,
        fromStatus: ConsultSessionStatus.CONSENT_REQUIRED,
        toStatus: ConsultSessionStatus.INTAKE_READY,
        actor: actor(),
      }),
    ).rejects.toThrow()

    await db.consultSession.update({
      where: { id: sessionId },
      data: { revisionSequence: 1 },
    })
    await expect(
      db.consultRevision.create({
        data: {
          consultSessionId: sessionId,
          revision: 1,
          kind: ConsultRevisionKind.INTAKE,
          payload: { forbidden: 'before-agreements' },
          schemaVersion: 1,
        },
      }),
    ).rejects.toThrow()
    await db.consultSession.update({
      where: { id: sessionId },
      data: { revisionSequence: 0 },
    })

    const rawPhotoTable = await db.$queryRaw<Array<{ table_name: string | null }>>`
      SELECT to_regclass('public."ConsultPhoto"')::text AS table_name
    `
    expect(rawPhotoTable).toEqual([{ table_name: null }])

    await expect(
      db.consultAgreementAcceptance.create({
        data: {
          consultSessionId: sessionId,
          agreementVersionId: consentVersionId,
          kind: ConsultAgreementKind.SENSITIVE_DATA_CONSENT,
          acceptedByType: ConsultActorType.SYSTEM,
          acceptedById: 'not-the-owning-client',
        },
      }),
    ).rejects.toThrow()

    await acceptConsultAgreement({
      consultSessionId: sessionId,
      agreementVersionId: consentVersionId,
      expectedKind: ConsultAgreementKind.SENSITIVE_DATA_CONSENT,
      actor: actor(),
    })

    expect(
      await db.consultSession.findUniqueOrThrow({ where: { id: sessionId } }),
    ).toMatchObject({ status: ConsultSessionStatus.CONSENT_REQUIRED })

    const accepted = await acceptConsultAgreement({
      consultSessionId: sessionId,
      agreementVersionId: adultVersionId,
      expectedKind: ConsultAgreementKind.ADULT_18_PLUS_ATTESTATION,
      actor: actor(),
    })
    expect(accepted.status).toBe(ConsultSessionStatus.INTAKE_READY)
  })

  it('pins exact legal versions and keeps published wording immutable', async () => {
    const acceptances = await db.consultAgreementAcceptance.findMany({
      where: { consultSessionId: sessionId, revokedAt: null },
      orderBy: { kind: 'asc' },
      include: { agreementVersion: true },
    })
    expect(acceptances).toHaveLength(2)
    expect(
      acceptances.map((acceptance) => ({
        kind: acceptance.kind,
        version: acceptance.agreementVersion.version,
        body: acceptance.agreementVersion.body,
      })),
    ).toEqual([
      {
        kind: ConsultAgreementKind.SENSITIVE_DATA_CONSENT,
        version: 1,
        body: 'Test-only exact consent words.',
      },
      {
        kind: ConsultAgreementKind.ADULT_18_PLUS_ATTESTATION,
        version: 1,
        body: 'I attest that I am at least 18 years old.',
      },
    ])

    await expect(
      db.consultAgreementVersion.update({
        where: { id: consentVersionId },
        data: { body: 'Changed after acceptance.' },
      }),
    ).rejects.toThrow()
  })

  it('appends numbered immutable revisions with matching audit events', async () => {
    await transitionConsultSession({
      consultSessionId: sessionId,
      fromStatus: ConsultSessionStatus.INTAKE_READY,
      toStatus: ConsultSessionStatus.INTAKE_IN_PROGRESS,
      actor: actor(),
    })

    const revision = await appendConsultRevision({
      consultSessionId: sessionId,
      kind: ConsultRevisionKind.ANALYSIS,
      payload: { fixture: 'revision-one' },
      schemaVersion: 1,
      actor: actor(),
    })
    expect(revision.revision).toBe(1)

    const event = await db.consultAuditEvent.findFirstOrThrow({
      where: {
        consultSessionId: sessionId,
        action: ConsultAuditAction.REVISION_CREATED,
        revisionId: revision.id,
      },
    })
    expect(event.actorId).toBe(userId)

    await expect(
      db.consultRevision.update({
        where: { id: revision.id },
        data: { payload: { fixture: 'rewritten' } },
      }),
    ).rejects.toThrow()
    await expect(
      db.consultAuditEvent.update({
        where: { id: event.id },
        data: { actorId: 'rewritten' },
      }),
    ).rejects.toThrow()
  })

  it('revokes one-way, stops sensitive writes, and preserves the evidence trail', async () => {
    const consent = await db.consultAgreementAcceptance.findFirstOrThrow({
      where: {
        consultSessionId: sessionId,
        kind: ConsultAgreementKind.SENSITIVE_DATA_CONSENT,
        revokedAt: null,
      },
    })

    const revoked = await revokeConsultAgreement({
      consultSessionId: sessionId,
      acceptanceId: consent.id,
      reason: 'Client withdrew consent.',
      actor: actor(),
    })
    expect(revoked.status).toBe(ConsultSessionStatus.CONSENT_REVOKED)
    expect(revoked.acceptance.revokedAt).toBeInstanceOf(Date)

    await expect(
      appendConsultRevision({
        consultSessionId: sessionId,
        kind: ConsultRevisionKind.ANALYSIS,
        payload: { forbidden: true },
        schemaVersion: 1,
        actor: actor(),
      }),
    ).rejects.toMatchObject({
      code: 'INVALID_STATE',
    })

    await expect(
      db.consultAgreementAcceptance.update({
        where: { id: consent.id },
        data: { revokedAt: null, revokedByType: null, revokedById: null, revocationReason: null },
      }),
    ).rejects.toThrow()

    const events = await db.consultAuditEvent.findMany({
      where: { consultSessionId: sessionId },
      select: { action: true, fromStatus: true, toStatus: true },
    })
    expect(events).toContainEqual({
      action: ConsultAuditAction.AGREEMENT_REVOKED,
      fromStatus: null,
      toStatus: null,
    })
    expect(events).toContainEqual({
      action: ConsultAuditAction.LIFECYCLE_TRANSITIONED,
      fromStatus: ConsultSessionStatus.INTAKE_IN_PROGRESS,
      toStatus: ConsultSessionStatus.CONSENT_REVOKED,
    })
  })
})
