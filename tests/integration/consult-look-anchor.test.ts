// tests/integration/consult-look-anchor.test.ts
//
// Book the Look, slice B2 (docs/product/BOOK-THE-LOOK-DIRECTION.md): a consult
// anchored to a LOOK and a professional, with NO booking, driven end to end
// against real PostgreSQL — create, inspiration seeded FROM the look, intake,
// captures, analysis, results.
//
// The database guards are the point of running this for real. Four of them
// join Booking on ConsultSession."bookingId"; with a NULL booking an INNER JOIN
// yields no row, which makes some of them refuse and — worse — makes others
// pass on NULLs. Only a real Postgres proves the new definitions do what the
// migration claims.

import {
  BookingStatus,
  ConsultActorType,
  ConsultAgreementKind,
  ConsultAuditAction,
  ConsultInspirationSource,
  ConsultInspirationStatus,
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
  VerificationStatus,
} from '@prisma/client'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  process.env.JWT_SECRET ||= 'integration-test-jwt-secret'
  // A look-anchored consult's inspiration image is the LOOK's own media,
  // resolved by lib/media/renderUrls. A PUBLIC-bucket object needs the Supabase
  // project origin to build its URL, and integration.yml exports only the two
  // DATABASE URLs — so without this the resolve returns null on CI (a correct
  // 404, but not the case the read test means to exercise) while passing
  // locally off .env.test.local. Never overrides a real value.
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://storage.test'
})

const mockRequireClient = vi.hoisted(() => vi.fn())
const fake = vi.hoisted(() => ({
  objects: new Map<
    string,
    { contentType: string; sizeBytes: number; checksumSha256: string | null }
  >(),
  purgedPaths: [] as string[],
  pathSequence: 0,
  runId: Math.floor(Math.random() * 0xffffffff)
    .toString(16)
    .padStart(8, '0'),
}))

vi.mock('@/app/api/_utils/auth/requireClient', () => ({
  requireClient: mockRequireClient,
}))

// The C6/C7 SERVE gate is founder-allowlist-only by design (Tori's eval
// deferral, lib/consult/access.ts) and a synthetic fixture pro can never be on
// that list, so serving results would be impossible to exercise here. Only the
// serve gate is stubbed; the C1–C5 founder gate this slice actually depends on
// — isAiConsultEnabledForPro, which evaluateConsultAnchor calls — stays the
// real implementation, driven by ENABLE_AI_CONSULT below.
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
      // Unique per RUN, not just per call: UploadSession has a unique index on
      // (storageBucket, storagePath), and this suite's rows outlive the process
      // in the shared test database.
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
        fake.purgedPaths.push(path)
      },
    },
  }
})

vi.mock('@/lib/consult/captureVision', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('@/lib/consult/captureVision')>()
  return {
    ...original,
    async checkConsultCapture() {
      return {
        accepted: true,
        reasonCode: 'PASS',
        retakeTip: null,
        model: 'fake-quality-model',
      }
    },
  }
})

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
    async runConsultAnalysis(input: {
      service: { menuServiceNames: readonly string[] }
    }) {
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
          serviceLens: {
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
          // Two directions minimum: the client-results serve boundary
          // (requireClientResultFraming) refuses a framing outside 2–3.
          recommendations: [
            {
              service: 'A consultation with the professional',
              title: 'Hair color consultation',
              rationale: 'Review a realistic red direction and chemical history.',
              achievability: 'The professional should confirm the service plan.',
              discussWithProfessional: true,
            },
            {
              service:
                input.service.menuServiceNames.find((name) => /balayage/i.test(name)) ??
                'A consultation with the professional',
              title: 'Hand-painted dimension',
              rationale: 'A hand-painted approach suits the blended direction.',
              achievability: 'The professional decides what is achievable today.',
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
import { GET as getLookAvailability } from '@/app/api/v1/client/consult/look/availability/route'
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
import {
  purgeConsultSessionRawObjects,
} from '@/lib/consult/capturePurge'
import {
  answerConsultInspirationQuestion,
  loadClientInspirationSignedRead,
  loadConsultInspirationState,
} from '@/lib/consult/inspirationContract'
import {
  purgeConsultSessionInspirationObjects,
  runConsultInspirationPurgeSweep,
} from '@/lib/consult/inspirationPurge'
import {
  HAIR_COLOR_INTAKE_PACK_VERSION,
  HAIR_COLOR_INTAKE_SCHEMA_VERSION,
} from '@/lib/consult/intakePack'
import { loadAuthorizedClientConsultResults } from '@/lib/consult/clientResults'
import {
  acceptConsultAgreement,
  appendConsultIntakeRevision,
} from '@/lib/consult/writeBoundary'

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error('Run with pnpm test:integration')
const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } })
const tag = `consult_look_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
const versionBase = 3_000_000 + Math.floor(Math.random() * 100_000)

let tenantId = ''
let proUserId = ''
let professionalId = ''
let otherProUserId = ''
let otherProfessionalId = ''
let locationId = ''
let categoryId = ''
let nailCategoryId = ''
let ownsHairColorCategory = false
let serviceId = ''
let nailServiceId = ''
let consentVersionId = ''
let adultVersionId = ''
let clientUserId = ''
let clientId = ''

let hairLookId = ''
let unlinkedLookId = ''
let nailLookId = ''
let draftLookId = ''
let otherProLookId = ''
const mediaIds: string[] = []
const lookIds: string[] = []
const sessionIds: string[] = []
const bookingIds: string[] = []

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

async function createLook(args: {
  professionalId: string
  serviceId: string | null
  status?: LookPostStatus
  visibility?: LookPostVisibility
  label: string
}) {
  const media = await db.mediaAsset.create({
    data: {
      professionalId: args.professionalId,
      proTenantId: tenantId,
      // MediaAsset always carries a bookable primary service; it is the LOOK's
      // own serviceId that this fixture varies.
      primaryServiceId: args.serviceId ?? serviceId,
      mediaType: MediaType.IMAGE,
      visibility: MediaVisibility.PUBLIC,
      storageBucket: 'media-public',
      storagePath: `${tag}/${args.label}.jpg`,
    },
    select: { id: true },
  })
  mediaIds.push(media.id)
  const look = await db.lookPost.create({
    data: {
      professionalId: args.professionalId,
      primaryMediaAssetId: media.id,
      serviceId: args.serviceId,
      status: args.status ?? LookPostStatus.PUBLISHED,
      visibility: args.visibility ?? LookPostVisibility.PUBLIC,
      moderationStatus: ModerationStatus.APPROVED,
      publishedAt: new Date(),
    },
    select: { id: true },
  })
  lookIds.push(look.id)
  return { lookId: look.id, mediaId: media.id }
}

/** A brand-new hair-color look, so each test gets its own anchor (creation is
 *  idempotent per (client, look, pro), which would otherwise hand the next test
 *  the previous test's consult). */
let freshLookSequence = 0
async function freshHairLook(): Promise<string> {
  freshLookSequence += 1
  const { lookId } = await createLook({
    professionalId,
    serviceId,
    label: `fresh-${freshLookSequence}`,
  })
  return lookId
}

async function startLook(lookPostId: string) {
  return startLookConsult(
    jsonRequest('/api/v1/client/consult/look', { lookPostId }),
  )
}

async function availability(lookPostId: string) {
  return getLookAvailability(
    new Request(
      `http://test/api/v1/client/consult/look/availability?lookPostId=${encodeURIComponent(lookPostId)}`,
    ),
  )
}

/** Consent → complete intake. The seed fires on the MEDIA_READY transition. */
async function consentAndCompleteIntake(sessionId: string, label: string) {
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
  await appendConsultIntakeRevision({
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
}

async function answerInspiration(sessionId: string, label: string) {
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
  const issuedBody = await body(issued)
  const upload = (issuedBody.upload ?? {}) as { uploadSessionId?: string }
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
  return captureId
}

beforeAll(async () => {
  process.env.ENABLE_AI_CONSULT = '1'
  const tenant = await db.tenant.create({
    data: { slug: `${tag}-tenant`, name: 'Look anchor', isActive: true },
    select: { id: true },
  })
  tenantId = tenant.id

  const [proUser, otherProUser, clientUser] = await Promise.all([
    db.user.create({
      data: { email: `${tag}_pro@example.com`, password: 'x', role: Role.PRO },
      select: { id: true },
    }),
    db.user.create({
      data: { email: `${tag}_pro2@example.com`, password: 'x', role: Role.PRO },
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
  otherProUserId = otherProUser.id
  clientUserId = clientUser.id

  const [pro, otherPro, client] = await Promise.all([
    db.professionalProfile.create({
      data: {
        userId: proUserId,
        homeTenantId: tenantId,
        firstName: 'Look',
        lastName: 'Professional',
        timeZone: 'America/Los_Angeles',
        verificationStatus: VerificationStatus.APPROVED,
      },
      select: { id: true },
    }),
    db.professionalProfile.create({
      data: {
        userId: otherProUserId,
        homeTenantId: tenantId,
        firstName: 'Other',
        lastName: 'Professional',
        timeZone: 'America/Los_Angeles',
        verificationStatus: VerificationStatus.APPROVED,
      },
      select: { id: true },
    }),
    db.clientProfile.create({
      data: {
        userId: clientUserId,
        firstName: 'Look',
        lastName: 'Client',
        homeTenantId: tenantId,
      },
      select: { id: true },
    }),
  ])
  professionalId = pro.id
  otherProfessionalId = otherPro.id
  clientId = client.id

  const location = await db.professionalLocation.create({
    data: {
      professionalId,
      type: ProfessionalLocationType.SALON,
      name: 'Look studio',
      timeZone: 'America/Los_Angeles',
      workingHours: {},
    },
    select: { id: true },
  })
  locationId = location.id

  // 'hair-color' is a globally unique slug and the seed fixture may already own
  // it. Reuse it when it exists (and leave it alone on the way out) rather than
  // colliding with — or deleting — a row this suite did not create.
  const existingCategory = await db.serviceCategory.findUnique({
    where: { slug: 'hair-color' },
    select: { id: true },
  })
  ownsHairColorCategory = !existingCategory
  const [category, nailCategory] = await Promise.all([
    existingCategory ??
      db.serviceCategory.create({
        data: { name: `${tag} hair color`, slug: 'hair-color' },
        select: { id: true },
      }),
    db.serviceCategory.create({
      data: { name: `${tag} nails`, slug: `${tag}-nails` },
      select: { id: true },
    }),
  ])
  categoryId = category.id
  nailCategoryId = nailCategory.id

  const [service, nailService] = await Promise.all([
    db.service.create({
      data: {
        name: `${tag} Balayage`,
        categoryId,
        defaultDurationMinutes: 60,
        minPrice: new Prisma.Decimal('100.00'),
      },
      select: { id: true },
    }),
    db.service.create({
      data: {
        name: `${tag} Gel Set`,
        categoryId: nailCategoryId,
        defaultDurationMinutes: 45,
        minPrice: new Prisma.Decimal('60.00'),
      },
      select: { id: true },
    }),
  ])
  serviceId = service.id
  nailServiceId = nailService.id

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
        title: 'Look anchor consent fixture',
        body: 'Look anchor consent fixture only.',
      },
      select: { id: true },
    }),
    db.consultAgreementVersion.create({
      data: {
        kind: ConsultAgreementKind.ADULT_18_PLUS_ATTESTATION,
        version: versionBase,
        title: 'Look anchor adult fixture',
        body: 'Look anchor adult fixture only.',
      },
      select: { id: true },
    }),
  ])
  consentVersionId = consent.id
  adultVersionId = adult.id

  hairLookId = (
    await createLook({ professionalId, serviceId, label: 'hair-look' })
  ).lookId
  unlinkedLookId = (
    await createLook({ professionalId, serviceId: null, label: 'unlinked-look' })
  ).lookId
  nailLookId = (
    await createLook({
      professionalId,
      serviceId: nailServiceId,
      label: 'nail-look',
    })
  ).lookId
  draftLookId = (
    await createLook({
      professionalId,
      serviceId,
      status: LookPostStatus.DRAFT,
      label: 'draft-look',
    })
  ).lookId
  otherProLookId = (
    await createLook({
      professionalId: otherProfessionalId,
      serviceId,
      label: 'other-pro-look',
    })
  ).lookId
})

beforeEach(() => {
  vi.clearAllMocks()
  fake.objects.clear()
  fake.purgedPaths.length = 0
  mockRequireClient.mockResolvedValue({
    ok: true,
    clientId,
    user: { id: clientUserId },
  })
})

afterAll(async () => {
  // Raw consult objects must be verified purged before a session may be
  // deleted (consult_session_delete_requires_purge). Do it per session and keep
  // going, so one stuck session cannot strand the rest of this fixture's rows —
  // notably the globally unique 'hair-color' ServiceCategory slug, which every
  // other consult suite also needs.
  for (const sessionId of new Set(sessionIds)) {
    try {
      await purgeConsultSessionRawObjects(sessionId)
      await db.consultSession.deleteMany({ where: { id: sessionId } })
    } catch (error) {
      console.error('look-anchor fixture cleanup failed', { sessionId, error })
    }
  }
  await db.booking.deleteMany({ where: { id: { in: bookingIds } } })
  // Acceptances cascade with their session; if one session refused to delete
  // above, deleting its agreement versions would throw and strand every row
  // after this line — including the shared 'hair-color' category.
  await db.consultAgreementVersion
    .deleteMany({
      where: { id: { in: [consentVersionId, adultVersionId].filter(Boolean) } },
    })
    .catch((error: unknown) => {
      console.error('look-anchor agreement cleanup failed', { error })
    })
  await db.lookPost.deleteMany({ where: { id: { in: lookIds } } })
  await db.mediaAsset.deleteMany({ where: { id: { in: mediaIds } } })
  await db.professionalServiceOffering.deleteMany({ where: { professionalId } })
  if (locationId) {
    await db.professionalLocation.deleteMany({ where: { id: locationId } })
  }
  await db.service.deleteMany({
    where: { id: { in: [serviceId, nailServiceId].filter(Boolean) } },
  })
  await db.serviceCategory.deleteMany({
    where: {
      id: {
        in: [ownsHairColorCategory ? categoryId : '', nailCategoryId].filter(
          Boolean,
        ),
      },
    },
  })
  if (clientId) await db.clientProfile.deleteMany({ where: { id: clientId } })
  await db.professionalProfile.deleteMany({
    where: { id: { in: [professionalId, otherProfessionalId].filter(Boolean) } },
  })
  await db.user.deleteMany({
    where: {
      id: { in: [proUserId, otherProUserId, clientUserId].filter(Boolean) },
    },
  })
  if (tenantId) await db.tenant.deleteMany({ where: { id: tenantId } })
  delete process.env.ENABLE_AI_CONSULT
  await db.$disconnect()
})

describe('look-anchored consult entry', () => {
  it('creates a consult with NO booking, deriving the pro and category from the look', async () => {
    const before = await availability(hairLookId)
    expect(before.status).toBe(200)
    expect((await body(before)).availability).toEqual({
      available: true,
      reason: null,
      consult: null,
    })

    const created = await startLook(hairLookId)
    expect(created.status).toBe(200)
    const consult = (await body(created)).consult as Record<string, unknown>
    sessionIds.push(String(consult.id))
    expect(consult).toMatchObject({
      lookPostId: hairLookId,
      professionalId,
      serviceCategoryId: categoryId,
      status: ConsultSessionStatus.CONSENT_REQUIRED,
    })
    expect(consult).not.toHaveProperty('bookingId')

    const row = await db.consultSession.findUniqueOrThrow({
      where: { id: String(consult.id) },
      select: { bookingId: true, anchorLookPostId: true },
    })
    expect(row).toEqual({ bookingId: null, anchorLookPostId: hairLookId })

    const after = await availability(hairLookId)
    expect(
      ((await body(after)).availability as { consult: { id: string } }).consult
        .id,
    ).toBe(String(consult.id))
  })

  it('is idempotent — tapping "book this look" twice returns the same consult', async () => {
    const first = await startLook(hairLookId)
    const second = await startLook(hairLookId)
    const firstId = ((await body(first)).consult as { id: string }).id
    const secondId = ((await body(second)).consult as { id: string }).id
    expect(secondId).toBe(firstId)
    expect(
      await db.consultSession.count({
        where: { clientId, anchorLookPostId: hairLookId },
      }),
    ).toBe(1)
  })

  it('REFUSES a look with no service linkage, and says so', async () => {
    const available = await availability(unlinkedLookId)
    expect((await body(available)).availability).toEqual({
      available: false,
      reason: 'LOOK_SERVICE_UNLINKED',
      consult: null,
    })
    const started = await startLook(unlinkedLookId)
    expect(started.status).toBe(409)
    expect(await body(started)).toMatchObject({
      code: 'CONSULT_LOOK_NOT_CONSULTABLE',
    })
    expect(
      await db.consultSession.count({
        where: { anchorLookPostId: unlinkedLookId },
      }),
    ).toBe(0)
  })

  it('admits a look in ANY category by default, and refuses it only under the kill switch', async () => {
    const open = await availability(nailLookId)
    expect((await body(open)).availability).toMatchObject({
      available: true,
      reason: null,
    })

    process.env.AI_CONSULT_SERVICE_SCOPE = 'HAIR_COLOR_ONLY'
    try {
      const narrowed = await availability(nailLookId)
      expect((await body(narrowed)).availability).toMatchObject({
        available: false,
        reason: 'LOOK_VERTICAL_NOT_ENABLED',
      })
      expect((await startLook(nailLookId)).status).toBe(409)
    } finally {
      delete process.env.AI_CONSULT_SERVICE_SCOPE
    }
    expect(
      await db.consultSession.count({ where: { anchorLookPostId: nailLookId } }),
    ).toBe(0)
  })

  it('leaks nothing about a look the client cannot see', async () => {
    const available = await availability(draftLookId)
    expect((await body(available)).availability).toEqual({
      available: false,
      reason: null,
      consult: null,
    })
    expect((await startLook(draftLookId)).status).toBe(404)
  })

  it('the database refuses a consult whose look belongs to another professional', async () => {
    await expect(
      db.consultSession.create({
        data: {
          clientId,
          professionalId,
          anchorLookPostId: otherProLookId,
          serviceCategoryId: categoryId,
        },
      }),
    ).rejects.toThrow(/look professional and name a service category/)
  })

  it('the database still refuses a consult with no anchor at all', async () => {
    // The scope guard reaches it first; the CHECK constraint is the backstop
    // behind it. Either way an anchorless consult cannot be written.
    await expect(
      db.consultSession.create({
        data: { clientId, professionalId, serviceCategoryId: categoryId },
      }),
    ).rejects.toThrow(/anchored to a booking or a look/)
  })
})

describe('inspiration seeded from the anchoring look', () => {
  it('attaches the look as the inspiration source without copying any bytes', async () => {
    const lookPostId = await freshHairLook()
    const created = await startLook(lookPostId)
    const sessionId = ((await body(created)).consult as { id: string }).id
    if (!sessionIds.includes(sessionId)) sessionIds.push(sessionId)

    expect(
      await db.consultInspiration.count({ where: { consultSessionId: sessionId } }),
    ).toBe(0)

    const mediaBefore = await db.mediaAsset.count()
    await consentAndCompleteIntake(sessionId, 'seed')

    const seeded = await db.consultInspiration.findFirstOrThrow({
      where: { consultSessionId: sessionId },
    })
    expect(seeded).toMatchObject({
      source: ConsultInspirationSource.BOOKED_PRO_LOOK,
      status: ConsultInspirationStatus.ATTACHED,
      sourceLookPostId: lookPostId,
      storageBucket: null,
      storagePath: null,
      contentType: null,
      sizeBytes: null,
      useExpiresAt: null,
      purgedAt: null,
    })
    // Referenced, not copied: no new MediaAsset, no storage traffic at all.
    expect(await db.mediaAsset.count()).toBe(mediaBefore)
    expect(fake.objects.size).toBe(0)

    expect(
      await db.consultAuditEvent.count({
        where: {
          consultSessionId: sessionId,
          inspirationId: seeded.id,
          action: ConsultAuditAction.INSPIRATION_SOURCE_SELECTED,
        },
      }),
    ).toBe(1)
  })

  // 🔴 B4. The inspiration image has to be READABLE, not just referenced. The
  // state used to hand a look-anchored consult `/api/v1/looks/{id}` as its
  // `imageReadEndpoint` — a route that answers a look DTO, not
  // `{ url, expiresInSeconds }` — so the likes/dislikes step ran with nothing
  // on screen on both platforms. One route, one shape, both sources.
  it('serves the anchoring look image through the consult-scoped read route', async () => {
    const lookPostId = await freshHairLook()
    const created = await startLook(lookPostId)
    const sessionId = ((await body(created)).consult as { id: string }).id
    if (!sessionIds.includes(sessionId)) sessionIds.push(sessionId)
    await consentAndCompleteIntake(sessionId, 'look-read')

    const state = await loadConsultInspirationState({
      consultSessionId: sessionId,
      clientId,
      actorUserId: clientUserId,
    })
    expect(state.source).toMatchObject({
      source: ConsultInspirationSource.BOOKED_PRO_LOOK,
      lookPostId,
      imageAvailable: true,
      imageReadEndpoint: `/api/v1/client/consult/${sessionId}/inspiration/media`,
    })

    const read = await loadClientInspirationSignedRead({
      consultSessionId: sessionId,
      clientId,
      actorUserId: clientUserId,
    })
    // The look fixture's asset lives in the PUBLIC bucket, so this resolves to
    // a public object URL naming that exact object; a private-bucket look would
    // resolve to a signed one instead. Either way the SHAPE is the contract,
    // and the expiry is finite and positive so the clients have something to
    // schedule a renewal from.
    const media = await db.mediaAsset.findUniqueOrThrow({
      where: { id: (await db.lookPost.findUniqueOrThrow({
        where: { id: lookPostId },
        select: { primaryMediaAssetId: true },
      })).primaryMediaAssetId },
      select: { storageBucket: true, storagePath: true },
    })
    expect(media.storageBucket).toBe('media-public')
    expect(read.url).toContain(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '\u0000')
    expect(read.url).toContain(media.storagePath!)
    expect(Number.isFinite(read.expiresInSeconds)).toBe(true)
    expect(read.expiresInSeconds).toBeGreaterThan(0)
    // No storage traffic: this is the LOOK's own object, never a copy.
    expect(fake.objects.size).toBe(0)

    // Unpublish the look and the very next read refuses. This is why the
    // endpoint is a route and not a URL baked into the state DTO — a URL
    // handed out once keeps working after the look stops being viewable.
    await db.lookPost.update({
      where: { id: lookPostId },
      data: { status: LookPostStatus.DRAFT },
    })
    await expect(
      loadClientInspirationSignedRead({
        consultSessionId: sessionId,
        clientId,
        actorUserId: clientUserId,
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
    expect(
      (
        await loadConsultInspirationState({
          consultSessionId: sessionId,
          clientId,
          actorUserId: clientUserId,
        })
      ).source?.imageAvailable,
    ).toBe(false)
  })

  it('does not seed a booking-anchored consult', async () => {
    const booking = await db.booking.create({
      data: {
        clientId,
        professionalId,
        serviceId,
        proTenantId: tenantId,
        clientHomeTenantId: tenantId,
        scheduledFor: new Date(Date.now() + 20 * 24 * 60 * 60 * 1000),
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
        clientId,
        bookingId: booking.id,
        professionalId,
        serviceCategoryId: categoryId,
        auditEvents: {
          create: {
            action: ConsultAuditAction.SESSION_CREATED,
            actorType: ConsultActorType.CLIENT,
            actorId: clientUserId,
            toStatus: ConsultSessionStatus.CONSENT_REQUIRED,
          },
        },
      },
      select: { id: true },
    })
    sessionIds.push(session.id)

    await consentAndCompleteIntake(session.id, 'booking-anchored')

    expect(
      await db.consultSession.findUniqueOrThrow({
        where: { id: session.id },
        select: { status: true },
      }),
    ).toEqual({ status: ConsultSessionStatus.MEDIA_READY })
    expect(
      await db.consultInspiration.count({
        where: { consultSessionId: session.id },
      }),
    ).toBe(0)
  })
})

describe('a look-anchored consult reaches analysis results', () => {
  it('runs create → seeded inspiration → intake → captures → analysis → results', async () => {
    const lookPostId = await freshHairLook()
    const created = await startLook(lookPostId)
    const sessionId = ((await body(created)).consult as { id: string }).id
    if (!sessionIds.includes(sessionId)) sessionIds.push(sessionId)

    await consentAndCompleteIntake(sessionId, 'e2e')
    await answerInspiration(sessionId, 'e2e')

    for (const shotKey of [
      'hair_back',
      'hair_left',
      'hair_right',
      'hair_crown',
      'face_front',
      'face_side',
      'eyes_closeup',
    ] as const) {
      await attachAcceptedCapture(sessionId, shotKey, 'e2e')
    }

    expect(
      await db.consultSession.findUniqueOrThrow({
        where: { id: sessionId },
        select: { status: true },
      }),
    ).toEqual({ status: ConsultSessionStatus.ANALYSIS_PENDING })

    const analysis = await startAnalysis(
      jsonRequest(`/api/v1/client/consult/${sessionId}/analysis`, {
        idempotencyKey: 'e2e-analysis',
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

    const results = await loadAuthorizedClientConsultResults({
      consultSessionId: sessionId,
      clientId,
      actorUserId: clientUserId,
    })
    expect(results).toMatchObject({
      consultId: sessionId,
      bookingId: null,
      lookPostId: lookPostId,
      serviceCategoryId: categoryId,
    })
    expect(results.styleDirections).toHaveLength(7)

    // A look-anchored consult has no visit to file chart photos against, so the
    // copy is skipped rather than invented against some other booking.
    expect(
      await db.consultSession.findUniqueOrThrow({
        where: { id: sessionId },
        select: { chartCopyCompletedAt: true },
      }),
    ).toEqual({ chartCopyCompletedAt: null })
  })
})

describe('purge lifecycles stay separate', () => {
  it('purging a look-anchored consult leaves the LOOK and its media intact', async () => {
    const lookPostId = await freshHairLook()
    const created = await startLook(lookPostId)
    const sessionId = ((await body(created)).consult as { id: string }).id
    if (!sessionIds.includes(sessionId)) sessionIds.push(sessionId)
    await consentAndCompleteIntake(sessionId, 'purge')

    const seeded = await db.consultInspiration.findFirstOrThrow({
      where: { consultSessionId: sessionId },
    })
    const look = await db.lookPost.findUniqueOrThrow({
      where: { id: lookPostId },
      select: { id: true, primaryMediaAssetId: true, status: true },
    })

    const sweep = await runConsultInspirationPurgeSweep()
    const targeted = await purgeConsultSessionInspirationObjects(sessionId)

    // Neither sweep touches a referenced Look: both filter on EXTERNAL_UPLOAD.
    expect(targeted).toMatchObject({ considered: 0, purged: 0, failed: 0 })
    expect(sweep.failed).toBe(0)

    expect(
      await db.consultInspiration.findUniqueOrThrow({
        where: { id: seeded.id },
      }),
    ).toMatchObject({
      sourceLookPostId: lookPostId,
      purgedAt: null,
      purgeEligibleAt: null,
      purgeRequestedAt: null,
      status: ConsultInspirationStatus.ATTACHED,
    })

    expect(
      await db.lookPost.findUniqueOrThrow({
        where: { id: lookPostId },
        select: { id: true, primaryMediaAssetId: true, status: true },
      }),
    ).toEqual(look)
    expect(
      await db.mediaAsset.count({ where: { id: look.primaryMediaAssetId } }),
    ).toBe(1)
    expect(fake.purgedPaths).toEqual([])
  })

  it('deleting the consult leaves the look standing', async () => {
    const lookPostId = await freshHairLook()
    const created = await startLook(lookPostId)
    const sessionId = ((await body(created)).consult as { id: string }).id
    await consentAndCompleteIntake(sessionId, 'delete')

    await db.consultSession.delete({ where: { id: sessionId } })

    expect(
      await db.consultInspiration.count({ where: { consultSessionId: sessionId } }),
    ).toBe(0)
    const look = await db.lookPost.findUnique({
      where: { id: lookPostId },
      select: { id: true, primaryMediaAssetId: true },
    })
    expect(look?.id).toBe(lookPostId)
    expect(
      await db.mediaAsset.count({ where: { id: look?.primaryMediaAssetId } }),
    ).toBe(1)
  })
})
