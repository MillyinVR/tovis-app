// The service-aware consult, slice 1, driven end to end against PostgreSQL:
// a HAIR-family category that is not colour serves the hair pack, a NAILS
// category serves the general pack, each writes under its own pack id, the
// database guard accepts those writes and refuses a colour answer on them,
// prefill comes from the session's OWN category — and under the default
// (colour-only) scope none of it is reachable.

import {
  BookingStatus,
  ConsultActorType,
  ConsultAgreementKind,
  ConsultAuditAction,
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

import { GET as getCapture } from '@/app/api/v1/client/consult/[id]/capture/route'
import {
  GET as getIntake,
  POST as postIntake,
} from '@/app/api/v1/client/consult/[id]/intake/route'
import { GENERAL_SERVICE_INTAKE_PACK } from '@/lib/consult/intake/packs/generalService'
import { HAIR_GENERAL_INTAKE_PACK } from '@/lib/consult/intake/packs/hairGeneral'
import { acceptConsultAgreement } from '@/lib/consult/writeBoundary'

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) {
  throw new Error('Missing DATABASE_URL. Run with: pnpm test:integration')
}

const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } })
const tag = `consult_sa_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
const versionBase = 700_000 + Math.floor(Math.random() * 50_000)
const futureBookingDate = new Date(Date.now() + 21 * 24 * 60 * 60 * 1000)
// The same pro cannot hold two overlapping bookings (an EXCLUDE constraint),
// so the nails appointment sits two days after the extensions one.
const futureNailsBookingDate = new Date(Date.now() + 23 * 24 * 60 * 60 * 1000)
const pastBookingDate = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000)

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
let hairBookingId = ''
let hairHistoryBookingId = ''
let nailsBookingId = ''
let hairSessionId = ''
let nailsSessionId = ''
let consentVersionId = ''
let adultVersionId = ''

// The P6 diet: the hair pack is down to what the photographs cannot answer.
const completeHair = {
  change_scale: 'noticeable',
  chemical_history: 'never',
  prior_lightening: 'over-12-months',
  prior_reaction: 'no',
}

const completeNails = {
  change_scale: 'subtle',
  goal_direction: 'shape',
  recent_treatment_timing: 'within-6-months',
  skin_sensitivity: 'no',
  known_allergies: 'none-known',
  prior_reaction: 'no',
}

/** The v1 general-service answers, still stored on pre-diet sessions. */
const completeNailsV1 = {
  ...completeNails,
  service_experience: 'regular',
  last_service_timing: 'within-4-weeks',
}

function context(id: string) {
  return { params: { id } }
}

async function json(response: Response): Promise<Record<string, unknown>> {
  const body: unknown = await response.json()
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new Error('Expected JSON object response.')
  }
  return { ...body }
}

function intakeUrl(sessionId: string) {
  return `http://test/api/v1/client/consult/${sessionId}/intake`
}

function submit(
  sessionId: string,
  pack: { version: number; schemaVersion: number },
  idempotencyKey: string,
  answers: Record<string, string>,
  complete: boolean,
) {
  return postIntake(
    new Request(intakeUrl(sessionId), {
      method: 'POST',
      body: JSON.stringify({
        idempotencyKey,
        packVersion: pack.version,
        schemaVersion: pack.schemaVersion,
        complete,
        answers,
      }),
    }),
    context(sessionId),
  )
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

async function createBooking(args: {
  serviceId: string
  scheduledFor: Date
  status: BookingStatus
}) {
  const booking = await db.booking.create({
    data: {
      clientId,
      professionalId,
      serviceId: args.serviceId,
      proTenantId: tenantId,
      clientHomeTenantId: tenantId,
      scheduledFor: args.scheduledFor,
      status: args.status,
      locationType: ServiceLocationType.SALON,
      locationId,
      locationTimeZone: 'America/Los_Angeles',
      subtotalSnapshot: new Prisma.Decimal('100.00'),
      totalAmount: new Prisma.Decimal('100.00'),
      totalDurationMinutes: 60,
    },
    select: { id: true },
  })
  return booking.id
}

beforeAll(async () => {
  process.env.ENABLE_AI_CONSULT = '1'

  const tenant = await db.tenant.create({
    data: { slug: `${tag}-tenant`, name: 'Service-aware consult', isActive: true },
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
        firstName: 'Service',
        lastName: 'Aware',
        homeTenantId: tenantId,
        // A colour signal that must NOT surface on a non-colour pack.
        selfProfile: { hair_color: 'brunette' },
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
      name: 'Service-aware studio',
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

  hairBookingId = await createBooking({
    serviceId: hairServiceId,
    scheduledFor: futureBookingDate,
    status: BookingStatus.ACCEPTED,
  })
  hairHistoryBookingId = await createBooking({
    serviceId: hairServiceId,
    scheduledFor: pastBookingDate,
    status: BookingStatus.COMPLETED,
  })
  nailsBookingId = await createBooking({
    serviceId: nailsServiceId,
    scheduledFor: futureNailsBookingDate,
    status: BookingStatus.ACCEPTED,
  })

  hairSessionId = await createSession(hairBookingId, hairCategoryId)
  nailsSessionId = await createSession(nailsBookingId, nailsCategoryId)

  const [consent, adult] = await Promise.all([
    db.consultAgreementVersion.create({
      data: {
        kind: ConsultAgreementKind.SENSITIVE_DATA_CONSENT,
        version: versionBase,
        title: 'Test-only service-aware consent',
        body: 'Explicit consent fixture.',
      },
      select: { id: true },
    }),
    db.consultAgreementVersion.create({
      data: {
        kind: ConsultAgreementKind.ADULT_18_PLUS_ATTESTATION,
        version: versionBase,
        title: 'Test-only service-aware 18+ attestation',
        body: 'Explicit adult-attestation fixture.',
      },
      select: { id: true },
    }),
  ])
  consentVersionId = consent.id
  adultVersionId = adult.id
  await acceptBoth(hairSessionId)
  await acceptBoth(nailsSessionId)
})

beforeEach(() => {
  process.env.ENABLE_AI_CONSULT = '1'
  delete process.env.AI_CONSULT_SERVICE_SCOPE
  mockRequireClient.mockResolvedValue({
    ok: true,
    clientId,
    user: { id: userId },
  })
})

afterAll(async () => {
  await db.consultSession.deleteMany({
    where: { id: { in: [hairSessionId, nailsSessionId].filter(Boolean) } },
  })
  await db.consultAgreementVersion.deleteMany({
    where: { id: { in: [consentVersionId, adultVersionId].filter(Boolean) } },
  })
  await db.booking.deleteMany({
    where: {
      id: {
        in: [hairBookingId, hairHistoryBookingId, nailsBookingId].filter(Boolean),
      },
    },
  })
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
  delete process.env.AI_CONSULT_SERVICE_SCOPE
  await db.$disconnect()
})

describe('service-aware consult intake against PostgreSQL', () => {
  it('serves the hair pack to a HAIR category that is not colour, with prefill from ITS category', async () => {
    const response = await getIntake(
      new Request(intakeUrl(hairSessionId)),
      context(hairSessionId),
    )
    expect(response.status).toBe(200)
    const { intake } = (await json(response)) as {
      intake: {
        questionPack: { id: string; version: number; schemaVersion: number; categorySlug: string }
        prefillSuggestions: Array<{ questionKey: string; value: string; provenance: Array<{ source: string; sourceId: string | null }> }>
        prefillSignals: Array<{ source: string; available: boolean }>
        progress: { nextQuestionKey: string | null }
      }
    }
    expect(intake.questionPack).toMatchObject({
      id: HAIR_GENERAL_INTAKE_PACK.id,
      version: HAIR_GENERAL_INTAKE_PACK.version,
      schemaVersion: HAIR_GENERAL_INTAKE_PACK.schemaVersion,
    })
    expect(intake.progress.nextQuestionKey).toBe('change_scale')

    // The client's colour self-profile is not a question here, so it is not
    // a suggestion — and the signal says so.
    expect(
      intake.prefillSuggestions.find((item) => item.questionKey === 'current_color'),
    ).toBeUndefined()
    expect(intake.prefillSignals).toContainEqual({ source: 'SELF_PROFILE', available: false })

    // P6: the diet moved "when was your last professional service?" onto the
    // post-booking follow-up, so the completed extensions booking 45 days ago
    // no longer has a question to land on. The signal must say so rather than
    // claim a prefill that is not on screen.
    expect(hairHistoryBookingId).not.toBe('')
    expect(
      intake.prefillSuggestions.find((item) => item.questionKey === 'last_service_timing'),
    ).toBeUndefined()
    expect(intake.prefillSignals).toContainEqual({
      source: 'BOOKING_HISTORY',
      available: false,
    })
  })

  it('refuses a colour answer on the hair pack and accepts the hair pack’s own', async () => {
    const colourAnswer = await submit(
      hairSessionId,
      HAIR_GENERAL_INTAKE_PACK,
      'hair-colour-answer',
      { current_color: 'brunette' },
      false,
    )
    expect(colourAnswer.status).toBe(400)
    await expect(json(colourAnswer)).resolves.toMatchObject({
      code: 'CONSULT_INVALID_ANSWERS',
    })

    // A question the diet removed is now an unknown key, exactly like a colour one.
    const dropped = await submit(
      hairSessionId,
      HAIR_GENERAL_INTAKE_PACK,
      'hair-dropped-answer',
      { hair_texture: 'wavy' },
      false,
    )
    expect(dropped.status).toBe(400)
    await expect(json(dropped)).resolves.toMatchObject({
      code: 'CONSULT_INVALID_ANSWERS',
    })

    const partial = await submit(
      hairSessionId,
      HAIR_GENERAL_INTAKE_PACK,
      'hair-partial',
      { chemical_history: 'never' },
      false,
    )
    expect(partial.status).toBe(200)
    await expect(json(partial)).resolves.toMatchObject({
      replayed: false,
      intake: {
        status: ConsultSessionStatus.INTAKE_IN_PROGRESS,
        latestRevision: {
          packId: HAIR_GENERAL_INTAKE_PACK.id,
          packVersion: HAIR_GENERAL_INTAKE_PACK.version,
          complete: false,
          answers: { chemical_history: 'never' },
        },
      },
    })

    const complete = await submit(
      hairSessionId,
      HAIR_GENERAL_INTAKE_PACK,
      'hair-complete',
      completeHair,
      true,
    )
    expect(complete.status).toBe(200)
    await expect(json(complete)).resolves.toMatchObject({
      intake: {
        status: ConsultSessionStatus.MEDIA_READY,
        progress: { canComplete: true, blocker: null },
        latestRevision: { packId: HAIR_GENERAL_INTAKE_PACK.id, complete: true },
      },
    })

    const stored = await db.consultRevision.findMany({
      where: { consultSessionId: hairSessionId, kind: ConsultRevisionKind.INTAKE },
      select: { payload: true, schemaVersion: true },
      orderBy: { revision: 'asc' },
    })
    expect(stored).toHaveLength(2)
    expect(stored[1]).toMatchObject({
      schemaVersion: HAIR_GENERAL_INTAKE_PACK.schemaVersion,
      payload: {
        packId: HAIR_GENERAL_INTAKE_PACK.id,
        packVersion: HAIR_GENERAL_INTAKE_PACK.version,
        complete: true,
        answers: completeHair,
      },
    })
  })

  it('serves the general pack to a NAILS category and completes it with the goal direction resolved', async () => {
    const response = await getIntake(
      new Request(intakeUrl(nailsSessionId)),
      context(nailsSessionId),
    )
    expect(response.status).toBe(200)
    await expect(json(response)).resolves.toMatchObject({
      intake: { questionPack: { id: GENERAL_SERVICE_INTAKE_PACK.id } },
    })

    const unresolved = await submit(
      nailsSessionId,
      GENERAL_SERVICE_INTAKE_PACK,
      'nails-unresolved',
      { ...completeNails, goal_direction: 'not-sure' },
      true,
    )
    expect(unresolved.status).toBe(409)
    await expect(json(unresolved)).resolves.toMatchObject({
      code: 'CONSULT_GOAL_DIRECTION_UNRESOLVED',
    })

    const complete = await submit(
      nailsSessionId,
      GENERAL_SERVICE_INTAKE_PACK,
      'nails-complete',
      completeNails,
      true,
    )
    expect(complete.status).toBe(200)
    await expect(json(complete)).resolves.toMatchObject({
      intake: {
        status: ConsultSessionStatus.MEDIA_READY,
        latestRevision: { packId: GENERAL_SERVICE_INTAKE_PACK.id, complete: true },
      },
    })
  })

  it('the database guard validates each pack’s own vocabulary and required set', async () => {
    const sequence = await db.consultSession.findUniqueOrThrow({
      where: { id: nailsSessionId },
      select: { revisionSequence: true },
    })
    const direct = (payload: Prisma.InputJsonObject) =>
      db.consultRevision.create({
        data: {
          consultSessionId: nailsSessionId,
          revision: sequence.revisionSequence + 1,
          kind: ConsultRevisionKind.INTAKE,
          schemaVersion: 2,
          payload,
        },
      })

    // A colour key is not in the general pack.
    await expect(
      direct({
        packId: GENERAL_SERVICE_INTAKE_PACK.id,
        packVersion: 1,
        schemaVersion: 2,
        complete: false,
        answers: { current_color: 'brunette' },
      }),
    ).rejects.toThrow(/invalid general-service intake answers/)

    // "Complete" without the required set.
    await expect(
      direct({
        packId: GENERAL_SERVICE_INTAKE_PACK.id,
        packVersion: 1,
        schemaVersion: 2,
        complete: true,
        answers: { service_experience: 'regular' },
      }),
    ).rejects.toThrow(/complete general-service intake is missing/)

    // A pack nobody registered.
    await expect(
      direct({
        packId: 'pack-from-nowhere',
        packVersion: 1,
        schemaVersion: 2,
        complete: false,
        answers: { service_experience: 'regular' },
      }),
    ).rejects.toThrow(/invalid consult intake payload version or shape/)

    // P6 — the guard learned v2 without forgetting v1. Each version validates
    // against ITS OWN key set, in both directions: a question the diet removed
    // is refused on v2, and it is still accepted on v1 (which is what keeps a
    // pre-diet session's stored payload readable).
    await expect(
      direct({
        packId: GENERAL_SERVICE_INTAKE_PACK.id,
        packVersion: 2,
        schemaVersion: 2,
        complete: false,
        answers: { service_experience: 'regular' },
      }),
    ).rejects.toThrow(/invalid general-service intake answers/)
    await expect(
      direct({
        packId: GENERAL_SERVICE_INTAKE_PACK.id,
        packVersion: 2,
        schemaVersion: 2,
        complete: true,
        answers: completeNailsV1,
      }),
    ).rejects.toThrow(/invalid general-service intake answers/)
    // v2 complete needs every v2 required answer, and refuses an unresolved
    // goal direction exactly as v1 does.
    await expect(
      direct({
        packId: GENERAL_SERVICE_INTAKE_PACK.id,
        packVersion: 2,
        schemaVersion: 2,
        complete: true,
        answers: { change_scale: 'total' },
      }),
    ).rejects.toThrow(/complete general-service intake is missing/)
    await expect(
      direct({
        packId: GENERAL_SERVICE_INTAKE_PACK.id,
        packVersion: 2,
        schemaVersion: 2,
        complete: true,
        answers: { ...completeNails, goal_direction: 'not-sure' },
      }),
    ).rejects.toThrow(/complete general-service intake is missing/)
    // A version nobody registered.
    await expect(
      direct({
        packId: GENERAL_SERVICE_INTAKE_PACK.id,
        packVersion: 3,
        schemaVersion: 2,
        complete: false,
        answers: completeNails,
      }),
    ).rejects.toThrow(/invalid general-service intake payload version or shape/)
  })

  // The load-bearing back-compat check. Sessions were mid-flight on v1 when
  // the diet shipped; the read path must serve them the pack they started on,
  // with their stored answers intact, rather than telling them they have no
  // intake and asking all eleven questions again.
  it('keeps a session that already answered on the pack version it started on', async () => {
    const session = await db.consultSession.findUniqueOrThrow({
      where: { id: nailsSessionId },
      select: { revisionSequence: true },
    })
    // A v1 payload written directly, standing in for the row the PREVIOUS
    // deploy's code wrote. The sequence is bumped first because
    // `consult_revision_sequence` requires the two to match.
    const nextRevision = session.revisionSequence + 1
    await db.consultSession.update({
      where: { id: nailsSessionId },
      data: { revisionSequence: nextRevision },
    })
    await db.consultRevision.create({
      data: {
        consultSessionId: nailsSessionId,
        revision: nextRevision,
        kind: ConsultRevisionKind.INTAKE,
        schemaVersion: 2,
        idempotencyKey: 'pre-diet-v1-row',
        requestHash: 'f'.repeat(64),
        payload: {
          packId: GENERAL_SERVICE_INTAKE_PACK.id,
          packVersion: 1,
          schemaVersion: 2,
          complete: true,
          answers: completeNailsV1,
        },
      },
    })

    const response = await getIntake(
      new Request(intakeUrl(nailsSessionId)),
      context(nailsSessionId),
    )
    expect(response.status).toBe(200)
    const { intake } = (await json(response)) as {
      intake: {
        questionPack: { id: string; version: number; questions: Array<{ key: string }> }
        progress: { canComplete: boolean }
        latestRevision: { packVersion: number; answers: Record<string, string> } | null
      }
    }
    expect(intake.questionPack).toMatchObject({
      id: GENERAL_SERVICE_INTAKE_PACK.id,
      version: 1,
    })
    expect(intake.questionPack.questions).toHaveLength(11)
    expect(intake.latestRevision).toMatchObject({
      packVersion: 1,
      answers: completeNailsV1,
    })
    expect(intake.progress.canComplete).toBe(true)

    // And a correction still WRITES on v1 — the pinned version, not the
    // current one, which is what a mid-flow client's next tap sends.
    const correction = await submit(
      nailsSessionId,
      { version: 1, schemaVersion: 2 },
      'nails-v1-correction',
      { ...completeNailsV1, skin_sensitivity: 'sometimes' },
      true,
    )
    expect(correction.status).toBe(200)
    await expect(json(correction)).resolves.toMatchObject({
      intake: {
        questionPack: { version: 1 },
        latestRevision: { packVersion: 1, complete: true },
      },
    })
    // Sending the CURRENT version on a pinned session is the stale-version
    // refusal, not a silent switch.
    const wrongVersion = await submit(
      nailsSessionId,
      GENERAL_SERVICE_INTAKE_PACK,
      'nails-v2-on-a-v1-session',
      completeNails,
      true,
    )
    expect(wrongVersion.status).toBe(409)
    await expect(json(wrongVersion)).resolves.toMatchObject({
      code: 'CONSULT_PACK_VERSION_MISMATCH',
    })
  })

  it('serves each family its own shot pack once the intake is complete', async () => {
    // Both sessions reached MEDIA_READY above.
    const hair = await getCapture(
      new Request(`http://test/api/v1/client/consult/${hairSessionId}/capture`),
      context(hairSessionId),
    )
    expect(hair.status).toBe(200)
    await expect(json(hair)).resolves.toMatchObject({
      capture: {
        shotPack: { id: 'hair-color-daylight', version: 2, schemaVersion: 1 },
      },
    })
    const hairBody = (await json(
      await getCapture(
        new Request(`http://test/api/v1/client/consult/${hairSessionId}/capture`),
        context(hairSessionId),
      ),
    )) as { capture: { slots: Array<{ shotKey: string; state: string }> } }
    expect(hairBody.capture.slots.map((slot) => slot.shotKey)).toEqual([
      'hair_back',
      'hair_left',
      'hair_right',
      'hair_crown',
      'face_front',
      'face_side',
      'eyes_closeup',
    ])

    const nails = (await json(
      await getCapture(
        new Request(`http://test/api/v1/client/consult/${nailsSessionId}/capture`),
        context(nailsSessionId),
      ),
    )) as {
      capture: {
        shotPack: { id: string; version: number; shots: Array<{ key: string; title: string }> }
        slots: Array<{ shotKey: string; state: string }>
      }
    }
    expect(nails.capture.shotPack).toMatchObject({ id: 'area-daylight', version: 1 })
    expect(nails.capture.shotPack.shots.map((shot) => shot.key)).toEqual([
      'area_wide',
      'area_closeup',
      'face_front',
    ])
    expect(nails.capture.slots).toEqual([
      expect.objectContaining({ shotKey: 'area_wide', state: 'EMPTY' }),
      expect.objectContaining({ shotKey: 'area_closeup', state: 'EMPTY' }),
      expect.objectContaining({ shotKey: 'face_front', state: 'EMPTY' }),
    ])
    // The wire pack carries no acceptance rules — those stay server-side.
    expect(JSON.stringify(nails.capture.shotPack)).not.toContain('Accept only')
  })

  it('goes dark, without leaking, when the kill switch narrows the scope to colour', async () => {
    process.env.AI_CONSULT_SERVICE_SCOPE = 'HAIR_COLOR_ONLY'
    const hidden = await getIntake(
      new Request(intakeUrl(hairSessionId)),
      context(hairSessionId),
    )
    expect(hidden.status).toBe(404)
  })
})
