// tests/integration/consult-capture-packs.test.ts
//
// The non-colour capture packs, driven end to end against PostgreSQL — the
// test debt the 2026-09-03 review named: nothing had run a face or area pack
// through upload → quality check → analysis write, and the pack-branched SQL
// guards in migrations 20261004 and 20261005 had been verified by reading.
//
// Four things a real database is the only place to prove:
//
//   * a NAILS category (area pack, three shots) and a SKIN category (face
//     pack, three shots) each reach ANALYSIS and COMPLETED through the same
//     routes the hair pack uses, with their own shot keys and pack versions —
//     the guard's key and version pins accept both;
//   * the analysis auto-advance counts THIS pack's slots. Before this test the
//     inspiration step's two callers fell back to the largest pack (seven), so
//     a three-shot consult whose inspiration finished LAST sat in MEDIA_READY
//     forever. The NAILS case here completes the captures first and the
//     inspiration last, on purpose;
//   * the analysis guard refuses a colour-only safety flag on a
//     general-service session ("analysis carries a safety flag the intake
//     cannot support") — and accepts the same session's honest write, so the
//     refusal is the guard telling, not the fixture failing;
//   * every analysis routes through the pro's narrowed menu, so a pro who can
//     only host mobile still analyses (the safety lookup reads her mobile
//     column — see consult-look-estimate for the estimate half).

import {
  BookingStatus,
  ConsultActorType,
  ConsultAgreementKind,
  ConsultAuditAction,
  ConsultCaptureStatus,
  ConsultRevisionKind,
  ConsultServiceFamily,
  ConsultSessionStatus,
  Prisma,
  PrismaClient,
  ProfessionalLocationType,
  Role,
  ServiceLocationType,
  VerificationStatus,
} from '@prisma/client'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ConsultCaptureQualityResult } from '@/lib/consult/captureVision'

vi.hoisted(() => {
  process.env.JWT_SECRET ||= 'integration-test-jwt-secret'
})

const mockRequireClient = vi.hoisted(() => vi.fn())
const fake = vi.hoisted(() => ({
  objects: new Map<
    string,
    { contentType: 'image/jpeg'; sizeBytes: number; checksumSha256: string | null }
  >(),
  pathSequence: 0,
  runPrefix: Math.floor(Math.random() * 0xffffffff)
    .toString(16)
    .padStart(8, '0'),
  modelCalls: [] as string[],
  /**
   * A quality verdict to return for one shot key instead of PASS. Typed as the
   * vision module's own result so a fixture can never name a reason code the
   * wire does not have, nor drift from the shape the contract is handed.
   */
  qualityByShot: new Map<string, ConsultCaptureQualityResult>(),
  analysisCalls: 0,
  /** The shot keys the engine was told it may cite, per call. */
  suppliedShotKeys: [] as string[][],
  capturePackIds: [] as string[],
}))

vi.mock('@/app/api/_utils/auth/requireClient', () => ({
  requireClient: mockRequireClient,
}))

vi.mock('@/lib/consult/captureStorage', () => {
  class FakeStorageError extends Error {
    constructor(readonly kind: 'unavailable' | 'missing' | 'invalid') {
      super('Private capture storage is unavailable.')
      this.name = 'ConsultCaptureStorageError'
    }
  }
  return {
    CONSULT_CAPTURE_BUCKET: 'media-private',
    CONSULT_CAPTURE_MAX_BYTES: 5_000_000,
    ConsultCaptureStorageError: FakeStorageError,
    consultCaptureObjectPath() {
      // Paths are unique per (bucket, path) in the database, so a run-local
      // prefix keeps this suite's rows from colliding with another suite's —
      // or with its own leftovers after an aborted run.
      fake.pathSequence += 1
      const tail = fake.pathSequence.toString(16).padStart(12, '0')
      return `consult-raw/v1/${fake.runPrefix}-0000-4000-8000-${tail}.jpg`
    },
    consultCaptureStorage: {
      assertReady: vi.fn().mockResolvedValue(undefined),
      async createSignedUpload() {
        return { token: 'signed-upload-secret', signedUrl: 'https://storage.test/upload' }
      },
      async createSignedRead(_path: string, expiresInSeconds: number) {
        return `https://storage.test/read/${expiresInSeconds}`
      },
      async inspectObject(args: {
        path: string
        expectedContentType: 'image/jpeg'
        maxBytes: number
        expectedChecksumSha256: string | null
      }) {
        const object = fake.objects.get(args.path)
        if (!object) throw new FakeStorageError('missing')
        return object
      },
      async readObject(args: { path: string; expectedContentType: 'image/jpeg' }) {
        const object = fake.objects.get(args.path)
        if (!object) throw new FakeStorageError('missing')
        return { base64: 'bm90LXJhdy1pbi1kYg==', mediaType: object.contentType }
      },
      async purgeObject(path: string) {
        fake.objects.delete(path)
      },
    },
  }
})

vi.mock('@/lib/consult/captureVision', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/consult/captureVision')>()
  return {
    ...original,
    async checkConsultCapture(input: { shotKey: string }) {
      fake.modelCalls.push(input.shotKey)
      return (
        fake.qualityByShot.get(input.shotKey) ?? {
          accepted: true,
          reasonCode: 'PASS',
          warningCode: null,
          retakeTip: null,
          model: 'fake-quality',
        }
      )
    },
  }
})

vi.mock('@/lib/consult/analysisEngine', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/consult/analysisEngine')>()
  return {
    ...original,
    async runConsultAnalysis(input: {
      capturePack: { id: string; shotKeys: string[] }
      captures: Array<{ shotKey: string }>
    }) {
      fake.analysisCalls += 1
      fake.capturePackIds.push(input.capturePack.id)
      fake.suppliedShotKeys.push(input.captures.map((capture) => capture.shotKey))
      // Every pack this suite drives carries the front face view, so it is the
      // one piece of evidence the engine may cite for either pack. Hair core
      // observations are UNKNOWN / null: hair is not the subject.
      const observed = (value: string, evidence: string[] = ['face_front']) => ({
        value,
        confidence:
          value === 'UNKNOWN' ? { min: 0, max: 0.25 } : { min: 0.4, max: 0.7 },
        evidence,
      })
      return {
        model: 'fake-analysis-model',
        analysis: {
          profile: {
            skinUndertone: observed('NEUTRAL'),
            contrastLevel: observed('MEDIUM'),
            colorSeason: observed('UNKNOWN', []),
            faceProportion: observed('BALANCED'),
            jawline: observed('SOFTLY_ROUNDED'),
            foreheadProportion: observed('BALANCED'),
            featureBalance: observed('SOFT'),
            eyeShape: observed('UNKNOWN', []),
            eyeSpacing: observed('UNKNOWN', []),
            browDensity: observed('UNKNOWN', []),
            browShape: observed('UNKNOWN', []),
          },
          styleDirections: [
            'HAIR_COLOR_HARMONY',
            'CUT_AND_SHAPE',
            'BANGS',
            'BROWS',
            'LASHES',
            'MAKEUP',
            'COLOR_PALETTE',
          ].map((domain) => ({
            domain,
            title: 'A soft, harmonizing direction',
            direction: 'Discuss a soft, blended direction for this domain together.',
            whyItFlatters: 'Low observed contrast favors blended choices.',
            confidence: { min: 0.4, max: 0.7 },
            evidence: ['face_front'],
            discussWithProfessional: true,
          })),
          core: {
            baseLevel: {
              value: 'UNKNOWN',
              confidence: { min: 0, max: 0.25 },
              evidence: [],
            },
            lightestLevel: {
              value: 'UNKNOWN',
              confidence: { min: 0, max: 0.25 },
              evidence: [],
            },
            currentTone: observed('UNKNOWN', []),
            visibleCondition: observed('UNKNOWN', []),
            density: observed('UNKNOWN', []),
            texture: observed('UNKNOWN', []),
          },
          serviceLens: {
            goal: 'A subtle shape direction grounded in the intake goal.',
            history: 'A treatment within six months is on record.',
            constraints: 'No known allergies were reported.',
            maintenance: 'Maintenance tolerance was not collected and is unknown.',
            appointmentContext: 'Appointment context uses the intake timing.',
            achievability: 'REQUIRES_PRO_ASSESSMENT',
            achievabilityReason: 'The professional should assess in person.',
            discussWithProfessional: true,
          },
          safetyFlags: [],
          recommendations: [
            {
              // The STORED shape the engine returns, not the provider's
              // `service` enum — see tests/integration/_support/consultLookFakes.ts.
              serviceIntent: 'CONSULTATION',
              serviceName: null,
              title: 'A consultation first',
              rationale: 'Review the direction and history together.',
              achievability: 'The professional should confirm the plan.',
              discussWithProfessional: true,
            },
          ],
        },
      }
    },
  }
})

import { POST as attachCapture } from '@/app/api/v1/client/consult/[id]/capture/attach/route'
import { POST as issueUpload } from '@/app/api/v1/client/consult/[id]/capture/uploads/route'
import { POST as checkQuality } from '@/app/api/v1/client/consult/[id]/capture/[captureId]/quality/route'
import { POST as startAnalysis } from '@/app/api/v1/client/consult/[id]/analysis/route'
import { processConsultAnalysisRuns } from '@/lib/consult/analysisRunner'
import {
  CONSULT_ANALYSIS_PROMPT_VERSION,
  CONSULT_ANALYSIS_SCHEMA_VERSION,
} from '@/lib/consult/analysisEngine'
import { AREA_CAPTURE_PACK } from '@/lib/consult/capture/packs/areaDaylight'
import { FACE_CAPTURE_PACK } from '@/lib/consult/capture/packs/faceDaylight'
import type { ConsultCapturePackDefinition } from '@/lib/consult/capture/types'
import { purgeConsultSessionRawObjects } from '@/lib/consult/capturePurge'
import { skipConsultInspiration } from '@/lib/consult/inspirationContract'
import {
  GENERAL_SERVICE_INTAKE_PACK_VERSION,
  GENERAL_SERVICE_INTAKE_SCHEMA_VERSION,
} from '@/lib/consult/intake/packs/generalService'
import {
  acceptConsultAgreement,
  appendConsultIntakeRevision,
  transitionLockedConsultSession,
} from '@/lib/consult/writeBoundary'

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error('Run with pnpm test:integration')

const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } })
const tag = `consult_packs_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
const versionBase = 3_000_000 + Math.floor(Math.random() * 100_000)
const future = new Date(Date.now() + 40 * 24 * 60 * 60 * 1000)

let tenantId = ''
let proUserId = ''
let professionalId = ''
let locationId = ''
let nailsCategoryId = ''
let skinCategoryId = ''
let nailsServiceId = ''
let skinServiceId = ''
let consentVersionId = ''
let adultVersionId = ''
const userIds: string[] = []
const clientIds: string[] = []
const bookingIds: string[] = []
const sessionIds: string[] = []
let bookingSequence = 0

type Consult = { userId: string; clientId: string; sessionId: string }

// A complete general-service intake that routes to NO safety test, so the
// menu needs no Patch Test row and the analysis is the thing under test.
const completeGeneral = {
  service_experience: 'regular',
  change_scale: 'subtle',
  goal_direction: 'shape',
  recent_treatment_timing: 'within-6-months',
  skin_sensitivity: 'no',
  known_allergies: 'none-known',
  prior_reaction: 'no',
  last_service_timing: 'within-4-weeks',
}

function context(id: string) {
  return { params: { id } }
}

function captureContext(id: string, captureId: string) {
  return { params: { id, captureId } }
}

async function body(response: Response): Promise<Record<string, unknown>> {
  const json: unknown = await response.json()
  if (!json || typeof json !== 'object' || Array.isArray(json)) {
    throw new Error('Expected a JSON object.')
  }
  return { ...json }
}

function jsonRequest(path: string, value: Record<string, unknown>) {
  return new Request(`http://test${path}`, {
    method: 'POST',
    body: JSON.stringify(value),
  })
}

function authenticate(consult: Consult) {
  mockRequireClient.mockResolvedValue({
    ok: true,
    clientId: consult.clientId,
    user: { id: consult.userId },
  })
}

async function createConsult(args: {
  label: string
  serviceCategoryId: string
  serviceId: string
  skipInspiration: boolean
  answers?: Record<string, string>
}): Promise<Consult> {
  const user = await db.user.create({
    data: { email: `${tag}_${args.label}@example.com`, password: 'x', role: Role.CLIENT },
    select: { id: true },
  })
  userIds.push(user.id)
  const client = await db.clientProfile.create({
    data: { userId: user.id, firstName: 'Pack', lastName: args.label, homeTenantId: tenantId },
    select: { id: true },
  })
  clientIds.push(client.id)
  bookingSequence += 1
  const booking = await db.booking.create({
    data: {
      clientId: client.id,
      professionalId,
      serviceId: args.serviceId,
      proTenantId: tenantId,
      clientHomeTenantId: tenantId,
      scheduledFor: new Date(future.getTime() + bookingSequence * 2 * 60 * 60 * 1000),
      status: BookingStatus.ACCEPTED,
      locationType: ServiceLocationType.MOBILE,
      locationId,
      locationTimeZone: 'America/Los_Angeles',
      subtotalSnapshot: new Prisma.Decimal('60.00'),
      totalAmount: new Prisma.Decimal('60.00'),
      totalDurationMinutes: 60,
    },
    select: { id: true },
  })
  bookingIds.push(booking.id)
  const session = await db.consultSession.create({
    data: {
      clientId: client.id,
      bookingId: booking.id,
      professionalId,
      serviceCategoryId: args.serviceCategoryId,
      auditEvents: {
        create: {
          action: ConsultAuditAction.SESSION_CREATED,
          actorType: ConsultActorType.CLIENT,
          actorId: user.id,
          toStatus: ConsultSessionStatus.CONSENT_REQUIRED,
        },
      },
    },
    select: { id: true },
  })
  sessionIds.push(session.id)
  const actor = { type: ConsultActorType.CLIENT, id: user.id } as const
  for (const [kind, agreementVersionId] of [
    [ConsultAgreementKind.SENSITIVE_DATA_CONSENT, consentVersionId],
    [ConsultAgreementKind.ADULT_18_PLUS_ATTESTATION, adultVersionId],
  ] as const) {
    await acceptConsultAgreement({
      consultSessionId: session.id,
      agreementVersionId,
      expectedKind: kind,
      actor,
    })
  }
  await appendConsultIntakeRevision({
    consultSessionId: session.id,
    actor,
    loadInput: async () => ({
      idempotencyKey: `intake-${args.label}`,
      packVersion: GENERAL_SERVICE_INTAKE_PACK_VERSION,
      schemaVersion: GENERAL_SERVICE_INTAKE_SCHEMA_VERSION,
      complete: true,
      answers: args.answers ?? completeGeneral,
    }),
  })
  const consult = { userId: user.id, clientId: client.id, sessionId: session.id }
  if (args.skipInspiration) await skipInspiration(consult, args.label)
  return consult
}

function skipInspiration(consult: Consult, label: string) {
  return skipConsultInspiration({
    consultSessionId: consult.sessionId,
    clientId: consult.clientId,
    actor: { type: ConsultActorType.CLIENT, id: consult.userId },
    input: { idempotencyKey: `skip-inspiration-${label}`, schemaVersion: 1 },
  })
}

/** Issue → put the bytes → attach, under THIS pack's versions. */
async function issueAttach(
  consult: Consult,
  pack: ConsultCapturePackDefinition,
  shotKey: string,
  label: string,
) {
  const versions = { shotPackVersion: pack.version, schemaVersion: pack.schemaVersion }
  const issued = await issueUpload(
    jsonRequest(`/api/v1/client/consult/${consult.sessionId}/capture/uploads`, {
      idempotencyKey: `${label}-issue-${shotKey}`,
      shotKey,
      ...versions,
      contentType: 'image/jpeg',
      sizeBytes: 100,
    }),
    context(consult.sessionId),
  )
  expect(issued.status).toBe(200)
  const upload = (await body(issued)).upload as { uploadSessionId: string }
  const row = await db.uploadSession.findUniqueOrThrow({
    where: { id: upload.uploadSessionId },
  })
  fake.objects.set(row.storagePath, {
    contentType: 'image/jpeg',
    sizeBytes: row.maxBytes,
    checksumSha256: row.checksumSha256,
  })
  const attached = await attachCapture(
    jsonRequest(`/api/v1/client/consult/${consult.sessionId}/capture/attach`, {
      idempotencyKey: `${label}-attach-${shotKey}`,
      uploadSessionId: upload.uploadSessionId,
      shotKey,
      ...versions,
    }),
    context(consult.sessionId),
  )
  expect(attached.status).toBe(200)
  return (await body(attached)).captureId as string
}

/** The quality check on an attached capture — the response, unasserted, so a
 *  rejection can be inspected as well as an acceptance. */
function checkShotQuality(
  consult: Consult,
  pack: ConsultCapturePackDefinition,
  captureId: string,
  label: string,
) {
  return checkQuality(
    jsonRequest(
      `/api/v1/client/consult/${consult.sessionId}/capture/${captureId}/quality`,
      {
        idempotencyKey: `${label}-quality-${captureId}`,
        shotPackVersion: pack.version,
        schemaVersion: pack.schemaVersion,
      },
    ),
    captureContext(consult.sessionId, captureId),
  )
}

/** Issue → put the bytes → attach → quality-check, expecting acceptance. */
async function acceptShot(
  consult: Consult,
  pack: ConsultCapturePackDefinition,
  shotKey: string,
  label: string,
) {
  const captureId = await issueAttach(consult, pack, shotKey, label)
  const quality = await checkShotQuality(consult, pack, captureId, label)
  expect(quality.status).toBe(200)
  return captureId
}

async function status(sessionId: string) {
  return (
    await db.consultSession.findUniqueOrThrow({
      where: { id: sessionId },
      select: { status: true },
    })
  ).status
}

/**
 * Start the analysis AND drain the run it queues.
 *
 * P4b split those into two steps: the request claims and returns, the worker
 * analyzes. These tests assert on the stored artefact, so they need both — the
 * production equivalent is the in-request kick plus the every-minute cron.
 */
async function runAnalysis(consult: Consult, label: string) {
  const started = await startAnalysis(
    jsonRequest(`/api/v1/client/consult/${consult.sessionId}/analysis`, {
      idempotencyKey: `${label}-analysis`,
      schemaVersion: CONSULT_ANALYSIS_SCHEMA_VERSION,
      promptVersion: CONSULT_ANALYSIS_PROMPT_VERSION,
    }),
    context(consult.sessionId),
  )
  if (started.status === 200) {
    await processConsultAnalysisRuns({ take: 1 })
  }
  return started
}

beforeAll(async () => {
  process.env.ENABLE_AI_CONSULT = '1'
  delete process.env.AI_CONSULT_SERVICE_SCOPE
  const tenant = await db.tenant.create({
    data: { slug: `${tag}-tenant`, name: 'Capture packs', isActive: true },
    select: { id: true },
  })
  tenantId = tenant.id
  const proUser = await db.user.create({
    data: { email: `${tag}_pro@example.com`, password: 'x', role: Role.PRO },
    select: { id: true },
  })
  proUserId = proUser.id
  const pro = await db.professionalProfile.create({
    data: {
      userId: proUser.id,
      homeTenantId: tenantId,
      firstName: 'Pack',
      lastName: 'Professional',
      timeZone: 'America/Los_Angeles',
      verificationStatus: VerificationStatus.APPROVED,
    },
    select: { id: true },
  })
  professionalId = pro.id
  // A pro who ONLY travels — the founder's real shape in prod. Her only
  // bookable location is a mobile base, so every menu read is narrowed to
  // mobile and the consult must still run end to end.
  const location = await db.professionalLocation.create({
    data: {
      professionalId,
      type: ProfessionalLocationType.MOBILE_BASE,
      name: 'Pack mobile base',
      timeZone: 'America/Los_Angeles',
      workingHours: {},
      isBookable: true,
    },
    select: { id: true },
  })
  locationId = location.id
  const [nails, skin] = await Promise.all([
    db.serviceCategory.create({
      data: {
        name: `${tag} nails`,
        slug: `${tag}-nails`,
        consultFamily: ConsultServiceFamily.NAILS,
      },
      select: { id: true },
    }),
    db.serviceCategory.create({
      data: {
        name: `${tag} skin`,
        slug: `${tag}-skin`,
        consultFamily: ConsultServiceFamily.SKIN,
      },
      select: { id: true },
    }),
  ])
  nailsCategoryId = nails.id
  skinCategoryId = skin.id
  const [nailsService, skinService] = await Promise.all([
    db.service.create({
      data: {
        name: `${tag} gel manicure`,
        categoryId: nailsCategoryId,
        defaultDurationMinutes: 60,
        minPrice: new Prisma.Decimal('60.00'),
      },
      select: { id: true },
    }),
    db.service.create({
      data: {
        name: `${tag} facial`,
        categoryId: skinCategoryId,
        defaultDurationMinutes: 60,
        minPrice: new Prisma.Decimal('90.00'),
      },
      select: { id: true },
    }),
  ])
  nailsServiceId = nailsService.id
  skinServiceId = skinService.id
  for (const serviceId of [nailsServiceId, skinServiceId]) {
    await db.professionalServiceOffering.create({
      data: {
        professionalId,
        serviceId,
        isActive: true,
        // Raw flags claim BOTH modes — prod's shape — but only mobile is real.
        offersInSalon: true,
        offersMobile: true,
        salonPriceStartingAt: new Prisma.Decimal('60.00'),
        salonDurationMinutes: 60,
        mobilePriceStartingAt: new Prisma.Decimal('60.00'),
        mobileDurationMinutes: 60,
      },
    })
  }
  const [consent, adult] = await Promise.all([
    db.consultAgreementVersion.create({
      data: {
        kind: ConsultAgreementKind.SENSITIVE_DATA_CONSENT,
        version: versionBase,
        title: 'Pack consent fixture',
        body: 'Pack consent fixture only.',
      },
      select: { id: true },
    }),
    db.consultAgreementVersion.create({
      data: {
        kind: ConsultAgreementKind.ADULT_18_PLUS_ATTESTATION,
        version: versionBase,
        title: 'Pack adult fixture',
        body: 'Pack adult fixture only.',
      },
      select: { id: true },
    }),
  ])
  consentVersionId = consent.id
  adultVersionId = adult.id
})

beforeEach(() => {
  process.env.ENABLE_AI_CONSULT = '1'
  delete process.env.AI_CONSULT_SERVICE_SCOPE
  fake.objects.clear()
  fake.modelCalls.length = 0
  fake.qualityByShot.clear()
  fake.analysisCalls = 0
  fake.suppliedShotKeys.length = 0
  fake.capturePackIds.length = 0
})

afterAll(async () => {
  // A session cannot be deleted while raw objects are unpurged (a trigger),
  // so the app's own purge runs first — against the fake storage above.
  for (const sessionId of sessionIds) {
    await purgeConsultSessionRawObjects(sessionId)
  }
  await db.consultSession.deleteMany({ where: { id: { in: sessionIds } } })
  await db.consultAgreementVersion.deleteMany({
    where: { id: { in: [consentVersionId, adultVersionId] } },
  })
  await db.booking.deleteMany({ where: { id: { in: bookingIds } } })
  await db.professionalServiceOffering.deleteMany({ where: { professionalId } })
  await db.professionalLocation.deleteMany({ where: { id: locationId } })
  await db.service.deleteMany({ where: { id: { in: [nailsServiceId, skinServiceId] } } })
  await db.serviceCategory.deleteMany({
    where: { id: { in: [nailsCategoryId, skinCategoryId] } },
  })
  await db.clientProfile.deleteMany({ where: { id: { in: clientIds } } })
  await db.professionalProfile.deleteMany({ where: { id: professionalId } })
  await db.user.deleteMany({ where: { id: { in: [...userIds, proUserId] } } })
  await db.tenant.deleteMany({ where: { id: tenantId } })
  delete process.env.ENABLE_AI_CONSULT
  await db.$disconnect()
})

describe('the area pack (NAILS) against PostgreSQL', () => {
  it('auto-advances on ITS three shots when the inspiration step finishes last', async () => {
    const consult = await createConsult({
      label: 'nails-inspiration-last',
      serviceCategoryId: nailsCategoryId,
      serviceId: nailsServiceId,
      skipInspiration: false,
    })
    authenticate(consult)
    for (const shot of AREA_CAPTURE_PACK.shots) {
      await acceptShot(consult, AREA_CAPTURE_PACK, shot.key, 'nails-il')
    }
    expect(fake.modelCalls).toEqual(['area_wide', 'area_closeup', 'face_front'])
    // A full pack is not enough on its own: the inspiration decision is the
    // other analysis prerequisite, so the session waits in MEDIA_READY.
    expect(await status(consult.sessionId)).toBe(ConsultSessionStatus.MEDIA_READY)

    // The inspiration step is the LAST prerequisite to land. Its caller used
    // to require the hair pack's seven accepted shots here; three is this
    // pack's whole slot count, so this is the advance.
    await skipInspiration(consult, 'nails-il')
    expect(await status(consult.sessionId)).toBe(ConsultSessionStatus.ANALYSIS_PENDING)

    const transitions = await db.consultAuditEvent.findMany({
      where: {
        consultSessionId: consult.sessionId,
        action: ConsultAuditAction.LIFECYCLE_TRANSITIONED,
        fromStatus: ConsultSessionStatus.MEDIA_READY,
        toStatus: ConsultSessionStatus.ANALYSIS_PENDING,
      },
    })
    expect(transitions).toHaveLength(1)
  })

  // SUBJECT_NOT_VISIBLE is the area pack's equivalent of HAIR_NOT_VISIBLE. The
  // vision enum, the DTO union and the ConsultCapture_quality_contract CHECK all
  // carried it from migration 20261005; the contract's own reason-code set did
  // not, so the write refused its OWN model's verdict and the client got
  // CONSULT_CAPTURE_QUALITY_UNAVAILABLE (503) — a retakeable photo reported as
  // a broken feature — instead of the retake tip that tells them what to fix.
  it('surfaces a SUBJECT_NOT_VISIBLE rejection with its retake tip', async () => {
    const consult = await createConsult({
      label: 'nails-subject-not-visible',
      serviceCategoryId: nailsCategoryId,
      serviceId: nailsServiceId,
      skipInspiration: true,
    })
    authenticate(consult)
    const retakeTip = 'Fill the frame with the nails themselves, in indirect daylight.'
    fake.qualityByShot.set('area_closeup', {
      accepted: false,
      reasonCode: 'SUBJECT_NOT_VISIBLE',
      warningCode: null,
      retakeTip,
      model: 'fake-quality',
    })

    const captureId = await issueAttach(
      consult,
      AREA_CAPTURE_PACK,
      'area_closeup',
      'nails-snv',
    )
    const response = await checkShotQuality(
      consult,
      AREA_CAPTURE_PACK,
      captureId,
      'nails-snv',
    )

    expect(response.status).toBe(200)
    const payload = await body(response)
    expect(payload).toMatchObject({
      quality: { accepted: false, reasonCode: 'SUBJECT_NOT_VISIBLE', retakeTip },
    })

    // The slot the client renders from carries the reason and the tip, not a
    // blank rejection: stateForCapture drops any code it does not recognize.
    const capture = payload.capture as {
      slots: Array<{
        shotKey: string
        state: string
        qualityReasonCode: string | null
        retakeTip: string | null
      }>
    }
    expect(capture.slots.find((slot) => slot.shotKey === 'area_closeup')).toMatchObject(
      { state: 'REJECTED', qualityReasonCode: 'SUBJECT_NOT_VISIBLE', retakeTip },
    )

    // And the row itself: proof the database CHECK takes the code for a
    // REJECTED capture, not just that the application let it through.
    expect(
      await db.consultCapture.findUniqueOrThrow({
        where: { id: captureId },
        select: { status: true, qualityReasonCode: true, retakeTip: true },
      }),
    ).toMatchObject({
      status: ConsultCaptureStatus.REJECTED,
      qualityReasonCode: 'SUBJECT_NOT_VISIBLE',
      retakeTip,
    })
  })

  it('runs the analysis on the area pack and the guard accepts the v3 write', async () => {
    const consult = await createConsult({
      label: 'nails-analysis',
      serviceCategoryId: nailsCategoryId,
      serviceId: nailsServiceId,
      skipInspiration: true,
    })
    authenticate(consult)
    for (const shot of AREA_CAPTURE_PACK.shots) {
      await acceptShot(consult, AREA_CAPTURE_PACK, shot.key, 'nails-an')
    }
    expect(await status(consult.sessionId)).toBe(ConsultSessionStatus.ANALYSIS_PENDING)

    const response = await runAnalysis(consult, 'nails-an')
    expect(response.status).toBe(200)
    expect(fake.analysisCalls).toBe(1)
    expect(fake.capturePackIds).toEqual([AREA_CAPTURE_PACK.id])
    expect(fake.suppliedShotKeys[0]).toEqual(['area_wide', 'area_closeup', 'face_front'])
    expect(await status(consult.sessionId)).toBe(ConsultSessionStatus.COMPLETED)

    const revision = await db.consultRevision.findFirstOrThrow({
      where: { consultSessionId: consult.sessionId, kind: ConsultRevisionKind.ANALYSIS },
    })
    expect(revision).toMatchObject({
      schemaVersion: CONSULT_ANALYSIS_SCHEMA_VERSION,
      promptVersion: CONSULT_ANALYSIS_PROMPT_VERSION,
    })
    // The general-service policy: a treatment within six months is a
    // required flag, and no colour flag may appear.
    const payload = revision.payload as {
      safetyFlags: Array<{ code: string }>
      recommendations: Array<{ serviceIntent: string; reference: { type: string } }>
    }
    expect(payload.safetyFlags.map((flag) => flag.code)).toEqual([
      'RECENT_CHEMICAL_SERVICE',
    ])
    expect(payload.recommendations).toEqual([
      expect.objectContaining({
        serviceIntent: 'CONSULTATION',
        reference: expect.objectContaining({ serviceCategoryId: nailsCategoryId }),
      }),
    ])
    // The BRIEF followed, pinned to this analysis.
    await expect(
      db.consultRevision.findFirst({
        where: { consultSessionId: consult.sessionId, kind: ConsultRevisionKind.BRIEF },
        select: { payload: true },
      }),
    ).resolves.toMatchObject({
      payload: { sourceAnalysisRevisionId: revision.id },
    })
  })

  it('the guard refuses a colour-only safety flag on a general-service session', async () => {
    const consult = await createConsult({
      label: 'nails-guard',
      serviceCategoryId: nailsCategoryId,
      serviceId: nailsServiceId,
      skipInspiration: true,
    })
    authenticate(consult)
    for (const shot of AREA_CAPTURE_PACK.shots) {
      await acceptShot(consult, AREA_CAPTURE_PACK, shot.key, 'nails-guard')
    }
    await db.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`
        SELECT "id" FROM "ConsultSession" WHERE "id" = ${consult.sessionId} FOR UPDATE
      `)
      await transitionLockedConsultSession(tx, {
        consultSessionId: consult.sessionId,
        actor: { type: ConsultActorType.CLIENT, id: consult.userId },
        fromStatus: ConsultSessionStatus.ANALYSIS_PENDING,
        toStatus: ConsultSessionStatus.ANALYZING,
      })
    })

    const write = (safetyFlags: Array<{ code: string }>, key: string) =>
      db.$transaction(async (tx) => {
        const sequenced = await tx.consultSession.update({
          where: { id: consult.sessionId },
          data: { revisionSequence: { increment: 1 } },
          select: { revisionSequence: true },
        })
        await tx.consultRevision.create({
          data: {
            consultSessionId: consult.sessionId,
            revision: sequenced.revisionSequence,
            kind: ConsultRevisionKind.ANALYSIS,
            payload: guardPayload(safetyFlags),
            schemaVersion: CONSULT_ANALYSIS_SCHEMA_VERSION,
            promptVersion: CONSULT_ANALYSIS_PROMPT_VERSION,
            model: 'direct-guard-test',
            idempotencyKey: key,
            requestHash: 'e'.repeat(64),
          },
        })
      })

    // RECENT_BOX_DYE is a COLOUR flag: the general-service pack asks no
    // box-dye question, so the intake cannot back it. The honest set for this
    // intake is exactly RECENT_CHEMICAL_SERVICE.
    await expect(
      write(
        [
          { code: 'RECENT_CHEMICAL_SERVICE' },
          { code: 'RECENT_BOX_DYE' },
        ],
        'guard-colour-flag',
      ),
    ).rejects.toThrow('analysis carries a safety flag the intake cannot support')

    // Positive control on the SAME session: the honest flag set passes the
    // payload guard. Triggers fire in name order, and the NEXT one refuses a
    // bare insert for lacking its atomic audit row — a refusal the route's
    // own write never sees (the accepted end-to-end case above) and one that
    // is only reachable once the payload guard has let the row through. So
    // "audit evidence" here is the payload branch telling, not a fixture that
    // can never pass; "cannot support" would be the branch still refusing.
    await expect(
      write([{ code: 'RECENT_CHEMICAL_SERVICE' }], 'guard-honest'),
    ).rejects.toThrow('analysis revision requires atomic content-free audit evidence')
  })
})

describe('a pro who only travels (the founder’s shape in prod)', () => {
  it('routes a reported reaction to her Patch Test through the mode she can host', async () => {
    // Her Patch Test row claims BOTH modes, like every row prod holds; only
    // mobile is real. The look-anchor / no-booking reading used to be the
    // SALON column, which the narrowed row no longer offers — so the routed
    // analysis refused ANALYSIS_PREREQUISITES_REQUIRED for a test she DOES
    // offer. It now reads the mode her bookable locations can host.
    const patchTest = await db.service.create({
      data: {
        name: 'Patch Test',
        categoryId: nailsCategoryId,
        defaultDurationMinutes: 10,
        minPrice: new Prisma.Decimal('0.00'),
      },
      select: { id: true },
    })
    await db.professionalServiceOffering.create({
      data: {
        professionalId,
        serviceId: patchTest.id,
        isActive: true,
        offersInSalon: true,
        offersMobile: true,
        salonPriceStartingAt: new Prisma.Decimal('0.00'),
        salonDurationMinutes: 10,
        mobilePriceStartingAt: new Prisma.Decimal('0.00'),
        mobileDurationMinutes: 10,
      },
    })
    try {
      const consult = await createConsult({
        label: 'nails-routed',
        serviceCategoryId: nailsCategoryId,
        serviceId: nailsServiceId,
        skipInspiration: true,
        answers: { ...completeGeneral, prior_reaction: 'yes' },
      })
      authenticate(consult)
      for (const shot of AREA_CAPTURE_PACK.shots) {
        await acceptShot(consult, AREA_CAPTURE_PACK, shot.key, 'nails-routed')
      }
      // The booking this consult hangs off is MOBILE, so the reading is the
      // mobile column either way; the estimate half of the same rule is
      // proven on a LOOK anchor in consult-look-estimate.test.ts.
      const response = await runAnalysis(consult, 'nails-routed')
      expect(response.status).toBe(200)
      const revision = await db.consultRevision.findFirstOrThrow({
        where: { consultSessionId: consult.sessionId, kind: ConsultRevisionKind.ANALYSIS },
      })
      const payload = revision.payload as {
        safetyFlags: Array<{ code: string }>
        recommendations: Array<{ serviceIntent: string; reference: { serviceId: string | null } }>
      }
      expect(payload.safetyFlags.map((flag) => flag.code).sort()).toEqual([
        'PRIOR_REACTION',
        'RECENT_CHEMICAL_SERVICE',
      ])
      // The routed direction leads, resolved to HER Patch Test row; the
      // provider's consultation direction follows it.
      expect(payload.recommendations[0]).toEqual(
        expect.objectContaining({
          serviceIntent: 'PATCH_TEST',
          reference: expect.objectContaining({ serviceId: patchTest.id }),
        }),
      )
    } finally {
      await db.professionalServiceOffering.deleteMany({ where: { serviceId: patchTest.id } })
      await db.service.delete({ where: { id: patchTest.id } })
    }
  })
})

describe('the face pack (SKIN) against PostgreSQL', () => {
  it('reaches ANALYSIS and COMPLETED on its three face views', async () => {
    const consult = await createConsult({
      label: 'skin-analysis',
      serviceCategoryId: skinCategoryId,
      serviceId: skinServiceId,
      skipInspiration: true,
    })
    authenticate(consult)
    for (const shot of FACE_CAPTURE_PACK.shots) {
      await acceptShot(consult, FACE_CAPTURE_PACK, shot.key, 'skin-an')
    }
    expect(fake.modelCalls).toEqual(['face_front', 'face_side', 'eyes_closeup'])
    expect(await status(consult.sessionId)).toBe(ConsultSessionStatus.ANALYSIS_PENDING)

    const response = await runAnalysis(consult, 'skin-an')
    expect(response.status).toBe(200)
    expect(fake.capturePackIds).toEqual([FACE_CAPTURE_PACK.id])
    expect(fake.suppliedShotKeys[0]).toEqual(['face_front', 'face_side', 'eyes_closeup'])
    expect(await status(consult.sessionId)).toBe(ConsultSessionStatus.COMPLETED)
    await expect(
      db.consultRevision.count({
        where: { consultSessionId: consult.sessionId, kind: ConsultRevisionKind.ANALYSIS },
      }),
    ).resolves.toBe(1)
  })
})

/** A structurally complete v3 payload for the guard, varying only the flags. */
function guardPayload(safetyFlags: Array<{ code: string }>) {
  const unknown = (evidence: string[] = []) => ({
    value: 'UNKNOWN',
    confidence: { min: 0, max: 0.25 },
    evidence,
  })
  const observed = (value: string) => ({
    value,
    confidence: { min: 0.4, max: 0.7 },
    evidence: ['face_front'],
  })
  return {
    profile: {
      skinUndertone: observed('NEUTRAL'),
      contrastLevel: observed('MEDIUM'),
      colorSeason: unknown(),
      faceProportion: observed('BALANCED'),
      jawline: observed('SOFTLY_ROUNDED'),
      foreheadProportion: observed('BALANCED'),
      featureBalance: observed('SOFT'),
      eyeShape: unknown(),
      eyeSpacing: unknown(),
      browDensity: unknown(),
      browShape: unknown(),
    },
    styleDirections: [
      'HAIR_COLOR_HARMONY',
      'CUT_AND_SHAPE',
      'BANGS',
      'BROWS',
      'LASHES',
      'MAKEUP',
      'COLOR_PALETTE',
    ].map((domain) => ({
      domain,
      title: 'A soft, harmonizing direction',
      direction: 'Discuss a soft, blended direction for this domain together.',
      whyItFlatters: 'Low observed contrast favors blended choices.',
      confidence: { min: 0.4, max: 0.7 },
      evidence: ['face_front'],
      discussWithProfessional: true,
    })),
    core: {
      baseLevel: { value: 'UNKNOWN', confidence: { min: 0, max: 0.25 }, evidence: [] },
      lightestLevel: { value: 'UNKNOWN', confidence: { min: 0, max: 0.25 }, evidence: [] },
      currentTone: unknown(),
      visibleCondition: unknown(),
      density: unknown(),
      texture: unknown(),
    },
    serviceLens: {
      goal: 'A subtle shape direction grounded in the intake goal.',
      history: 'A treatment within six months is on record.',
      constraints: 'No known allergies were reported.',
      maintenance: 'Maintenance tolerance was not collected and is unknown.',
      appointmentContext: 'Appointment context uses the intake timing.',
      achievability: 'REQUIRES_PRO_ASSESSMENT',
      achievabilityReason: 'The professional should assess in person.',
      discussWithProfessional: true,
    },
    safetyFlags: safetyFlags.map((flag) => ({
      ...flag,
      summary: 'Discuss this with your professional before service.',
      discussWithProfessional: true,
    })),
    recommendations: [
      {
        serviceIntent: 'CONSULTATION',
        serviceName: null,
        title: 'A consultation first',
        rationale: 'Review the direction and history together.',
        achievability: 'The professional should confirm the plan.',
        discussWithProfessional: true,
        reference: {
          type: 'SERVICE_CATEGORY',
          serviceId: null,
          serviceCategoryId: nailsCategoryId,
        },
      },
    ],
  }
}
