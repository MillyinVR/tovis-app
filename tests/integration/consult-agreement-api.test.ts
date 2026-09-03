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
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  process.env.JWT_SECRET ||= 'integration-test-jwt-secret'
})

const mockRequireClient = vi.hoisted(() => vi.fn())

vi.mock('@/app/api/_utils/auth/requireClient', () => ({
  requireClient: mockRequireClient,
}))

import { GET as getAgreements } from '@/app/api/v1/client/consult/[id]/agreements/route'
import { POST as acceptAgreement } from '@/app/api/v1/client/consult/[id]/agreements/accept/route'
import { POST as revokeAgreement } from '@/app/api/v1/client/consult/[id]/agreements/revoke/route'
import {
  appendConsultRevision,
  transitionConsultSession,
} from '@/lib/consult/writeBoundary'

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) {
  throw new Error('Missing DATABASE_URL. Run with: pnpm test:integration')
}

const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } })
const tag = `consult_api_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
const versionBase = 700_000 + Math.floor(Math.random() * 100_000)

let tenantId = ''
let ownerUserId = ''
let ownerClientId = ''
let otherUserId = ''
let otherClientId = ''
let proUserId = ''
let professionalId = ''
let locationId = ''
let categoryId = ''
let serviceId = ''
let bookingId = ''
let sessionId = ''
let staleConsentVersionId = ''
let consentVersionId = ''
let adultVersionId = ''

function context(id: string) {
  return { params: { id } }
}

async function json(response: Response): Promise<Record<string, unknown>> {
  const body: unknown = await response.json()
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new Error('Expected a JSON object response.')
  }
  return body as Record<string, unknown>
}

function postAccept(kind: ConsultAgreementKind, agreementVersionId: string) {
  return acceptAgreement(
    new Request(`http://test/api/v1/client/consult/${sessionId}/agreements/accept`, {
      method: 'POST',
      body: JSON.stringify({ kind, agreementVersionId }),
    }),
    context(sessionId),
  )
}

function postRevoke(acceptanceId: string, reason = 'Client withdrew consent.') {
  return revokeAgreement(
    new Request(`http://test/api/v1/client/consult/${sessionId}/agreements/revoke`, {
      method: 'POST',
      body: JSON.stringify({ acceptanceId, reason }),
    }),
    context(sessionId),
  )
}

beforeAll(async () => {
  process.env.ENABLE_AI_CONSULT = '1'

  const tenant = await db.tenant.create({
    data: { slug: `${tag}-tenant`, name: 'Consult API', isActive: true },
    select: { id: true },
  })
  tenantId = tenant.id

  const [ownerUser, otherUser, proUser] = await Promise.all([
    db.user.create({
      data: { email: `${tag}_owner@example.com`, password: 'x', role: Role.CLIENT },
      select: { id: true },
    }),
    db.user.create({
      data: { email: `${tag}_other@example.com`, password: 'x', role: Role.CLIENT },
      select: { id: true },
    }),
    db.user.create({
      data: { email: `${tag}_pro@example.com`, password: 'x', role: Role.PRO },
      select: { id: true },
    }),
  ])
  ownerUserId = ownerUser.id
  otherUserId = otherUser.id
  proUserId = proUser.id

  const [ownerClient, otherClient, professional] = await Promise.all([
    db.clientProfile.create({
      data: {
        userId: ownerUserId,
        firstName: 'Owner',
        lastName: 'Client',
        homeTenantId: tenantId,
      },
      select: { id: true },
    }),
    db.clientProfile.create({
      data: {
        userId: otherUserId,
        firstName: 'Other',
        lastName: 'Client',
        homeTenantId: tenantId,
      },
      select: { id: true },
    }),
    db.professionalProfile.create({
      data: {
        userId: proUserId,
        homeTenantId: tenantId,
        firstName: 'Consult',
        lastName: 'Professional',
        timeZone: 'America/Los_Angeles',
      },
      select: { id: true },
    }),
  ])
  ownerClientId = ownerClient.id
  otherClientId = otherClient.id
  professionalId = professional.id

  const [location, category] = await Promise.all([
    db.professionalLocation.create({
      data: {
        professionalId,
        type: ProfessionalLocationType.SALON,
        name: 'Consult API studio',
        timeZone: 'America/Los_Angeles',
        workingHours: {},
      },
      select: { id: true },
    }),
    db.serviceCategory.create({
      data: { name: `${tag} hair color`, slug: 'hair-color' },
      select: { id: true },
    }),
  ])
  locationId = location.id
  categoryId = category.id

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
      clientId: ownerClientId,
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
      clientId: ownerClientId,
      bookingId,
      professionalId,
      serviceCategoryId: categoryId,
      auditEvents: {
        create: {
          action: ConsultAuditAction.SESSION_CREATED,
          actorType: ConsultActorType.CLIENT,
          actorId: ownerUserId,
          toStatus: ConsultSessionStatus.CONSENT_REQUIRED,
        },
      },
    },
    select: { id: true },
  })
  sessionId = session.id
})

beforeEach(() => {
  mockRequireClient.mockResolvedValue({
    ok: true,
    clientId: ownerClientId,
    user: { id: ownerUserId },
  })
})

afterAll(async () => {
  if (sessionId) await db.consultSession.deleteMany({ where: { id: sessionId } })
  const versionIds = [staleConsentVersionId, consentVersionId, adultVersionId].filter(Boolean)
  if (versionIds.length > 0) {
    await db.consultAgreementVersion.deleteMany({ where: { id: { in: versionIds } } })
  }
  if (bookingId) await db.booking.deleteMany({ where: { id: bookingId } })
  if (locationId) await db.professionalLocation.deleteMany({ where: { id: locationId } })
  if (serviceId) await db.service.deleteMany({ where: { id: serviceId } })
  if (categoryId) await db.serviceCategory.deleteMany({ where: { id: categoryId } })
  if (ownerClientId || otherClientId) {
    await db.clientProfile.deleteMany({ where: { id: { in: [ownerClientId, otherClientId] } } })
  }
  if (professionalId) {
    await db.professionalProfile.deleteMany({ where: { id: professionalId } })
  }
  const userIds = [ownerUserId, otherUserId, proUserId].filter(Boolean)
  if (userIds.length > 0) await db.user.deleteMany({ where: { id: { in: userIds } } })
  if (tenantId) await db.tenant.deleteMany({ where: { id: tenantId } })
  delete process.env.ENABLE_AI_CONSULT
  await db.$disconnect()
})

describe('client consult agreement API against PostgreSQL', () => {
  it('fails closed before both required versions are published', async () => {
    const response = await getAgreements(
      new Request(`http://test/api/v1/client/consult/${sessionId}/agreements`),
      context(sessionId),
    )

    expect(response.status).toBe(503)
    await expect(json(response)).resolves.toMatchObject({
      ok: false,
      code: 'CONSULT_AGREEMENTS_UNAVAILABLE',
    })
  })

  it('uses explicit fixtures and returns separate exact-version requirements', async () => {
    const [staleConsent, consent, adult] = await Promise.all([
      db.consultAgreementVersion.create({
        data: {
          kind: ConsultAgreementKind.SENSITIVE_DATA_CONSENT,
          version: versionBase,
          title: 'Test-only old consent',
          body: 'Explicit stale consent fixture.',
          publishedAt: new Date('2020-01-01T00:00:00.000Z'),
        },
        select: { id: true },
      }),
      db.consultAgreementVersion.create({
        data: {
          kind: ConsultAgreementKind.SENSITIVE_DATA_CONSENT,
          version: versionBase + 1,
          title: 'Test-only consent',
          body: 'Explicit current consent fixture.',
          publishedAt: new Date('2020-01-02T00:00:00.000Z'),
        },
        select: { id: true },
      }),
      db.consultAgreementVersion.create({
        data: {
          kind: ConsultAgreementKind.ADULT_18_PLUS_ATTESTATION,
          version: versionBase,
          title: 'Test-only 18+ attestation',
          body: 'Explicit adult-attestation fixture.',
          publishedAt: new Date('2020-01-01T00:00:00.000Z'),
        },
        select: { id: true },
      }),
    ])
    staleConsentVersionId = staleConsent.id
    consentVersionId = consent.id
    adultVersionId = adult.id

    const response = await getAgreements(
      new Request(`http://test/api/v1/client/consult/${sessionId}/agreements`),
      context(sessionId),
    )
    const body = await json(response)

    expect(response.status).toBe(200)
    expect(body).toMatchObject({
      ok: true,
      agreementState: {
        consultId: sessionId,
        status: ConsultSessionStatus.CONSENT_REQUIRED,
        requirements: [
          {
            kind: ConsultAgreementKind.SENSITIVE_DATA_CONSENT,
            requiredVersion: {
              id: consentVersionId,
              version: versionBase + 1,
              body: 'Explicit current consent fixture.',
            },
            currentAcceptance: null,
            latestRevocation: null,
          },
          {
            kind: ConsultAgreementKind.ADULT_18_PLUS_ATTESTATION,
            requiredVersion: {
              id: adultVersionId,
              version: versionBase,
              body: 'Explicit adult-attestation fixture.',
            },
            currentAcceptance: null,
            latestRevocation: null,
          },
        ],
      },
    })
  })

  it('returns the same non-leaking contract for missing and foreign sessions', async () => {
    const missing = await getAgreements(
      new Request('http://test/api/v1/client/consult/missing/agreements'),
      context('missing'),
    )

    mockRequireClient.mockResolvedValue({
      ok: true,
      clientId: otherClientId,
      user: { id: otherUserId },
    })
    const foreign = await getAgreements(
      new Request(`http://test/api/v1/client/consult/${sessionId}/agreements`),
      context(sessionId),
    )
    const foreignAccept = await postAccept(
      ConsultAgreementKind.SENSITIVE_DATA_CONSENT,
      consentVersionId,
    )

    expect(missing.status).toBe(404)
    expect(foreign.status).toBe(404)
    expect(foreignAccept.status).toBe(404)
    await expect(json(missing)).resolves.toEqual({
      ok: false,
      error: 'Not found.',
      code: 'CONSULT_NOT_FOUND',
    })
    await expect(json(foreign)).resolves.toEqual({
      ok: false,
      error: 'Not found.',
      code: 'CONSULT_NOT_FOUND',
    })
    await expect(json(foreignAccept)).resolves.toEqual({
      ok: false,
      error: 'Not found.',
      code: 'CONSULT_NOT_FOUND',
    })
  })

  it('keeps founder gating and non-hair-color bookings dark', async () => {
    delete process.env.ENABLE_AI_CONSULT
    const gated = await getAgreements(
      new Request(`http://test/api/v1/client/consult/${sessionId}/agreements`),
      context(sessionId),
    )
    expect(gated.status).toBe(404)

    process.env.ENABLE_AI_CONSULT = '1'
    // Every category is consultable by default (2026-09-03); only the kill
    // switch makes a non-colour category dark, and it must stay no-leak.
    process.env.AI_CONSULT_SERVICE_SCOPE = 'HAIR_COLOR_ONLY'
    await db.serviceCategory.update({
      where: { id: categoryId },
      data: { slug: 'brows' },
    })
    try {
      const brows = await getAgreements(
        new Request(`http://test/api/v1/client/consult/${sessionId}/agreements`),
        context(sessionId),
      )
      expect(brows.status).toBe(404)
    } finally {
      delete process.env.AI_CONSULT_SERVICE_SCOPE
      await db.serviceCategory.update({
        where: { id: categoryId },
        data: { slug: 'hair-color' },
      })
    }
  })

  it('rejects stale and kind-mismatched versions without writing evidence', async () => {
    const stale = await postAccept(
      ConsultAgreementKind.SENSITIVE_DATA_CONSENT,
      staleConsentVersionId,
    )
    const mismatched = await postAccept(
      ConsultAgreementKind.ADULT_18_PLUS_ATTESTATION,
      consentVersionId,
    )

    expect(stale.status).toBe(409)
    expect(mismatched.status).toBe(409)
    await expect(json(stale)).resolves.toMatchObject({
      code: 'CONSULT_AGREEMENT_VERSION_MISMATCH',
    })
    await expect(json(mismatched)).resolves.toMatchObject({
      code: 'CONSULT_AGREEMENT_VERSION_MISMATCH',
    })
    await expect(
      db.consultAgreementAcceptance.count({ where: { consultSessionId: sessionId } }),
    ).resolves.toBe(0)
  })

  it('pins both prerequisites and makes acceptance retries effect-idempotent', async () => {
    const [consent, consentReplay] = await Promise.all([
      postAccept(
        ConsultAgreementKind.SENSITIVE_DATA_CONSENT,
        consentVersionId,
      ),
      postAccept(
        ConsultAgreementKind.SENSITIVE_DATA_CONSENT,
        consentVersionId,
      ),
    ])

    expect(consent.status).toBe(200)
    expect(consentReplay.status).toBe(200)
    const consentBodies = await Promise.all([json(consent), json(consentReplay)])
    expect(consentBodies).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ replayed: false }),
        expect.objectContaining({ replayed: true }),
      ]),
    )
    expect(consentBodies).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          agreementState: expect.objectContaining({
            status: ConsultSessionStatus.CONSENT_REQUIRED,
          }),
        }),
      ]),
    )
    await expect(
      db.consultAgreementAcceptance.count({ where: { consultSessionId: sessionId } }),
    ).resolves.toBe(1)
    await expect(
      db.consultAuditEvent.count({
        where: {
          consultSessionId: sessionId,
          action: ConsultAuditAction.AGREEMENT_ACCEPTED,
        },
      }),
    ).resolves.toBe(1)

    await expect(
      appendConsultRevision({
        consultSessionId: sessionId,
        kind: ConsultRevisionKind.ANALYSIS,
        payload: { forbidden: 'only-one-prerequisite' },
        schemaVersion: 1,
        actor: { type: ConsultActorType.CLIENT, id: ownerUserId },
      }),
    ).rejects.toMatchObject({ code: 'INVALID_STATE' })

    const adult = await postAccept(
      ConsultAgreementKind.ADULT_18_PLUS_ATTESTATION,
      adultVersionId,
    )
    const adultReplay = await postAccept(
      ConsultAgreementKind.ADULT_18_PLUS_ATTESTATION,
      adultVersionId,
    )

    expect(adult.status).toBe(200)
    await expect(json(adult)).resolves.toMatchObject({
      replayed: false,
      agreementState: { status: ConsultSessionStatus.INTAKE_READY },
    })
    await expect(json(adultReplay)).resolves.toMatchObject({ replayed: true })
    await expect(
      db.consultAgreementAcceptance.count({ where: { consultSessionId: sessionId } }),
    ).resolves.toBe(2)
  })

  it('revokes one-way, stops sensitive work, and re-consents with new evidence', async () => {
    const consent = await db.consultAgreementAcceptance.findFirstOrThrow({
      where: {
        consultSessionId: sessionId,
        kind: ConsultAgreementKind.SENSITIVE_DATA_CONSENT,
        revokedAt: null,
      },
    })

    const revoked = await postRevoke(consent.id)
    expect(revoked.status).toBe(200)
    await expect(json(revoked)).resolves.toEqual(
      expect.objectContaining({
        agreementState: expect.objectContaining({
          status: ConsultSessionStatus.CONSENT_REVOKED,
          requirements: expect.arrayContaining([
            expect.objectContaining({
              kind: ConsultAgreementKind.SENSITIVE_DATA_CONSENT,
              currentAcceptance: null,
              latestRevocation: expect.objectContaining({
                acceptanceId: consent.id,
                reason: 'Client withdrew consent.',
              }),
            }),
          ]),
        }),
      }),
    )

    const eventsBeforeReplay = await db.consultAuditEvent.count({
      where: { consultSessionId: sessionId },
    })
    const revokeReplay = await postRevoke(consent.id)
    expect(revokeReplay.status).toBe(409)
    await expect(json(revokeReplay)).resolves.toMatchObject({
      code: 'CONSULT_ACCEPTANCE_ALREADY_REVOKED',
    })
    await expect(
      db.consultAuditEvent.count({ where: { consultSessionId: sessionId } }),
    ).resolves.toBe(eventsBeforeReplay)

    await expect(
      appendConsultRevision({
        consultSessionId: sessionId,
        kind: ConsultRevisionKind.ANALYSIS,
        payload: { forbidden: 'after-revocation' },
        schemaVersion: 1,
        actor: { type: ConsultActorType.CLIENT, id: ownerUserId },
      }),
    ).rejects.toMatchObject({ code: 'INVALID_STATE' })

    const reconsent = await postAccept(
      ConsultAgreementKind.SENSITIVE_DATA_CONSENT,
      consentVersionId,
    )
    expect(reconsent.status).toBe(200)
    await expect(json(reconsent)).resolves.toEqual(
      expect.objectContaining({
        replayed: false,
        agreementState: expect.objectContaining({
          status: ConsultSessionStatus.INTAKE_READY,
          requirements: expect.arrayContaining([
            expect.objectContaining({
              kind: ConsultAgreementKind.SENSITIVE_DATA_CONSENT,
              currentAcceptance: expect.objectContaining({
                agreementVersionId: consentVersionId,
              }),
              latestRevocation: expect.objectContaining({
                acceptanceId: consent.id,
              }),
            }),
          ]),
        }),
      }),
    )

    const evidence = await db.consultAgreementAcceptance.findMany({
      where: {
        consultSessionId: sessionId,
        kind: ConsultAgreementKind.SENSITIVE_DATA_CONSENT,
      },
      orderBy: { acceptedAt: 'asc' },
    })
    expect(evidence).toHaveLength(2)
    expect(evidence.filter((row) => row.revokedAt === null)).toHaveLength(1)
    expect(evidence[0]?.revokedAt).toBeInstanceOf(Date)

    const actionCounts = await db.consultAuditEvent.groupBy({
      by: ['action'],
      where: { consultSessionId: sessionId },
      _count: { _all: true },
    })
    expect(actionCounts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: ConsultAuditAction.AGREEMENT_ACCEPTED,
          _count: { _all: 3 },
        }),
        expect.objectContaining({
          action: ConsultAuditAction.AGREEMENT_REVOKED,
          _count: { _all: 1 },
        }),
        expect.objectContaining({
          action: ConsultAuditAction.LIFECYCLE_TRANSITIONED,
          _count: { _all: 4 },
        }),
      ]),
    )
  })

  it('keeps database immutability/RLS enforcement and reports invalid lifecycle state', async () => {
    const revoked = await db.consultAgreementAcceptance.findFirstOrThrow({
      where: { consultSessionId: sessionId, revokedAt: { not: null } },
    })
    await expect(
      db.consultAgreementAcceptance.update({
        where: { id: revoked.id },
        data: {
          revokedAt: null,
          revokedByType: null,
          revokedById: null,
          revocationReason: null,
        },
      }),
    ).rejects.toThrow()

    const rls = await db.$queryRaw<
      Array<{ relname: string; relrowsecurity: boolean }>
    >`
      SELECT relname, relrowsecurity
      FROM pg_class
      WHERE relname IN (
        'ConsultAgreementVersion',
        'ConsultAgreementAcceptance',
        'ConsultAuditEvent'
      )
      ORDER BY relname
    `
    expect(rls).toHaveLength(3)
    expect(rls.every((row) => row.relrowsecurity)).toBe(true)

    await transitionConsultSession({
      consultSessionId: sessionId,
      fromStatus: ConsultSessionStatus.INTAKE_READY,
      toStatus: ConsultSessionStatus.CANCELLED,
      actor: { type: ConsultActorType.CLIENT, id: ownerUserId },
    })
    const invalid = await postAccept(
      ConsultAgreementKind.SENSITIVE_DATA_CONSENT,
      consentVersionId,
    )
    expect(invalid.status).toBe(409)
    await expect(json(invalid)).resolves.toMatchObject({
      code: 'CONSULT_INVALID_STATE',
    })
  })
})
