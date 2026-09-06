// P5c — the guided inspiration as a per-family CONTRACT, driven end to end
// against real PostgreSQL.
//
// The database is the point of running this for real. The whole slice rests on
// `consult_inspiration_payload_guard` accepting a payload shape it has never
// seen (keys and enums, no question list pinned) while still enforcing the old
// one for consults mid-flow, and on `consult_current_inspiration_complete` —
// the predicate the BOOKING gate asks — reading either. Neither can be proven
// against a mock.
//
// Four things are asserted here that nothing else can assert:
//   1. a HAIR-family category that is not colour, and a NAILS category, each
//      write their OWN pack through the live guard;
//   2. a consult that already holds a contract-v1 review keeps being served
//      v1 — questions, schema version and all — and can still answer;
//   3. the booking gate says "complete" for both contracts;
//   4. the guard still refuses free text, and still refuses a v1 payload that
//      would have failed before P5c.

import {
  BookingStatus,
  ConsultActorType,
  ConsultAgreementKind,
  ConsultAuditAction,
  ConsultInspirationSource,
  ConsultInspirationStatus,
  ConsultRevisionKind,
  ConsultServiceFamily,
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

import { POST as postIntake } from '@/app/api/v1/client/consult/[id]/intake/route'
import { CONSULT_INSPIRATION_BUCKET } from '@/lib/consult/inspirationStorage'
import {
  answerConsultInspirationQuestion,
  loadConsultInspirationState,
  skipConsultInspiration,
} from '@/lib/consult/inspirationContract'
import { GENERAL_SERVICE_INSPIRATION_CARD_PACK as GENERAL_SERVICE_INSPIRATION_PACK } from '@/lib/consult/inspiration/packs/generalService'
import { HAIR_GENERAL_INSPIRATION_CARD_PACK as HAIR_GENERAL_INSPIRATION_PACK } from '@/lib/consult/inspiration/packs/hairGeneral'
import { GENERAL_SERVICE_INTAKE_PACK } from '@/lib/consult/intake/packs/generalService'
import { HAIR_GENERAL_INTAKE_PACK } from '@/lib/consult/intake/packs/hairGeneral'
import { acceptConsultAgreement } from '@/lib/consult/writeBoundary'

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) {
  throw new Error('Missing DATABASE_URL. Run with: pnpm test:integration')
}

const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } })
const tag = `consult_p5c_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
const versionBase = 760_000 + Math.floor(Math.random() * 20_000)
const hairBookingDate = new Date(Date.now() + 21 * 24 * 60 * 60 * 1000)
// One pro cannot hold two overlapping bookings (an EXCLUDE constraint).
const nailsBookingDate = new Date(Date.now() + 23 * 24 * 60 * 60 * 1000)
const legacyBookingDate = new Date(Date.now() + 25 * 24 * 60 * 60 * 1000)

let tenantId = ''
let userId = ''
let clientId = ''
let proUserId = ''
let professionalId = ''
let locationId = ''
let hairCategoryId = ''
let nailsCategoryId = ''
let hairServiceId = ''
let nailsServiceId = ''
const bookingIds: string[] = []
let hairSessionId = ''
let nailsSessionId = ''
let legacySessionId = ''
let consentVersionId = ''
let adultVersionId = ''

const completeHairIntake = {
  change_scale: 'noticeable',
  chemical_history: 'never',
  prior_lightening: 'over-12-months',
  prior_reaction: 'no',
}
const completeNailsIntake = {
  change_scale: 'noticeable',
  goal_direction: 'color-tone',
  recent_treatment_timing: 'over-12-months',
  skin_sensitivity: 'no',
  known_allergies: 'none-known',
  prior_reaction: 'no',
}

function context(id: string) {
  return { params: Promise.resolve({ id }) }
}

async function completeIntake(
  sessionId: string,
  pack: { version: number; schemaVersion: number },
  answers: Record<string, string>,
) {
  const response = await postIntake(
    new Request(`http://test/api/v1/client/consult/${sessionId}/intake`, {
      method: 'POST',
      body: JSON.stringify({
        idempotencyKey: `${sessionId}-intake`,
        packVersion: pack.version,
        schemaVersion: pack.schemaVersion,
        complete: true,
        answers,
      }),
    }),
    context(sessionId),
  )
  if (response.status !== 200) {
    throw new Error(`intake failed: ${response.status} ${await response.text()}`)
  }
}

async function acceptBoth(sessionId: string) {
  for (const [kind, agreementVersionId] of [
    [ConsultAgreementKind.SENSITIVE_DATA_CONSENT, consentVersionId],
    [ConsultAgreementKind.ADULT_18_PLUS_ATTESTATION, adultVersionId],
  ] as const) {
    await acceptConsultAgreement({
      consultSessionId: sessionId,
      agreementVersionId,
      expectedKind: kind,
      actor: { type: ConsultActorType.CLIENT, id: userId },
    })
  }
}

async function createSession(bookingId: string, serviceCategoryId: string) {
  const session = await db.consultSession.create({
    data: {
      clientId,
      bookingId,
      professionalId,
      serviceCategoryId,
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
  return session.id
}

async function createBooking(serviceId: string, scheduledFor: Date) {
  const booking = await db.booking.create({
    data: {
      clientId,
      professionalId,
      serviceId,
      proTenantId: tenantId,
      clientHomeTenantId: tenantId,
      scheduledFor,
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
  bookingIds.push(booking.id)
  return booking.id
}

/** An ATTACHED upload for a session, so the guided questions have a subject. */
async function attachReference(sessionId: string) {
  const inspiration = await db.consultInspiration.create({
    data: {
      consultSessionId: sessionId,
      source: ConsultInspirationSource.EXTERNAL_UPLOAD,
      status: ConsultInspirationStatus.ATTACHED,
      storageBucket: CONSULT_INSPIRATION_BUCKET,
      // `ConsultInspiration_shape` pins the object path, both expiries and
      // their order, so the row is built the way the upload path builds it.
      storagePath: `consult-inspiration/v1/${crypto.randomUUID()}.jpg`,
      contentType: 'image/jpeg',
      sizeBytes: 1024,
      sourceIdempotencyKey: `${sessionId}-source`,
      sourceRequestHash: 'a'.repeat(64),
      attachIdempotencyKey: `${sessionId}-attach`,
      attachRequestHash: 'b'.repeat(64),
      uploadExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
      useExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    },
    select: { id: true },
  })
  return inspiration.id
}

/** The predicate the BOOKING gate asks (`consult_lifecycle_guard`). */
async function bookingGateSaysComplete(sessionId: string): Promise<boolean> {
  const rows = await db.$queryRaw<Array<{ complete: boolean }>>`
    SELECT public."consult_current_inspiration_complete"(${sessionId}) AS complete
  `
  return rows[0]!.complete
}

/** A revision written straight at the table, so the LIVE guard is the judge. */
async function writeRevisionDirectly(
  sessionId: string,
  schemaVersion: number,
  payload: Prisma.InputJsonObject,
) {
  const session = await db.consultSession.update({
    where: { id: sessionId },
    data: { revisionSequence: { increment: 1 } },
    select: { revisionSequence: true },
  })
  return db.consultRevision.create({
    data: {
      consultSessionId: sessionId,
      revision: session.revisionSequence,
      kind: ConsultRevisionKind.INSPIRATION,
      schemaVersion,
      payload,
      idempotencyKey: `direct-${sessionId}-${session.revisionSequence}`,
      requestHash: 'c'.repeat(64),
      // `ConsultRevision_inspiration_requires_audit` is a deferred constraint
      // trigger: an INSPIRATION revision without content-free audit evidence
      // fails at COMMIT, not at INSERT.
      auditEvents: {
        create: {
          consultSessionId: sessionId,
          action: ConsultAuditAction.REVISION_CREATED,
          actorType: ConsultActorType.CLIENT,
          actorId: userId,
        },
      },
    },
    select: { id: true },
  })
}

beforeAll(async () => {
  process.env.ENABLE_AI_CONSULT = '1'

  const tenant = await db.tenant.create({
    data: { slug: `${tag}-tenant`, name: 'P5c inspiration contract', isActive: true },
    select: { id: true },
  })
  tenantId = tenant.id

  const [user, proUser] = await Promise.all([
    db.user.create({
      data: { email: `${tag}_client@example.com`, password: 'x', role: Role.CLIENT },
      select: { id: true },
    }),
    db.user.create({
      data: { email: `${tag}_pro@example.com`, password: 'x', role: Role.PRO },
      select: { id: true },
    }),
  ])
  userId = user.id
  proUserId = proUser.id

  const [client, professional] = await Promise.all([
    db.clientProfile.create({
      data: {
        userId,
        firstName: 'Contract',
        lastName: 'Two',
        homeTenantId: tenantId,
      },
      select: { id: true },
    }),
    db.professionalProfile.create({
      data: {
        userId: proUserId,
        homeTenantId: tenantId,
        firstName: 'Any',
        lastName: 'Service',
        timeZone: 'America/Los_Angeles',
      },
      select: { id: true },
    }),
  ])
  clientId = client.id
  professionalId = professional.id

  const location = await db.professionalLocation.create({
    data: {
      professionalId,
      type: ProfessionalLocationType.SALON,
      name: 'P5c studio',
      timeZone: 'America/Los_Angeles',
      workingHours: {},
    },
    select: { id: true },
  })
  locationId = location.id

  const [hairCategory, nailsCategory] = await Promise.all([
    db.serviceCategory.create({
      data: {
        name: `${tag} extensions`,
        slug: `${tag}-extensions`,
        consultFamily: ConsultServiceFamily.HAIR,
      },
      select: { id: true },
    }),
    db.serviceCategory.create({
      data: {
        name: `${tag} nails`,
        slug: `${tag}-nails`,
        consultFamily: ConsultServiceFamily.NAILS,
      },
      select: { id: true },
    }),
  ])
  hairCategoryId = hairCategory.id
  nailsCategoryId = nailsCategory.id

  const [hairService, nailsService] = await Promise.all([
    db.service.create({
      data: {
        name: `${tag} tape-in install`,
        categoryId: hairCategoryId,
        defaultDurationMinutes: 120,
        minPrice: new Prisma.Decimal('300.00'),
      },
      select: { id: true },
    }),
    db.service.create({
      data: {
        name: `${tag} gel manicure`,
        categoryId: nailsCategoryId,
        defaultDurationMinutes: 60,
        minPrice: new Prisma.Decimal('60.00'),
      },
      select: { id: true },
    }),
  ])
  hairServiceId = hairService.id
  nailsServiceId = nailsService.id

  const [consent, adult] = await Promise.all([
    db.consultAgreementVersion.create({
      data: {
        kind: ConsultAgreementKind.SENSITIVE_DATA_CONSENT,
        version: versionBase,
        title: 'Test-only P5c consent',
        body: 'Explicit consent fixture.',
      },
      select: { id: true },
    }),
    db.consultAgreementVersion.create({
      data: {
        kind: ConsultAgreementKind.ADULT_18_PLUS_ATTESTATION,
        version: versionBase,
        title: 'Test-only P5c 18+ attestation',
        body: 'Explicit adult-attestation fixture.',
      },
      select: { id: true },
    }),
  ])
  consentVersionId = consent.id
  adultVersionId = adult.id

  mockRequireClient.mockResolvedValue({ ok: true, clientId, user: { id: userId } })

  hairSessionId = await createSession(
    await createBooking(hairServiceId, hairBookingDate),
    hairCategoryId,
  )
  nailsSessionId = await createSession(
    await createBooking(nailsServiceId, nailsBookingDate),
    nailsCategoryId,
  )
  legacySessionId = await createSession(
    await createBooking(hairServiceId, legacyBookingDate),
    hairCategoryId,
  )
  for (const sessionId of [hairSessionId, nailsSessionId, legacySessionId]) {
    await acceptBoth(sessionId)
  }
  // MEDIA_READY is the inspiration step's mutable window, and the only honest
  // way in is the intake the client actually completes.
  await completeIntake(hairSessionId, HAIR_GENERAL_INTAKE_PACK, completeHairIntake)
  await completeIntake(nailsSessionId, GENERAL_SERVICE_INTAKE_PACK, completeNailsIntake)
  await completeIntake(legacySessionId, HAIR_GENERAL_INTAKE_PACK, completeHairIntake)
})

beforeEach(() => {
  process.env.ENABLE_AI_CONSULT = '1'
  delete process.env.AI_CONSULT_SERVICE_SCOPE
  mockRequireClient.mockResolvedValue({ ok: true, clientId, user: { id: userId } })
})

afterAll(async () => {
  // `consult_session_delete_requires_purge` refuses to drop a session whose
  // raw inspiration objects are still live. The fixtures never put bytes in a
  // bucket, so the honest teardown is to record the purge the way the purge
  // job would (the shape constraint requires the storage pointers to go with
  // it) rather than to disable the guard.
  await db.consultInspiration.updateMany({
    where: {
      consultSessionId: {
        in: [hairSessionId, nailsSessionId, legacySessionId].filter(Boolean),
      },
      purgedAt: null,
    },
    data: {
      storageBucket: null,
      storagePath: null,
      purgeEligibleAt: new Date(),
      purgeRequestedAt: new Date(),
      purgedAt: new Date(),
    },
  })
  await db.consultSession.deleteMany({
    where: {
      id: { in: [hairSessionId, nailsSessionId, legacySessionId].filter(Boolean) },
    },
  })
  await db.consultAgreementVersion.deleteMany({
    where: { id: { in: [consentVersionId, adultVersionId].filter(Boolean) } },
  })
  await db.booking.deleteMany({ where: { id: { in: bookingIds } } })
  if (locationId) {
    await db.professionalLocation.deleteMany({ where: { id: locationId } })
  }
  await db.service.deleteMany({
    where: { id: { in: [hairServiceId, nailsServiceId].filter(Boolean) } },
  })
  await db.serviceCategory.deleteMany({
    where: { id: { in: [hairCategoryId, nailsCategoryId].filter(Boolean) } },
  })
  if (clientId) await db.clientProfile.deleteMany({ where: { id: clientId } })
  if (professionalId) {
    await db.professionalProfile.deleteMany({ where: { id: professionalId } })
  }
  await db.user.deleteMany({
    where: { id: { in: [userId, proUserId].filter(Boolean) } },
  })
  if (tenantId) await db.tenant.deleteMany({ where: { id: tenantId } })
  delete process.env.ENABLE_AI_CONSULT
  await db.$disconnect()
})

describe('the guided inspiration is per-family now', () => {
  it('serves a NAILS consult its own pack, and writes it through the live guard', async () => {
    const state = await loadConsultInspirationState({
      consultSessionId: nailsSessionId,
      clientId,
      actorUserId: userId,
    })
    expect(state.schemaVersion).toBe(GENERAL_SERVICE_INSPIRATION_PACK.schemaVersion)
    // 🔴 Not one colour question. Before P5c this consult was asked "which
    // color or colors in this picture are your favorite?" about a manicure.
    expect(state.progress.blocker).toBe('SOURCE_DECISION_REQUIRED')
    expect(state.progress.requiredSpecificDetailCount).toBe(0)

    const inspirationId = await attachReference(nailsSessionId)
    const pack = GENERAL_SERVICE_INSPIRATION_PACK
    const answers: Record<string, string[]> = {}
    for (const question of pack.questions) {
      const asked = await loadConsultInspirationState({
        consultSessionId: nailsSessionId,
        clientId,
        actorUserId: userId,
      })
      expect(asked.progress.currentQuestion?.key).toBe(question.key)
      // The first option of every card, which is never a neutral value — so
      // the payload carries real details through the live guard.
      const selectedValues = [question.options[0]!.value]
      answers[question.key] = selectedValues
      await answerConsultInspirationQuestion({
        consultSessionId: nailsSessionId,
        clientId,
        actor: { type: ConsultActorType.CLIENT, id: userId },
        input: {
          idempotencyKey: `nails-${question.key}`,
          schemaVersion: pack.schemaVersion,
          questionKey: question.key,
          selectedValues,
        },
      })
    }

    const stored = await db.consultRevision.findFirst({
      where: { consultSessionId: nailsSessionId, kind: ConsultRevisionKind.INSPIRATION },
      orderBy: { revision: 'desc' },
      select: { schemaVersion: true, payload: true },
    })
    expect(stored).toMatchObject({
      schemaVersion: pack.schemaVersion,
      payload: {
        packId: pack.id,
        packVersion: pack.version,
        schemaVersion: pack.schemaVersion,
        source: 'EXTERNAL_UPLOAD',
        inspirationId,
        complete: true,
        answers,
      },
    })
    // Keys and enums ONLY: no derived arrays, no sentences, no free text.
    expect(Object.keys(stored!.payload as object).sort()).toEqual([
      'answers',
      'catalogGuidance',
      'complete',
      'inspirationId',
      'packId',
      'packVersion',
      'schemaVersion',
      'source',
    ])
    await expect(bookingGateSaysComplete(nailsSessionId)).resolves.toBe(true)
  })

  it('serves a non-colour HAIR consult the hair pack, and records a skip', async () => {
    const state = await loadConsultInspirationState({
      consultSessionId: hairSessionId,
      clientId,
      actorUserId: userId,
    })
    expect(state.schemaVersion).toBe(HAIR_GENERAL_INSPIRATION_PACK.schemaVersion)

    const skipped = await skipConsultInspiration({
      consultSessionId: hairSessionId,
      clientId,
      actor: { type: ConsultActorType.CLIENT, id: userId },
      input: { idempotencyKey: 'hair-skip', schemaVersion: state.schemaVersion },
    })
    expect(skipped.state.progress.canComplete).toBe(true)

    const stored = await db.consultRevision.findFirst({
      where: { consultSessionId: hairSessionId, kind: ConsultRevisionKind.INSPIRATION },
      orderBy: { revision: 'desc' },
      select: { schemaVersion: true, payload: true },
    })
    expect(stored).toMatchObject({
      schemaVersion: 2,
      payload: {
        packId: HAIR_GENERAL_INSPIRATION_PACK.id,
        source: 'NONE',
        inspirationId: null,
        complete: true,
        answers: {},
        catalogGuidance: [],
      },
    })
    await expect(bookingGateSaysComplete(hairSessionId)).resolves.toBe(true)
  })

  it('🔴 keeps a consult that already holds a contract-v1 review ON v1', async () => {
    const inspirationId = await attachReference(legacySessionId)
    // The row a still-deployed server would have written during the
    // migrate-to-deploy window. The LIVE guard accepts it — that is the arm
    // this migration keeps.
    await writeRevisionDirectly(legacySessionId, 1, {
      contractId: 'hair-color-guided-inspiration',
      contractVersion: 1,
      schemaVersion: 1,
      source: 'EXTERNAL_UPLOAD',
      inspirationId,
      complete: false,
      answers: [
        {
          questionKey: 'favorite_colors',
          selectedValues: ['warm-golden'],
          text: null,
          sentiment: null,
        },
      ],
      exactClientDetails: [
        {
          questionKey: 'favorite_colors',
          value: 'warm-golden',
          clientWords: 'The warm or golden colors',
          sentiment: 'LIKE',
        },
      ],
      possibleProfessionalInterpretation: [
        {
          clientDetailValue: 'warm-golden',
          possibleMeaning:
            'May point to a preference for warmer or golden-looking hair color.',
          confidence: 'POSSIBLE',
          evidence: 'CLIENT_SELECTION',
        },
      ],
      catalogGuidance: [],
    })

    const state = await loadConsultInspirationState({
      consultSessionId: legacySessionId,
      clientId,
      actorUserId: userId,
    })
    // Still v1: the version she echoes, the gate she is held to, and the next
    // question all come from the contract she started on.
    expect(state.schemaVersion).toBe(1)
    expect(state.progress.requiredSpecificDetailCount).toBe(3)
    expect(state.progress.currentQuestion?.key).toBe('avoid_colors')
    expect(state.latestReview?.packId ?? null).toBeNull()

    // And she can still answer it — under v1's rules, at v1's schema version.
    await answerConsultInspirationQuestion({
      consultSessionId: legacySessionId,
      clientId,
      actor: { type: ConsultActorType.CLIENT, id: userId },
      input: {
        idempotencyKey: 'legacy-avoid',
        schemaVersion: 1,
        questionKey: 'avoid_colors',
        selectedValues: ['none'],
      },
    })
    const stored = await db.consultRevision.findFirst({
      where: { consultSessionId: legacySessionId, kind: ConsultRevisionKind.INSPIRATION },
      orderBy: { revision: 'desc' },
      select: { schemaVersion: true, payload: true },
    })
    expect(stored?.schemaVersion).toBe(1)
    expect(stored?.payload).toMatchObject({
      contractId: 'hair-color-guided-inspiration',
      contractVersion: 1,
    })

    // A client echoing the CURRENT pack's version at a v1 consult is refused
    // rather than silently switched.
    await expect(
      answerConsultInspirationQuestion({
        consultSessionId: legacySessionId,
        clientId,
        actor: { type: ConsultActorType.CLIENT, id: userId },
        input: {
          idempotencyKey: 'legacy-wrong-version',
          schemaVersion: 2,
          questionKey: 'length_goal',
          selectedValues: ['longer'],
        },
      }),
    ).rejects.toMatchObject({ code: 'INSPIRATION_SCHEMA_VERSION_MISMATCH' })
  })

  it('🔴 the live guard still refuses free text, and still refuses a v1 payload that failed before', async () => {
    // v2: a sentence where an enum belongs.
    await expect(
      writeRevisionDirectly(hairSessionId, 2, {
        packId: HAIR_GENERAL_INSPIRATION_PACK.id,
        packVersion: HAIR_GENERAL_INSPIRATION_PACK.version,
        schemaVersion: 2,
        source: 'NONE',
        inspirationId: null,
        complete: true,
        answers: { favorite_details: ['I like the soft bend near the ends'] },
        catalogGuidance: [],
      }),
    ).rejects.toThrow()

    // v2: a value carrying a word about the person in the photograph. This is
    // the trap `assertConsultInspirationPackWritable` exists to catch — a
    // hyphen is a word boundary, so `face-framing` matches `\mface\M`.
    await expect(
      writeRevisionDirectly(hairSessionId, 2, {
        packId: HAIR_GENERAL_INSPIRATION_PACK.id,
        packVersion: HAIR_GENERAL_INSPIRATION_PACK.version,
        schemaVersion: 2,
        source: 'NONE',
        inspirationId: null,
        complete: true,
        answers: { favorite_details: ['face-framing'] },
        catalogGuidance: [],
      }),
    ).rejects.toThrow()

    // v1: complete with only two specific details. The v1 arm is unchanged, so
    // this must still be refused even though v2 has no such gate.
    await expect(
      writeRevisionDirectly(hairSessionId, 1, {
        contractId: 'hair-color-guided-inspiration',
        contractVersion: 1,
        schemaVersion: 1,
        source: 'NONE',
        inspirationId: null,
        complete: false,
        answers: [],
        exactClientDetails: [],
        possibleProfessionalInterpretation: [],
        catalogGuidance: [],
      }),
    ).rejects.toThrow()
  })
})
