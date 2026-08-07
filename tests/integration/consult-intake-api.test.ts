import {
  BoardType,
  BookingStatus,
  ConsultActorType,
  ConsultAgreementKind,
  ConsultAuditAction,
  ConsultRevisionKind,
  ConsultSessionStatus,
  LookPostStatus,
  MediaType,
  ModerationStatus,
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

import {
  GET as getIntake,
  POST as postIntake,
} from '@/app/api/v1/client/consult/[id]/intake/route'
import {
  HAIR_COLOR_INTAKE_PACK_VERSION,
  HAIR_COLOR_INTAKE_SCHEMA_VERSION,
} from '@/lib/consult/intakePack'
import {
  acceptConsultAgreement,
  revokeConsultAgreement,
  transitionConsultSession,
} from '@/lib/consult/writeBoundary'

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) {
  throw new Error('Missing DATABASE_URL. Run with: pnpm test:integration')
}

const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } })
const tag = `consult_intake_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
const versionBase = 900_000 + Math.floor(Math.random() * 50_000)
const futureBookingDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)

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
let historyBookingId = ''
let sessionId = ''
let consentVersionId = ''
let adultVersionId = ''
let replacementConsentVersionId = ''
let boardId = ''
let mediaId = ''
let lookId = ''

const partialAnswers = { current_color: 'brunette' }
const completeAnswers = {
  current_color: 'brunette',
  desired_color: 'red',
  change_scale: 'noticeable',
  box_dye_history: 'over-12-months',
  prior_lightening: '6-12-months',
  last_color_service_timing: '1-3-months',
  prior_reaction: 'no',
  event_timing: '2-4-weeks',
  budget: '150-250',
}

function context(id = sessionId) {
  return { params: { id } }
}

async function json(response: Response): Promise<Record<string, unknown>> {
  const body: unknown = await response.json()
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new Error('Expected JSON object response.')
  }
  return { ...body }
}

function intakeRequest(
  idempotencyKey: string,
  answers: Record<string, string>,
  complete: boolean,
  versions: { packVersion?: number; schemaVersion?: number } = {},
) {
  return new Request(`http://test/api/v1/client/consult/${sessionId}/intake`, {
    method: 'POST',
    body: JSON.stringify({
      idempotencyKey,
      packVersion:
        versions.packVersion ?? HAIR_COLOR_INTAKE_PACK_VERSION,
      schemaVersion:
        versions.schemaVersion ?? HAIR_COLOR_INTAKE_SCHEMA_VERSION,
      complete,
      answers,
    }),
  })
}

async function accept(kind: ConsultAgreementKind, agreementVersionId: string) {
  return acceptConsultAgreement({
    consultSessionId: sessionId,
    agreementVersionId,
    expectedKind: kind,
    actor: { type: ConsultActorType.CLIENT, id: ownerUserId },
  })
}

beforeAll(async () => {
  process.env.ENABLE_AI_CONSULT = '1'
  const tenant = await db.tenant.create({
    data: { slug: `${tag}-tenant`, name: 'Consult intake', isActive: true },
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

  const [owner, other, professional] = await Promise.all([
    db.clientProfile.create({
      data: {
        userId: ownerUserId,
        firstName: 'Owner',
        lastName: 'Client',
        homeTenantId: tenantId,
        selfProfile: { hair_color: 'brunette' },
      },
      select: { id: true },
    }),
    db.clientProfile.create({
      data: {
        userId: otherUserId,
        firstName: 'Other',
        lastName: 'Client',
        homeTenantId: tenantId,
        selfProfile: { hair_color: 'blonde' },
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
  ownerClientId = owner.id
  otherClientId = other.id
  professionalId = professional.id

  const [location, category] = await Promise.all([
    db.professionalLocation.create({
      data: {
        professionalId,
        type: ProfessionalLocationType.SALON,
        name: 'Consult intake studio',
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
      scheduledFor: futureBookingDate,
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
  if (boardId) await db.board.deleteMany({ where: { id: boardId } })
  if (lookId) await db.lookPost.deleteMany({ where: { id: lookId } })
  if (mediaId) await db.mediaAsset.deleteMany({ where: { id: mediaId } })
  const agreementIds = [
    consentVersionId,
    adultVersionId,
    replacementConsentVersionId,
  ].filter(Boolean)
  if (agreementIds.length > 0) {
    await db.consultAgreementVersion.deleteMany({
      where: { id: { in: agreementIds } },
    })
  }
  const bookingIds = [bookingId, historyBookingId].filter(Boolean)
  if (bookingIds.length > 0) {
    await db.booking.deleteMany({ where: { id: { in: bookingIds } } })
  }
  if (locationId) {
    await db.professionalLocation.deleteMany({ where: { id: locationId } })
  }
  if (serviceId) await db.service.deleteMany({ where: { id: serviceId } })
  if (categoryId) {
    await db.serviceCategory.deleteMany({ where: { id: categoryId } })
  }
  if (ownerClientId || otherClientId) {
    await db.clientProfile.deleteMany({
      where: { id: { in: [ownerClientId, otherClientId].filter(Boolean) } },
    })
  }
  if (professionalId) {
    await db.professionalProfile.deleteMany({ where: { id: professionalId } })
  }
  await db.user.deleteMany({
    where: { id: { in: [ownerUserId, otherUserId, proUserId].filter(Boolean) } },
  })
  if (tenantId) await db.tenant.deleteMany({ where: { id: tenantId } })
  delete process.env.ENABLE_AI_CONSULT
  await db.$disconnect()
})

describe('client hair-color consult intake API against PostgreSQL', () => {
  it('keeps missing, ownership, founder, and category failures non-leaking', async () => {
    const missing = await getIntake(
      new Request('http://test/api/v1/client/consult/missing/intake'),
      context('missing'),
    )

    mockRequireClient.mockResolvedValue({
      ok: true,
      clientId: otherClientId,
      user: { id: otherUserId },
    })
    const foreign = await getIntake(
      new Request(`http://test/api/v1/client/consult/${sessionId}/intake`),
      context(),
    )
    const foreignRequest = intakeRequest(
      'foreign-owner',
      partialAnswers,
      false,
    )
    const foreignJsonSpy = vi.spyOn(foreignRequest, 'json')
    const foreignWrite = await postIntake(foreignRequest, context())
    expect(foreignJsonSpy).not.toHaveBeenCalled()

    delete process.env.ENABLE_AI_CONSULT
    mockRequireClient.mockResolvedValue({
      ok: true,
      clientId: ownerClientId,
      user: { id: ownerUserId },
    })
    const founderGated = await getIntake(
      new Request(`http://test/api/v1/client/consult/${sessionId}/intake`),
      context(),
    )

    process.env.ENABLE_AI_CONSULT = '1'
    await db.serviceCategory.update({
      where: { id: categoryId },
      data: { slug: 'brows' },
    })
    const wrongCategory = await getIntake(
      new Request(`http://test/api/v1/client/consult/${sessionId}/intake`),
      context(),
    )
    await db.serviceCategory.update({
      where: { id: categoryId },
      data: { slug: 'hair-color' },
    })

    for (const response of [
      missing,
      foreign,
      foreignWrite,
      founderGated,
      wrongCategory,
    ]) {
      expect(response.status).toBe(404)
      await expect(json(response)).resolves.toEqual({
        ok: false,
        error: 'Not found.',
        code: 'CONSULT_NOT_FOUND',
      })
    }
  })

  it('fails closed before published/current prerequisites and does not parse answers', async () => {
    const getUnavailable = await getIntake(
      new Request(`http://test/api/v1/client/consult/${sessionId}/intake`),
      context(),
    )
    expect(getUnavailable.status).toBe(503)
    await expect(json(getUnavailable)).resolves.toMatchObject({
      code: 'CONSULT_AGREEMENTS_UNAVAILABLE',
    })

    const guardedRequest = intakeRequest('before-consent', partialAnswers, false)
    const jsonSpy = vi.spyOn(guardedRequest, 'json')
    const postUnavailable = await postIntake(guardedRequest, context())
    expect(postUnavailable.status).toBe(503)
    expect(jsonSpy).not.toHaveBeenCalled()

    const [consent, adult] = await Promise.all([
      db.consultAgreementVersion.create({
        data: {
          kind: ConsultAgreementKind.SENSITIVE_DATA_CONSENT,
          version: versionBase,
          title: 'Test-only intake consent',
          body: 'Explicit intake consent fixture.',
        },
        select: { id: true },
      }),
      db.consultAgreementVersion.create({
        data: {
          kind: ConsultAgreementKind.ADULT_18_PLUS_ATTESTATION,
          version: versionBase,
          title: 'Test-only intake 18+ attestation',
          body: 'Explicit intake adult-attestation fixture.',
        },
        select: { id: true },
      }),
    ])
    consentVersionId = consent.id
    adultVersionId = adult.id

    const noAcceptance = await getIntake(
      new Request(`http://test/api/v1/client/consult/${sessionId}/intake`),
      context(),
    )
    expect(noAcceptance.status).toBe(409)
    await expect(json(noAcceptance)).resolves.toMatchObject({
      code: 'CONSULT_PREREQUISITES_REQUIRED',
    })

    await accept(ConsultAgreementKind.SENSITIVE_DATA_CONSENT, consentVersionId)
    const oneAcceptance = await getIntake(
      new Request(`http://test/api/v1/client/consult/${sessionId}/intake`),
      context(),
    )
    expect(oneAcceptance.status).toBe(409)
    await accept(ConsultAgreementKind.ADULT_18_PLUS_ATTESTATION, adultVersionId)
  })

  it('returns the exact pack and bounded owned prefill without mutating sources', async () => {
    const board = await db.board.create({
      data: {
        clientId: ownerClientId,
        name: `${tag} board`,
        slug: `${tag}-board`,
        type: BoardType.COLOR_TRANSFORMATION,
        answers: {
          current_color: 'brunette',
          dream_color: 'red',
          change_scale: 'noticeable',
        },
      },
      select: { id: true },
    })
    boardId = board.id

    const media = await db.mediaAsset.create({
      data: {
        professionalId,
        proTenantId: tenantId,
        primaryServiceId: serviceId,
        mediaType: MediaType.IMAGE,
        storageBucket: 'media-public',
        storagePath: `${tag}/saved-look.jpg`,
      },
      select: { id: true },
    })
    mediaId = media.id
    const look = await db.lookPost.create({
      data: {
        professionalId,
        primaryMediaAssetId: mediaId,
        serviceId,
        status: LookPostStatus.PUBLISHED,
        moderationStatus: ModerationStatus.APPROVED,
        publishedAt: new Date(),
        tags: {
          connectOrCreate: {
            where: { slug: `${tag}copper` },
            create: { slug: `${tag}copper`, display: 'copper' },
          },
        },
      },
      select: { id: true },
    })
    lookId = look.id
    // Use the approved color slug itself; connect it after the unique fixture
    // tag so cleanup never needs to own a shared LookTag row.
    await db.lookPost.update({
      where: { id: lookId },
      data: {
        tags: {
          connectOrCreate: {
            where: { slug: 'copper' },
            create: { slug: 'copper', display: 'copper' },
          },
        },
      },
    })
    await db.boardItem.create({ data: { boardId, lookPostId: lookId } })

    const vectorText = `[1,${Array.from({ length: 1023 }, () => '0').join(',')}]`
    await db.$executeRaw`
      INSERT INTO "ClientTasteVector"
        ("clientProfileId", "embedding", "model", "signalCount")
      VALUES (${ownerClientId}, ${vectorText}::vector, 'test-only', 3)
    `
    await db.$executeRaw`
      INSERT INTO "LookPostEmbedding"
        ("lookPostId", "embedding", "model", "mediaAssetId")
      VALUES (${lookId}, ${vectorText}::vector, 'test-only', ${mediaId})
    `

    const historyBooking = await db.booking.create({
      data: {
        clientId: ownerClientId,
        professionalId,
        serviceId,
        proTenantId: tenantId,
        clientHomeTenantId: tenantId,
        scheduledFor: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000),
        status: BookingStatus.COMPLETED,
        locationType: ServiceLocationType.SALON,
        locationId,
        locationTimeZone: 'America/Los_Angeles',
        subtotalSnapshot: new Prisma.Decimal('100.00'),
        totalAmount: new Prisma.Decimal('100.00'),
        totalDurationMinutes: 60,
      },
      select: { id: true },
    })
    historyBookingId = historyBooking.id

    const before = await Promise.all([
      db.clientProfile.findUniqueOrThrow({ where: { id: ownerClientId } }),
      db.board.findUniqueOrThrow({ where: { id: boardId } }),
      db.boardItem.findMany({ where: { boardId } }),
      db.booking.findUniqueOrThrow({ where: { id: historyBookingId } }),
      db.$queryRaw`
        SELECT "clientProfileId", "embedding"::text, "model", "signalCount",
          "computedAt", "createdAt"
        FROM "ClientTasteVector"
        WHERE "clientProfileId" = ${ownerClientId}
      `,
      db.$queryRaw`
        SELECT "lookPostId", "embedding"::text, "model", "mediaAssetId", "updatedAt"
        FROM "LookPostEmbedding"
        WHERE "lookPostId" = ${lookId}
      `,
    ])
    const response = await getIntake(
      new Request(`http://test/api/v1/client/consult/${sessionId}/intake`),
      context(),
    )
    expect(response.status).toBe(200)
    const body = await json(response)
    expect(body).toMatchObject({
      ok: true,
      intake: {
        consultId: sessionId,
        status: ConsultSessionStatus.INTAKE_READY,
        questionPack: {
          id: 'hair-color',
          categorySlug: 'hair-color',
          version: HAIR_COLOR_INTAKE_PACK_VERSION,
          schemaVersion: HAIR_COLOR_INTAKE_SCHEMA_VERSION,
        },
        latestRevision: null,
        prefillSuggestions: expect.arrayContaining([
          expect.objectContaining({
            questionKey: 'current_color',
            value: 'brunette',
          }),
          expect.objectContaining({
            questionKey: 'desired_color',
            value: 'red',
            provenance: expect.arrayContaining([
              { source: 'SAVED_LOOK', sourceId: lookId },
              { source: 'TASTE_VECTOR', sourceId: null },
            ]),
          }),
          expect.objectContaining({
            questionKey: 'last_color_service_timing',
            value: '1-3-months',
          }),
        ]),
        prefillSignals: expect.arrayContaining([
          { source: 'SELF_PROFILE', available: true },
          { source: 'BOARD', available: true },
          { source: 'SAVED_LOOK', available: true },
          { source: 'TASTE_VECTOR', available: true },
          { source: 'BOOKING_HISTORY', available: true },
        ]),
      },
    })
    const serialized = JSON.stringify(body)
    expect(serialized).not.toContain(vectorText)
    expect(serialized).not.toContain(otherClientId)

    const after = await Promise.all([
      db.clientProfile.findUniqueOrThrow({ where: { id: ownerClientId } }),
      db.board.findUniqueOrThrow({ where: { id: boardId } }),
      db.boardItem.findMany({ where: { boardId } }),
      db.booking.findUniqueOrThrow({ where: { id: historyBookingId } }),
      db.$queryRaw`
        SELECT "clientProfileId", "embedding"::text, "model", "signalCount",
          "computedAt", "createdAt"
        FROM "ClientTasteVector"
        WHERE "clientProfileId" = ${ownerClientId}
      `,
      db.$queryRaw`
        SELECT "lookPostId", "embedding"::text, "model", "mediaAssetId", "updatedAt"
        FROM "LookPostEmbedding"
        WHERE "lookPostId" = ${lookId}
      `,
    ])
    expect(after).toEqual(before)
  })

  it('rejects malformed answers and stale versions without writing', async () => {
    const before = await db.consultRevision.count({
      where: { consultSessionId: sessionId },
    })
    const cases = [
      [
        new Request(`http://test/api/v1/client/consult/${sessionId}/intake`, {
          method: 'POST',
          body: JSON.stringify({}),
        }),
        400,
        'CONSULT_INVALID_REQUEST',
      ],
      [
        intakeRequest('bad-option', { current_color: 'purple' }, false),
        400,
        'CONSULT_INVALID_ANSWERS',
      ],
      [
        intakeRequest('missing-required', partialAnswers, true),
        400,
        'CONSULT_INVALID_ANSWERS',
      ],
      [
        intakeRequest('stale-pack', partialAnswers, false, { packVersion: 0 }),
        409,
        'CONSULT_PACK_VERSION_MISMATCH',
      ],
      [
        intakeRequest('stale-schema', partialAnswers, false, { schemaVersion: 0 }),
        409,
        'CONSULT_SCHEMA_VERSION_MISMATCH',
      ],
    ] as const
    for (const [request, status, code] of cases) {
      const response = await postIntake(request, context())
      expect(response.status).toBe(status)
      await expect(json(response)).resolves.toMatchObject({ code })
    }
    await expect(
      db.consultRevision.count({ where: { consultSessionId: sessionId } }),
    ).resolves.toBe(before)
  })

  it('makes concurrent partial retries effect-idempotent and starts intake once', async () => {
    const responses = await Promise.all(
      Array.from({ length: 8 }, () =>
        postIntake(intakeRequest('partial-retry', partialAnswers, false), context()),
      ),
    )
    expect(responses.every((response) => response.status === 200)).toBe(true)
    const bodies = await Promise.all(responses.map(json))
    expect(bodies.filter((body) => body.replayed === false)).toHaveLength(1)
    expect(bodies.filter((body) => body.replayed === true)).toHaveLength(7)

    const session = await db.consultSession.findUniqueOrThrow({
      where: { id: sessionId },
    })
    expect(session).toMatchObject({
      status: ConsultSessionStatus.INTAKE_IN_PROGRESS,
      revisionSequence: 1,
    })
    await expect(
      db.consultRevision.count({ where: { consultSessionId: sessionId } }),
    ).resolves.toBe(1)
    await expect(
      db.consultAuditEvent.count({
        where: {
          consultSessionId: sessionId,
          action: ConsultAuditAction.REVISION_CREATED,
        },
      }),
    ).resolves.toBe(1)
    await expect(
      db.consultAuditEvent.count({
        where: {
          consultSessionId: sessionId,
          action: ConsultAuditAction.LIFECYCLE_TRANSITIONED,
          fromStatus: ConsultSessionStatus.INTAKE_READY,
          toStatus: ConsultSessionStatus.INTAKE_IN_PROGRESS,
        },
      }),
    ).resolves.toBe(1)

    const conflict = await postIntake(
      intakeRequest('partial-retry', { current_color: 'blonde' }, false),
      context(),
    )
    expect(conflict.status).toBe(409)
    await expect(json(conflict)).resolves.toMatchObject({
      code: 'CONSULT_IDEMPOTENCY_CONFLICT',
    })
  })

  it('completes atomically and appends immutable concurrent corrections', async () => {
    const completed = await postIntake(
      intakeRequest('complete-pack', completeAnswers, true),
      context(),
    )
    expect(completed.status).toBe(200)
    await expect(json(completed)).resolves.toMatchObject({
      replayed: false,
      intake: {
        status: ConsultSessionStatus.MEDIA_READY,
        latestRevision: {
          revision: 2,
          complete: true,
          answers: completeAnswers,
        },
      },
    })

    const correctedAnswers = { ...completeAnswers, budget: '251-400' }
    const corrections = await Promise.all(
      Array.from({ length: 6 }, () =>
        postIntake(
          intakeRequest('correction-retry', correctedAnswers, true),
          context(),
        ),
      ),
    )
    const correctionBodies = await Promise.all(corrections.map(json))
    expect(correctionBodies.filter((body) => body.replayed === false)).toHaveLength(1)
    expect(correctionBodies.filter((body) => body.replayed === true)).toHaveLength(5)

    const revisions = await db.consultRevision.findMany({
      where: { consultSessionId: sessionId },
      orderBy: { revision: 'asc' },
    })
    expect(revisions.map((revision) => revision.revision)).toEqual([1, 2, 3])
    expect(revisions[0]?.payload).toMatchObject({ answers: partialAnswers })
    expect(revisions[1]?.payload).toMatchObject({ answers: completeAnswers })
    expect(revisions[2]?.payload).toMatchObject({ answers: correctedAnswers })
    await expect(
      db.consultSession.findUniqueOrThrow({ where: { id: sessionId } }),
    ).resolves.toMatchObject({
      status: ConsultSessionStatus.MEDIA_READY,
      revisionSequence: 3,
    })
    await expect(
      db.consultAuditEvent.count({
        where: {
          consultSessionId: sessionId,
          action: ConsultAuditAction.REVISION_CREATED,
        },
      }),
    ).resolves.toBe(3)
    expect(
      await db.consultAuditEvent.count({
        where: {
          consultSessionId: sessionId,
          action: ConsultAuditAction.LIFECYCLE_TRANSITIONED,
          fromStatus: ConsultSessionStatus.INTAKE_IN_PROGRESS,
          toStatus: ConsultSessionStatus.MEDIA_READY,
        },
      }),
    ).toBe(1)

    await expect(
      db.consultRevision.update({
        where: { id: revisions[0]?.id },
        data: { payload: { rewritten: true } },
      }),
    ).rejects.toThrow()
  })

  it('blocks sensitive reads/writes immediately on revocation and resumes only after re-consent', async () => {
    const consent = await db.consultAgreementAcceptance.findFirstOrThrow({
      where: {
        consultSessionId: sessionId,
        kind: ConsultAgreementKind.SENSITIVE_DATA_CONSENT,
        revokedAt: null,
      },
    })
    await revokeConsultAgreement({
      consultSessionId: sessionId,
      acceptanceId: consent.id,
      reason: 'Client withdrew intake consent.',
      actor: { type: ConsultActorType.CLIENT, id: ownerUserId },
    })

    const blockedGet = await getIntake(
      new Request(`http://test/api/v1/client/consult/${sessionId}/intake`),
      context(),
    )
    expect(blockedGet.status).toBe(409)
    await expect(json(blockedGet)).resolves.toMatchObject({
      code: 'CONSULT_PREREQUISITES_REQUIRED',
    })

    const blockedRequest = intakeRequest('blocked-after-revoke', completeAnswers, true)
    const jsonSpy = vi.spyOn(blockedRequest, 'json')
    const blockedPost = await postIntake(blockedRequest, context())
    expect(blockedPost.status).toBe(409)
    expect(jsonSpy).not.toHaveBeenCalled()
    await expect(
      db.consultRevision.count({ where: { consultSessionId: sessionId } }),
    ).resolves.toBe(3)

    await accept(ConsultAgreementKind.SENSITIVE_DATA_CONSENT, consentVersionId)
    const resumed = await getIntake(
      new Request(`http://test/api/v1/client/consult/${sessionId}/intake`),
      context(),
    )
    expect(resumed.status).toBe(200)
    await expect(json(resumed)).resolves.toMatchObject({
      intake: {
        status: ConsultSessionStatus.INTAKE_READY,
        latestRevision: { revision: 3, complete: true },
      },
    })
  })

  it('requires acceptances pinned to newly published current versions', async () => {
    const replacement = await db.consultAgreementVersion.create({
      data: {
        kind: ConsultAgreementKind.SENSITIVE_DATA_CONSENT,
        version: versionBase + 1,
        title: 'Test-only replacement consent',
        body: 'Explicit replacement consent fixture.',
      },
      select: { id: true },
    })
    replacementConsentVersionId = replacement.id

    const stale = await getIntake(
      new Request(`http://test/api/v1/client/consult/${sessionId}/intake`),
      context(),
    )
    expect(stale.status).toBe(409)
    await expect(json(stale)).resolves.toMatchObject({
      code: 'CONSULT_PREREQUISITES_REQUIRED',
    })

    const beforeDirect = await db.consultSession.findUniqueOrThrow({
      where: { id: sessionId },
    })
    await db.consultSession.update({
      where: { id: sessionId },
      data: { revisionSequence: { increment: 1 } },
    })
    await expect(
      db.consultRevision.create({
        data: {
          consultSessionId: sessionId,
          revision: beforeDirect.revisionSequence + 1,
          kind: ConsultRevisionKind.INTAKE,
          payload: {
            packId: 'hair-color',
            packVersion: 1,
            schemaVersion: 1,
            complete: true,
            answers: completeAnswers,
          },
          schemaVersion: 1,
          idempotencyKey: 'direct-stale-agreement',
          requestHash: 'a'.repeat(64),
        },
      }),
    ).rejects.toThrow()
    await db.consultSession.update({
      where: { id: sessionId },
      data: { revisionSequence: beforeDirect.revisionSequence },
    })

    const activeOld = await db.consultAgreementAcceptance.findFirstOrThrow({
      where: {
        consultSessionId: sessionId,
        kind: ConsultAgreementKind.SENSITIVE_DATA_CONSENT,
        revokedAt: null,
      },
    })
    await revokeConsultAgreement({
      consultSessionId: sessionId,
      acceptanceId: activeOld.id,
      reason: 'Replacing stale consent evidence.',
      actor: { type: ConsultActorType.CLIENT, id: ownerUserId },
    })
    await accept(
      ConsultAgreementKind.SENSITIVE_DATA_CONSENT,
      replacementConsentVersionId,
    )
    const current = await getIntake(
      new Request(`http://test/api/v1/client/consult/${sessionId}/intake`),
      context(),
    )
    expect(current.status).toBe(200)

    const resumedWrite = await postIntake(
      intakeRequest('after-reconsent', completeAnswers, true),
      context(),
    )
    expect(resumedWrite.status).toBe(200)
    await expect(json(resumedWrite)).resolves.toMatchObject({
      intake: {
        status: ConsultSessionStatus.MEDIA_READY,
        latestRevision: { revision: 4 },
      },
    })
  })

  it('returns stable booking-ineligible errors before parsing answer data', async () => {
    await db.booking.update({
      where: { id: bookingId },
      data: { status: BookingStatus.COMPLETED },
    })
    const getResponse = await getIntake(
      new Request(`http://test/api/v1/client/consult/${sessionId}/intake`),
      context(),
    )
    expect(getResponse.status).toBe(409)
    await expect(json(getResponse)).resolves.toMatchObject({
      code: 'CONSULT_BOOKING_INELIGIBLE',
    })

    const request = intakeRequest('booking-ineligible', completeAnswers, true)
    const jsonSpy = vi.spyOn(request, 'json')
    const postResponse = await postIntake(request, context())
    expect(postResponse.status).toBe(409)
    expect(jsonSpy).not.toHaveBeenCalled()

    const beforeDirect = await db.consultSession.findUniqueOrThrow({
      where: { id: sessionId },
    })
    await db.consultSession.update({
      where: { id: sessionId },
      data: { revisionSequence: { increment: 1 } },
    })
    await expect(
      db.consultRevision.create({
        data: {
          consultSessionId: sessionId,
          revision: beforeDirect.revisionSequence + 1,
          kind: ConsultRevisionKind.INTAKE,
          payload: {
            packId: 'hair-color',
            packVersion: 1,
            schemaVersion: 1,
            complete: true,
            answers: completeAnswers,
          },
          schemaVersion: 1,
          idempotencyKey: 'direct-booking-ineligible',
          requestHash: 'b'.repeat(64),
        },
      }),
    ).rejects.toThrow()
    await db.consultSession.update({
      where: { id: sessionId },
      data: { revisionSequence: beforeDirect.revisionSequence },
    })
    await db.booking.update({
      where: { id: bookingId },
      data: { status: BookingStatus.ACCEPTED },
    })
  })

  it('enforces intake payloads, sequencing, current agreements, eligibility, and RLS in the database', async () => {
    const session = await db.consultSession.findUniqueOrThrow({
      where: { id: sessionId },
    })
    await db.consultSession.update({
      where: { id: sessionId },
      data: { revisionSequence: { increment: 1 } },
    })
    const directRevision = session.revisionSequence + 1
    await expect(
      db.consultRevision.create({
        data: {
          consultSessionId: sessionId,
          revision: directRevision,
          kind: ConsultRevisionKind.INTAKE,
          payload: {
            packId: 'hair-color',
            packVersion: 1,
            schemaVersion: 1,
            complete: false,
            answers: { current_color: 'invalid' },
          },
          schemaVersion: 1,
          idempotencyKey: 'direct-malformed-answers',
          requestHash: 'c'.repeat(64),
        },
      }),
    ).rejects.toThrow()
    await expect(
      db.consultRevision.create({
        data: {
          consultSessionId: sessionId,
          revision: directRevision,
          kind: ConsultRevisionKind.INTAKE,
          payload: {
            packId: 'hair-color',
            packVersion: 1,
            schemaVersion: 1,
            complete: false,
            answers: { current_color: null },
          },
          schemaVersion: 1,
          idempotencyKey: 'direct-wrong-answer-type',
          requestHash: 'd'.repeat(64),
        },
      }),
    ).rejects.toThrow()
    await expect(
      db.consultRevision.create({
        data: {
          consultSessionId: sessionId,
          revision: directRevision,
          kind: ConsultRevisionKind.INTAKE,
          payload: {
            packId: 'hair-color',
            packVersion: 1,
            schemaVersion: 1,
            complete: false,
          },
          schemaVersion: 1,
          idempotencyKey: 'direct-missing-answers',
          requestHash: 'f'.repeat(64),
        },
      }),
    ).rejects.toThrow()
    await db.consultSession.update({
      where: { id: sessionId },
      data: { revisionSequence: session.revisionSequence },
    })

    const rls = await db.$queryRaw<
      Array<{ relname: string; relrowsecurity: boolean }>
    >`
      SELECT relname, relrowsecurity
      FROM pg_class
      WHERE relname IN ('ConsultRevision', 'ConsultSession', 'ConsultAuditEvent')
      ORDER BY relname
    `
    expect(rls).toHaveLength(3)
    expect(rls.every((row) => row.relrowsecurity)).toBe(true)
  })

  it('rejects intake reads and writes outside the intake lifecycle states', async () => {
    await transitionConsultSession({
      consultSessionId: sessionId,
      fromStatus: ConsultSessionStatus.MEDIA_READY,
      toStatus: ConsultSessionStatus.CANCELLED,
      actor: { type: ConsultActorType.CLIENT, id: ownerUserId },
    })

    const getResponse = await getIntake(
      new Request(`http://test/api/v1/client/consult/${sessionId}/intake`),
      context(),
    )
    expect(getResponse.status).toBe(409)
    await expect(json(getResponse)).resolves.toMatchObject({
      code: 'CONSULT_INVALID_STATE',
    })

    const request = intakeRequest('later-lifecycle', completeAnswers, true)
    const jsonSpy = vi.spyOn(request, 'json')
    const postResponse = await postIntake(request, context())
    expect(postResponse.status).toBe(409)
    expect(jsonSpy).not.toHaveBeenCalled()

    const session = await db.consultSession.findUniqueOrThrow({
      where: { id: sessionId },
    })
    await db.consultSession.update({
      where: { id: sessionId },
      data: { revisionSequence: { increment: 1 } },
    })
    await expect(
      db.consultRevision.create({
        data: {
          consultSessionId: sessionId,
          revision: session.revisionSequence + 1,
          kind: ConsultRevisionKind.INTAKE,
          payload: {
            packId: 'hair-color',
            packVersion: 1,
            schemaVersion: 1,
            complete: true,
            answers: completeAnswers,
          },
          schemaVersion: 1,
          idempotencyKey: 'direct-later-lifecycle',
          requestHash: 'e'.repeat(64),
        },
      }),
    ).rejects.toThrow()
    await db.consultSession.update({
      where: { id: sessionId },
      data: { revisionSequence: session.revisionSequence },
    })
  })
})
