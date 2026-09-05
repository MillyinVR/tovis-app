import {
  BookingStatus,
  ConsultActorType,
  ConsultAgreementKind,
  ConsultAuditAction,
  ConsultBriefFeedbackRating,
  ConsultCaptureStatus,
  ConsultSessionStatus,
  LookPostStatus,
  LookPostVisibility,
  MediaType,
  MediaVisibility,
  ModerationStatus,
  Prisma,
  PrismaClient,
  ProfessionalLocationType,
  Role,
  ServiceLocationType,
  UploadSessionStatus,
  VerificationStatus,
} from '@prisma/client'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  process.env.JWT_SECRET ||= 'integration-test-jwt-secret'
})

const mockRequireClient = vi.hoisted(() => vi.fn())
const fake = vi.hoisted(() => ({
  objects: new Map<
    string,
    { contentType: 'image/jpeg'; sizeBytes: number; checksumSha256: string | null }
  >(),
  signedPaths: [] as string[],
  purgedPaths: [] as string[],
  failPurgePaths: new Set<string>(),
  qualityByShot: new Map<
    string,
    {
      accepted: boolean
      reasonCode:
        | 'PASS'
        | 'WARM_INDOOR_LIGHT'
        | 'COLOR_CAST'
        | 'VIEW_MISMATCH'
        | 'HAIR_NOT_VISIBLE'
        | 'BLURRY'
        | 'TOO_DARK'
        | 'TOO_BRIGHT'
        | 'OTHER_QUALITY_FAILURE'
      retakeTip: string | null
      model: string
    }
  >(),
  modelCalls: [] as string[],
  analysisCalls: 0,
  analysisFails: false,
  inspirationVisionCalls: 0,
  inspirationUnreadable: false,
  inspirationImageUrls: [] as string[],
  analysisDuring: null as null | (() => Promise<void>),
  pathSequence: 0,
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
      fake.pathSequence += 1
      const tail = fake.pathSequence.toString(16).padStart(12, '0')
      return `consult-raw/v1/00000000-0000-4000-8000-${tail}.jpg`
    },
    consultCaptureStorage: {
      assertReady: vi.fn().mockResolvedValue(undefined),
      async createSignedUpload(path: string) {
        fake.signedPaths.push(path)
        return {
          token: 'signed-upload-secret',
          signedUrl: 'https://storage.test/signed-upload-secret',
        }
      },
      async createSignedRead(path: string, expiresInSeconds: number) {
        fake.signedPaths.push(path)
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
        if (
          object.contentType !== args.expectedContentType ||
          object.sizeBytes > args.maxBytes ||
          (args.expectedChecksumSha256 &&
            object.checksumSha256 !== args.expectedChecksumSha256)
        ) {
          throw new FakeStorageError('invalid')
        }
        return object
      },
      async readObject(args: {
        path: string
        expectedContentType: 'image/jpeg'
        maxBytes: number
      }) {
        const object = fake.objects.get(args.path)
        if (
          !object ||
          object.contentType !== args.expectedContentType ||
          object.sizeBytes > args.maxBytes
        ) {
          throw new FakeStorageError('missing')
        }
        return { base64: 'bm90LXJhdy1pbi1kYg==', mediaType: object.contentType }
      },
      async purgeObject(path: string) {
        if (fake.failPurgePaths.delete(path)) {
          throw new FakeStorageError('unavailable')
        }
        fake.objects.delete(path)
        if (fake.objects.has(path)) {
          throw new FakeStorageError('unavailable')
        }
        fake.purgedPaths.push(path)
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
      // The fake stands in for the NETWORK, not for the policy: whatever the
      // provider would have answered goes through the real sanitizer, so the
      // shot-aware colour rule (B3) is exercised end to end here instead of
      // being restated in a second place.
      const entry = fake.qualityByShot.get(input.shotKey) ?? {
        accepted: true,
        reasonCode: 'PASS' as const,
        retakeTip: null,
        model: 'fake-quality-model',
      }
      return original.sanitizeConsultCaptureQuality(
        { accepted: entry.accepted, reasonCode: entry.reasonCode, retakeTip: entry.retakeTip },
        entry.model,
        input.shotKey,
      )
    },
  }
})

// P4: the EXTERNAL_UPLOAD arm of the inspiration read. The signed read itself
// is the fake storage's (so the upload branch of the read path is genuinely
// exercised); only the network fetch of those bytes and the paid provider call
// are faked. Without the fetch fake this suite fails 422 — the origin guard in
// inspirationImage.ts correctly refuses `https://storage.test/...`, which is
// not this project's Supabase origin.
vi.mock('@/lib/consult/inspirationImage', () => ({
  async fetchConsultInspirationImage(url: string) {
    fake.inspirationImageUrls.push(url)
    return { base64: 'aW5zcGlyYXRpb24=', mediaType: 'image/jpeg' as const }
  },
}))

vi.mock('@/lib/consult/inspirationVision', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('@/lib/consult/inspirationVision')>()
  const known = (value: string) => ({
    value,
    confidence: { min: 0.4, max: 0.65 },
    evidence: ['inspiration'] as const,
    region: { x: 0.1, y: 0.15, w: 0.7, h: 0.6 },
  })
  return {
    ...original,
    async runConsultInspirationVision() {
      fake.inspirationVisionCalls += 1
      if (fake.inspirationUnreadable) {
        throw new original.ConsultInspirationVisionError('unreadable')
      }
      return {
        model: 'fake-inspiration-model',
        analysis: {
          baseLevel: known('LEVEL_5'),
          lightestLevel: known('LEVEL_7'),
          tone: known('WARM'),
          technique: known('SINGLE_PROCESS'),
          placement: known('ALL_OVER'),
          rootBlend: known('SOLID_TO_ROOT'),
          finish: known('SATIN'),
          dimension: known('SUBTLE'),
        },
      }
    },
  }
})

vi.mock('@/lib/consult/analysisEngine', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/consult/analysisEngine')>()
  return {
    ...original,
    async runConsultAnalysis() {
      fake.analysisCalls += 1
      await new Promise((resolve) => setTimeout(resolve, 50))
      if (fake.analysisDuring) await fake.analysisDuring()
      if (fake.analysisFails) {
        throw new original.ConsultAnalysisProviderError('unavailable')
      }
      const observed = (value: string, evidence: string[] = ['hair_back']) => ({
        value,
        confidence:
          value === 'UNKNOWN' ? { min: 0, max: 0.25 } : { min: 0.4, max: 0.7 },
        evidence,
      })
      return {
        model: 'fake-analysis-model',
        analysis: {
          profile: {
            skinUndertone: observed('NEUTRAL', ['face_front']),
            contrastLevel: observed('MEDIUM', ['face_front']),
            colorSeason: observed('UNKNOWN', []),
            faceProportion: observed('BALANCED', ['face_front']),
            jawline: observed('SOFTLY_ROUNDED', ['face_side']),
            foreheadProportion: observed('BALANCED', ['face_side']),
            featureBalance: observed('SOFT', ['face_front']),
            eyeShape: observed('HOODED', ['eyes_closeup']),
            eyeSpacing: observed('BALANCED', ['eyes_closeup']),
            browDensity: observed('FULL', ['eyes_closeup']),
            browShape: observed('SOFT_ARCH', ['eyes_closeup']),
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
            whyItFlatters:
              'Low observed contrast and soft feature balance favor blended choices.',
            confidence: { min: 0.4, max: 0.7 },
            evidence: ['face_front'],
            discussWithProfessional: true,
          })),
          core: {
            baseLevel: {
              value: 'LEVEL_4',
              confidence: { min: 0.5, max: 0.75 },
              evidence: ['hair_back', 'hair_crown'],
            },
            lightestLevel: {
              value: 'LEVEL_5',
              confidence: { min: 0.5, max: 0.75 },
              evidence: ['hair_back', 'hair_crown'],
            },
            currentTone: observed('MIXED'),
            visibleCondition: observed('NO_VISIBLE_CONCERN'),
            density: observed('UNKNOWN', []),
            texture: observed('WAVY'),
          },
          serviceLens: {
            goal: 'A noticeable red direction grounded in the intake goal.',
            history: 'Prior lightening and box-dye timing affect the range.',
            constraints: 'Allergy history and other constraints are unknown.',
            maintenance: 'Maintenance tolerance was not collected and is unknown.',
            appointmentContext: 'Appointment context uses the intake timing and budget.',
            achievability: 'REQUIRES_PRO_ASSESSMENT',
            achievabilityReason: 'The professional should assess condition and history.',
            discussWithProfessional: true,
          },
          safetyFlags: [],
          recommendations: [
            {
              // The STORED shape the engine returns (serviceIntent +
              // serviceName), not the provider's `service` enum.
              serviceIntent: 'CONSULTATION',
              serviceName: null,
              title: 'Hair color consultation',
              rationale: 'Review a realistic red direction and chemical history.',
              achievability: 'The professional should confirm the service plan.',
              discussWithProfessional: true,
            },
          ],
        },
      }
    },
  }
})

import { POST as attachCapture } from '@/app/api/v1/client/consult/[id]/capture/attach/route'
import { POST as proceedCapture } from '@/app/api/v1/client/consult/[id]/capture/proceed/route'
import { GET as getCapture } from '@/app/api/v1/client/consult/[id]/capture/route'
import { POST as issueUpload } from '@/app/api/v1/client/consult/[id]/capture/uploads/route'
import { POST as checkQuality } from '@/app/api/v1/client/consult/[id]/capture/[captureId]/quality/route'
import { DELETE as deleteCapture } from '@/app/api/v1/client/consult/[id]/capture/[captureId]/route'
import { GET as getAnalysis, POST as startAnalysis } from '@/app/api/v1/client/consult/[id]/analysis/route'
import { processConsultAnalysisRuns } from '@/lib/consult/analysisRunner'
import {
  CONSULT_ANALYSIS_PROMPT_VERSION,
  CONSULT_ANALYSIS_SCHEMA_VERSION,
} from '@/lib/consult/analysisEngine'
import {
  HAIR_COLOR_CAPTURE_PACK_VERSION,
  HAIR_COLOR_CAPTURE_SCHEMA_VERSION,
  type HairColorCaptureShotKey,
} from '@/lib/consult/capturePack'
import {
  attachConsultCaptureUpload,
  CONSULT_CAPTURE_MAX_QUALITY_CHECKS_PER_SESSION,
} from '@/lib/consult/captureContract'
import {
  purgeConsultSessionRawObjects,
  runConsultCapturePurgeSweep,
} from '@/lib/consult/capturePurge'
import {
  acceptConsultAgreement,
  appendLockedConsultInspirationRevision,
  appendConsultIntakeRevision,
  revokeConsultAgreement,
  transitionLockedConsultSession,
} from '@/lib/consult/writeBoundary'
import {
  HAIR_COLOR_INTAKE_PACK_VERSION,
  HAIR_COLOR_INTAKE_SCHEMA_VERSION,
} from '@/lib/consult/intakePack'
import {
  answerConsultInspirationQuestion,
  attachConsultInspirationUpload,
  chooseConsultInspirationLook,
  issueConsultInspirationUpload,
  loadClientInspirationSignedRead,
  loadConsultInspirationState,
  loadProInspirationSignedRead,
  requireCompletedConsultInspiration,
  skipConsultInspiration,
} from '@/lib/consult/inspirationContract'
import { runConsultInspirationPurgeSweep } from '@/lib/consult/inspirationPurge'

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error('Run with pnpm test:integration')
const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } })
const tag = `consult_capture_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
const future = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
const versionBase = 2_000_000 + Math.floor(Math.random() * 100_000)

let tenantId = ''
let proUserId = ''
let professionalId = ''
let locationId = ''
let categoryId = ''
let serviceId = ''
let consentVersionId = ''
let adultVersionId = ''
const userIds: string[] = []
const clientIds: string[] = []
const bookingIds: string[] = []
const sessionIds: string[] = []
const auxiliaryServiceIds: string[] = []
const lookAssetIds: string[] = []
const auxiliaryProfessionalIds: string[] = []
const auxiliaryUserIds: string[] = []
let bookingSequence = 0

type ReadyConsult = {
  userId: string
  clientId: string
  bookingId: string
  sessionId: string
}

const completeAnswers = {
  current_color: 'brunette',
  desired_color: 'red',
  change_scale: 'noticeable',
  box_dye_history: 'over-12-months',
  prior_lightening: '6-12-months',
  henna_plant_dye_history: 'never',
  perm_history: 'never',
  relaxer_texturizer_history: 'never',
  keratin_smoothing_history: 'never',
  other_chemical_history: 'never',
  last_color_service_timing: '1-3-months',
  prior_reaction: 'no',
}

function context(id: string) {
  return { params: { id } }
}

function captureContext(id: string, captureId: string) {
  return { params: { id, captureId } }
}

async function body(response: Response): Promise<Record<string, unknown>> {
  const parsed: unknown = await response.json()
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Expected response object.')
  }
  return { ...parsed }
}

function jsonRequest(path: string, value: Record<string, unknown>, method = 'POST') {
  return new Request(`http://test${path}`, {
    method,
    body: JSON.stringify(value),
  })
}

function validIssue(idempotencyKey: string, shotKey: string) {
  return {
    idempotencyKey,
    shotKey,
    shotPackVersion: HAIR_COLOR_CAPTURE_PACK_VERSION,
    schemaVersion: HAIR_COLOR_CAPTURE_SCHEMA_VERSION,
    contentType: 'image/jpeg',
    sizeBytes: 100,
  }
}

async function createReadyConsult(
  label: string,
  answerOverrides: Record<string, string> = {},
  options: { skipInspiration?: boolean } = {},
): Promise<ReadyConsult> {
  const user = await db.user.create({
    data: { email: `${tag}_${label}@example.com`, password: 'x', role: Role.CLIENT },
    select: { id: true },
  })
  userIds.push(user.id)
  const client = await db.clientProfile.create({
    data: {
      userId: user.id,
      firstName: 'Capture',
      lastName: label,
      homeTenantId: tenantId,
    },
    select: { id: true },
  })
  clientIds.push(client.id)
  bookingSequence += 1
  const booking = await db.booking.create({
    data: {
      clientId: client.id,
      professionalId,
      serviceId,
      proTenantId: tenantId,
      clientHomeTenantId: tenantId,
      scheduledFor: new Date(future.getTime() + bookingSequence * 60 * 60 * 1000),
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
  const session = await db.consultSession.create({
    data: {
      clientId: client.id,
      bookingId: booking.id,
      professionalId,
      serviceCategoryId: categoryId,
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

  await acceptConsultAgreement({
    consultSessionId: session.id,
    agreementVersionId: consentVersionId,
    expectedKind: ConsultAgreementKind.SENSITIVE_DATA_CONSENT,
    actor: { type: ConsultActorType.CLIENT, id: user.id },
  })
  await acceptConsultAgreement({
    consultSessionId: session.id,
    agreementVersionId: adultVersionId,
    expectedKind: ConsultAgreementKind.ADULT_18_PLUS_ATTESTATION,
    actor: { type: ConsultActorType.CLIENT, id: user.id },
  })
  await appendConsultIntakeRevision({
    consultSessionId: session.id,
    actor: { type: ConsultActorType.CLIENT, id: user.id },
    loadInput: async () => ({
      idempotencyKey: `complete-${label}`,
      packVersion: HAIR_COLOR_INTAKE_PACK_VERSION,
      schemaVersion: HAIR_COLOR_INTAKE_SCHEMA_VERSION,
      complete: true,
      answers: { ...completeAnswers, ...answerOverrides },
    }),
  })
  if (options.skipInspiration !== false) {
    await skipConsultInspiration({
      consultSessionId: session.id,
      clientId: client.id,
      actor: { type: ConsultActorType.CLIENT, id: user.id },
      input: {
        idempotencyKey: `skip-inspiration-${label}`,
        schemaVersion: 1,
      },
    })
  }
  return { userId: user.id, clientId: client.id, bookingId: booking.id, sessionId: session.id }
}

async function createSafetyOffering(args: {
  name: 'Patch Test' | 'Strand Test'
  durationMinutes: 10 | 15
}) {
  const service = await db.service.create({
    data: {
      name: args.name,
      categoryId,
      defaultDurationMinutes: args.durationMinutes,
      minPrice: new Prisma.Decimal('0.00'),
    },
    select: { id: true },
  })
  auxiliaryServiceIds.push(service.id)
  await db.professionalServiceOffering.create({
    data: {
      professionalId,
      serviceId: service.id,
      isActive: true,
      offersInSalon: true,
      salonPriceStartingAt: new Prisma.Decimal('0.00'),
      salonDurationMinutes: args.durationMinutes,
    },
  })
  return service.id
}

function authenticate(consult: ReadyConsult) {
  mockRequireClient.mockResolvedValue({
    ok: true,
    clientId: consult.clientId,
    user: { id: consult.userId },
  })
}

async function issue(
  consult: ReadyConsult,
  shotKey: HairColorCaptureShotKey,
  key: string,
  options: { sizeBytes?: number; checksumSha256?: string } = {},
) {
  const request = jsonRequest(`/api/v1/client/consult/${consult.sessionId}/capture/uploads`, {
    idempotencyKey: key,
    shotKey,
    shotPackVersion: HAIR_COLOR_CAPTURE_PACK_VERSION,
    schemaVersion: HAIR_COLOR_CAPTURE_SCHEMA_VERSION,
    contentType: 'image/jpeg',
    sizeBytes: options.sizeBytes ?? 100,
    ...(options.checksumSha256 ? { checksumSha256: options.checksumSha256 } : {}),
  })
  return issueUpload(request, context(consult.sessionId))
}

async function putIssuedObject(uploadSessionId: string) {
  const upload = await db.uploadSession.findUniqueOrThrow({
    where: { id: uploadSessionId },
  })
  fake.objects.set(upload.storagePath, {
    contentType: 'image/jpeg',
    sizeBytes: upload.maxBytes,
    checksumSha256: upload.checksumSha256,
  })
  return upload
}

async function attach(
  consult: ReadyConsult,
  uploadSessionId: string,
  shotKey: HairColorCaptureShotKey,
  key: string,
) {
  return attachCapture(
    jsonRequest(`/api/v1/client/consult/${consult.sessionId}/capture/attach`, {
      idempotencyKey: key,
      uploadSessionId,
      shotKey,
      shotPackVersion: HAIR_COLOR_CAPTURE_PACK_VERSION,
      schemaVersion: HAIR_COLOR_CAPTURE_SCHEMA_VERSION,
    }),
    context(consult.sessionId),
  )
}

async function quality(
  consult: ReadyConsult,
  captureId: string,
  key: string,
) {
  return checkQuality(
    jsonRequest(`/api/v1/client/consult/${consult.sessionId}/capture/${captureId}/quality`, {
      idempotencyKey: key,
      shotPackVersion: HAIR_COLOR_CAPTURE_PACK_VERSION,
      schemaVersion: HAIR_COLOR_CAPTURE_SCHEMA_VERSION,
    }),
    captureContext(consult.sessionId, captureId),
  )
}

async function issueAttach(
  consult: ReadyConsult,
  shotKey: HairColorCaptureShotKey,
  suffix: string,
) {
  const issued = await issue(consult, shotKey, `issue-${suffix}`)
  const issuedBody = await body(issued)
  const upload = issuedBody.upload as { uploadSessionId: string }
  await putIssuedObject(upload.uploadSessionId)
  const attached = await attach(
    consult,
    upload.uploadSessionId,
    shotKey,
    `attach-${suffix}`,
  )
  const attachedBody = await body(attached)
  return attachedBody.captureId as string
}

async function completeCapturePack(consult: ReadyConsult, suffix: string) {
  for (const shotKey of [
    'hair_back',
    'hair_left',
    'hair_right',
    'hair_crown',
    'face_front',
    'face_side',
    'eyes_closeup',
  ] as const) {
    const captureId = await issueAttach(consult, shotKey, `${suffix}-${shotKey}`)
    const response = await quality(
      consult,
      captureId,
      `${suffix}-quality-${shotKey}`,
    )
    expect(response.status).toBe(200)
  }
}

async function attachExternalInspiration(consult: ReadyConsult, suffix: string) {
  const issued = await issueConsultInspirationUpload({
    consultSessionId: consult.sessionId,
    clientId: consult.clientId,
    actor: { type: ConsultActorType.CLIENT, id: consult.userId },
    input: {
      idempotencyKey: `${suffix}-issue`,
      schemaVersion: 1,
      contentType: 'image/jpeg',
      sizeBytes: 100,
      checksumSha256: null,
    },
  })
  const row = await db.consultInspiration.findUniqueOrThrow({
    where: { id: issued.upload.inspirationId },
  })
  fake.objects.set(row.storagePath!, {
    contentType: 'image/jpeg',
    sizeBytes: 100,
    checksumSha256: null,
  })
  await attachConsultInspirationUpload({
    consultSessionId: consult.sessionId,
    clientId: consult.clientId,
    actor: { type: ConsultActorType.CLIENT, id: consult.userId },
    input: {
      idempotencyKey: `${suffix}-attach`,
      inspirationId: row.id,
      schemaVersion: 1,
    },
  })
  return row
}

/**
 * Just the START request: claims the analysis, queues a run, returns. Makes no
 * provider call (P4b).
 */
function startAnalysisRequest(consult: ReadyConsult, idempotencyKey: string) {
  return startAnalysis(
    jsonRequest(`/api/v1/client/consult/${consult.sessionId}/analysis`, {
      idempotencyKey,
      schemaVersion: CONSULT_ANALYSIS_SCHEMA_VERSION,
      promptVersion: CONSULT_ANALYSIS_PROMPT_VERSION,
    }),
    context(consult.sessionId),
  )
}

/**
 * Start AND run, for the tests that assert on the finished artefact. In
 * production the two halves are the in-request kick and the every-minute cron.
 */
async function analysisRequest(consult: ReadyConsult, idempotencyKey: string) {
  const started = await startAnalysisRequest(consult, idempotencyKey)
  if (started.status === 200) {
    await processConsultAnalysisRuns({ take: 1 })
  }
  return started
}

beforeAll(async () => {
  process.env.ENABLE_AI_CONSULT = '1'
  const tenant = await db.tenant.create({
    data: { slug: `${tag}-tenant`, name: 'Capture integration', isActive: true },
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
      firstName: 'Capture',
      lastName: 'Professional',
      timeZone: 'America/Los_Angeles',
      verificationStatus: VerificationStatus.APPROVED,
    },
    select: { id: true },
  })
  professionalId = pro.id
  const location = await db.professionalLocation.create({
    data: {
      professionalId,
      type: ProfessionalLocationType.SALON,
      name: 'Capture studio',
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
  const service = await db.service.create({
    data: {
      name: `${tag} Hair Color Consultation`,
      categoryId,
      defaultDurationMinutes: 60,
      minPrice: new Prisma.Decimal('100.00'),
    },
    select: { id: true },
  })
  serviceId = service.id
  await db.professionalServiceOffering.create({
    data: {
      professionalId,
      serviceId,
      isActive: true,
      offersInSalon: true,
      salonPriceStartingAt: new Prisma.Decimal('100.00'),
      salonDurationMinutes: 60,
    },
  })
  const [consent, adult] = await Promise.all([
    db.consultAgreementVersion.create({
      data: {
        kind: ConsultAgreementKind.SENSITIVE_DATA_CONSENT,
        version: versionBase,
        title: 'Explicit capture consent fixture',
        body: 'Explicit capture consent fixture only.',
      },
      select: { id: true },
    }),
    db.consultAgreementVersion.create({
      data: {
        kind: ConsultAgreementKind.ADULT_18_PLUS_ATTESTATION,
        version: versionBase,
        title: 'Explicit capture adult fixture',
        body: 'Explicit capture adult fixture only.',
      },
      select: { id: true },
    }),
  ])
  consentVersionId = consent.id
  adultVersionId = adult.id
})

beforeEach(() => {
  vi.clearAllMocks()
  fake.objects.clear()
  fake.signedPaths.length = 0
  fake.purgedPaths.length = 0
  fake.failPurgePaths.clear()
  fake.qualityByShot.clear()
  fake.modelCalls.length = 0
  fake.analysisCalls = 0
  fake.analysisFails = false
  fake.inspirationVisionCalls = 0
  fake.inspirationUnreadable = false
  fake.inspirationImageUrls.length = 0
  fake.analysisDuring = null
})

afterAll(async () => {
  for (const sessionId of sessionIds) {
    await purgeConsultSessionRawObjects(sessionId)
  }
  await db.consultSession.deleteMany({ where: { id: { in: sessionIds } } })
  await db.consultAgreementVersion.deleteMany({
    where: { id: { in: [consentVersionId, adultVersionId] } },
  })
  await db.booking.deleteMany({ where: { id: { in: bookingIds } } })
  await db.professionalLocation.deleteMany({ where: { id: locationId } })
  await db.professionalServiceOffering.deleteMany({
    where: { serviceId: { in: [serviceId, ...auxiliaryServiceIds] } },
  })
  await db.mediaAsset.deleteMany({ where: { id: { in: lookAssetIds } } })
  await db.service.deleteMany({
    where: { id: { in: [serviceId, ...auxiliaryServiceIds] } },
  })
  await db.serviceCategory.deleteMany({ where: { id: categoryId } })
  await db.clientProfile.deleteMany({ where: { id: { in: clientIds } } })
  await db.professionalProfile.deleteMany({
    where: { id: { in: [professionalId, ...auxiliaryProfessionalIds] } },
  })
  await db.user.deleteMany({
    where: { id: { in: [...userIds, proUserId, ...auxiliaryUserIds] } },
  })
  await db.tenant.deleteMany({ where: { id: tenantId } })
  delete process.env.ENABLE_AI_CONSULT
  await db.$disconnect()
})

describe('consult C3 capture API against PostgreSQL and fake private storage', () => {
  it('returns the exact bounded shot pack only after both current prerequisites', async () => {
    const consult = await createReadyConsult('pack')
    authenticate(consult)
    const response = await getCapture(
      new Request(`http://test/api/v1/client/consult/${consult.sessionId}/capture`),
      context(consult.sessionId),
    )
    expect(response.status).toBe(200)
    expect(await body(response)).toMatchObject({
      capture: {
        consultId: consult.sessionId,
        status: ConsultSessionStatus.MEDIA_READY,
        shotPack: {
          id: 'hair-color-daylight',
          version: 2,
          schemaVersion: 1,
          shots: [
            { key: 'hair_back', requirement: 'REQUIRED' },
            { key: 'hair_left', requirement: 'REQUIRED' },
            { key: 'hair_right', requirement: 'REQUIRED' },
            { key: 'hair_crown', requirement: 'REQUIRED' },
            { key: 'face_front', requirement: 'REQUIRED' },
            { key: 'face_side', requirement: 'REQUIRED' },
            { key: 'eyes_closeup', requirement: 'REQUIRED' },
          ],
        },
      },
    })
  })

  it('issues and attaches concurrently without duplicate rows or audits and validates the authoritative object', async () => {
    const consult = await createReadyConsult('idempotent')
    authenticate(consult)
    const checksum = 'a'.repeat(64)
    const [left, right] = await Promise.all([
      issue(consult, 'hair_back', 'same-issue', { checksumSha256: checksum }),
      issue(consult, 'hair_back', 'same-issue', { checksumSha256: checksum }),
    ])
    expect(left.status).toBe(200)
    expect(right.status).toBe(200)
    const leftBody = await body(left)
    const rightBody = await body(right)
    const leftUpload = leftBody.upload as { uploadSessionId: string; token: string; rawExpiresAt: string; expiresAt: string }
    const rightUpload = rightBody.upload as { uploadSessionId: string }
    expect(rightUpload.uploadSessionId).toBe(leftUpload.uploadSessionId)
    expect(leftUpload.token).toBe('signed-upload-secret')
    expect(
      new Date(leftUpload.rawExpiresAt).getTime() - new Date(leftUpload.expiresAt).getTime(),
    ).toBe(23 * 60 * 60 * 1000)
    const upload = await putIssuedObject(leftUpload.uploadSessionId)
    expect(upload.storageBucket).toBe('media-private')
    expect(upload.storagePath).toMatch(/^consult-raw\/v1\/[0-9a-f-]{36}\.jpg$/)
    expect(upload.storagePath).not.toContain(consult.clientId)
    expect(upload.storagePath).not.toContain(consult.sessionId)

    const [firstAttach, secondAttach] = await Promise.all([
      attach(consult, upload.id, 'hair_back', 'same-attach'),
      attach(consult, upload.id, 'hair_back', 'same-attach'),
    ])
    expect(firstAttach.status).toBe(200)
    expect(secondAttach.status).toBe(200)
    expect(
      await db.uploadSession.count({ where: { id: upload.id, status: UploadSessionStatus.CONSUMED } }),
    ).toBe(1)
    expect(
      await db.consultCapture.count({ where: { uploadSessionId: upload.id } }),
    ).toBe(1)
    expect(
      await db.consultAuditEvent.count({
        where: { consultSessionId: consult.sessionId, action: ConsultAuditAction.CAPTURE_UPLOAD_ISSUED },
      }),
    ).toBe(1)
    expect(
      await db.consultAuditEvent.count({
        where: { consultSessionId: consult.sessionId, action: ConsultAuditAction.CAPTURE_ATTACHED },
      }),
    ).toBe(1)

    const secondIssue = await issue(consult, 'hair_back', 'different-live-issue')
    const secondUploadId = ((await body(secondIssue)).upload as {
      uploadSessionId: string
    }).uploadSessionId
    await putIssuedObject(secondUploadId)
    const duplicateLive = await attach(
      consult,
      secondUploadId,
      'hair_back',
      'different-live-attach',
    )
    expect(duplicateLive.status).toBe(409)
    expect(
      await db.consultCapture.count({
        where: { consultSessionId: consult.sessionId, shotKey: 'hair_back' },
      }),
    ).toBe(1)
  })

  it('uses stable non-leaking upload failures for missing and foreign sessions', async () => {
    const owner = await createReadyConsult('upload-owner')
    const foreign = await createReadyConsult('upload-foreign')
    authenticate(foreign)
    const foreignIssue = await issue(foreign, 'hair_left', 'foreign-upload')
    const foreignUpload = (await body(foreignIssue)).upload as { uploadSessionId: string }
    await putIssuedObject(foreignUpload.uploadSessionId)

    authenticate(owner)
    const missing = await attach(owner, 'missing-session', 'hair_left', 'missing-attach')
    const stolen = await attach(owner, foreignUpload.uploadSessionId, 'hair_left', 'foreign-attach')
    expect(missing.status).toBe(409)
    expect(stolen.status).toBe(409)
    expect(await body(missing)).toMatchObject({ code: 'CONSULT_CAPTURE_UPLOAD_MISMATCH' })
    expect(await body(stolen)).toMatchObject({ code: 'CONSULT_CAPTURE_UPLOAD_MISMATCH' })
  })

  it('returns stable slot/version/idempotency/object/expiry failures without trusting client paths', async () => {
    const consult = await createReadyConsult('failures')
    authenticate(consult)
    const endpoint = `/api/v1/client/consult/${consult.sessionId}/capture/uploads`
    const invalidRequests = [
      [
        { ...validIssue('bad-pack', 'hair_back'), shotPackVersion: 99 },
        409,
        'CONSULT_CAPTURE_PACK_VERSION_MISMATCH',
      ],
      [
        { ...validIssue('bad-schema', 'hair_back'), schemaVersion: 99 },
        409,
        'CONSULT_CAPTURE_SCHEMA_VERSION_MISMATCH',
      ],
      [validIssue('bad-slot', 'brows_front'), 400, 'CONSULT_CAPTURE_INVALID_SLOT'],
    ] as const
    for (const [payload, status, code] of invalidRequests) {
      const response = await issueUpload(
        jsonRequest(endpoint, payload),
        context(consult.sessionId),
      )
      expect(response.status).toBe(status)
      expect(await body(response)).toMatchObject({ code })
    }

    const issued = await issue(consult, 'hair_back', 'conflicting-issue')
    expect(issued.status).toBe(200)
    const conflict = await issue(consult, 'hair_left', 'conflicting-issue')
    expect(conflict.status).toBe(409)
    expect(await body(conflict)).toMatchObject({ code: 'CONSULT_IDEMPOTENCY_CONFLICT' })

    const uploadSessionId = ((await body(issued)).upload as { uploadSessionId: string }).uploadSessionId
    const missingObject = await attach(
      consult,
      uploadSessionId,
      'hair_back',
      'missing-object',
    )
    expect(missingObject.status).toBe(422)
    expect(await body(missingObject)).toMatchObject({ code: 'CONSULT_CAPTURE_OBJECT_INVALID' })

    const upload = await putIssuedObject(uploadSessionId)
    await expect(
      attachConsultCaptureUpload({
        consultSessionId: consult.sessionId,
        clientId: consult.clientId,
        actor: { type: ConsultActorType.CLIENT, id: consult.userId },
        now: new Date(upload.expiresAt.getTime() + 1),
        loadInput: async () => ({
          idempotencyKey: 'expired-attach',
          uploadSessionId,
          shotKey: 'hair_back',
          shotPackVersion: 2,
          schemaVersion: 1,
        }),
      }),
    ).rejects.toMatchObject({ code: 'CAPTURE_UPLOAD_EXPIRED' })
  })

  it('fails closed on newly published agreement versions and founder disable before parsing capture input', async () => {
    const consult = await createReadyConsult('stale-agreement')
    authenticate(consult)
    const replacement = await db.consultAgreementVersion.create({
      data: {
        kind: ConsultAgreementKind.SENSITIVE_DATA_CONSENT,
        version: versionBase + 1,
        title: 'Explicit newer capture consent fixture',
        body: 'Explicit newer capture consent fixture only.',
      },
      select: { id: true },
    })
    try {
      const staleRequest = jsonRequest(
        `/api/v1/client/consult/${consult.sessionId}/capture/uploads`,
        validIssue('stale-agreement', 'hair_back'),
      )
      const staleJson = vi.spyOn(staleRequest, 'json')
      const stale = await issueUpload(staleRequest, context(consult.sessionId))
      expect(stale.status).toBe(409)
      expect(await body(stale)).toMatchObject({ code: 'CONSULT_PREREQUISITES_REQUIRED' })
      expect(staleJson).not.toHaveBeenCalled()
    } finally {
      await db.consultAgreementVersion.delete({ where: { id: replacement.id } })
    }

    delete process.env.ENABLE_AI_CONSULT
    const darkRequest = jsonRequest(
      `/api/v1/client/consult/${consult.sessionId}/capture/uploads`,
      validIssue('dark', 'hair_back'),
    )
    const darkJson = vi.spyOn(darkRequest, 'json')
    const dark = await issueUpload(darkRequest, context(consult.sessionId))
    process.env.ENABLE_AI_CONSULT = '1'
    expect(dark.status).toBe(404)
    expect(darkJson).not.toHaveBeenCalled()
  })

  it('hard-rejects warm light and color cast, purges immediately, and preserves replacement evidence', async () => {
    const consult = await createReadyConsult('replace')
    authenticate(consult)
    fake.qualityByShot.set('hair_left', {
      accepted: false,
      reasonCode: 'WARM_INDOOR_LIGHT',
      retakeTip: 'Face a window and turn off warm room lights.',
      model: 'fake-quality-model',
    })
    const rejectedId = await issueAttach(consult, 'hair_left', 'rejected')
    const [first, retry] = await Promise.all([
      quality(consult, rejectedId, 'same-quality'),
      quality(consult, rejectedId, 'same-quality'),
    ])
    expect(first.status).toBe(200)
    expect(retry.status).toBe(200)
    expect(fake.modelCalls).toEqual(['hair_left'])
    expect(await body(first)).toMatchObject({
      quality: {
        accepted: false,
        reasonCode: 'WARM_INDOOR_LIGHT',
        retakeTip: 'Face a window and turn off warm room lights.',
      },
    })
    const rejected = await db.consultCapture.findUniqueOrThrow({ where: { id: rejectedId } })
    expect(rejected.status).toBe(ConsultCaptureStatus.REJECTED)
    expect(rejected.storagePath).toBeNull()
    expect(rejected.purgedAt).not.toBeNull()

    fake.qualityByShot.set('hair_left', {
      accepted: true,
      reasonCode: 'PASS',
      retakeTip: null,
      model: 'fake-quality-model',
    })
    const replacementId = await issueAttach(consult, 'hair_left', 'replacement')
    expect((await quality(consult, replacementId, 'replacement-quality')).status).toBe(200)
    expect(
      await db.consultAuditEvent.count({
        where: { captureId: rejectedId, action: ConsultAuditAction.CAPTURE_QUALITY_CHECKED },
      }),
    ).toBe(1)
    expect(
      await db.consultAuditEvent.count({
        where: { captureId: rejectedId, action: ConsultAuditAction.RAW_OBJECT_PURGED },
      }),
    ).toBe(1)

    const colorCastConsult = await createReadyConsult('color-cast')
    authenticate(colorCastConsult)
    fake.qualityByShot.set('hair_back', {
      accepted: false,
      reasonCode: 'COLOR_CAST',
      retakeTip: 'Move into indirect daylight and remove colored reflections.',
      model: 'fake-quality-model',
    })
    const colorCastId = await issueAttach(
      colorCastConsult,
      'hair_back',
      'color-cast',
    )
    const colorCastResponse = await quality(
      colorCastConsult,
      colorCastId,
      'color-cast-quality',
    )
    expect(await body(colorCastResponse)).toMatchObject({
      quality: { accepted: false, reasonCode: 'COLOR_CAST' },
    })
    expect(
      await db.consultCapture.findUniqueOrThrow({
        where: { id: colorCastId },
        select: { purgedAt: true, storagePath: true },
      }),
    ).toMatchObject({ purgedAt: expect.any(Date), storagePath: null })
  })

  it('moves to ANALYSIS_PENDING exactly once after seven accepted unexpired slots', async () => {
    const consult = await createReadyConsult('ready')
    authenticate(consult)
    const shotKeys = [
      'hair_back',
      'hair_left',
      'hair_right',
      'hair_crown',
      'face_front',
      'face_side',
      'eyes_closeup',
    ] as const
    for (const shotKey of shotKeys) {
      const captureId = await issueAttach(consult, shotKey, `ready-${shotKey}`)
      const [first, retry] = await Promise.all([
        quality(consult, captureId, `quality-${shotKey}`),
        quality(consult, captureId, `quality-${shotKey}`),
      ])
      expect(first.status).toBe(200)
      expect(retry.status).toBe(200)
    }
    expect(fake.modelCalls.sort()).toEqual([...shotKeys].sort())
    expect(
      await db.consultSession.findUniqueOrThrow({ where: { id: consult.sessionId }, select: { status: true } }),
    ).toEqual({ status: ConsultSessionStatus.ANALYSIS_PENDING })
    const transitions = await db.consultAuditEvent.findMany({
      where: {
        consultSessionId: consult.sessionId,
        action: ConsultAuditAction.LIFECYCLE_TRANSITIONED,
        fromStatus: ConsultSessionStatus.MEDIA_READY,
        toStatus: ConsultSessionStatus.ANALYSIS_PENDING,
      },
    })
    expect(transitions).toHaveLength(1)
    expect(transitions[0]).toMatchObject({
      agreementAcceptanceId: null,
      revisionId: null,
      captureId: null,
    })
  })

  it('revocation fences later quality work and immediately purges raw objects', async () => {
    const consult = await createReadyConsult('revoke')
    authenticate(consult)
    const captureId = await issueAttach(consult, 'hair_right', 'revoke')
    const acceptance = await db.consultAgreementAcceptance.findFirstOrThrow({
      where: {
        consultSessionId: consult.sessionId,
        kind: ConsultAgreementKind.SENSITIVE_DATA_CONSENT,
        revokedAt: null,
      },
    })
    await revokeConsultAgreement({
      consultSessionId: consult.sessionId,
      acceptanceId: acceptance.id,
      reason: 'Integration revocation fixture.',
      actor: { type: ConsultActorType.CLIENT, id: consult.userId },
    })
    await purgeConsultSessionRawObjects(consult.sessionId)

    const response = await quality(consult, captureId, 'after-revoke')
    expect(response.status).toBe(409)
    expect(await body(response)).toMatchObject({ code: 'CONSULT_PREREQUISITES_REQUIRED' })
    expect(fake.modelCalls).toHaveLength(0)
    expect(
      await db.consultCapture.findUniqueOrThrow({ where: { id: captureId }, select: { purgedAt: true, storagePath: true } }),
    ).toMatchObject({ storagePath: null, purgedAt: expect.any(Date) })
  })

  it('serializes a quality/revocation race and leaves no readable raw object', async () => {
    const consult = await createReadyConsult('revoke-race')
    authenticate(consult)
    const captureId = await issueAttach(consult, 'hair_left', 'revoke-race')
    const acceptance = await db.consultAgreementAcceptance.findFirstOrThrow({
      where: {
        consultSessionId: consult.sessionId,
        kind: ConsultAgreementKind.SENSITIVE_DATA_CONSENT,
        revokedAt: null,
      },
    })

    const [qualityResponse] = await Promise.all([
      quality(consult, captureId, 'revoke-race-quality'),
      revokeConsultAgreement({
        consultSessionId: consult.sessionId,
        acceptanceId: acceptance.id,
        reason: 'Revocation race fixture.',
        actor: { type: ConsultActorType.CLIENT, id: consult.userId },
      }),
    ])
    expect([200, 409]).toContain(qualityResponse.status)
    await purgeConsultSessionRawObjects(consult.sessionId)
    expect(
      await db.consultSession.findUniqueOrThrow({
        where: { id: consult.sessionId },
        select: { status: true },
      }),
    ).toEqual({ status: ConsultSessionStatus.CONSENT_REVOKED })
    expect(
      await db.consultCapture.findUniqueOrThrow({
        where: { id: captureId },
        select: { purgedAt: true, storagePath: true },
      }),
    ).toMatchObject({ storagePath: null, purgedAt: expect.any(Date) })
    expect(fake.modelCalls.length).toBeLessThanOrEqual(1)
  })

  it('re-consent requires a fresh intake and permits only fresh raw captures', async () => {
    const consult = await createReadyConsult('reconsent')
    authenticate(consult)
    const oldCaptureId = await issueAttach(consult, 'hair_right', 'old-consent')
    const acceptance = await db.consultAgreementAcceptance.findFirstOrThrow({
      where: {
        consultSessionId: consult.sessionId,
        kind: ConsultAgreementKind.SENSITIVE_DATA_CONSENT,
        revokedAt: null,
      },
    })
    await revokeConsultAgreement({
      consultSessionId: consult.sessionId,
      acceptanceId: acceptance.id,
      reason: 'Re-consent integration fixture.',
      actor: { type: ConsultActorType.CLIENT, id: consult.userId },
    })
    await purgeConsultSessionRawObjects(consult.sessionId)
    await acceptConsultAgreement({
      consultSessionId: consult.sessionId,
      agreementVersionId: consentVersionId,
      expectedKind: ConsultAgreementKind.SENSITIVE_DATA_CONSENT,
      actor: { type: ConsultActorType.CLIENT, id: consult.userId },
    })
    expect(
      await db.consultSession.findUniqueOrThrow({ where: { id: consult.sessionId }, select: { status: true } }),
    ).toEqual({ status: ConsultSessionStatus.INTAKE_READY })
    await appendConsultIntakeRevision({
      consultSessionId: consult.sessionId,
      actor: { type: ConsultActorType.CLIENT, id: consult.userId },
      loadInput: async () => ({
        idempotencyKey: 'fresh-intake-after-reconsent',
        packVersion: HAIR_COLOR_INTAKE_PACK_VERSION,
        schemaVersion: HAIR_COLOR_INTAKE_SCHEMA_VERSION,
        complete: true,
        answers: completeAnswers,
      }),
    })
    await expect(
      db.$transaction((tx) =>
        requireCompletedConsultInspiration(tx, {
          consultSessionId: consult.sessionId,
          clientId: consult.clientId,
          professionalId,
          now: new Date(),
        }),
      ),
    ).rejects.toMatchObject({ code: 'ANALYSIS_PREREQUISITES_REQUIRED' })
    await skipConsultInspiration({
      consultSessionId: consult.sessionId,
      clientId: consult.clientId,
      actor: { type: ConsultActorType.CLIENT, id: consult.userId },
      input: { idempotencyKey: 'fresh-inspiration-after-reconsent', schemaVersion: 1 },
    })
    const fresh = await issue(consult, 'hair_right', 'fresh-consent')
    expect(fresh.status).toBe(200)
    expect(
      await db.consultCapture.findUniqueOrThrow({ where: { id: oldCaptureId }, select: { purgedAt: true } }),
    ).toMatchObject({ purgedAt: expect.any(Date) })
  })

  it('direct cancellation makes attached raw objects immediately purge-eligible', async () => {
    const consult = await createReadyConsult('cancel')
    authenticate(consult)
    const captureId = await issueAttach(consult, 'hair_crown', 'cancel')
    await db.consultSession.update({
      where: { id: consult.sessionId },
      data: { status: ConsultSessionStatus.CANCELLED },
    })
    const marked = await db.consultCapture.findUniqueOrThrow({
      where: { id: captureId },
      select: { purgeEligibleAt: true },
    })
    expect(marked.purgeEligibleAt).not.toBeNull()
    await runConsultCapturePurgeSweep(new Date())
    expect(
      await db.consultCapture.findUniqueOrThrow({
        where: { id: captureId },
        select: { purgedAt: true, storagePath: true },
      }),
    ).toMatchObject({ purgedAt: expect.any(Date), storagePath: null })
  })

  it('purges an unattached upload immediately when its booking is cancelled', async () => {
    const consult = await createReadyConsult('booking-cancel')
    authenticate(consult)
    const issued = await issue(consult, 'hair_back', 'booking-cancel-pending')
    const uploadSessionId = ((await body(issued)).upload as {
      uploadSessionId: string
    }).uploadSessionId
    const upload = await putIssuedObject(uploadSessionId)

    await db.booking.update({
      where: { id: consult.bookingId },
      data: { status: BookingStatus.CANCELLED },
    })
    expect(
      await db.uploadSession.findUniqueOrThrow({
        where: { id: upload.id },
        select: { purgeEligibleAt: true },
      }),
    ).toMatchObject({ purgeEligibleAt: expect.any(Date) })
    expect(await runConsultCapturePurgeSweep(new Date())).toMatchObject({
      considered: 1,
      purged: 1,
      failed: 0,
    })
    expect(fake.objects.has(upload.storagePath)).toBe(false)
    expect(
      await db.uploadSession.findUniqueOrThrow({
        where: { id: upload.id },
        select: { status: true, purgedAt: true },
      }),
    ).toMatchObject({
      status: UploadSessionStatus.EXPIRED,
      purgedAt: expect.any(Date),
    })
  })

  it('retries verified scheduled purge and marks absent only after storage succeeds', async () => {
    const consult = await createReadyConsult('sweep')
    authenticate(consult)
    const issued = await issue(consult, 'hair_crown', 'abandoned')
    const uploadSessionId = ((await body(issued)).upload as { uploadSessionId: string }).uploadSessionId
    const upload = await putIssuedObject(uploadSessionId)
    fake.failPurgePaths.add(upload.storagePath)
    const futureSweep = new Date(upload.expiresAt.getTime() + 1)
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    const first = await runConsultCapturePurgeSweep(futureSweep)
    expect(first.failed).toBe(1)
    expect(JSON.stringify(errorLog.mock.calls)).not.toContain(upload.storagePath)
    expect(JSON.stringify(errorLog.mock.calls)).not.toContain('signed-upload-secret')
    expect(
      await db.uploadSession.findUniqueOrThrow({ where: { id: upload.id }, select: { purgedAt: true } }),
    ).toEqual({ purgedAt: null })

    const second = await runConsultCapturePurgeSweep(futureSweep)
    expect(second).toMatchObject({ considered: 1, purged: 1, failed: 0 })
    errorLog.mockRestore()
    expect(fake.objects.has(upload.storagePath)).toBe(false)
    expect(
      await db.uploadSession.findUniqueOrThrow({
        where: { id: upload.id },
        select: { status: true, purgedAt: true, storageBucket: true, storagePath: true },
      }),
    ).toMatchObject({
      status: UploadSessionStatus.EXPIRED,
      purgedAt: expect.any(Date),
      storageBucket: 'purged',
      storagePath: `purged/${upload.id}`,
    })
  })

  it('client deletion purges bytes, retains content-free evidence, and never creates MediaAsset', async () => {
    const consult = await createReadyConsult('delete')
    authenticate(consult)
    const captureId = await issueAttach(consult, 'hair_back', 'delete')
    const mediaBefore = await db.mediaAsset.count()
    const response = await deleteCapture(
      new Request(`http://test/api/v1/client/consult/${consult.sessionId}/capture/${captureId}`, { method: 'DELETE' }),
      captureContext(consult.sessionId, captureId),
    )
    expect(response.status).toBe(200)
    expect(await body(response)).toMatchObject({ deleted: true })
    expect(await db.mediaAsset.count()).toBe(mediaBefore)
    const capture = await db.consultCapture.findUniqueOrThrow({ where: { id: captureId } })
    expect(capture.storageBucket).toBeNull()
    expect(capture.storagePath).toBeNull()
    expect(capture.purgedAt).not.toBeNull()
    const serializedAudit = JSON.stringify(
      await db.consultAuditEvent.findMany({ where: { captureId } }),
    )
    expect(serializedAudit).not.toContain('consult-raw')
    expect(serializedAudit).not.toContain('signed-upload-secret')
    expect(serializedAudit).not.toContain('fake-quality-model')
  })

  it('enforces RLS and rejects direct capture rows without an exact server-minted binding', async () => {
    const rls = await db.$queryRaw<Array<{ relrowsecurity: boolean }>>(Prisma.sql`
      SELECT relrowsecurity FROM pg_class WHERE oid = '"ConsultCapture"'::regclass
    `)
    expect(rls).toEqual([{ relrowsecurity: true }])

    const consult = await createReadyConsult('direct-db')
    await expect(
      db.consultCapture.create({
        data: {
          consultSessionId: consult.sessionId,
          uploadSessionId: 'forged-upload',
          shotKey: 'hair_back',
          shotPackVersion: 1,
          schemaVersion: 1,
          storageBucket: 'media-private',
          storagePath: 'consult-raw/v1/00000000-0000-0000-0000-000000000000.jpg',
          contentType: 'image/jpeg',
          sizeBytes: 100,
          attachIdempotencyKey: 'forged-attach',
          attachRequestHash: 'f'.repeat(64),
          rawExpiresAt: new Date(Date.now() + 60_000),
        },
      }),
    ).rejects.toThrow()

    await expect(
      db.consultSession.update({
        where: { id: consult.sessionId },
        data: { status: ConsultSessionStatus.ANALYSIS_PENDING },
      }),
    ).rejects.toThrow()

    authenticate(consult)
    const pendingResponse = await issue(consult, 'hair_left', 'direct-pending')
    const pendingUpload = (await body(pendingResponse)).upload as {
      uploadSessionId: string
    }
    await expect(
      db.uploadSession.update({
        where: { id: pendingUpload.uploadSessionId },
        data: { status: UploadSessionStatus.CONSUMED, consumedAt: new Date() },
      }),
    ).rejects.toThrow()

    const captureId = await issueAttach(consult, 'hair_right', 'direct-quality')
    await expect(
      db.consultCapture.update({
        where: { id: captureId },
        data: {
          status: ConsultCaptureStatus.ACCEPTED,
          qualityReasonCode: 'PASS',
          qualitySchemaVersion: 1,
          qualityPromptVersion: 'unversioned-direct-write',
          qualityModel: 'direct-write',
          qualityCheckedAt: new Date(),
          qualityIdempotencyKey: 'direct-quality',
          qualityRequestHash: 'a'.repeat(64),
        },
      }),
    ).rejects.toThrow()
    const attached = await db.consultCapture.findUniqueOrThrow({
      where: { id: captureId },
      select: { uploadSessionId: true },
    })
    await expect(
      db.uploadSession.delete({ where: { id: attached.uploadSessionId } }),
    ).rejects.toThrow()
  })

  it('runs one canonical C4 analysis for concurrent retries, resolves an active offering, and verifies raw purge', async () => {
    const consult = await createReadyConsult('analysis-success')
    authenticate(consult)
    await completeCapturePack(consult, 'analysis-success')
    const before = await db.consultSession.findUniqueOrThrow({
      where: { id: consult.sessionId },
      select: { revisionSequence: true },
    })

    // Both starts race the claim. P4b makes the loser's answer the LIVE RUN
    // rather than a second claim, so a double-tap costs nothing: one claim,
    // one run, one paid analysis.
    const [first, retry] = await Promise.all([
      startAnalysisRequest(consult, 'canonical-analysis'),
      startAnalysisRequest(consult, 'canonical-analysis'),
    ])
    expect(first.status).toBe(200)
    expect(retry.status).toBe(200)
    expect(
      await db.consultAnalysisRun.count({
        where: { consultSessionId: consult.sessionId },
      }),
    ).toBe(1)
    expect(fake.analysisCalls).toBe(0)

    await processConsultAnalysisRuns({ take: 1 })
    expect(fake.analysisCalls).toBe(1)
    expect([await body(first), await body(retry)]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ replayed: false }),
        expect.objectContaining({ replayed: true }),
      ]),
    )

    const session = await db.consultSession.findUniqueOrThrow({
      where: { id: consult.sessionId },
      select: { status: true, revisionSequence: true },
    })
    expect(session).toEqual({
      status: ConsultSessionStatus.COMPLETED,
      revisionSequence: before.revisionSequence + 2,
    })
    const revisions = await db.consultRevision.findMany({
      where: { consultSessionId: consult.sessionId, kind: 'ANALYSIS' },
    })
    expect(revisions).toHaveLength(1)
    expect(revisions[0]).toMatchObject({
      schemaVersion: CONSULT_ANALYSIS_SCHEMA_VERSION,
      promptVersion: CONSULT_ANALYSIS_PROMPT_VERSION,
      model: 'fake-analysis-model',
      idempotencyKey: 'canonical-analysis',
    })
    expect(revisions[0]?.payload).toMatchObject({
      safetyFlags: expect.arrayContaining([
        expect.objectContaining({
          code: 'ALLERGY_HISTORY_UNKNOWN',
          discussWithProfessional: true,
        }),
      ]),
      recommendations: [
        expect.objectContaining({
          reference: {
            type: 'SERVICE',
            serviceId,
            serviceCategoryId: categoryId,
          },
        }),
      ],
    })
    const brief = await db.consultRevision.findFirstOrThrow({
      where: { consultSessionId: consult.sessionId, kind: 'BRIEF' },
    })
    expect(brief).toMatchObject({
      revision: revisions[0]!.revision + 1,
      schemaVersion: 3,
      promptVersion: 'full-analysis-pro-brief-v3',
      model: null,
      idempotencyKey: null,
      requestHash: null,
      payload: {
        sourceAnalysisRevisionId: revisions[0]!.id,
        sourceAnalysisRevision: revisions[0]!.revision,
        intakeRevisionId: expect.any(String),
        inspiration: expect.objectContaining({
          source: 'NONE',
          inspirationId: null,
          exactClientDetails: [],
          possibleProfessionalInterpretation: [],
        }),
        clientIntake: expect.any(Array),
        aiObservations: expect.any(Object),
        safetyFlags: expect.arrayContaining([
          expect.objectContaining({
            code: 'ALLERGY_HISTORY_UNKNOWN',
            discussWithProfessional: true,
          }),
        ]),
        achievabilityDirection: expect.objectContaining({
          discussWithProfessional: true,
          direction: expect.stringContaining('Discuss'),
        }),
        recommendationDirections: expect.arrayContaining([
          expect.objectContaining({
            discussWithProfessional: true,
            direction: expect.stringContaining('discuss'),
          }),
        ]),
      },
    })
    const captures = await db.consultCapture.findMany({
      where: { consultSessionId: consult.sessionId, status: ConsultCaptureStatus.ACCEPTED },
      select: { purgedAt: true, storagePath: true, storageBucket: true },
    })
    expect(captures).toHaveLength(7)
    expect(captures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          purgedAt: expect.any(Date),
          storagePath: null,
          storageBucket: null,
        }),
      ]),
    )
    expect(fake.purgedPaths).toHaveLength(7)

    const audits = await db.consultAuditEvent.findMany({
      where: { consultSessionId: consult.sessionId },
    })
    expect(
      audits.filter(
        (event) =>
          event.fromStatus === ConsultSessionStatus.ANALYSIS_PENDING &&
          event.toStatus === ConsultSessionStatus.ANALYZING,
      ),
    ).toHaveLength(1)
    expect(
      audits.filter(
        (event) =>
          event.fromStatus === ConsultSessionStatus.ANALYZING &&
          event.toStatus === ConsultSessionStatus.COMPLETED,
      ),
    ).toHaveLength(1)
    expect(audits.filter((event) => event.revisionId === revisions[0]?.id)).toHaveLength(1)
    // Decision 2026-08-26: cosmetic feature observations (skinUndertone,
    // eyeShape, …) are now first-class durable content, so they left this
    // list. Raw material and identity/medical terms remain forbidden.
    const durable = JSON.stringify({ revisions, brief, audits })
    for (const forbidden of [
      'consult-raw',
      'signed-upload-secret',
      'aGVsbG8=',
      'providerRequest',
      'providerResponse',
      'hiddenReasoning',
      'storagePath',
      'storageBucket',
      'ethnicity',
    ]) {
      expect(durable).not.toContain(forbidden)
    }
    expect(durable).toContain('styleDirections')
    expect(durable).toContain('skinUndertone')

    const feedback = await db.$transaction(async (tx) => {
      const created = await tx.consultBriefFeedback.create({
        data: {
          consultSessionId: consult.sessionId,
          briefRevisionId: brief.id,
          professionalId,
          rating: ConsultBriefFeedbackRating.ACCURATE_USEFUL,
        },
      })
      await tx.consultAuditEvent.create({
        data: {
          consultSessionId: consult.sessionId,
          action: ConsultAuditAction.BRIEF_FEEDBACK_RECORDED,
          actorType: ConsultActorType.PROFESSIONAL,
          actorId: professionalId,
          briefFeedbackId: created.id,
        },
      })
      return created
    })
    await expect(
      db.consultBriefFeedback.update({
        where: { id: feedback.id },
        data: { rating: ConsultBriefFeedbackRating.OFF },
      }),
    ).rejects.toThrow()

    const read = await getAnalysis(
      new Request(`http://test/api/v1/client/consult/${consult.sessionId}/analysis`),
      context(consult.sessionId),
    )
    expect(read.status).toBe(200)
    expect(await body(read)).toMatchObject({
      analysis: {
        status: ConsultSessionStatus.COMPLETED,
        schemaVersion: CONSULT_ANALYSIS_SCHEMA_VERSION,
        promptVersion: CONSULT_ANALYSIS_PROMPT_VERSION,
        result: { revisionId: revisions[0]?.id },
      },
    })
  })

  it('fails before provider work when a required Patch Test offering is unavailable', async () => {
    const consult = await createReadyConsult('missing-patch-test', {
      prior_reaction: 'yes',
    })
    authenticate(consult)
    await completeCapturePack(consult, 'missing-patch-test')

    const response = await analysisRequest(consult, 'missing-patch-test')
    expect(response.status).toBe(409)
    expect(await body(response)).toMatchObject({
      code: 'CONSULT_ANALYSIS_PREREQUISITES_REQUIRED',
    })
    expect(fake.analysisCalls).toBe(0)
  })

  it('replaces chemical directions with exact free Patch/Strand Test services', async () => {
    const patchTestServiceId = await createSafetyOffering({
      name: 'Patch Test',
      durationMinutes: 10,
    })
    const strandTestServiceId = await createSafetyOffering({
      name: 'Strand Test',
      durationMinutes: 15,
    })
    const consult = await createReadyConsult('deterministic-tests', {
      prior_reaction: 'yes',
      henna_plant_dye_history: 'within-6-months',
    })
    authenticate(consult)
    await completeCapturePack(consult, 'deterministic-tests')

    const response = await analysisRequest(consult, 'deterministic-tests')
    expect(response.status).toBe(200)
    const analysis = await db.consultRevision.findFirstOrThrow({
      where: { consultSessionId: consult.sessionId, kind: 'ANALYSIS' },
      select: { payload: true },
    })
    expect(analysis.payload).toMatchObject({
      safetyFlags: expect.arrayContaining([
        expect.objectContaining({ code: 'PRIOR_REACTION' }),
      ]),
      recommendations: [
        expect.objectContaining({
          serviceIntent: 'PATCH_TEST',
          reference: {
            type: 'SERVICE',
            serviceId: patchTestServiceId,
            serviceCategoryId: categoryId,
          },
        }),
        expect.objectContaining({
          serviceIntent: 'STRAND_TEST',
          reference: {
            type: 'SERVICE',
            serviceId: strandTestServiceId,
            serviceCategoryId: categoryId,
          },
        }),
        expect.objectContaining({ serviceIntent: 'CONSULTATION' }),
      ],
    })
    expect(JSON.stringify(analysis.payload)).not.toContain(
      'Review a realistic red direction and chemical history.',
    )
  })

  it('keeps provider failures retriable with no analysis revision, sequence effect, or committed transition', async () => {
    const consult = await createReadyConsult('analysis-provider-failure')
    authenticate(consult)
    await completeCapturePack(consult, 'analysis-provider-failure')
    const before = await db.consultSession.findUniqueOrThrow({
      where: { id: consult.sessionId },
      select: { revisionSequence: true },
    })
    fake.analysisFails = true

    // P4b: the START always succeeds — it makes no provider call. The failure
    // happens in the worker and lands on the RUN, which is the thing the
    // client is polling.
    const started = await startAnalysisRequest(consult, 'provider-failure')
    expect(started.status).toBe(200)

    // The run spends its whole attempt budget, one drain per attempt. Each
    // retry is scheduled 15s out, so the drain has to be given a clock that
    // has reached it — otherwise the run simply is not due and nothing runs.
    const attempts: string[] = []
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const drained = await processConsultAnalysisRuns({
        now: new Date(Date.now() + attempt * 20_000),
        take: 1,
      })
      attempts.push(drained.outcomes[0]?.result ?? 'NOTHING_DUE')
    }
    expect(attempts).toEqual([
      'RETRY_SCHEDULED',
      'RETRY_SCHEDULED',
      'FAILED_FINAL',
    ])
    expect(fake.analysisCalls).toBe(3)

    const failedRun = await db.consultAnalysisRun.findFirstOrThrow({
      where: { consultSessionId: consult.sessionId },
      orderBy: { createdAt: 'desc' },
    })
    expect(failedRun).toMatchObject({
      status: 'FAILED',
      attemptCount: 3,
      failureCode: 'ANALYSIS_UNAVAILABLE',
    })

    // Nothing durable was written, and the session is parked in ANALYZING —
    // NOT walked back to ANALYSIS_PENDING. Walking it back is what would wedge
    // the consult forever: the claim audit index below permits one such row
    // per consult for all time, so a second claim could never be recorded.
    expect(
      await db.consultSession.findUniqueOrThrow({
        where: { id: consult.sessionId },
        select: { status: true, revisionSequence: true },
      }),
    ).toEqual({
      status: ConsultSessionStatus.ANALYZING,
      revisionSequence: before.revisionSequence,
    })
    expect(
      await db.consultRevision.count({
        where: { consultSessionId: consult.sessionId, kind: 'ANALYSIS' },
      }),
    ).toBe(0)

    // The retry: a NEW run against the SAME claim, under the same idempotency
    // key, and it completes.
    fake.analysisFails = false
    const recovered = await analysisRequest(consult, 'provider-failure')
    expect(recovered.status).toBe(200)
    expect(fake.analysisCalls).toBe(4)
    expect(
      await db.consultSession.findUniqueOrThrow({
        where: { id: consult.sessionId },
        select: { status: true },
      }),
    ).toEqual({ status: ConsultSessionStatus.COMPLETED })
    expect(
      await db.consultAnalysisRun.count({
        where: { consultSessionId: consult.sessionId },
      }),
    ).toBe(2)

    // 🔴 Still exactly ONE claim transition, across a failure and a recovery.
    expect(
      await db.consultAuditEvent.count({
        where: {
          consultSessionId: consult.sessionId,
          fromStatus: ConsultSessionStatus.ANALYSIS_PENDING,
          toStatus: ConsultSessionStatus.ANALYZING,
        },
      }),
    ).toBe(1)
  })

  it('recovers a run whose worker died mid-flight, once its lease expires', async () => {
    // 🔴 The only thing standing between a killed function (a deploy, an OOM,
    // a platform timeout) and a client watching a spinner forever. The run is
    // left RUNNING with a stale `claimedAt` and nothing to finish it; the
    // stale-lease sweep is what picks it back up.
    //
    // Worth its own test because the failure mode is SILENCE: a run stuck in
    // RUNNING throws nothing, logs nothing, and notifies nobody. If this path
    // regressed, every other test in this file would still pass.
    const consult = await createReadyConsult('analysis-stale-lease')
    authenticate(consult)
    await completeCapturePack(consult, 'analysis-stale-lease')

    const started = await startAnalysisRequest(consult, 'stale-lease')
    expect(started.status).toBe(200)

    // Simulate the worker that claimed it and then vanished.
    const abandonedAt = new Date(Date.now() - 10 * 60_000)
    await db.consultAnalysisRun.updateMany({
      where: { consultSessionId: consult.sessionId },
      data: {
        status: 'RUNNING',
        stage: 'BUILDING_PLAN',
        claimedAt: abandonedAt,
        startedAt: abandonedAt,
        attemptCount: 1,
      },
    })

    // A sweep BEFORE the lease expires must leave it alone — otherwise two
    // workers analyze the same consult and the client pays twice.
    const tooSoon = await processConsultAnalysisRuns({
      now: new Date(abandonedAt.getTime() + 60_000),
      take: 1,
    })
    expect(tooSoon.scannedCount).toBe(0)
    expect(
      await db.consultAnalysisRun.findFirstOrThrow({
        where: { consultSessionId: consult.sessionId },
        select: { status: true },
      }),
    ).toEqual({ status: 'RUNNING' })

    // Past the lease (420s), it is claimable again and finishes.
    const recovered = await processConsultAnalysisRuns({ take: 1 })
    expect(recovered.outcomes[0]?.result).toBe('COMPLETED')
    expect(
      await db.consultSession.findUniqueOrThrow({
        where: { id: consult.sessionId },
        select: { status: true },
      }),
    ).toEqual({ status: ConsultSessionStatus.COMPLETED })

    // Recovery re-used the SAME run — a fresh row would have meant two runs
    // for one claim, which the live-run index exists to prevent.
    const runs = await db.consultAnalysisRun.findMany({
      where: { consultSessionId: consult.sessionId },
    })
    expect(runs).toHaveLength(1)
    expect(runs[0]).toMatchObject({ status: 'COMPLETED', attemptCount: 2 })
  })

  it('keeps completed analysis durable and lets cleanup retry a failed post-commit purge', async () => {
    const consult = await createReadyConsult('analysis-purge-retry')
    authenticate(consult)
    await completeCapturePack(consult, 'analysis-purge-retry')
    const capture = await db.consultCapture.findFirstOrThrow({
      where: {
        consultSessionId: consult.sessionId,
        status: ConsultCaptureStatus.ACCEPTED,
      },
      select: { id: true, storagePath: true },
    })
    if (!capture.storagePath) throw new Error('Expected raw capture fixture path.')
    fake.failPurgePaths.add(capture.storagePath)

    const response = await analysisRequest(consult, 'purge-retry')
    expect(response.status).toBe(200)
    expect(
      await db.consultSession.findUniqueOrThrow({
        where: { id: consult.sessionId },
        select: { status: true },
      }),
    ).toEqual({ status: ConsultSessionStatus.COMPLETED })
    expect(
      await db.consultRevision.count({
        where: { consultSessionId: consult.sessionId, kind: 'ANALYSIS' },
      }),
    ).toBe(1)
    expect(
      await db.consultCapture.findUniqueOrThrow({
        where: { id: capture.id },
        select: {
          purgedAt: true,
          purgeEligibleAt: true,
          purgeRequestedAt: true,
          storagePath: true,
        },
      }),
    ).toMatchObject({
      purgedAt: null,
      purgeEligibleAt: expect.any(Date),
      purgeRequestedAt: expect.any(Date),
      storagePath: capture.storagePath,
    })

    expect(await runConsultCapturePurgeSweep(new Date())).toMatchObject({
      considered: 1,
      purged: 1,
      failed: 0,
    })
    expect(
      await db.consultCapture.findUniqueOrThrow({
        where: { id: capture.id },
        select: { purgedAt: true, storagePath: true },
      }),
    ).toMatchObject({ purgedAt: expect.any(Date), storagePath: null })
  })

  it('falls back to the authoritative active hair-color category when no active service match exists', async () => {
    const consult = await createReadyConsult('analysis-category-fallback')
    authenticate(consult)
    await completeCapturePack(consult, 'analysis-category-fallback')
    await db.professionalServiceOffering.update({
      where: { professionalId_serviceId: { professionalId, serviceId } },
      data: { isActive: false },
    })
    try {
      const response = await analysisRequest(consult, 'category-fallback')
      expect(response.status).toBe(200)
      const revision = await db.consultRevision.findFirstOrThrow({
        where: { consultSessionId: consult.sessionId, kind: 'ANALYSIS' },
        select: { payload: true },
      })
      expect(revision.payload).toMatchObject({
        recommendations: [
          expect.objectContaining({
            reference: {
              type: 'SERVICE_CATEGORY',
              serviceId: null,
              serviceCategoryId: categoryId,
            },
          }),
        ],
      })
    } finally {
      await db.professionalServiceOffering.update({
        where: { professionalId_serviceId: { professionalId, serviceId } },
        data: { isActive: true },
      })
    }
  })

  it('fails analysis closed for foreign ownership, founder disable, and newly published legal versions before provider work', async () => {
    const owner = await createReadyConsult('analysis-owner-gates')
    const foreign = await createReadyConsult('analysis-foreign-gates')
    authenticate(owner)
    await completeCapturePack(owner, 'analysis-owner-gates')

    authenticate(foreign)
    const stolen = await analysisRequest(owner, 'foreign-owner')
    expect(stolen.status).toBe(404)
    expect(fake.analysisCalls).toBe(0)

    authenticate(owner)
    delete process.env.ENABLE_AI_CONSULT
    const darkRequest = jsonRequest(`/api/v1/client/consult/${owner.sessionId}/analysis`, {
      idempotencyKey: 'dark-analysis',
      schemaVersion: CONSULT_ANALYSIS_SCHEMA_VERSION,
      promptVersion: CONSULT_ANALYSIS_PROMPT_VERSION,
    })
    const darkJson = vi.spyOn(darkRequest, 'json')
    const dark = await startAnalysis(darkRequest, context(owner.sessionId))
    process.env.ENABLE_AI_CONSULT = '1'
    expect(dark.status).toBe(404)
    expect(darkJson).not.toHaveBeenCalled()
    expect(fake.analysisCalls).toBe(0)

    const replacement = await db.consultAgreementVersion.create({
      data: {
        kind: ConsultAgreementKind.SENSITIVE_DATA_CONSENT,
        version: versionBase + 2,
        title: 'Explicit newer analysis consent fixture',
        body: 'Explicit newer analysis consent fixture only.',
      },
      select: { id: true },
    })
    try {
      const stale = await analysisRequest(owner, 'stale-analysis-consent')
      expect(stale.status).toBe(409)
      expect(await body(stale)).toMatchObject({
        code: 'CONSULT_PREREQUISITES_REQUIRED',
      })
      expect(fake.analysisCalls).toBe(0)
    } finally {
      await db.consultAgreementVersion.delete({ where: { id: replacement.id } })
    }
  })

  it('discards an in-flight result when booking cancellation marks captures for purge', async () => {
    const consult = await createReadyConsult('analysis-cancel-race')
    authenticate(consult)
    await completeCapturePack(consult, 'analysis-cancel-race')
    fake.analysisDuring = async () => {
      await db.booking.update({
        where: { id: consult.bookingId },
        data: { status: BookingStatus.CANCELLED },
      })
    }
    // P4b: the discard happens in the RUN, which is where the provider call
    // now lives. The client's start request already returned 200; what she
    // learns is that the run failed, and the refusal code says why.
    const response = await startAnalysisRequest(consult, 'cancel-race')
    expect(response.status).toBe(200)
    const drained = await processConsultAnalysisRuns({ take: 1 })
    expect(drained.outcomes[0]).toMatchObject({
      result: 'FAILED_FINAL',
      failureCode: 'BOOKING_INELIGIBLE',
    })
    expect(fake.analysisCalls).toBe(1)
    expect(
      await db.consultRevision.count({
        where: { consultSessionId: consult.sessionId, kind: 'ANALYSIS' },
      }),
    ).toBe(0)
    // The claim stands; the run is what failed. Walking the session back to
    // ANALYSIS_PENDING is the move that would make it unclaimable forever.
    expect(
      await db.consultSession.findUniqueOrThrow({
        where: { id: consult.sessionId },
        select: { status: true },
      }),
    ).toEqual({ status: ConsultSessionStatus.ANALYZING })
    expect(
      await db.consultCapture.count({
        where: {
          consultSessionId: consult.sessionId,
          purgeRequestedAt: { not: null },
        },
      }),
    ).toBe(7)
  })

  it('rejects a structurally incomplete analysis payload at the direct database guard', async () => {
    const consult = await createReadyConsult('analysis-payload-guard')
    authenticate(consult)
    await completeCapturePack(consult, 'analysis-payload-guard')
    await db.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`
        SELECT "id" FROM "ConsultSession"
        WHERE "id" = ${consult.sessionId}
        FOR UPDATE
      `)
      await transitionLockedConsultSession(tx, {
        consultSessionId: consult.sessionId,
        actor: { type: ConsultActorType.CLIENT, id: consult.userId },
        fromStatus: ConsultSessionStatus.ANALYSIS_PENDING,
        toStatus: ConsultSessionStatus.ANALYZING,
      })
    })
    const sequenced = await db.consultSession.update({
      where: { id: consult.sessionId },
      data: { revisionSequence: { increment: 1 } },
      select: { revisionSequence: true },
    })

    await expect(
      db.consultRevision.create({
        data: {
          consultSessionId: consult.sessionId,
          revision: sequenced.revisionSequence,
          kind: 'ANALYSIS',
          payload: {
            core: {
              baseLevel: {
                value: 'LEVEL_4',
                confidence: { min: 0.5, max: 0.75 },
                evidence: ['hair_back'],
              },
              lightestLevel: {
                value: 'LEVEL_5',
                confidence: { min: 0.5, max: 0.75 },
                evidence: ['hair_back'],
              },
              currentTone: {
                value: 'MIXED',
                confidence: { min: 0.4, max: 0.7 },
                evidence: ['hair_back'],
              },
              visibleCondition: {
                value: 'NO_VISIBLE_CONCERN',
                confidence: { min: 0.4, max: 0.7 },
                evidence: ['hair_back'],
              },
              density: {
                value: 'UNKNOWN',
                confidence: { min: 0, max: 0.25 },
                evidence: [],
              },
              texture: {
                value: 'WAVY',
                confidence: { min: 0.4, max: 0.7 },
                evidence: ['hair_back'],
              },
            },
            serviceLens: {
              // Intentionally missing required `goal`.
              history: 'Chemical history comes from the intake.',
              constraints: 'Allergy history and constraints are unknown.',
              maintenance: 'Maintenance tolerance is unknown.',
              appointmentContext: 'Appointment context comes from the intake.',
              achievability: 'REQUIRES_PRO_ASSESSMENT',
              achievabilityReason: 'A professional should confirm the plan.',
              discussWithProfessional: true,
            },
            safetyFlags: [
              {
                code: 'ALLERGY_HISTORY_UNKNOWN',
                summary: 'Allergy history is unknown; discuss precautions with the professional.',
                discussWithProfessional: true,
              },
            ],
            recommendations: [
              {
                service: 'A consultation with the professional',
                title: 'Hair color consultation',
                rationale: 'Confirm a bounded color direction together.',
                achievability: 'The professional should confirm the appointment plan.',
                discussWithProfessional: true,
                reference: {
                  type: 'SERVICE_CATEGORY',
                  serviceId: null,
                  serviceCategoryId: categoryId,
                },
              },
            ],
          },
          schemaVersion: 1,
          promptVersion: 'hair-color-analysis-v1',
          model: 'direct-guard-test',
          idempotencyKey: 'direct-payload-guard',
          requestHash: 'd'.repeat(64),
        },
      }),
    ).rejects.toThrow('invalid versioned service-analysis payload')
  })

  it('keeps inspiration optional but requires an explicit fresh decision before analysis', async () => {
    const consult = await createReadyConsult('inspiration-skip-last', {}, {
      skipInspiration: false,
    })
    authenticate(consult)
    await completeCapturePack(consult, 'inspiration-skip-last')

    expect(
      (await db.consultSession.findUniqueOrThrow({
        where: { id: consult.sessionId },
        select: { status: true },
      })).status,
    ).toBe(ConsultSessionStatus.MEDIA_READY)
    await expect(
      db.consultSession.update({
        where: { id: consult.sessionId },
        data: { status: ConsultSessionStatus.ANALYSIS_PENDING },
      }),
    ).rejects.toThrow()

    const first = await skipConsultInspiration({
      consultSessionId: consult.sessionId,
      clientId: consult.clientId,
      actor: { type: ConsultActorType.CLIENT, id: consult.userId },
      input: { idempotencyKey: 'skip-last', schemaVersion: 1 },
    })
    expect(first.state.status).toBe(ConsultSessionStatus.ANALYSIS_PENDING)
    expect(first.state.latestReview).toMatchObject({
      source: 'NONE',
      complete: true,
      answers: [],
    })
  })

  it('rejects a forged complete review with fewer than three specifics at the database boundary', async () => {
    const consult = await createReadyConsult('inspiration-db-payload', {}, {
      skipInspiration: false,
    })
    await expect(
      db.$transaction(async (tx) => {
        await tx.$queryRaw(Prisma.sql`
          SELECT "id" FROM "ConsultSession"
          WHERE "id" = ${consult.sessionId}
          FOR UPDATE
        `)
        return appendLockedConsultInspirationRevision(tx, {
          consultSessionId: consult.sessionId,
          schemaVersion: 1,
          idempotencyKey: 'forged-inspiration-review',
          requestHash: 'f'.repeat(64),
          actor: { type: ConsultActorType.CLIENT, id: consult.userId },
          payload: {
            contractId: 'hair-color-guided-inspiration',
            contractVersion: 1,
            schemaVersion: 1,
            source: 'EXTERNAL_UPLOAD',
            inspirationId: 'forged-source',
            complete: true,
            answers: [
              { questionKey: 'favorite_colors', selectedValues: ['not-sure'], text: null, sentiment: null },
              { questionKey: 'avoid_colors', selectedValues: ['none'], text: null, sentiment: null },
              { questionKey: 'length_goal', selectedValues: ['not-part-of-goal'], text: null, sentiment: null },
              { questionKey: 'fullness_goal', selectedValues: ['not-sure'], text: null, sentiment: null },
              { questionKey: 'current_styling', selectedValues: ['not-sure'], text: null, sentiment: null },
              { questionKey: 'styling_walkthrough', selectedValues: ['yes'], text: null, sentiment: null },
              { questionKey: 'other_detail', selectedValues: ['nothing-else'], text: null, sentiment: 'NONE' },
            ],
            exactClientDetails: [],
            possibleProfessionalInterpretation: [],
            catalogGuidance: [],
          },
        })
      }),
    ).rejects.toThrow('invalid guided inspiration review')
  })

  it('links a currently authorized booked-pro Look without copying media bytes', async () => {
    const consult = await createReadyConsult('inspiration-look', {}, {
      skipInspiration: false,
    })
    const media = await db.mediaAsset.create({
      data: {
        professionalId,
        proTenantId: tenantId,
        primaryServiceId: serviceId,
        mediaType: MediaType.IMAGE,
        visibility: MediaVisibility.PUBLIC,
        storageBucket: 'media-public',
        storagePath: `${tag}/booked-pro-look.jpg`,
      },
      select: { id: true },
    })
    lookAssetIds.push(media.id)
    const look = await db.lookPost.create({
      data: {
        professionalId,
        primaryMediaAssetId: media.id,
        serviceId,
        status: LookPostStatus.PUBLISHED,
        visibility: LookPostVisibility.UNLISTED,
        moderationStatus: ModerationStatus.APPROVED,
        publishedAt: new Date(),
      },
      select: { id: true },
    })
    const mediaCount = await db.mediaAsset.count()

    const selected = await chooseConsultInspirationLook({
      consultSessionId: consult.sessionId,
      clientId: consult.clientId,
      actor: { type: ConsultActorType.CLIENT, id: consult.userId },
      input: {
        idempotencyKey: 'select-booked-look',
        schemaVersion: 1,
        source: 'BOOKED_PRO_LOOK',
        lookPostId: look.id,
      },
    })
    expect(selected.state.source).toMatchObject({
      source: 'BOOKED_PRO_LOOK',
      lookPostId: look.id,
      imageAvailable: true,
    })
    expect(await db.mediaAsset.count()).toBe(mediaCount)
    expect(
      await db.consultInspiration.findFirstOrThrow({
        where: { consultSessionId: consult.sessionId },
        select: { storageBucket: true, storagePath: true },
      }),
    ).toEqual({ storageBucket: null, storagePath: null })

    const forgedScope = await createReadyConsult(
      'inspiration-forged-look-source',
      {},
      { skipInspiration: false },
    )
    await expect(
      db.consultInspiration.create({
        data: {
          consultSessionId: forgedScope.sessionId,
          source: 'PLATFORM_LOOK',
          status: 'ATTACHED',
          sourceLookPostId: look.id,
          sourceIdempotencyKey: 'forged-classification',
          sourceRequestHash: 'f'.repeat(64),
        },
      }),
    ).rejects.toThrow()

    await db.lookPost.update({
      where: { id: look.id },
      data: { status: LookPostStatus.ARCHIVED },
    })
    const state = await loadConsultInspirationState({
      consultSessionId: consult.sessionId,
      clientId: consult.clientId,
      actorUserId: consult.userId,
    })
    expect(state.source?.imageAvailable).toBe(false)
    const rls = await db.$queryRaw<Array<{ relrowsecurity: boolean }>>(Prisma.sql`
      SELECT relrowsecurity FROM pg_class WHERE oid = '"ConsultInspiration"'::regclass
    `)
    expect(rls).toEqual([{ relrowsecurity: true }])
  })

  it('rechecks platform Look visibility and follow authorization without taking ownership', async () => {
    const consult = await createReadyConsult('inspiration-platform-look', {}, {
      skipInspiration: false,
    })
    const ownerUser = await db.user.create({
      data: {
        email: `${tag}_platform_look_owner@example.com`,
        password: 'x',
        role: Role.PRO,
      },
      select: { id: true },
    })
    auxiliaryUserIds.push(ownerUser.id)
    const owner = await db.professionalProfile.create({
      data: {
        userId: ownerUser.id,
        homeTenantId: tenantId,
        firstName: 'Platform',
        lastName: 'Owner',
        verificationStatus: VerificationStatus.APPROVED,
      },
      select: { id: true },
    })
    auxiliaryProfessionalIds.push(owner.id)
    const media = await db.mediaAsset.create({
      data: {
        professionalId: owner.id,
        proTenantId: tenantId,
        primaryServiceId: serviceId,
        mediaType: MediaType.IMAGE,
        visibility: MediaVisibility.PUBLIC,
        storageBucket: 'media-public',
        storagePath: `${tag}/platform-look.jpg`,
      },
      select: { id: true },
    })
    lookAssetIds.push(media.id)
    const look = await db.lookPost.create({
      data: {
        professionalId: owner.id,
        primaryMediaAssetId: media.id,
        serviceId,
        status: LookPostStatus.PUBLISHED,
        visibility: LookPostVisibility.PUBLIC,
        moderationStatus: ModerationStatus.APPROVED,
        publishedAt: new Date(),
      },
      select: { id: true },
    })
    const selected = await chooseConsultInspirationLook({
      consultSessionId: consult.sessionId,
      clientId: consult.clientId,
      actor: { type: ConsultActorType.CLIENT, id: consult.userId },
      input: {
        idempotencyKey: 'select-platform-look',
        schemaVersion: 1,
        source: 'PLATFORM_LOOK',
        lookPostId: look.id,
      },
    })
    expect(selected.state.source).toMatchObject({
      source: 'PLATFORM_LOOK',
      lookPostId: look.id,
      imageAvailable: true,
    })

    await db.lookPost.update({
      where: { id: look.id },
      data: { visibility: LookPostVisibility.FOLLOWERS_ONLY },
    })
    expect(
      (await loadConsultInspirationState({
        consultSessionId: consult.sessionId,
        clientId: consult.clientId,
        actorUserId: consult.userId,
      })).source?.imageAvailable,
    ).toBe(false)
    await db.proFollow.create({
      data: { clientId: consult.clientId, professionalId: owner.id },
    })
    expect(
      (await loadConsultInspirationState({
        consultSessionId: consult.sessionId,
        clientId: consult.clientId,
        actorUserId: consult.userId,
      })).source?.imageAvailable,
    ).toBe(false)
  })

  it('serializes concurrent external issue and attach retries without duplicate evidence', async () => {
    const consult = await createReadyConsult('inspiration-concurrent', {}, {
      skipInspiration: false,
    })
    const issueArgs = {
      consultSessionId: consult.sessionId,
      clientId: consult.clientId,
      actor: { type: ConsultActorType.CLIENT, id: consult.userId } as const,
      input: {
        idempotencyKey: 'concurrent-issue',
        schemaVersion: 1,
        contentType: 'image/jpeg',
        sizeBytes: 100,
        checksumSha256: null,
      },
    }
    const issued = await Promise.all([
      issueConsultInspirationUpload(issueArgs),
      issueConsultInspirationUpload(issueArgs),
    ])
    expect(new Set(issued.map(({ upload }) => upload.inspirationId)).size).toBe(1)
    expect(issued.map(({ replayed }) => replayed).sort()).toEqual([false, true])
    const row = await db.consultInspiration.findUniqueOrThrow({
      where: { id: issued[0]!.upload.inspirationId },
    })
    fake.objects.set(row.storagePath!, {
      contentType: 'image/jpeg',
      sizeBytes: 100,
      checksumSha256: null,
    })
    const attachArgs = {
      consultSessionId: consult.sessionId,
      clientId: consult.clientId,
      actor: { type: ConsultActorType.CLIENT, id: consult.userId } as const,
      input: {
        idempotencyKey: 'concurrent-attach',
        inspirationId: row.id,
        schemaVersion: 1,
      },
    }
    const attached = await Promise.all([
      attachConsultInspirationUpload(attachArgs),
      attachConsultInspirationUpload(attachArgs),
    ])
    expect(attached.map(({ replayed }) => replayed).sort()).toEqual([false, true])
    expect(
      await db.consultInspiration.count({
        where: { consultSessionId: consult.sessionId },
      }),
    ).toBe(1)
    expect(
      await db.consultAuditEvent.count({
        where: {
          inspirationId: row.id,
          action: ConsultAuditAction.INSPIRATION_UPLOAD_ATTACHED,
        },
      }),
    ).toBe(1)
  })

  it('keeps an external image private and completes seven ordered answers with bounded guidance', async () => {
    const consult = await createReadyConsult('inspiration-external', {}, {
      skipInspiration: false,
    })
    const itemCountBefore = await db.bookingServiceItem.count({
      where: { bookingId: consult.bookingId },
    })
    const stylingService = await db.service.create({
      data: {
        name: `${tag} Style Finish`,
        categoryId,
        defaultDurationMinutes: 20,
        minPrice: new Prisma.Decimal('30.00'),
      },
      select: { id: true },
    })
    auxiliaryServiceIds.push(stylingService.id)
    await db.professionalServiceOffering.create({
      data: {
        professionalId,
        serviceId: stylingService.id,
        isActive: true,
        offersInSalon: true,
        salonPriceStartingAt: new Prisma.Decimal('30.00'),
        salonDurationMinutes: 20,
      },
    })
    const row = await attachExternalInspiration(consult, 'external')
    expect(row.storageBucket).toBe('media-private')
    expect(row.storagePath).toMatch(/^consult-inspiration\/v1\/[0-9a-f-]+\.jpg$/)
    expect(row.storagePath).not.toContain(consult.clientId)
    await expect(
      answerConsultInspirationQuestion({
        consultSessionId: consult.sessionId,
        clientId: consult.clientId,
        actor: { type: ConsultActorType.CLIENT, id: consult.userId },
        input: {
          idempotencyKey: 'out-of-order',
          schemaVersion: 1,
          questionKey: 'avoid_colors',
          selectedValues: ['none'],
        },
      }),
    ).rejects.toMatchObject({ code: 'INSPIRATION_QUESTION_OUT_OF_ORDER' })

    const answers = [
      ['favorite_colors', ['cool-smoky'], undefined, undefined],
      ['avoid_colors', ['none'], undefined, undefined],
      ['length_goal', ['yes-same-length'], undefined, undefined],
      ['fullness_goal', ['more-full'], undefined, undefined],
      ['current_styling', ['not-sure'], undefined, undefined],
      ['styling_walkthrough', ['no'], undefined, undefined],
      ['other_detail', ['nothing-else'], undefined, 'NONE'],
    ] as const
    let completed: Awaited<ReturnType<typeof answerConsultInspirationQuestion>> | null = null
    for (const [questionKey, selectedValues, text, sentiment] of answers) {
      try {
        completed = await answerConsultInspirationQuestion({
        consultSessionId: consult.sessionId,
        clientId: consult.clientId,
        actor: { type: ConsultActorType.CLIENT, id: consult.userId },
        input: {
          idempotencyKey: `answer-${questionKey}`,
          schemaVersion: 1,
          questionKey,
          selectedValues: [...selectedValues],
          text,
          sentiment,
        },
        })
      } catch (error) {
        throw new Error(`Failed guided answer ${questionKey}`, { cause: error })
      }
    }
    expect(completed?.state.latestReview).toMatchObject({
      complete: true,
      source: 'EXTERNAL_UPLOAD',
      answers: expect.arrayContaining([expect.objectContaining({ questionKey: 'other_detail' })]),
      exactClientDetails: expect.arrayContaining([
        expect.objectContaining({ clientWords: 'The cool or smoky colors' }),
      ]),
      possibleProfessionalInterpretation: expect.arrayContaining([
        expect.objectContaining({ confidence: 'POSSIBLE', evidence: 'CLIENT_SELECTION' }),
      ]),
      catalogGuidance: [
        expect.objectContaining({
          detail: 'STYLING',
          contextOnly: true,
          automaticallyAdded: false,
          message: expect.stringContaining('nothing was added'),
        }),
      ],
    })
    expect(completed?.state.progress).toMatchObject({
      answeredQuestionCount: 7,
      specificDetailCount: 3,
      canComplete: true,
    })
    expect(
      (await answerConsultInspirationQuestion({
        consultSessionId: consult.sessionId,
        clientId: consult.clientId,
        actor: { type: ConsultActorType.CLIENT, id: consult.userId },
        input: {
          idempotencyKey: 'answer-favorite_colors',
          schemaVersion: 1,
          questionKey: 'favorite_colors',
          selectedValues: ['cool-smoky'],
        },
      })).replayed,
    ).toBe(true)
    await expect(
      answerConsultInspirationQuestion({
        consultSessionId: consult.sessionId,
        clientId: consult.clientId,
        actor: { type: ConsultActorType.CLIENT, id: consult.userId },
        input: {
          idempotencyKey: 'answer-favorite_colors',
          schemaVersion: 1,
          questionKey: 'favorite_colors',
          selectedValues: ['warm-golden'],
        },
      }),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' })
    expect(
      await db.bookingServiceItem.count({ where: { bookingId: consult.bookingId } }),
    ).toBe(itemCountBefore)
    const read = await loadClientInspirationSignedRead({
      consultSessionId: consult.sessionId,
      clientId: consult.clientId,
      actorUserId: consult.userId,
    })
    expect(read).toEqual({
      url: 'https://storage.test/read/600',
      expiresInSeconds: 600,
    })
    await expect(
      loadProInspirationSignedRead({
        consultSessionId: consult.sessionId,
        professionalId,
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
    expect(await db.mediaAsset.count({ where: { storagePath: row.storagePath! } })).toBe(0)
    authenticate(consult)
    await completeCapturePack(consult, 'external-brief')

    // P4 — the failure path first, on the SAME consult, so the refusal is
    // proven against a session that is otherwise ready to analyze.
    //
    // An unreadable reference fails the RUN and writes nothing: no analysis
    // revision, no artefact, and the client is left with a retry. Part 0 rule
    // 4 — no silent fall-back to a picture-blind analysis, and none to the old
    // static question list.
    //
    // P4b: it is TERMINAL on the first attempt rather than burning the retry
    // budget. The same photograph read three times is the same non-answer and
    // two more paid calls.
    fake.inspirationUnreadable = true
    const refused = await analysisRequest(consult, 'external-unreadable')
    expect(refused.status).toBe(200)
    const unreadableRun = await db.consultAnalysisRun.findFirstOrThrow({
      where: { consultSessionId: consult.sessionId },
      orderBy: { createdAt: 'desc' },
    })
    expect(unreadableRun).toMatchObject({
      status: 'FAILED',
      attemptCount: 1,
      failureCode: 'INSPIRATION_ANALYSIS_UNREADABLE',
    })
    expect(fake.analysisCalls).toBe(0)
    expect(
      await db.consultRevision.count({
        where: {
          consultSessionId: consult.sessionId,
          kind: { in: ['ANALYSIS', 'INSPIRATION_ANALYSIS'] },
        },
      }),
    ).toBe(0)
    expect(
      await db.consultSession.findUniqueOrThrow({
        where: { id: consult.sessionId },
        select: { status: true },
      }),
    ).toEqual({ status: 'ANALYZING' })

    fake.inspirationUnreadable = false
    expect((await analysisRequest(consult, 'external-brief-analysis')).status).toBe(200)
    // The upload arm really went through the signed-read path, not a bucket
    // read of its own: the URL fetched is the one the fake storage minted.
    expect(fake.inspirationImageUrls).toContain('https://storage.test/read/600')
    expect(fake.inspirationVisionCalls).toBeGreaterThan(0)
    const brief = await db.consultRevision.findFirstOrThrow({
      where: { consultSessionId: consult.sessionId, kind: 'BRIEF' },
      orderBy: [{ revision: 'desc' }, { id: 'desc' }],
      select: { schemaVersion: true, promptVersion: true, payload: true },
    })
    expect(brief).toMatchObject({
      schemaVersion: 3,
      promptVersion: 'full-analysis-pro-brief-v3',
      payload: expect.objectContaining({
        inspiration: expect.objectContaining({
          source: 'EXTERNAL_UPLOAD',
          inspirationId: row.id,
          exactClientDetails: expect.arrayContaining([
            expect.objectContaining({ clientWords: 'The cool or smoky colors' }),
          ]),
          possibleProfessionalInterpretation: expect.arrayContaining([
            expect.objectContaining({ confidence: 'POSSIBLE' }),
          ]),
        }),
      }),
    })
    expect(JSON.stringify(brief.payload)).not.toMatch(
      /storagePath|storageBucket|signedUrl|base64/,
    )
    await expect(
      loadProInspirationSignedRead({
        consultSessionId: consult.sessionId,
        professionalId,
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await expect(
      loadProInspirationSignedRead({
        consultSessionId: consult.sessionId,
        professionalId: 'foreign-professional',
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('never mutates the Booking row across the seven-question external inspiration flow', async () => {
    const consult = await createReadyConsult('inspiration-booking-snapshot', {}, {
      skipInspiration: false,
    })
    const before = await db.booking.findUniqueOrThrow({ where: { id: consult.bookingId } })

    await attachExternalInspiration(consult, 'booking-snapshot')
    const answers = [
      ['favorite_colors', ['cool-smoky'], undefined, undefined],
      ['avoid_colors', ['none'], undefined, undefined],
      ['length_goal', ['yes-same-length'], undefined, undefined],
      ['fullness_goal', ['more-full'], undefined, undefined],
      ['current_styling', ['not-sure'], undefined, undefined],
      ['styling_walkthrough', ['no'], undefined, undefined],
      ['other_detail', ['nothing-else'], undefined, 'NONE'],
    ] as const
    let completed: Awaited<ReturnType<typeof answerConsultInspirationQuestion>> | null = null
    for (const [questionKey, selectedValues, text, sentiment] of answers) {
      completed = await answerConsultInspirationQuestion({
        consultSessionId: consult.sessionId,
        clientId: consult.clientId,
        actor: { type: ConsultActorType.CLIENT, id: consult.userId },
        input: {
          idempotencyKey: `booking-snapshot-answer-${questionKey}`,
          schemaVersion: 1,
          questionKey,
          selectedValues: [...selectedValues],
          text,
          sentiment,
        },
      })
    }
    // Guards against a vacuous pass: confirm the flow actually completed
    // before asserting nothing else moved.
    expect(completed?.state.progress).toMatchObject({
      answeredQuestionCount: 7,
      canComplete: true,
    })

    const after = await db.booking.findUniqueOrThrow({ where: { id: consult.bookingId } })
    expect(after).toEqual(before)
  })

  it('purges replaced, cancelled, and revoked external inspiration with verified retry', async () => {
    const replaced = await createReadyConsult('inspiration-replaced', {}, {
      skipInspiration: false,
    })
    const replacedRow = await attachExternalInspiration(replaced, 'replace')
    await skipConsultInspiration({
      consultSessionId: replaced.sessionId,
      clientId: replaced.clientId,
      actor: { type: ConsultActorType.CLIENT, id: replaced.userId },
      input: { idempotencyKey: 'replace-with-skip', schemaVersion: 1 },
    })
    expect(fake.objects.has(replacedRow.storagePath!)).toBe(false)
    expect(
      await db.consultInspiration.findUniqueOrThrow({
        where: { id: replacedRow.id },
        select: { status: true, storagePath: true, purgedAt: true },
      }),
    ).toMatchObject({ status: 'REPLACED', storagePath: null, purgedAt: expect.any(Date) })

    const cancelled = await createReadyConsult('inspiration-cancelled', {}, {
      skipInspiration: false,
    })
    const cancelledRow = await attachExternalInspiration(cancelled, 'cancel')
    const rescheduledFor = new Date(future.getTime() + 20 * 24 * 60 * 60 * 1000)
    await db.booking.update({
      where: { id: cancelled.bookingId },
      data: { scheduledFor: rescheduledFor },
    })
    expect(
      (await db.consultInspiration.findUniqueOrThrow({
        where: { id: cancelledRow.id },
        select: { useExpiresAt: true },
      })).useExpiresAt,
    ).toEqual(new Date(rescheduledFor.getTime() + 25 * 60 * 60 * 1000))
    await db.booking.update({
      where: { id: cancelled.bookingId },
      data: { status: BookingStatus.CANCELLED },
    })
    expect(
      await db.consultInspiration.findUniqueOrThrow({
        where: { id: cancelledRow.id },
        select: { purgeEligibleAt: true, purgeRequestedAt: true },
      }),
    ).toMatchObject({
      purgeEligibleAt: expect.any(Date),
      purgeRequestedAt: expect.any(Date),
    })
    expect(await runConsultInspirationPurgeSweep()).toMatchObject({
      considered: 1,
      purged: 1,
      failed: 0,
    })

    const revoked = await createReadyConsult('inspiration-revoked', {}, {
      skipInspiration: false,
    })
    const revokedRow = await attachExternalInspiration(revoked, 'revoke')
    const acceptance = await db.consultAgreementAcceptance.findFirstOrThrow({
      where: {
        consultSessionId: revoked.sessionId,
        kind: ConsultAgreementKind.SENSITIVE_DATA_CONSENT,
        revokedAt: null,
      },
    })
    await revokeConsultAgreement({
      consultSessionId: revoked.sessionId,
      acceptanceId: acceptance.id,
      reason: 'External inspiration purge retry fixture.',
      actor: { type: ConsultActorType.CLIENT, id: revoked.userId },
    })
    fake.failPurgePaths.add(revokedRow.storagePath!)
    expect(await runConsultInspirationPurgeSweep()).toMatchObject({
      considered: 1,
      purged: 0,
      failed: 1,
    })
    expect(
      await db.consultInspiration.findUniqueOrThrow({
        where: { id: revokedRow.id },
        select: { storagePath: true, purgedAt: true },
      }),
    ).toEqual({ storagePath: revokedRow.storagePath, purgedAt: null })
    expect(await runConsultInspirationPurgeSweep()).toMatchObject({
      considered: 1,
      purged: 1,
      failed: 0,
    })
    expect(
      await db.consultAuditEvent.count({
        where: {
          inspirationId: revokedRow.id,
          action: ConsultAuditAction.INSPIRATION_RAW_PURGED,
        },
      }),
    ).toBe(1)
    await expect(
      loadClientInspirationSignedRead({
        consultSessionId: revoked.sessionId,
        clientId: revoked.clientId,
        actorUserId: revoked.userId,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_STATE' })
  })

  it('rejects conflicting analysis keys and direct database completion/revision bypasses', async () => {
    const consult = await createReadyConsult('analysis-db-guard')
    authenticate(consult)
    await completeCapturePack(consult, 'analysis-db-guard')

    await expect(
      db.consultSession.update({
        where: { id: consult.sessionId },
        data: { status: ConsultSessionStatus.ANALYZING },
      }),
    ).rejects.toThrow()

    const succeeded = await analysisRequest(consult, 'db-guard-key')
    expect(succeeded.status).toBe(200)
    const conflict = await analysisRequest(consult, 'different-key')
    expect(conflict.status).toBe(409)
    expect(await body(conflict)).toMatchObject({ code: 'CONSULT_IDEMPOTENCY_CONFLICT' })

    await expect(
      db.consultRevision.create({
        data: {
          consultSessionId: consult.sessionId,
          revision: 999,
          kind: 'ANALYSIS',
          payload: { raw: 'aGVsbG8=', storagePath: 'consult-raw/private.jpg' },
          schemaVersion: 1,
          promptVersion: 'hair-color-analysis-v1',
          model: 'forged-model',
          idempotencyKey: 'forged',
          requestHash: 'f'.repeat(64),
        },
      }),
    ).rejects.toThrow()

    const rls = await db.$queryRaw<Array<{ relrowsecurity: boolean }>>(Prisma.sql`
      SELECT relrowsecurity FROM pg_class WHERE oid = '"ConsultRevision"'::regclass
    `)
    expect(rls).toEqual([{ relrowsecurity: true }])
  })

  it(
    'stops paid quality checks at the per-session cap while replays stay free',
    async () => {
      const consult = await createReadyConsult('quality-cap')
      authenticate(consult)
      fake.qualityByShot.set('hair_left', {
        accepted: false,
        reasonCode: 'BLURRY',
        retakeTip: 'Hold the phone still and try again.',
        model: 'fake-quality-model',
      })

      let lastCheckedId = ''
      for (let i = 0; i < CONSULT_CAPTURE_MAX_QUALITY_CHECKS_PER_SESSION; i += 1) {
        lastCheckedId = await issueAttach(consult, 'hair_left', `cap-${i}`)
        const checked = await quality(consult, lastCheckedId, `cap-q-${i}`)
        expect(checked.status).toBe(200)
      }
      expect(fake.modelCalls.length).toBe(
        CONSULT_CAPTURE_MAX_QUALITY_CHECKS_PER_SESSION,
      )

      // The next fresh check is refused BEFORE the provider is called — the
      // provider-call count is the assertion that matters, not the status.
      const overCapId = await issueAttach(consult, 'hair_left', 'cap-final')
      const blocked = await quality(consult, overCapId, 'cap-q-final')
      expect(blocked.status).toBe(429)
      expect(await body(blocked)).toMatchObject({
        code: 'CONSULT_CAPTURE_QUALITY_LIMIT_EXCEEDED',
      })
      expect(fake.modelCalls.length).toBe(
        CONSULT_CAPTURE_MAX_QUALITY_CHECKS_PER_SESSION,
      )

      // Replaying an already-checked capture is free and stays available.
      const lastIndex = CONSULT_CAPTURE_MAX_QUALITY_CHECKS_PER_SESSION - 1
      const replay = await quality(consult, lastCheckedId, `cap-q-${lastIndex}`)
      expect(replay.status).toBe(200)
      expect(await body(replay)).toMatchObject({ replayed: true })
      expect(fake.modelCalls.length).toBe(
        CONSULT_CAPTURE_MAX_QUALITY_CHECKS_PER_SESSION,
      )
    },
    120_000,
  )
})

describe('consult partial capture submission against PostgreSQL (Tori, 2026-08-27)', () => {
  // hair_left / hair_right deliberately omitted: the fake analysis provider
  // cites only the other five views, so the supplied-evidence check holds.
  const PARTIAL_SHOTS = [
    'hair_back',
    'hair_crown',
    'face_front',
    'face_side',
    'eyes_closeup',
  ] as const satisfies readonly HairColorCaptureShotKey[]

  async function acceptShots(
    consult: ReadyConsult,
    suffix: string,
    shots: readonly HairColorCaptureShotKey[],
  ) {
    for (const shotKey of shots) {
      const captureId = await issueAttach(consult, shotKey, `${suffix}-${shotKey}`)
      expect((await quality(consult, captureId, `${suffix}-q-${shotKey}`)).status).toBe(
        200,
      )
    }
  }

  function proceedRequest(consult: ReadyConsult) {
    return proceedCapture(
      jsonRequest(
        `/api/v1/client/consult/${consult.sessionId}/capture/proceed`,
        {},
      ),
      context(consult.sessionId),
    )
  }

  it(
    'advances an incomplete accepted pack on explicit proceed and completes the analysis end to end',
    async () => {
      const consult = await createReadyConsult('partial-proceed')
      authenticate(consult)
      await acceptShots(consult, 'partial-proceed', PARTIAL_SHOTS)

      // Below seven accepted shots there is no auto-advance.
      const before = await db.consultSession.findUniqueOrThrow({
        where: { id: consult.sessionId },
        select: { status: true },
      })
      expect(before.status).toBe(ConsultSessionStatus.MEDIA_READY)

      const proceed = await proceedRequest(consult)
      expect(proceed.status).toBe(200)
      expect(await body(proceed)).toMatchObject({
        advanced: true,
        capture: expect.objectContaining({ status: 'ANALYSIS_PENDING' }),
      })

      // Replays are safe once the session moved forward.
      const replay = await proceedRequest(consult)
      expect(replay.status).toBe(200)
      expect(await body(replay)).toMatchObject({ advanced: false })

      const analysis = await analysisRequest(consult, 'partial-analysis')
      expect(analysis.status).toBe(200)
      const session = await db.consultSession.findUniqueOrThrow({
        where: { id: consult.sessionId },
        select: { status: true },
      })
      expect(session.status).toBe(ConsultSessionStatus.COMPLETED)

      const accepted = await db.consultCapture.findMany({
        where: {
          consultSessionId: consult.sessionId,
          status: ConsultCaptureStatus.ACCEPTED,
        },
        select: { shotKey: true, purgeRequestedAt: true, purgedAt: true },
      })
      expect(accepted.map(({ shotKey }) => shotKey).sort()).toEqual(
        [...PARTIAL_SHOTS].sort(),
      )
      for (const capture of accepted) {
        expect(capture.purgeRequestedAt).not.toBeNull()
        expect(capture.purgedAt).not.toBeNull()
      }
    },
    120_000,
  )

  it('refuses to proceed with zero accepted captures', async () => {
    const consult = await createReadyConsult('partial-zero')
    authenticate(consult)
    const response = await proceedRequest(consult)
    expect(response.status).toBe(409)
    expect(await body(response)).toMatchObject({
      code: 'CONSULT_ANALYSIS_CAPTURES_REQUIRED',
      error: 'At least one accepted photo is required before analysis.',
    })
  })

  it('refuses to proceed before the inspiration step is finished', async () => {
    const consult = await createReadyConsult(
      'partial-inspiration',
      {},
      { skipInspiration: false },
    )
    authenticate(consult)
    await acceptShots(consult, 'partial-inspiration', ['hair_back'])
    const response = await proceedRequest(consult)
    expect(response.status).toBe(409)
    expect(await body(response)).toMatchObject({
      code: 'CONSULT_ANALYSIS_INSPIRATION_REQUIRED',
      error: 'Finish the inspiration step before continuing to analysis.',
    })
  })

  it('keeps the rejection reason and retake tip on the slot after the immediate purge', async () => {
    const consult = await createReadyConsult('rejected-slot-state')
    authenticate(consult)
    fake.qualityByShot.set('hair_left', {
      accepted: false,
      reasonCode: 'WARM_INDOOR_LIGHT',
      retakeTip: 'Face a window in indirect daylight.',
      model: 'fake-quality-model',
    })
    const rejectedId = await issueAttach(consult, 'hair_left', 'rejected-slot')
    expect((await quality(consult, rejectedId, 'rejected-slot-q')).status).toBe(200)
    const row = await db.consultCapture.findUniqueOrThrow({
      where: { id: rejectedId },
      select: { purgedAt: true },
    })
    expect(row.purgedAt).not.toBeNull()

    const state = await getCapture(
      new Request(
        `http://test/api/v1/client/consult/${consult.sessionId}/capture`,
      ),
      context(consult.sessionId),
    )
    expect(state.status).toBe(200)
    const payload = (await body(state)) as {
      capture: { slots: Array<Record<string, unknown>> }
    }
    const slot = payload.capture.slots.find(
      (entry) => entry.shotKey === 'hair_left',
    )
    expect(slot).toMatchObject({
      state: 'REJECTED',
      qualityReasonCode: 'WARM_INDOOR_LIGHT',
      retakeTip: 'Face a window in indirect daylight.',
    })
  })

  // B3. The eyes/brows shot was being refused by a colour rule written for a
  // photo of a whole head. On a view whose own spec asks the eyes to FILL the
  // frame there is almost no background left to read the light off, so the
  // finding is recorded as a warning and the slot is accepted.
  it('accepts a warm-lit eyes/brows close-up with a warning, and still rejects a warm full-face shot', async () => {
    const consult = await createReadyConsult('tight-crop-warning')
    authenticate(consult)
    // Exactly what the provider answers today for the shot Tori's walkthrough
    // could never get past the gate.
    fake.qualityByShot.set('eyes_closeup', {
      accepted: false,
      reasonCode: 'WARM_INDOOR_LIGHT',
      retakeTip: 'Move near a window and face the daylight.',
      model: 'fake-quality-model',
    })
    const eyesId = await issueAttach(consult, 'eyes_closeup', 'tight-crop')
    const eyesResponse = await quality(consult, eyesId, 'tight-crop-q')
    expect(eyesResponse.status).toBe(200)
    expect(await body(eyesResponse)).toMatchObject({
      quality: {
        accepted: true,
        reasonCode: 'PASS',
        warningCode: 'WARM_INDOOR_LIGHT',
        retakeTip: null,
      },
    })

    // (a) the warning is in the STORED row, not just the response…
    const storedEyes = await db.consultCapture.findUniqueOrThrow({
      where: { id: eyesId },
      select: {
        status: true,
        qualityReasonCode: true,
        qualityWarningCode: true,
        retakeTip: true,
        qualityPromptVersion: true,
        purgedAt: true,
      },
    })
    expect(storedEyes).toMatchObject({
      status: ConsultCaptureStatus.ACCEPTED,
      qualityReasonCode: 'PASS',
      qualityWarningCode: 'WARM_INDOOR_LIGHT',
      retakeTip: null,
      qualityPromptVersion: 'full-analysis-capture-v3',
    })
    // …and the raw object survives, as it must for an accepted shot.
    expect(storedEyes.purgedAt).toBeNull()

    // (b) a genuinely warm-cast FULL-FACE shot is still a hard rejection.
    fake.qualityByShot.set('face_front', {
      accepted: false,
      reasonCode: 'WARM_INDOOR_LIGHT',
      retakeTip: 'Move near a window and face the daylight.',
      model: 'fake-quality-model',
    })
    const faceId = await issueAttach(consult, 'face_front', 'warm-full-face')
    expect(await body(await quality(consult, faceId, 'warm-full-face-q'))).toMatchObject({
      quality: {
        accepted: false,
        reasonCode: 'WARM_INDOOR_LIGHT',
        warningCode: null,
        retakeTip: 'Move near a window and face the daylight.',
      },
    })
    expect(
      await db.consultCapture.findUniqueOrThrow({
        where: { id: faceId },
        select: { status: true, qualityWarningCode: true, purgedAt: true },
      }),
    ).toMatchObject({
      status: ConsultCaptureStatus.REJECTED,
      qualityWarningCode: null,
      purgedAt: expect.any(Date),
    })

    // (d) an ordinary full view under neutral light is untouched: accepted,
    // no warning. (The default fake answer is a clean PASS.)
    const sideId = await issueAttach(consult, 'face_side', 'neutral-full-view')
    expect(await body(await quality(consult, sideId, 'neutral-full-view-q'))).toMatchObject({
      quality: { accepted: true, reasonCode: 'PASS', warningCode: null },
    })

    // (c) the "N / M accepted" counter is `slots.filter(state == ACCEPTED)`
    // on both clients, so the close-up now counts toward it and the warm
    // full-face shot does not.
    const state = await getCapture(
      new Request(`http://test/api/v1/client/consult/${consult.sessionId}/capture`),
      context(consult.sessionId),
    )
    const payload = (await body(state)) as {
      capture: { slots: Array<Record<string, unknown>> }
    }
    const bySlot = new Map(
      payload.capture.slots.map((slot) => [slot.shotKey as string, slot]),
    )
    expect(bySlot.get('eyes_closeup')).toMatchObject({
      state: 'ACCEPTED',
      qualityReasonCode: 'PASS',
      qualityWarningCode: 'WARM_INDOOR_LIGHT',
      retakeTip: null,
    })
    expect(bySlot.get('face_front')).toMatchObject({
      state: 'REJECTED',
      qualityReasonCode: 'WARM_INDOOR_LIGHT',
      qualityWarningCode: null,
    })
    expect(bySlot.get('face_side')).toMatchObject({
      state: 'ACCEPTED',
      qualityWarningCode: null,
    })
    expect(
      payload.capture.slots.filter((slot) => slot.state === 'ACCEPTED').length,
    ).toBe(2)
    expect(payload.capture.slots.length).toBe(7)
  })
})
