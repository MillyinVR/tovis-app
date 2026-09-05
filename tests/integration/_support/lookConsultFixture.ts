// tests/integration/_support/lookConsultFixture.ts
//
// The shared fixture for Book the Look's integration suites: one seeded pro
// with a real two-service hair-color menu, one client, one bookable salon
// location, and the create → consent → intake → inspiration → captures →
// analysis drive that takes a look-anchored consult to COMPLETED with a
// persisted `ConsultServiceEstimate`.
//
// Extracted from tests/integration/consult-look-estimate.test.ts (B3) when B4
// needed the same ~500-line setup to reach the state its own subject STARTS
// from. Two copies of "how a consult is driven" would drift the moment either
// slice changed a step, and then one suite would be proving something about a
// flow the other no longer runs.
//
// ⚠️ The `vi.mock` calls CANNOT move here — Vitest hoists them per test FILE.
// Each suite declares its own, delegating to `./consultLookFakes`, which is a
// leaf module for exactly that reason.

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
import { expect } from 'vitest'

import { POST as attachCapture } from '@/app/api/v1/client/consult/[id]/capture/attach/route'
import { POST as checkQuality } from '@/app/api/v1/client/consult/[id]/capture/[captureId]/quality/route'
import { POST as issueUpload } from '@/app/api/v1/client/consult/[id]/capture/uploads/route'
import { POST as startAnalysis } from '@/app/api/v1/client/consult/[id]/analysis/route'
import { processConsultAnalysisRuns } from '@/lib/consult/analysisRunner'
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
import {
  acceptConsultAgreement,
  appendConsultIntakeRevision,
} from '@/lib/consult/writeBoundary'

import { fakeStorageObjects } from './consultLookFakes'

// The pro's real menu, and the numbers every assertion is derived from.
// 50 minutes on a 30-minute grid is the point: rounding to the NEAREST slot
// would give 45 and quietly steal five minutes of her day.
export const BALAYAGE_PRICE = '180.00'
export const BALAYAGE_MINUTES = 50
export const BALAYAGE_ESTIMATED_MINUTES = 60
export const GLOSS_PRICE = '45.00'
export const GLOSS_MINUTES = 20
export const GLOSS_ESTIMATED_MINUTES = 30
export const STEP_MINUTES = 30
export const BUFFER_MINUTES = 15
export const ZONE = 'America/Los_Angeles'
/** Pinned by CONSULT_SAFETY_SERVICE_BOOKING_RULES.PATCH_TEST — not a free choice. */
export const PATCH_TEST_MINUTES = 10

/** Every id the seeded world hands back. Mutated in place by `seedLookConsultFixture`. */
export const fx = {
  tenantId: '',
  proUserId: '',
  professionalId: '',
  locationId: '',
  categoryId: '',
  ownsHairColorCategory: false,
  balayageServiceId: '',
  glossServiceId: '',
  offMenuServiceId: '',
  patchTestServiceId: '',
  balayageOfferingId: '',
  glossOfferingId: '',
  consentVersionId: '',
  adultVersionId: '',
  clientUserId: '',
  clientId: '',
  tag: '',
}

const mediaIds: string[] = []
const lookIds: string[] = []
const sessionIds: string[] = []

/**
 * The ordinary intake: nothing that routes to safety prerequisites.
 * `determineHairColorSafetyRouting` (lib/consult/safetyRouting.ts) is what
 * decides, so these values are chosen to keep `blocksChemicalRecommendations`
 * false — a "not-sure" or a recent box dye anywhere here flips it.
 */
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

/**
 * An intake that DOES route to safety prerequisites: a reported prior reaction
 * requires a PATCH_TEST, and the analysis then replaces every colour
 * recommendation with the tests plus a professional review.
 *
 * Driven from the intake rather than by faking a provider safety flag, because
 * `resolveRecommendations` rewrites the recommendation list server-side — a
 * faked flag would prove nothing about the path B4 actually gates on.
 */
export const SAFETY_ROUTED_ANSWERS = {
  ...completeAnswers,
  prior_reaction: 'yes',
}

export function context(id: string) {
  return { params: { id } }
}

function captureContext(id: string, captureId: string) {
  return { params: { id, captureId } }
}

export async function body(response: Response): Promise<Record<string, unknown>> {
  const parsed: unknown = await response.json()
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Expected response object.')
  }
  return { ...parsed }
}

export function jsonRequest(path: string, value: Record<string, unknown>) {
  return new Request(`http://test${path}`, {
    method: 'POST',
    body: JSON.stringify(value),
  })
}

let lookSequence = 0

export async function createLook(
  db: PrismaClient,
  serviceId: string,
): Promise<string> {
  lookSequence += 1
  const media = await db.mediaAsset.create({
    data: {
      professionalId: fx.professionalId,
      proTenantId: fx.tenantId,
      primaryServiceId: serviceId,
      mediaType: MediaType.IMAGE,
      visibility: MediaVisibility.PUBLIC,
      storageBucket: 'media-public',
      storagePath: `${fx.tag}/look-${lookSequence}.jpg`,
    },
    select: { id: true },
  })
  mediaIds.push(media.id)
  const look = await db.lookPost.create({
    data: {
      professionalId: fx.professionalId,
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
  db: PrismaClient,
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
  fakeStorageObjects.set(row.storagePath, {
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
export async function runConsultToCompletion(
  db: PrismaClient,
  lookPostId: string,
  label: string,
  answers: Readonly<Record<string, string>> = completeAnswers,
): Promise<string> {
  const created = await startLookConsult(
    jsonRequest('/api/v1/client/consult/look', { lookPostId }),
  )
  expect(created.status).toBe(200)
  const sessionId = ((await body(created)).consult as { id: string }).id
  if (!sessionIds.includes(sessionId)) sessionIds.push(sessionId)

  await acceptConsultAgreement({
    consultSessionId: sessionId,
    agreementVersionId: fx.consentVersionId,
    expectedKind: ConsultAgreementKind.SENSITIVE_DATA_CONSENT,
    actor: { type: ConsultActorType.CLIENT, id: fx.clientUserId },
  })
  await acceptConsultAgreement({
    consultSessionId: sessionId,
    agreementVersionId: fx.adultVersionId,
    expectedKind: ConsultAgreementKind.ADULT_18_PLUS_ATTESTATION,
    actor: { type: ConsultActorType.CLIENT, id: fx.clientUserId },
  })
  await appendConsultIntakeRevision({
    consultSessionId: sessionId,
    actor: { type: ConsultActorType.CLIENT, id: fx.clientUserId },
    loadInput: async () => ({
      idempotencyKey: `intake-${label}`,
      packVersion: HAIR_COLOR_INTAKE_PACK_VERSION,
      schemaVersion: HAIR_COLOR_INTAKE_SCHEMA_VERSION,
      complete: true,
      answers,
    }),
  })
  for (const [questionKey, selectedValues, text, sentiment] of INSPIRATION_ANSWERS) {
    await answerConsultInspirationQuestion({
      consultSessionId: sessionId,
      clientId: fx.clientId,
      actor: { type: ConsultActorType.CLIENT, id: fx.clientUserId },
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
    await attachAcceptedCapture(db, sessionId, shotKey, label)
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

  // P4b: the start request claims the analysis and queues a run; it does not
  // analyze. Every suite that reaches through this fixture wants a FINISHED
  // consult, so the fixture drains the run — the production equivalent is the
  // in-request kick plus the every-minute cron, neither of which exists in a
  // test process (`kickConsultAnalysisRun` deliberately no-ops under VITEST so
  // no unit test can make a paid call by accident).
  const drained = await processConsultAnalysisRuns({ take: 1 })
  expect(drained.outcomes[0]?.result).toBe('COMPLETED')

  expect(
    await db.consultSession.findUniqueOrThrow({
      where: { id: sessionId },
      select: { status: true },
    }),
  ).toEqual({ status: ConsultSessionStatus.COMPLETED })

  return sessionId
}

/**
 * Seed the world.
 *
 * `tagPrefix` must be free of the words "color" and "consult": service names
 * are matched to analysis intents by regex (analysisContract INTENT_PATTERNS),
 * and a tag carrying either word would silently change which offering matched.
 *
 * `workingHours` is optional — B3 never books anything, so its location needs
 * none; B4 does, so it passes real hours and scheduling knobs.
 */
export async function seedLookConsultFixture(
  db: PrismaClient,
  args: {
    tagPrefix: string
    workingHours?: Prisma.InputJsonValue
    advanceNoticeMinutes?: number
    maxDaysAhead?: number
    /**
     * Give the salon location a real address + coordinates, making the pro
     * BOOKING-READY (`assertProfessionalIsBookingReady` refuses without them:
     * LOCATION_MISSING_GEO / SALON_MISSING_ADDRESS / NO_BOOKABLE_LOCATION).
     * B3 books nothing and leaves it off; B4 needs it.
     */
    bookable?: boolean
    /**
     * Add the "Patch Test" offering the safety-routed path needs. When the
     * intake routes to prerequisites, `requireSafetyOfferings` refuses the whole
     * analysis unless the pro lists a service named exactly "Patch Test" at the
     * exact duration and price `CONSULT_SAFETY_SERVICE_BOOKING_RULES` pins
     * (10 minutes, $0). Off by default so B3's menu assertions are untouched.
     */
    withSafetyOfferings?: boolean
  },
): Promise<void> {
  process.env.ENABLE_AI_CONSULT = '1'
  fx.tag = `${args.tagPrefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  const versionBase = 4_000_000 + Math.floor(Math.random() * 100_000)

  const tenant = await db.tenant.create({
    data: { slug: `${fx.tag}-tenant`, name: 'Look fixture', isActive: true },
    select: { id: true },
  })
  fx.tenantId = tenant.id

  const [proUser, clientUser] = await Promise.all([
    db.user.create({
      data: { email: `${fx.tag}_pro@example.com`, password: 'x', role: Role.PRO },
      select: { id: true },
    }),
    db.user.create({
      data: {
        email: `${fx.tag}_client@example.com`,
        password: 'x',
        role: Role.CLIENT,
      },
      select: { id: true },
    }),
  ])
  fx.proUserId = proUser.id
  fx.clientUserId = clientUser.id

  const [pro, client] = await Promise.all([
    db.professionalProfile.create({
      data: {
        userId: fx.proUserId,
        homeTenantId: fx.tenantId,
        firstName: 'Estimate',
        lastName: 'Professional',
        timeZone: ZONE,
        verificationStatus: VerificationStatus.APPROVED,
      },
      select: { id: true },
    }),
    db.clientProfile.create({
      data: {
        userId: fx.clientUserId,
        firstName: 'Estimate',
        lastName: 'Client',
        homeTenantId: fx.tenantId,
      },
      select: { id: true },
    }),
  ])
  fx.professionalId = pro.id
  fx.clientId = client.id

  const location = await db.professionalLocation.create({
    data: {
      professionalId: fx.professionalId,
      type: ProfessionalLocationType.SALON,
      name: 'Estimate studio',
      timeZone: ZONE,
      workingHours: args.workingHours ?? {},
      isBookable: true,
      stepMinutes: STEP_MINUTES,
      bufferMinutes: BUFFER_MINUTES,
      ...(args.bookable
        ? {
            isPrimary: true,
            formattedAddress: '123 Salon St, San Diego, CA 92101',
            addressLine1: '123 Salon St',
            city: 'San Diego',
            state: 'CA',
            postalCode: '92101',
            countryCode: 'US',
            lat: new Prisma.Decimal('32.7157000'),
            lng: new Prisma.Decimal('-117.1611000'),
          }
        : {}),
      ...(args.advanceNoticeMinutes == null
        ? {}
        : { advanceNoticeMinutes: args.advanceNoticeMinutes }),
      ...(args.maxDaysAhead == null ? {} : { maxDaysAhead: args.maxDaysAhead }),
    },
    select: { id: true },
  })
  fx.locationId = location.id

  // 'hair-color' is a globally unique slug the seed fixture may already own.
  const existingCategory = await db.serviceCategory.findUnique({
    where: { slug: 'hair-color' },
    select: { id: true },
  })
  fx.ownsHairColorCategory = !existingCategory
  const category =
    existingCategory ??
    (await db.serviceCategory.create({
      data: { name: `${fx.tag} hair`, slug: 'hair-color' },
      select: { id: true },
    }))
  fx.categoryId = category.id

  // Names matter: analysisContract matches an analysis serviceIntent to an
  // offering by regex over the service's name and description.
  const [balayage, gloss, offMenu] = await Promise.all([
    db.service.create({
      data: {
        name: `${fx.tag} Balayage`,
        categoryId: fx.categoryId,
        defaultDurationMinutes: 90,
        minPrice: new Prisma.Decimal('100.00'),
      },
      select: { id: true },
    }),
    db.service.create({
      data: {
        name: `${fx.tag} Toner Gloss`,
        categoryId: fx.categoryId,
        defaultDurationMinutes: 30,
        minPrice: new Prisma.Decimal('30.00'),
      },
      select: { id: true },
    }),
    db.service.create({
      data: {
        name: `${fx.tag} Vivid Fashion`,
        categoryId: fx.categoryId,
        defaultDurationMinutes: 120,
        minPrice: new Prisma.Decimal('200.00'),
      },
      select: { id: true },
    }),
  ])
  fx.balayageServiceId = balayage.id
  fx.glossServiceId = gloss.id
  fx.offMenuServiceId = offMenu.id

  // The pro's menu: balayage and the gloss. `offMenuServiceId` is deliberately
  // NOT here — it is a real hair-color service she does not offer.
  const [balayageOffering, glossOffering] = await Promise.all([
    db.professionalServiceOffering.create({
      data: {
        professionalId: fx.professionalId,
        serviceId: fx.balayageServiceId,
        isActive: true,
        offersInSalon: true,
        salonPriceStartingAt: new Prisma.Decimal(BALAYAGE_PRICE),
        salonDurationMinutes: BALAYAGE_MINUTES,
      },
      select: { id: true },
    }),
    db.professionalServiceOffering.create({
      data: {
        professionalId: fx.professionalId,
        serviceId: fx.glossServiceId,
        isActive: true,
        offersInSalon: true,
        salonPriceStartingAt: new Prisma.Decimal(GLOSS_PRICE),
        salonDurationMinutes: GLOSS_MINUTES,
      },
      select: { id: true },
    }),
  ])
  fx.balayageOfferingId = balayageOffering.id
  fx.glossOfferingId = glossOffering.id

  if (args.withSafetyOfferings) {
    // Named exactly "Patch Test" — `safetyOffering` matches on the trimmed,
    // lower-cased service NAME, so the fixture tag must not be prefixed here.
    const patchTest = await db.service.create({
      data: {
        name: 'Patch Test',
        categoryId: fx.categoryId,
        defaultDurationMinutes: PATCH_TEST_MINUTES,
        minPrice: new Prisma.Decimal('0.00'),
      },
      select: { id: true },
    })
    fx.patchTestServiceId = patchTest.id
    await db.professionalServiceOffering.create({
      data: {
        professionalId: fx.professionalId,
        serviceId: fx.patchTestServiceId,
        isActive: true,
        offersInSalon: true,
        salonPriceStartingAt: new Prisma.Decimal('0.00'),
        salonDurationMinutes: PATCH_TEST_MINUTES,
      },
      select: { id: true },
    })
  }

  // The pro's brief is chart-gated (lib/clientVisibility). An explicitly
  // granted chart share is the honest way to open it for a fixture client with
  // no booking history — the real gate runs, it just has a real reason to pass.
  await db.clientChartShare.create({
    data: {
      clientId: fx.clientId,
      professionalId: fx.professionalId,
      status: ClientChartShareStatus.GRANTED,
      respondedAt: new Date(),
    },
  })

  const [consent, adult] = await Promise.all([
    db.consultAgreementVersion.create({
      data: {
        kind: ConsultAgreementKind.SENSITIVE_DATA_CONSENT,
        version: versionBase,
        title: 'Look fixture consent',
        body: 'Look fixture consent only.',
      },
      select: { id: true },
    }),
    db.consultAgreementVersion.create({
      data: {
        kind: ConsultAgreementKind.ADULT_18_PLUS_ATTESTATION,
        version: versionBase,
        title: 'Look fixture adult attestation',
        body: 'Look fixture adult attestation only.',
      },
      select: { id: true },
    }),
  ])
  fx.consentVersionId = consent.id
  fx.adultVersionId = adult.id
}

export async function teardownLookConsultFixture(
  db: PrismaClient,
  extra?: () => Promise<void>,
): Promise<void> {
  if (extra) {
    await extra().catch((error: unknown) => {
      console.error('look fixture extra cleanup failed', { error })
    })
  }
  for (const sessionId of new Set(sessionIds)) {
    try {
      await purgeConsultSessionRawObjects(sessionId)
      await db.consultSession.deleteMany({ where: { id: sessionId } })
    } catch (error) {
      console.error('look fixture cleanup failed', { sessionId, error })
    }
  }
  sessionIds.length = 0
  await db.consultAgreementVersion
    .deleteMany({
      where: {
        id: { in: [fx.consentVersionId, fx.adultVersionId].filter(Boolean) },
      },
    })
    .catch((error: unknown) => {
      console.error('look fixture agreement cleanup failed', { error })
    })
  await db.clientChartShare.deleteMany({
    where: { professionalId: fx.professionalId },
  })
  await db.lookPost.deleteMany({ where: { id: { in: lookIds } } })
  await db.mediaAsset.deleteMany({ where: { id: { in: mediaIds } } })
  lookIds.length = 0
  mediaIds.length = 0
  await db.professionalServiceOffering.deleteMany({
    where: { professionalId: fx.professionalId },
  })
  if (fx.locationId) {
    await db.professionalLocation.deleteMany({ where: { id: fx.locationId } })
  }
  await db.service.deleteMany({
    where: {
      id: {
        in: [
          fx.balayageServiceId,
          fx.glossServiceId,
          fx.offMenuServiceId,
          fx.patchTestServiceId,
        ].filter(Boolean),
      },
    },
  })
  if (fx.ownsHairColorCategory && fx.categoryId) {
    await db.serviceCategory.deleteMany({ where: { id: fx.categoryId } })
  }
  if (fx.clientId) {
    await db.clientProfile.deleteMany({ where: { id: fx.clientId } })
  }
  await db.professionalProfile.deleteMany({ where: { id: fx.professionalId } })
  await db.user.deleteMany({
    where: { id: { in: [fx.proUserId, fx.clientUserId].filter(Boolean) } },
  })
  if (fx.tenantId) await db.tenant.deleteMany({ where: { id: fx.tenantId } })
  delete process.env.ENABLE_AI_CONSULT
}
