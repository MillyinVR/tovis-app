// tests/integration/consult-look-estimate.test.ts
//
// Book the Look, slice B3 (docs/product/BOOK-THE-LOOK-DIRECTION.md): the
// TRANSLATION MODULE, driven end to end against real PostgreSQL — a
// look-anchored consult runs to analysis, and the estimate it persists is
// priced entirely off the seeded pro's real service list and surfaces on her
// brief.
//
// Three things only a real database can prove, and each is why this suite
// exists rather than another unit test:
//
//   * the RLS grant on both new tables — nothing else catches its omission;
//   * the correction pair's protection: the AI half of a line is frozen by a
//     trigger while the pro-final half stays writable. Decision 7's training
//     signal is worthless if an estimate can be rewritten to agree with its
//     own correction;
//   * "the pro's menu cannot express this look" reaching the brief as a TYPED
//     refusal instead of a guess.

import {
  ClientChartShareStatus,
  ConsultActorType,
  ConsultAgreementKind,
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
    { contentType: string; sizeBytes: number; checksumSha256: string | null }
  >(),
  pathSequence: 0,
  runId: Math.floor(Math.random() * 0xffffffff)
    .toString(16)
    .padStart(8, '0'),
}))

vi.mock('@/app/api/_utils/auth/requireClient', () => ({
  requireClient: mockRequireClient,
}))

// Only the C6/C7 SERVE gate is stubbed — it is a founder allowlist a synthetic
// fixture pro can never be on. The C1–C5 founder gate this slice depends on
// stays real, driven by ENABLE_AI_CONSULT below.
vi.mock('@/lib/consult/access', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/consult/access')>()
  return {
    ...original,
    isAiConsultC6ExposureEnabledForPro: () => true,
    isAiConsultC7ExposureEnabledForPro: () => true,
  }
})

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
      return `consult-raw/v1/${fake.runId}-0000-4000-8000-${tail}.jpg`
    },
    consultCaptureStorage: {
      assertReady: vi.fn().mockResolvedValue(undefined),
      async createSignedUpload() {
        return { token: 'signed', signedUrl: 'https://storage.test/signed' }
      },
      async createSignedRead(_path: string, expiresInSeconds: number) {
        return `https://storage.test/read/${expiresInSeconds}`
      },
      async inspectObject(args: { path: string }) {
        const object = fake.objects.get(args.path)
        if (!object) throw new FakeStorageError('missing')
        return object
      },
      async readObject(args: { path: string }) {
        const object = fake.objects.get(args.path)
        if (!object) throw new FakeStorageError('missing')
        return { base64: 'bm90LXJhdy1pbi1kYg==', mediaType: object.contentType }
      },
      async copyObject(args: { fromPath: string; toPath: string }) {
        const object = fake.objects.get(args.fromPath)
        if (!object) throw new FakeStorageError('missing')
        fake.objects.set(args.toPath, object)
      },
      async purgeObject(path: string) {
        fake.objects.delete(path)
      },
    },
  }
})

vi.mock('@/lib/consult/captureVision', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('@/lib/consult/captureVision')>()
  return {
    ...original,
    async checkHairColorCapture() {
      return {
        accepted: true,
        reasonCode: 'PASS',
        retakeTip: null,
        model: 'fake-quality-model',
      }
    },
  }
})

// The two recommendations are chosen so the analysis resolves ONE of them to
// the look's own linked service (BALAYAGE) and the other to a second service on
// the pro's menu (TONER_GLOSS). That is exactly the shape B3 has to translate:
// a floor line that also carries an analysis reason, plus one line beyond it.
vi.mock('@/lib/consult/analysisEngine', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('@/lib/consult/analysisEngine')>()
  const observed = (value: string, evidence: string[] = ['hair_back']) => ({
    value,
    confidence:
      value === 'UNKNOWN' ? { min: 0, max: 0.25 } : { min: 0.4, max: 0.7 },
    evidence,
  })
  return {
    ...original,
    async runHairColorAnalysis() {
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
            direction:
              'Discuss a soft, blended direction for this domain together.',
            whyItFlatters:
              'Low observed contrast and soft feature balance favor blended choices.',
            confidence: { min: 0.4, max: 0.7 },
            evidence: ['face_front'],
            discussWithProfessional: true,
          })),
          core: {
            currentLevel: {
              min: 4,
              max: 5,
              confidence: { min: 0.5, max: 0.75 },
              evidence: ['hair_back', 'hair_crown'],
            },
            currentTone: observed('MIXED'),
            visibleCondition: observed('NO_VISIBLE_CONCERN'),
            density: observed('UNKNOWN', []),
            texture: observed('WAVY'),
          },
          hairColorLens: {
            goal: 'A noticeable red direction grounded in the intake goal.',
            history: 'Prior lightening and box-dye timing affect the range.',
            constraints: 'Allergy history and other constraints are unknown.',
            maintenance:
              'Maintenance tolerance was not collected and is unknown.',
            appointmentContext:
              'Appointment context uses the intake timing and budget.',
            achievability: 'REQUIRES_PRO_ASSESSMENT',
            achievabilityReason:
              'The professional should assess condition and history.',
            discussWithProfessional: true,
          },
          safetyFlags: [],
          recommendations: [
            {
              serviceIntent: 'BALAYAGE',
              title: 'Hand-painted dimension',
              rationale: 'A hand-painted approach suits the blended direction.',
              achievability: 'The professional decides what is achievable today.',
              discussWithProfessional: true,
            },
            {
              serviceIntent: 'TONER_GLOSS',
              title: 'A gloss to hold the tone',
              rationale: 'The mid-lengths would otherwise read brassy in weeks.',
              achievability: 'The professional confirms the toner in person.',
              discussWithProfessional: true,
            },
          ],
        },
      }
    },
  }
})

import { POST as attachCapture } from '@/app/api/v1/client/consult/[id]/capture/attach/route'
import { POST as checkQuality } from '@/app/api/v1/client/consult/[id]/capture/[captureId]/quality/route'
import { POST as issueUpload } from '@/app/api/v1/client/consult/[id]/capture/uploads/route'
import { POST as startAnalysis } from '@/app/api/v1/client/consult/[id]/analysis/route'
import { POST as startLookConsult } from '@/app/api/v1/client/consult/look/route'
import {
  CONSULT_ANALYSIS_PROMPT_VERSION,
  CONSULT_ANALYSIS_SCHEMA_VERSION,
} from '@/lib/consult/analysisEngine'
import {
  HAIR_COLOR_CAPTURE_PACK_VERSION,
  HAIR_COLOR_CAPTURE_SCHEMA_VERSION,
  type HairColorCaptureShotKey,
} from '@/lib/consult/capturePack'
import { purgeConsultSessionRawObjects } from '@/lib/consult/capturePurge'
import { answerConsultInspirationQuestion } from '@/lib/consult/inspirationContract'
import {
  HAIR_COLOR_INTAKE_PACK_VERSION,
  HAIR_COLOR_INTAKE_SCHEMA_VERSION,
} from '@/lib/consult/intakePack'
import { loadAuthorizedProConsultBriefs } from '@/lib/consult/proBrief'
import {
  CONSULT_SERVICE_ESTIMATE_DERIVATION_VERSION,
  CONSULT_SERVICE_ESTIMATE_SCHEMA_VERSION,
} from '@/lib/consult/serviceEstimate'
import {
  acceptConsultAgreement,
  appendHairColorIntakeRevision,
} from '@/lib/consult/writeBoundary'

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error('Run with pnpm test:integration')
const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } })

// Deliberately free of the words "color" and "consult": service names are
// matched to analysis intents by regex (analysisContract INTENT_PATTERNS), and
// a tag carrying either word would silently change which offering matched.
const tag = `bt1_estim_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
const versionBase = 4_000_000 + Math.floor(Math.random() * 100_000)

// The pro's real menu, and the numbers every assertion below is derived from.
// 50 minutes on a 30-minute grid is the point: rounding to the NEAREST slot
// would give 45 and quietly steal five minutes of her day.
const BALAYAGE_PRICE = '180.00'
const BALAYAGE_MINUTES = 50
const BALAYAGE_ESTIMATED_MINUTES = 60
const GLOSS_PRICE = '45.00'
const GLOSS_MINUTES = 20
const GLOSS_ESTIMATED_MINUTES = 30
const STEP_MINUTES = 30
const BUFFER_MINUTES = 15

let tenantId = ''
let proUserId = ''
let professionalId = ''
let locationId = ''
let categoryId = ''
let ownsHairColorCategory = false
let balayageServiceId = ''
let glossServiceId = ''
let offMenuServiceId = ''
let consentVersionId = ''
let adultVersionId = ''
let clientUserId = ''
let clientId = ''

const mediaIds: string[] = []
const lookIds: string[] = []
const sessionIds: string[] = []

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

const INSPIRATION_ANSWERS: ReadonlyArray<
  [string, string[], string | null, string | null]
> = [
  ['favorite_colors', ['cool-smoky'], null, null],
  ['avoid_colors', ['none'], null, null],
  ['length_goal', ['yes-same-length'], null, null],
  ['fullness_goal', ['more-full'], null, null],
  ['current_styling', ['not-sure'], null, null],
  ['styling_walkthrough', ['no'], null, null],
  ['other_detail', ['nothing-else'], null, 'NONE'],
]

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

function jsonRequest(path: string, value: Record<string, unknown>) {
  return new Request(`http://test${path}`, {
    method: 'POST',
    body: JSON.stringify(value),
  })
}

let lookSequence = 0
async function createLook(serviceId: string): Promise<string> {
  lookSequence += 1
  const media = await db.mediaAsset.create({
    data: {
      professionalId,
      proTenantId: tenantId,
      primaryServiceId: serviceId,
      mediaType: MediaType.IMAGE,
      visibility: MediaVisibility.PUBLIC,
      storageBucket: 'media-public',
      storagePath: `${tag}/look-${lookSequence}.jpg`,
    },
    select: { id: true },
  })
  mediaIds.push(media.id)
  const look = await db.lookPost.create({
    data: {
      professionalId,
      primaryMediaAssetId: media.id,
      serviceId,
      status: LookPostStatus.PUBLISHED,
      visibility: LookPostVisibility.PUBLIC,
      moderationStatus: ModerationStatus.APPROVED,
      publishedAt: new Date(),
    },
    select: { id: true },
  })
  lookIds.push(look.id)
  return look.id
}

async function attachAcceptedCapture(
  sessionId: string,
  shotKey: HairColorCaptureShotKey,
  label: string,
) {
  const issued = await issueUpload(
    jsonRequest(`/api/v1/client/consult/${sessionId}/capture/uploads`, {
      idempotencyKey: `${label}-issue-${shotKey}`,
      shotKey,
      shotPackVersion: HAIR_COLOR_CAPTURE_PACK_VERSION,
      schemaVersion: HAIR_COLOR_CAPTURE_SCHEMA_VERSION,
      contentType: 'image/jpeg',
      sizeBytes: 100,
    }),
    context(sessionId),
  )
  expect(issued.status).toBe(200)
  const upload = ((await body(issued)).upload ?? {}) as {
    uploadSessionId?: string
  }
  const uploadSessionId = upload.uploadSessionId ?? ''
  expect(uploadSessionId).not.toBe('')
  const row = await db.uploadSession.findUniqueOrThrow({
    where: { id: uploadSessionId },
  })
  fake.objects.set(row.storagePath, {
    contentType: 'image/jpeg',
    sizeBytes: row.maxBytes,
    checksumSha256: row.checksumSha256,
  })
  const attached = await attachCapture(
    jsonRequest(`/api/v1/client/consult/${sessionId}/capture/attach`, {
      idempotencyKey: `${label}-attach-${shotKey}`,
      uploadSessionId,
      shotKey,
      shotPackVersion: HAIR_COLOR_CAPTURE_PACK_VERSION,
      schemaVersion: HAIR_COLOR_CAPTURE_SCHEMA_VERSION,
    }),
    context(sessionId),
  )
  expect(attached.status).toBe(200)
  const captureId = String((await body(attached)).captureId ?? '')
  expect(captureId).not.toBe('')
  const quality = await checkQuality(
    jsonRequest(
      `/api/v1/client/consult/${sessionId}/capture/${captureId}/quality`,
      {
        idempotencyKey: `${label}-quality-${shotKey}`,
        shotPackVersion: HAIR_COLOR_CAPTURE_PACK_VERSION,
        schemaVersion: HAIR_COLOR_CAPTURE_SCHEMA_VERSION,
      },
    ),
    captureContext(sessionId, captureId),
  )
  expect(quality.status).toBe(200)
}

/** Create → consent → intake → inspiration → captures → analysis. */
async function runConsultToCompletion(
  lookPostId: string,
  label: string,
): Promise<string> {
  const created = await startLookConsult(
    jsonRequest('/api/v1/client/consult/look', { lookPostId }),
  )
  expect(created.status).toBe(200)
  const sessionId = ((await body(created)).consult as { id: string }).id
  if (!sessionIds.includes(sessionId)) sessionIds.push(sessionId)

  await acceptConsultAgreement({
    consultSessionId: sessionId,
    agreementVersionId: consentVersionId,
    expectedKind: ConsultAgreementKind.SENSITIVE_DATA_CONSENT,
    actor: { type: ConsultActorType.CLIENT, id: clientUserId },
  })
  await acceptConsultAgreement({
    consultSessionId: sessionId,
    agreementVersionId: adultVersionId,
    expectedKind: ConsultAgreementKind.ADULT_18_PLUS_ATTESTATION,
    actor: { type: ConsultActorType.CLIENT, id: clientUserId },
  })
  await appendHairColorIntakeRevision({
    consultSessionId: sessionId,
    actor: { type: ConsultActorType.CLIENT, id: clientUserId },
    loadInput: async () => ({
      idempotencyKey: `intake-${label}`,
      packVersion: HAIR_COLOR_INTAKE_PACK_VERSION,
      schemaVersion: HAIR_COLOR_INTAKE_SCHEMA_VERSION,
      complete: true,
      answers: completeAnswers,
    }),
  })
  for (const [questionKey, selectedValues, text, sentiment] of INSPIRATION_ANSWERS) {
    await answerConsultInspirationQuestion({
      consultSessionId: sessionId,
      clientId,
      actor: { type: ConsultActorType.CLIENT, id: clientUserId },
      input: {
        idempotencyKey: `${label}-${questionKey}`,
        schemaVersion: 1,
        questionKey,
        selectedValues,
        ...(text ? { text } : {}),
        ...(sentiment ? { sentiment } : {}),
      },
    })
  }
  for (const shotKey of [
    'hair_back',
    'hair_left',
    'hair_right',
    'hair_crown',
    'face_front',
    'face_side',
    'eyes_closeup',
  ] as const) {
    await attachAcceptedCapture(sessionId, shotKey, label)
  }

  const analysis = await startAnalysis(
    jsonRequest(`/api/v1/client/consult/${sessionId}/analysis`, {
      idempotencyKey: `${label}-analysis`,
      schemaVersion: CONSULT_ANALYSIS_SCHEMA_VERSION,
      promptVersion: CONSULT_ANALYSIS_PROMPT_VERSION,
    }),
    context(sessionId),
  )
  expect(analysis.status).toBe(200)
  expect(
    await db.consultSession.findUniqueOrThrow({
      where: { id: sessionId },
      select: { status: true },
    }),
  ).toEqual({ status: ConsultSessionStatus.COMPLETED })

  return sessionId
}

beforeAll(async () => {
  process.env.ENABLE_AI_CONSULT = '1'
  const tenant = await db.tenant.create({
    data: { slug: `${tag}-tenant`, name: 'Look estimate', isActive: true },
    select: { id: true },
  })
  tenantId = tenant.id

  const [proUser, clientUser] = await Promise.all([
    db.user.create({
      data: { email: `${tag}_pro@example.com`, password: 'x', role: Role.PRO },
      select: { id: true },
    }),
    db.user.create({
      data: {
        email: `${tag}_client@example.com`,
        password: 'x',
        role: Role.CLIENT,
      },
      select: { id: true },
    }),
  ])
  proUserId = proUser.id
  clientUserId = clientUser.id

  const [pro, client] = await Promise.all([
    db.professionalProfile.create({
      data: {
        userId: proUserId,
        homeTenantId: tenantId,
        firstName: 'Estimate',
        lastName: 'Professional',
        timeZone: 'America/Los_Angeles',
        verificationStatus: VerificationStatus.APPROVED,
      },
      select: { id: true },
    }),
    db.clientProfile.create({
      data: {
        userId: clientUserId,
        firstName: 'Estimate',
        lastName: 'Client',
        homeTenantId: tenantId,
      },
      select: { id: true },
    }),
  ])
  professionalId = pro.id
  clientId = client.id

  const location = await db.professionalLocation.create({
    data: {
      professionalId,
      type: ProfessionalLocationType.SALON,
      name: 'Estimate studio',
      timeZone: 'America/Los_Angeles',
      workingHours: {},
      isBookable: true,
      stepMinutes: STEP_MINUTES,
      bufferMinutes: BUFFER_MINUTES,
    },
    select: { id: true },
  })
  locationId = location.id

  // 'hair-color' is a globally unique slug the seed fixture may already own.
  const existingCategory = await db.serviceCategory.findUnique({
    where: { slug: 'hair-color' },
    select: { id: true },
  })
  ownsHairColorCategory = !existingCategory
  const category =
    existingCategory ??
    (await db.serviceCategory.create({
      data: { name: `${tag} hair`, slug: 'hair-color' },
      select: { id: true },
    }))
  categoryId = category.id

  // Names matter: analysisContract matches an analysis serviceIntent to an
  // offering by regex over the service's name and description.
  const [balayage, gloss, offMenu] = await Promise.all([
    db.service.create({
      data: {
        name: `${tag} Balayage`,
        categoryId,
        defaultDurationMinutes: 90,
        minPrice: new Prisma.Decimal('100.00'),
      },
      select: { id: true },
    }),
    db.service.create({
      data: {
        name: `${tag} Toner Gloss`,
        categoryId,
        defaultDurationMinutes: 30,
        minPrice: new Prisma.Decimal('30.00'),
      },
      select: { id: true },
    }),
    db.service.create({
      data: {
        name: `${tag} Vivid Fashion`,
        categoryId,
        defaultDurationMinutes: 120,
        minPrice: new Prisma.Decimal('200.00'),
      },
      select: { id: true },
    }),
  ])
  balayageServiceId = balayage.id
  glossServiceId = gloss.id
  offMenuServiceId = offMenu.id

  // The pro's menu: balayage and the gloss. `offMenuServiceId` is deliberately
  // NOT here — it is a real hair-color service she does not offer.
  await db.professionalServiceOffering.createMany({
    data: [
      {
        professionalId,
        serviceId: balayageServiceId,
        isActive: true,
        offersInSalon: true,
        salonPriceStartingAt: new Prisma.Decimal(BALAYAGE_PRICE),
        salonDurationMinutes: BALAYAGE_MINUTES,
      },
      {
        professionalId,
        serviceId: glossServiceId,
        isActive: true,
        offersInSalon: true,
        salonPriceStartingAt: new Prisma.Decimal(GLOSS_PRICE),
        salonDurationMinutes: GLOSS_MINUTES,
      },
    ],
  })

  // The pro's brief is chart-gated (lib/clientVisibility). An explicitly
  // granted chart share is the honest way to open it for a fixture client with
  // no booking history — the real gate runs, it just has a real reason to pass.
  await db.clientChartShare.create({
    data: {
      clientId,
      professionalId,
      status: ClientChartShareStatus.GRANTED,
      respondedAt: new Date(),
    },
  })

  const [consent, adult] = await Promise.all([
    db.consultAgreementVersion.create({
      data: {
        kind: ConsultAgreementKind.SENSITIVE_DATA_CONSENT,
        version: versionBase,
        title: 'Look estimate consent fixture',
        body: 'Look estimate consent fixture only.',
      },
      select: { id: true },
    }),
    db.consultAgreementVersion.create({
      data: {
        kind: ConsultAgreementKind.ADULT_18_PLUS_ATTESTATION,
        version: versionBase,
        title: 'Look estimate adult fixture',
        body: 'Look estimate adult fixture only.',
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
  mockRequireClient.mockResolvedValue({
    ok: true,
    clientId,
    user: { id: clientUserId },
  })
})

afterAll(async () => {
  for (const sessionId of new Set(sessionIds)) {
    try {
      await purgeConsultSessionRawObjects(sessionId)
      await db.consultSession.deleteMany({ where: { id: sessionId } })
    } catch (error) {
      console.error('look-estimate fixture cleanup failed', { sessionId, error })
    }
  }
  await db.consultAgreementVersion
    .deleteMany({
      where: { id: { in: [consentVersionId, adultVersionId].filter(Boolean) } },
    })
    .catch((error: unknown) => {
      console.error('look-estimate agreement cleanup failed', { error })
    })
  await db.clientChartShare.deleteMany({ where: { professionalId } })
  await db.lookPost.deleteMany({ where: { id: { in: lookIds } } })
  await db.mediaAsset.deleteMany({ where: { id: { in: mediaIds } } })
  await db.professionalServiceOffering.deleteMany({ where: { professionalId } })
  if (locationId) {
    await db.professionalLocation.deleteMany({ where: { id: locationId } })
  }
  await db.service.deleteMany({
    where: {
      id: {
        in: [balayageServiceId, glossServiceId, offMenuServiceId].filter(Boolean),
      },
    },
  })
  if (ownsHairColorCategory && categoryId) {
    await db.serviceCategory.deleteMany({ where: { id: categoryId } })
  }
  if (clientId) await db.clientProfile.deleteMany({ where: { id: clientId } })
  await db.professionalProfile.deleteMany({ where: { id: professionalId } })
  await db.user.deleteMany({
    where: { id: { in: [proUserId, clientUserId].filter(Boolean) } },
  })
  if (tenantId) await db.tenant.deleteMany({ where: { id: tenantId } })
  delete process.env.ENABLE_AI_CONSULT
  await db.$disconnect()
})

describe('row level security', () => {
  it('is enabled on both new tables', async () => {
    const rows = await db.$queryRaw<Array<{ relname: string }>>(Prisma.sql`
      SELECT c.relname
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relrowsecurity = true
        AND c.relname IN ('ConsultServiceEstimate', 'ConsultServiceEstimateLine')
    `)
    expect(rows.map((row) => row.relname).sort()).toEqual([
      'ConsultServiceEstimate',
      'ConsultServiceEstimateLine',
    ])
  })
})

describe('a look-anchored consult persists a line-item estimate', () => {
  it('prices the floor off the pro’s own list and rounds duration UP', async () => {
    const lookPostId = await createLook(balayageServiceId)
    const sessionId = await runConsultToCompletion(lookPostId, 'priced')

    const estimate = await db.consultServiceEstimate.findUniqueOrThrow({
      where: { consultSessionId: sessionId },
      select: {
        status: true,
        refusalCode: true,
        locationType: true,
        stepMinutes: true,
        bufferMinutes: true,
        schemaVersion: true,
        derivationVersion: true,
        sourceAnalysisRevisionId: true,
        professionalId: true,
        lines: {
          select: {
            sortOrder: true,
            serviceId: true,
            serviceName: true,
            source: true,
            rationale: true,
            estimatedPrice: true,
            estimatedDurationMinutes: true,
            proFinalPrice: true,
            proFinalDurationMinutes: true,
            proFinalAt: true,
          },
          orderBy: { sortOrder: 'asc' },
        },
      },
    })

    expect(estimate).toMatchObject({
      status: 'ESTIMATED',
      refusalCode: null,
      locationType: 'SALON',
      stepMinutes: STEP_MINUTES,
      bufferMinutes: BUFFER_MINUTES,
      schemaVersion: CONSULT_SERVICE_ESTIMATE_SCHEMA_VERSION,
      derivationVersion: CONSULT_SERVICE_ESTIMATE_DERIVATION_VERSION,
      professionalId,
    })

    // The pin is what makes a later correction pair interpretable.
    const analysisRevision = await db.consultRevision.findFirstOrThrow({
      where: { consultSessionId: sessionId, kind: 'ANALYSIS' },
      select: { id: true },
    })
    expect(estimate.sourceAnalysisRevisionId).toBe(analysisRevision.id)

    expect(estimate.lines).toHaveLength(2)

    const [floor, extra] = estimate.lines
    expect(floor).toMatchObject({
      sortOrder: 0,
      serviceId: balayageServiceId,
      serviceName: `${tag} Balayage`,
      source: 'LOOK_LINKED_SERVICE',
      estimatedDurationMinutes: BALAYAGE_ESTIMATED_MINUTES,
    })
    expect(floor?.estimatedPrice.toFixed(2)).toBe(BALAYAGE_PRICE)
    // The analysis also named this service, so its reason rides the floor line.
    expect(floor?.rationale).toContain(
      'A hand-painted approach suits the blended direction.',
    )

    expect(extra).toMatchObject({
      sortOrder: 1,
      serviceId: glossServiceId,
      source: 'ANALYSIS_RECOMMENDATION',
      estimatedDurationMinutes: GLOSS_ESTIMATED_MINUTES,
    })
    expect(extra?.estimatedPrice.toFixed(2)).toBe(GLOSS_PRICE)
    expect(extra?.rationale).toContain(
      'The mid-lengths would otherwise read brassy in weeks.',
    )

    // Every price on the estimate is one the pro actually listed.
    const listed = await db.professionalServiceOffering.findMany({
      where: { professionalId },
      select: { serviceId: true, salonPriceStartingAt: true },
    })
    const listedByService = new Map(
      listed.map((row) => [
        row.serviceId,
        row.salonPriceStartingAt?.toFixed(2) ?? null,
      ]),
    )
    for (const line of estimate.lines) {
      expect(line.estimatedPrice.toFixed(2)).toBe(
        listedByService.get(line.serviceId),
      )
    }

    // The correction half exists and is empty. B5/B6 fills it.
    for (const line of estimate.lines) {
      expect(line.proFinalPrice).toBeNull()
      expect(line.proFinalDurationMinutes).toBeNull()
      expect(line.proFinalAt).toBeNull()
    }
  })

  it('surfaces the estimate on the pro brief', async () => {
    const briefs = await loadAuthorizedProConsultBriefs({
      professionalId,
      clientId,
    })
    const brief = briefs.find((candidate) => candidate.serviceEstimate)
    expect(brief).toBeDefined()
    expect(brief?.serviceEstimate).toMatchObject({
      status: 'ESTIMATED',
      refusalCode: null,
      locationType: 'SALON',
      stepMinutes: STEP_MINUTES,
      bufferMinutes: BUFFER_MINUTES,
      derivationVersion: CONSULT_SERVICE_ESTIMATE_DERIVATION_VERSION,
    })
    expect(brief?.serviceEstimate?.lines).toMatchObject([
      {
        serviceId: balayageServiceId,
        source: 'LOOK_LINKED_SERVICE',
        estimatedPrice: BALAYAGE_PRICE,
        estimatedDurationMinutes: BALAYAGE_ESTIMATED_MINUTES,
        proFinalPrice: null,
      },
      {
        serviceId: glossServiceId,
        source: 'ANALYSIS_RECOMMENDATION',
        estimatedPrice: GLOSS_PRICE,
        estimatedDurationMinutes: GLOSS_ESTIMATED_MINUTES,
        proFinalPrice: null,
      },
    ])
  })
})

describe('a menu that cannot express the look', () => {
  it('records a TYPED refusal rather than guessing a price', async () => {
    const lookPostId = await createLook(offMenuServiceId)
    const sessionId = await runConsultToCompletion(lookPostId, 'off-menu')

    const estimate = await db.consultServiceEstimate.findUniqueOrThrow({
      where: { consultSessionId: sessionId },
      select: { status: true, refusalCode: true, lines: { select: { id: true } } },
    })
    expect(estimate).toMatchObject({
      status: 'REFUSED',
      refusalCode: 'SERVICE_NOT_ON_MENU',
      lines: [],
    })

    const briefs = await loadAuthorizedProConsultBriefs({
      professionalId,
      clientId,
    })
    const brief = briefs.find(
      (candidate) => candidate.consultId === sessionId,
    )
    expect(brief?.serviceEstimate).toMatchObject({
      status: 'REFUSED',
      refusalCode: 'SERVICE_NOT_ON_MENU',
      lines: [],
    })
  })
})

describe('a pro with nothing bookable to size a duration against', () => {
  it('records PRO_SCHEDULING_NOT_READY with no scheduling facts at all', async () => {
    // The one refusal whose row shape differs: stepMinutes and bufferMinutes
    // are NULL, and a CHECK constraint decides whether that is legal. Getting
    // it backwards would abort the whole analysis transaction, not just skip
    // the estimate — which is exactly why this runs against the real database.
    await db.professionalLocation.update({
      where: { id: locationId },
      data: { isBookable: false },
    })
    try {
      const lookPostId = await createLook(balayageServiceId)
      const sessionId = await runConsultToCompletion(lookPostId, 'no-location')

      expect(
        await db.consultServiceEstimate.findUniqueOrThrow({
          where: { consultSessionId: sessionId },
          select: {
            status: true,
            refusalCode: true,
            stepMinutes: true,
            bufferMinutes: true,
          },
        }),
      ).toEqual({
        status: 'REFUSED',
        refusalCode: 'PRO_SCHEDULING_NOT_READY',
        stepMinutes: null,
        bufferMinutes: null,
      })
    } finally {
      await db.professionalLocation.update({
        where: { id: locationId },
        data: { isBookable: true },
      })
    }
  })
})

describe('the correction pair is protected', () => {
  it('freezes the AI half of a line and leaves the pro-final half writable', async () => {
    const estimate = await db.consultServiceEstimate.findFirstOrThrow({
      where: { professionalId, status: 'ESTIMATED' },
      select: { id: true, lines: { select: { id: true }, take: 1 } },
    })
    const lineId = estimate.lines[0]?.id ?? ''
    expect(lineId).not.toBe('')

    await expect(
      db.consultServiceEstimateLine.update({
        where: { id: lineId },
        data: { estimatedPrice: new Prisma.Decimal('1.00') },
      }),
    ).rejects.toThrow(/immutable/i)

    await expect(
      db.consultServiceEstimate.update({
        where: { id: estimate.id },
        data: { status: 'REFUSED', refusalCode: 'SERVICE_NOT_ON_MENU' },
      }),
    ).rejects.toThrow(/immutable/i)

    const corrected = await db.consultServiceEstimateLine.update({
      where: { id: lineId },
      data: {
        proFinalPrice: new Prisma.Decimal('205.00'),
        proFinalDurationMinutes: 75,
        proFinalNote: 'Ran long on the root melt.',
        proFinalAt: new Date(),
      },
      select: {
        estimatedPrice: true,
        proFinalPrice: true,
        proFinalDurationMinutes: true,
      },
    })
    expect(corrected.proFinalPrice?.toFixed(2)).toBe('205.00')
    expect(corrected.proFinalDurationMinutes).toBe(75)
    // The estimate half is still what the AI derived — that is the pair.
    expect(corrected.estimatedPrice.toFixed(2)).toBe(BALAYAGE_PRICE)
  })
})
