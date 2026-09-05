import 'server-only'

import { createHash } from 'node:crypto'
import {
  ConsultActorType,
  ConsultAnalysisRunStage,
  ConsultAnalysisRunStatus,
  ConsultCaptureStatus,
  ConsultRevisionKind,
  ConsultSessionStatus,
  Prisma,
  ServiceLocationType,
  UploadSessionStatus,
  UploadSurface,
} from '@prisma/client'

import type {
  ConsultAnalysisRunDTO,
  ConsultAnalysisStateDTO,
  ConsultCaptureQualityWarningCodeDTO,
  ConsultCaptureShotKeyDTO,
  ConsultInspirationAnswerDTO,
} from '@/lib/dto/consult'
import { safeError } from '@/lib/security/logging'
import { decimalToCents } from '@/lib/money'
import { prisma } from '@/lib/prisma'

import { requireCurrentConsultAgreementAcceptances } from './agreementContract'
import {
  CONSULT_ANALYSIS_PROMPT_VERSION,
  CONSULT_ANALYSIS_SCHEMA_VERSION,
  ConsultAnalysisProviderError,
  runConsultAnalysis as runConsultAnalysisProvider,
  validateConsultAnalysisProviderResult,
  type ConsultAnalysisProvider,
  type ConsultAnalysisProviderOutput,
  type ConsultAnalysisServiceContext,
} from './analysisEngine'
import { isConsultCaptureShotKey, packHasShot } from './capture/registry'
import type { ConsultCapturePackDefinition } from './capture/types'
import {
  CONSULT_CAPTURE_BUCKET,
  ConsultCaptureStorageError,
  consultCaptureStorage,
  type ConsultCaptureImage,
  type ConsultCaptureStorage,
} from './captureStorage'
import {
  CONSULT_CAPTURE_MEDIA_TYPES,
  CONSULT_CAPTURE_QUALITY_SCHEMA_VERSION,
  CONSULT_CAPTURE_QUALITY_WARNING_CODES,
  isAnalyzableConsultCapturePromptVersion,
  type ConsultCaptureMediaType,
} from './captureVision'
import {
  performConsultInspirationRead,
  persistLockedConsultInspirationAnalysis,
  prepareConsultInspirationRead,
} from './inspirationAnalysisContract'
import {
  advanceConsultAnalysisRunStage,
  claimConsultAnalysisRun,
  completeLockedConsultAnalysisRun,
  CONSULT_ANALYSIS_RUN_SELECT,
  createLockedConsultAnalysisRun,
  failConsultAnalysisRunAttempt,
  latestConsultAnalysisRun,
  mapConsultAnalysisRun,
} from './analysisRun'
import {
  flushConsultProviderMeter,
  type ConsultProviderMeterSink,
} from './providerMeter'
import {
  buildExactClientDetails,
  CONSULT_INSPIRATION_QUESTIONS,
} from './inspirationPack'
import type { ConsultInspirationStorage } from './inspirationStorage'
import type { ConsultInspirationVisionProvider } from './inspirationVision'
import { CONSULT_ANCHOR_SELECT, evaluateConsultAnchor } from './anchor'
import { ConsultWriteError } from './errors'
import {
  consultLookLocationType,
  loadConsultProMenu,
  loadConsultSafetyOfferings,
  type ConsultProMenu,
  type ConsultProMenuOffering,
} from './proMenu'
import { mapStoredConsultAnalysisRevision } from './analysisRevision'
import {
  consultIntakeItems,
  normalizeConsultIntakePayloadForPack,
} from './intake/registry'
import {
  resolveLookPrimaryService,
  toLookPrimaryServiceSummary,
} from '@/lib/looks/serviceOwnership'
import { normalizeServiceName } from '@/lib/migration/serviceMatch'
import {
  loadProLocationCapability,
  type ProLocationCapability,
} from '@/lib/offerings/locationCapability'
import { requireCompletedConsultInspiration } from './inspirationContract'
import { purgeConsultCaptureRawObject } from './capturePurge'
import { copyConsultCapturesToChart } from './chartCopy'
import {
  applyConsultSafetyFlagPolicy,
  deriveConsultSafetyFlagPolicy,
} from './safetyFlags'
import {
  CONSULT_SAFETY_SERVICE_BOOKING_RULES,
  determineConsultSafetyRouting,
  type ConsultSafetyServiceRequirement,
} from './safetyRouting'
import {
  CONSULT_SERVICE_PROFILE_CATEGORY_SELECT,
  resolveConsultServiceProfile,
} from './serviceProfile'
import {
  finalizeLockedHairColorAnalysis,
  transitionLockedConsultSession,
} from './writeBoundary'

type ClientActor = {
  type: typeof ConsultActorType.CLIENT
  id: string
}

const ANALYSIS_SCOPE_SELECT = {
  id: true,
  status: true,
  revisionSequence: true,
  client: { select: { userId: true } },
  professional: {
    select: { homeTenantId: true, homeTenant: { select: { isActive: true } } },
  },
  ...CONSULT_ANCHOR_SELECT,
  serviceCategory: { select: CONSULT_SERVICE_PROFILE_CATEGORY_SELECT },
  booking: {
    select: {
      proTenantId: true,
      locationType: true,
      ...CONSULT_ANCHOR_SELECT.booking.select,
      service: {
        select: {
          ...CONSULT_ANCHOR_SELECT.booking.select.service.select,
          name: true,
        },
      },
    },
  },
} satisfies Prisma.ConsultSessionSelect

type AnalysisScope = Prisma.ConsultSessionGetPayload<{
  select: typeof ANALYSIS_SCOPE_SELECT
}>

/**
 * What the analysis is told the consult is FOR. The family and category come
 * off the session's service profile; the specific service is the booking's,
 * or the look's linked primary service for a look anchor; the menu is the
 * professional's active offerings in this category, by exact name — the enum
 * the provider recommends from.
 */
async function loadServiceContext(
  tx: Prisma.TransactionClient,
  session: AnalysisScope,
  menu: readonly RecommendationOffering[],
): Promise<ConsultAnalysisServiceContext> {
  const profile = resolveConsultServiceProfile(session.serviceCategory)
  let serviceName: string | null = session.booking?.service.name ?? null
  if (!serviceName && session.anchorLookPostId) {
    const look = await tx.lookPost.findUnique({
      where: { id: session.anchorLookPostId },
      select: {
        serviceId: true,
        service: {
          select: {
            id: true,
            name: true,
            category: { select: { name: true, slug: true } },
          },
        },
      },
    })
    const primary = look
      ? toLookPrimaryServiceSummary(
          resolveLookPrimaryService({ serviceId: look.serviceId, service: look.service }),
        )
      : null
    serviceName = primary?.name ?? null
  }
  return {
    family: profile.family,
    categoryName: profile.categoryName,
    serviceName,
    menuServiceNames: menu.map((offering) => offering.service.name),
  }
}

const CAPTURE_SELECT = {
  id: true,
  shotKey: true,
  shotPackVersion: true,
  schemaVersion: true,
  storageBucket: true,
  storagePath: true,
  contentType: true,
  sizeBytes: true,
  checksumSha256: true,
  status: true,
  qualityReasonCode: true,
  // P4: a frame the gate accepted WITH a colour finding is lower-confidence
  // colour evidence, and the analysis prompt is told so per view.
  qualityWarningCode: true,
  qualitySchemaVersion: true,
  qualityPromptVersion: true,
  qualityModel: true,
  rawExpiresAt: true,
  purgeEligibleAt: true,
  purgeRequestedAt: true,
  purgedAt: true,
  uploadSession: {
    select: {
      id: true,
      surface: true,
      status: true,
      consultSessionId: true,
      consultShotKey: true,
      shotPackVersion: true,
      captureSchemaVersion: true,
      storageBucket: true,
      storagePath: true,
      contentType: true,
      maxBytes: true,
      rawExpiresAt: true,
      purgedAt: true,
    },
  },
} satisfies Prisma.ConsultCaptureSelect

type AnalysisCapture = Prisma.ConsultCaptureGetPayload<{
  select: typeof CAPTURE_SELECT
}>

type AnalysisInput = {
  idempotencyKey: string
  schemaVersion: number
  promptVersion: string
}

function requestHash(args: {
  schemaVersion: number
  promptVersion: string
  intakeRevisionId: string
  inspirationRevisionId: string
  captures: readonly AnalysisCapture[]
}): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        schemaVersion: args.schemaVersion,
        promptVersion: args.promptVersion,
        intakeRevisionId: args.intakeRevisionId,
        inspirationRevisionId: args.inspirationRevisionId,
        captures: args.captures.map((capture) => ({
          id: capture.id,
          shotKey: capture.shotKey,
          shotPackVersion: capture.shotPackVersion,
          schemaVersion: capture.schemaVersion,
          qualitySchemaVersion: capture.qualitySchemaVersion,
          qualityPromptVersion: capture.qualityPromptVersion,
        })),
      }),
    )
    .digest('hex')
}

function validInput(input: AnalysisInput): AnalysisInput {
  const idempotencyKey = input.idempotencyKey.trim()
  if (!idempotencyKey || idempotencyKey.length > 128) {
    throw new ConsultWriteError('INVALID_REQUEST', 'Invalid idempotency key.')
  }
  if (input.schemaVersion !== CONSULT_ANALYSIS_SCHEMA_VERSION) {
    throw new ConsultWriteError(
      'ANALYSIS_SCHEMA_VERSION_MISMATCH',
      'Analysis schema version is stale.',
    )
  }
  if (input.promptVersion !== CONSULT_ANALYSIS_PROMPT_VERSION) {
    throw new ConsultWriteError(
      'ANALYSIS_PROMPT_VERSION_MISMATCH',
      'Analysis prompt version is stale.',
    )
  }
  return { ...input, idempotencyKey }
}

async function lockSession(
  tx: Prisma.TransactionClient,
  consultSessionId: string,
  mode: 'SHARE' | 'UPDATE',
): Promise<void> {
  const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT "id" FROM "ConsultSession"
    WHERE "id" = ${consultSessionId}
    ${mode === 'SHARE' ? Prisma.raw('FOR SHARE') : Prisma.raw('FOR UPDATE')}
  `)
  if (rows.length === 0) {
    throw new ConsultWriteError('NOT_FOUND', 'Consult session not found.')
  }
}

async function requireScope(
  tx: Prisma.TransactionClient,
  args: {
    consultSessionId: string
    clientId: string
    actorUserId: string
    now: Date
  },
): Promise<AnalysisScope> {
  const session = await tx.consultSession.findUnique({
    where: { id: args.consultSessionId },
    select: ANALYSIS_SCOPE_SELECT,
  })
  if (
    !session ||
    session.clientId !== args.clientId ||
    session.client.userId !== args.actorUserId ||
    // A booking anchor must sit in the professional's own tenant. A look
    // anchor has no tenant of its own; the pro's home tenant is checked for
    // both arms just below.
    (session.booking &&
      session.booking.proTenantId !== session.professional.homeTenantId)
  ) {
    throw new ConsultWriteError('NOT_FOUND', 'Consult session not found.')
  }
  // Which categories are consultable is the anchor rule's question
  // (lib/consult/serviceScope.ts), asked once, just below.
  const anchor = evaluateConsultAnchor(session, args.now)
  if (!anchor.eligible || !session.serviceCategory.isActive || !session.professional.homeTenant.isActive) {
    throw new ConsultWriteError(
      anchor.eligible || !anchor.hidden ? 'BOOKING_INELIGIBLE' : 'NOT_FOUND',
      'Consult is unavailable for this booking.',
    )
  }
  return session
}

/**
 * The latest intake, normalized against the pack THIS session serves. The
 * normalizer already refuses a stale pack version or schema, so a completed
 * payload here is current by construction.
 */
async function currentCompletedIntake(
  tx: Prisma.TransactionClient,
  session: AnalysisScope,
) {
  const pack = resolveConsultServiceProfile(session.serviceCategory).intakePack
  const revision = await tx.consultRevision.findFirst({
    where: { consultSessionId: session.id, kind: ConsultRevisionKind.INTAKE },
    select: { id: true, revision: true, payload: true },
    orderBy: { revision: 'desc' },
  })
  const payload = revision
    ? normalizeConsultIntakePayloadForPack(pack, revision.payload)
    : null
  if (!revision || !payload || !payload.complete) {
    throw new ConsultWriteError(
      'ANALYSIS_PREREQUISITES_REQUIRED',
      'A current completed intake is required.',
    )
  }
  return { revision, payload }
}

/** The stored warning column narrowed to the DTO union, or null. */
function consultCaptureWarningCode(
  value: string | null,
): ConsultCaptureQualityWarningCodeDTO | null {
  return (
    CONSULT_CAPTURE_QUALITY_WARNING_CODES.find((candidate) => candidate === value) ??
    null
  )
}

/**
 * The client's guided-inspiration answers as the prompt reads them: her own
 * words, from the SAME `buildExactClientDetails` the pro brief renders — so
 * the model and the professional are looking at one list, not two.
 */
function consultInspirationPromptAnswers(
  answers: readonly ConsultInspirationAnswerDTO[],
): { question: string; answer: string }[] {
  return buildExactClientDetails(answers).map((detail) => ({
    question:
      CONSULT_INSPIRATION_QUESTIONS.find((question) => question.key === detail.questionKey)
        ?.label ?? detail.questionKey,
    answer: `${detail.clientWords} (${detail.sentiment})`,
  }))
}

function captureMediaType(value: string): ConsultCaptureMediaType {
  const mediaType = CONSULT_CAPTURE_MEDIA_TYPES.find((candidate) => candidate === value)
  if (!mediaType) {
    throw new ConsultWriteError('ANALYSIS_PREREQUISITES_REQUIRED', 'Invalid capture binding.')
  }
  return mediaType
}

async function currentCaptures(
  tx: Prisma.TransactionClient,
  session: AnalysisScope,
  now: Date,
): Promise<AnalysisCapture[]> {
  const pack: ConsultCapturePackDefinition = resolveConsultServiceProfile(
    session.serviceCategory,
  ).capturePack
  const captures = await tx.consultCapture.findMany({
    where: {
      consultSessionId: session.id,
      status: ConsultCaptureStatus.ACCEPTED,
      purgedAt: null,
      rawExpiresAt: { gt: now },
    },
    select: CAPTURE_SELECT,
    orderBy: [{ shotKey: 'asc' }, { id: 'asc' }],
  })
  const byShot = new Map<string, AnalysisCapture>()
  for (const capture of captures) {
    if (!packHasShot(pack, capture.shotKey) || byShot.has(capture.shotKey)) {
      throw new ConsultWriteError(
        'ANALYSIS_PREREQUISITES_REQUIRED',
        'The current capture pack is incomplete.',
      )
    }
    const upload = capture.uploadSession
    if (
      capture.shotPackVersion !== pack.version ||
      capture.schemaVersion !== pack.schemaVersion ||
      capture.storageBucket !== CONSULT_CAPTURE_BUCKET ||
      !capture.storagePath ||
      capture.qualityReasonCode !== 'PASS' ||
      capture.qualitySchemaVersion !== CONSULT_CAPTURE_QUALITY_SCHEMA_VERSION ||
      !isAnalyzableConsultCapturePromptVersion(capture.qualityPromptVersion) ||
      !capture.qualityModel ||
      capture.purgeEligibleAt ||
      capture.purgeRequestedAt ||
      capture.purgedAt ||
      upload.surface !== UploadSurface.CLIENT_CONSULT ||
      upload.status !== UploadSessionStatus.CONSUMED ||
      upload.consultSessionId !== session.id ||
      upload.consultShotKey !== capture.shotKey ||
      upload.shotPackVersion !== capture.shotPackVersion ||
      upload.captureSchemaVersion !== capture.schemaVersion ||
      upload.storageBucket !== capture.storageBucket ||
      upload.storagePath !== capture.storagePath ||
      upload.contentType !== capture.contentType ||
      upload.maxBytes !== capture.sizeBytes ||
      upload.rawExpiresAt?.getTime() !== capture.rawExpiresAt.getTime() ||
      upload.purgedAt
    ) {
      throw new ConsultWriteError(
        'ANALYSIS_PREREQUISITES_REQUIRED',
        'The current capture pack is invalid.',
      )
    }
    captureMediaType(capture.contentType)
    byShot.set(capture.shotKey, capture)
  }
  // Partial packs are allowed (Tori, 2026-08-27): the client can proceed with
  // any non-empty accepted subset, and the v2 prompt is told which views are
  // missing. The lifecycle transition into ANALYSIS_PENDING enforced the same
  // at-least-one bound.
  if (byShot.size < 1) {
    throw new ConsultWriteError(
      'ANALYSIS_PREREQUISITES_REQUIRED',
      'At least one accepted, unexpired capture is required.',
    )
  }
  // Pack order is the fixed evidence order the provider is sent.
  return pack.shots.flatMap(({ key }) => {
    const capture = byShot.get(key)
    return capture ? [capture] : []
  })
}

async function readVerifiedImages(
  captures: readonly AnalysisCapture[],
  storage: ConsultCaptureStorage,
): Promise<
  Array<{
    shotKey: ConsultCaptureShotKeyDTO
    image: ConsultCaptureImage
    qualityWarningCode: ConsultCaptureQualityWarningCodeDTO | null
  }>
> {
  try {
    await storage.assertReady()
    const images = []
    for (const capture of captures) {
      if (
        !isConsultCaptureShotKey(capture.shotKey) ||!capture.storagePath) {
        throw new ConsultCaptureStorageError('invalid')
      }
      const mediaType = captureMediaType(capture.contentType)
      const inspected = await storage.inspectObject({
        path: capture.storagePath,
        expectedContentType: mediaType,
        maxBytes: capture.sizeBytes,
        expectedChecksumSha256: capture.checksumSha256,
      })
      if (
        inspected.contentType !== mediaType ||
        inspected.sizeBytes !== capture.sizeBytes ||
        (capture.checksumSha256 && inspected.checksumSha256 !== capture.checksumSha256)
      ) {
        throw new ConsultCaptureStorageError('invalid')
      }
      const image = await storage.readObject({
        path: capture.storagePath,
        expectedContentType: mediaType,
        maxBytes: capture.sizeBytes,
      })
      images.push({
        shotKey: capture.shotKey,
        image,
        qualityWarningCode: consultCaptureWarningCode(capture.qualityWarningCode),
      })
    }
    return images
  } catch (error) {
    if (error instanceof ConsultCaptureStorageError) {
      throw new ConsultWriteError(
        error.kind === 'unavailable'
          ? 'CAPTURE_STORAGE_UNAVAILABLE'
          : 'CAPTURE_OBJECT_INVALID',
        'Capture object validation failed.',
      )
    }
    throw error
  }
}

/**
 * A recommendation names a menu service EXACTLY (the provider chose it from an
 * enum of the menu), so resolution is an exact, case-insensitive name match —
 * the colour pipeline's regex table over names and descriptions is gone.
 * A consultation resolves to the pro's consultation service when she offers
 * one in this category, else to the category itself.
 */
const CONSULTATION_OFFERING_PATTERN = /\bconsult/i

function offeringByName(
  offerings: readonly RecommendationOffering[],
  serviceName: string,
): RecommendationOffering | undefined {
  const wanted = normalizeServiceName(serviceName)
  return offerings.find(
    (offering) => normalizeServiceName(offering.service.name) === wanted,
  )
}

// The menu read moved to lib/consult/proMenu.ts when B3's translation module
// became its second reader: the estimate must price off the SAME list the
// recommendations were matched against, or it could price a service this
// matcher never saw.
type RecommendationOffering = ConsultProMenuOffering

async function loadRecommendationOfferings(
  tx: Prisma.TransactionClient,
  session: AnalysisScope,
) {
  return loadConsultProMenu(tx, {
    professionalId: session.professionalId,
    serviceCategoryId: session.serviceCategoryId,
  })
}

function offeringMode(offering: RecommendationOffering, locationType: ServiceLocationType) {
  return locationType === ServiceLocationType.SALON
    ? {
        enabled: offering.offersInSalon,
        price: offering.salonPriceStartingAt,
        durationMinutes:
          offering.salonDurationMinutes ?? offering.service.defaultDurationMinutes,
      }
    : {
        enabled: offering.offersMobile,
        price: offering.mobilePriceStartingAt,
        durationMinutes:
          offering.mobileDurationMinutes ?? offering.service.defaultDurationMinutes,
      }
}

/**
 * Which of the pro's two price/duration columns a recommendation is read from.
 *
 * A booking already chose salon or mobile. A look-anchored consult has not — the
 * booking proposal is B4 — so it reads the column for the mode the pro can
 * HOST (`consultLookLocationType`): salon when she has a bookable salon or
 * suite, else mobile. Before this the look anchor always read the salon
 * column, so a mobile-only pro's Patch Test — narrowed to mobile — was never
 * found and every routed consult refused. This is a READING choice for the
 * reference lookup only; deriving a real price for a look is the translation
 * module's job (B3), not this one's.
 */
function recommendationLocationType(
  session: AnalysisScope,
  capability: ProLocationCapability,
): ServiceLocationType {
  return session.booking?.locationType ?? consultLookLocationType(capability)
}

function safetyOffering(
  offerings: readonly RecommendationOffering[],
  locationType: ServiceLocationType,
  requirement: ConsultSafetyServiceRequirement,
): RecommendationOffering | null {
  const rule = CONSULT_SAFETY_SERVICE_BOOKING_RULES[requirement]
  return (
    offerings.find((offering) => {
      const mode = offeringMode(offering, locationType)
      return (
        offering.service.name.trim().toLowerCase() === rule.name.toLowerCase() &&
        mode.enabled &&
        mode.durationMinutes === rule.durationMinutes &&
        decimalToCents(mode.price) === rule.priceCents
      )
    }) ?? null
  )
}

/**
 * The safety tests are looked up across the professional's WHOLE menu
 * (lib/consult/proMenu.ts `loadConsultSafetyOfferings`): a Patch Test is one
 * service however the pro filed it, and a nails or brows consult routes to it
 * as readily as a colour one.
 */
async function loadSafetyOfferings(
  tx: Prisma.TransactionClient,
  session: AnalysisScope,
  requirements: readonly ConsultSafetyServiceRequirement[],
  capability: ProLocationCapability,
): Promise<RecommendationOffering[]> {
  return loadConsultSafetyOfferings(
    tx,
    {
      professionalId: session.professionalId,
      serviceNames: requirements.map(
        (requirement) => CONSULT_SAFETY_SERVICE_BOOKING_RULES[requirement].name,
      ),
    },
    capability,
  )
}

function requireSafetyOfferings(
  offerings: readonly RecommendationOffering[],
  session: AnalysisScope,
  requirements: readonly ConsultSafetyServiceRequirement[],
  capability: ProLocationCapability,
): Map<ConsultSafetyServiceRequirement, RecommendationOffering> {
  const resolved = new Map<
    ConsultSafetyServiceRequirement,
    RecommendationOffering
  >()
  for (const requirement of requirements) {
    const offering = safetyOffering(
      offerings,
      recommendationLocationType(session, capability),
      requirement,
    )
    if (!offering) {
      throw new ConsultWriteError(
        'ANALYSIS_PREREQUISITES_REQUIRED',
        'A required safety service is unavailable.',
      )
    }
    resolved.set(requirement, offering)
  }
  return resolved
}

function recommendationReference(
  session: AnalysisScope,
  offering: RecommendationOffering | undefined,
) {
  return offering
    ? {
        type: 'SERVICE' as const,
        serviceId: offering.serviceId,
        serviceCategoryId: offering.service.categoryId,
      }
    : {
        type: 'SERVICE_CATEGORY' as const,
        serviceId: null,
        serviceCategoryId: session.serviceCategoryId,
      }
}

function resolveRecommendations(
  session: AnalysisScope,
  menu: ConsultProMenu,
  safetyMenu: readonly RecommendationOffering[],
  recommendations: ConsultAnalysisProviderOutput['recommendations'],
  routing: ReturnType<typeof determineConsultSafetyRouting>,
) {
  const offerings = menu.offerings
  if (routing.blocksChemicalRecommendations) {
    const safetyOfferings = requireSafetyOfferings(
      safetyMenu,
      session,
      routing.requirements,
      menu.capability,
    )
    const directions = routing.requirements.map((requirement) => {
      const offering = safetyOfferings.get(requirement)
      if (!offering) {
        throw new ConsultWriteError(
          'ANALYSIS_PREREQUISITES_REQUIRED',
          'A required safety service is unavailable.',
        )
      }
      return requirement === 'PATCH_TEST'
        ? {
            serviceIntent: requirement,
            serviceName: null,
            title: 'Patch Test',
            rationale:
              'Because a reaction, allergy or sensitivity was reported, test for sensitivity and review the result with the professional before any product or chemical service.',
            achievability:
              'The professional must review the reaction history and test result before choosing a service.',
            discussWithProfessional: true as const,
            reference: recommendationReference(session, offering),
          }
        : {
            serviceIntent: requirement,
            serviceName: null,
            title: 'Strand Test',
            rationale:
              'A small section should be tested first so the professional can see how the hair responds before recommending a chemical plan.',
            achievability:
              'The professional will use the strand result to recommend what is safely achievable.',
            discussWithProfessional: true as const,
            reference: recommendationReference(session, offering),
          }
    })
    const consultation = offerings.find((offering) =>
      CONSULTATION_OFFERING_PATTERN.test(offering.service.name),
    )
    return [
      ...directions,
      {
        serviceIntent: 'CONSULTATION' as const,
        serviceName: null,
        title: 'Professional review',
        rationale:
          'Review the goal, full history, and any test result with the professional before selecting a service.',
        achievability:
          'The professional will decide the next service after the required review.',
        discussWithProfessional: true as const,
        reference: recommendationReference(session, consultation),
      },
    ]
  }

  return recommendations.map((recommendation) => {
    const match =
      recommendation.serviceIntent === 'SERVICE' && recommendation.serviceName
        ? offeringByName(offerings, recommendation.serviceName)
        : offerings.find((offering) =>
            CONSULTATION_OFFERING_PATTERN.test(offering.service.name),
          )
    return { ...recommendation, reference: recommendationReference(session, match) }
  })
}


async function stateInTransaction(
  tx: Prisma.TransactionClient,
  session: AnalysisScope,
): Promise<ConsultAnalysisStateDTO> {
  const revision = await tx.consultRevision.findFirst({
    where: { consultSessionId: session.id, kind: ConsultRevisionKind.ANALYSIS },
    select: {
      id: true,
      revision: true,
      payload: true,
      schemaVersion: true,
      createdAt: true,
    },
    orderBy: { revision: 'desc' },
  })
  // P4b: the run travels with the state, so the client's poll is ONE request
  // that answers both "is it done?" and "what is it doing?".
  const run = await latestConsultAnalysisRun(tx, session.id)
  return {
    consultId: session.id,
    status: session.status,
    schemaVersion: CONSULT_ANALYSIS_SCHEMA_VERSION,
    promptVersion: CONSULT_ANALYSIS_PROMPT_VERSION,
    result: revision ? mapStoredConsultAnalysisRevision(revision) : null,
    run: run ? mapConsultAnalysisRun(run) : null,
  }
}

/**
 * PostgreSQL `40001 could not serialize access due to concurrent update`.
 *
 * 🔴 Measured, not theorised (2026-09-04, test DB): P4b introduced a writer
 * the read below never had to coexist with. `loadConsultAnalysisState` runs at
 * REPEATABLE READ and takes `FOR SHARE`; the worker's finalize transaction
 * updates the same ConsultSession row. When a client's 5-second poll lands
 * inside that window, the `FOR SHARE` finds a row updated after the poll's
 * snapshot and Postgres refuses to serialize it. Prisma wraps a failed raw
 * query as P2010 and puts the real SQLSTATE in `meta.code`, so this looks like
 * a generic "raw query failed" until you read the meta — and it reached the
 * client as a bare 500 in the middle of a perfectly healthy analysis.
 *
 * Retrying is the documented answer for 40001, and it is the right one here:
 * the conflict means the row moved, and the whole point of the poll is to see
 * where it moved to.
 */
function isSerializationFailure(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false
  const meta = error.meta
  return (
    typeof meta === 'object' &&
    meta !== null &&
    'code' in meta &&
    (meta as { code?: unknown }).code === '40001'
  )
}

/**
 * The client's poll. Retried on a serialization conflict with the background
 * worker — see `isSerializationFailure`.
 *
 * Three attempts, no backoff: the conflict window is a single short finalize
 * transaction, so the retry either wins immediately or the row has settled by
 * the next one. A poll that still cannot read after three attempts is a real
 * problem and should surface rather than spin.
 */
export async function loadConsultAnalysisState(args: {
  consultSessionId: string
  clientId: string
  actorUserId: string
  now?: Date
}): Promise<ConsultAnalysisStateDTO> {
  const now = args.now ?? new Date()
  const read = () =>
    prisma.$transaction(
      async (tx) => {
        await lockSession(tx, args.consultSessionId, 'SHARE')
        const session = await requireScope(tx, { ...args, now })
        await requireCurrentConsultAgreementAcceptances(tx, session.id)
        if (
          session.status !== ConsultSessionStatus.ANALYSIS_PENDING &&
          session.status !== ConsultSessionStatus.ANALYZING &&
          session.status !== ConsultSessionStatus.COMPLETED
        ) {
          throw new ConsultWriteError('INVALID_STATE', 'Analysis is unavailable.')
        }
        return stateInTransaction(tx, session)
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    )

  let lastError: unknown
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await read()
    } catch (error: unknown) {
      if (!isSerializationFailure(error)) throw error
      lastError = error
    }
  }
  throw lastError
}

/**
 * P4b: the analysis lifecycle, in three parts that never overlap.
 *
 *   1. `startConsultAnalysis`      — ONE short transaction. Validates every
 *      prerequisite, claims the session (ANALYSIS_PENDING → ANALYZING), writes
 *      the run row, commits, returns. No provider call, no image read.
 *   2. `executeConsultAnalysisRun` — the worker. Reads what it needs with NO
 *      lock, makes the three paid calls with NO transaction open, then:
 *   3. the finalize transaction    — re-locks, re-checks that the client has
 *      not changed her inputs, writes both artefacts, completes the run.
 *
 * 🔴 The rule the split exists for: **the consult row lock is never held while
 * a model is thinking.** Before P4b all of this was one interactive
 * transaction whose budget said 115 seconds wrapped around up to 245 seconds
 * of provider time (50s inspiration + 45s profile + 150s direction) — a
 * `SELECT ... FOR UPDATE` on the session held for the whole analysis, under a
 * budget that could expire mid-call and roll back work the client had already
 * been billed for. Both halves of that are gone.
 */

/** Everything the pipeline reads about a consult, gathered once. */
type ConsultAnalysisRunContext = {
  session: AnalysisScope
  intake: Awaited<ReturnType<typeof currentCompletedIntake>>
  inspiration: Awaited<ReturnType<typeof requireCompletedConsultInspiration>>
  captures: AnalysisCapture[]
  menu: ConsultProMenu
  service: ConsultAnalysisServiceContext
  requestHash: string
}

/**
 * Who the run acts as.
 *
 * The worker is not a caller and has no session of its own; authorization
 * happened once, in the claim transaction, against the signed-in client. So it
 * reads the consult's OWN client back and acts as her — which makes
 * `requireScope`'s ownership comparison below a tautology, on purpose. What
 * that call still buys is everything else it checks: anchor eligibility, an
 * active category, an active tenant. Those can change between the claim and
 * the finalize, and must still refuse.
 */
async function consultRunIdentity(
  db: Prisma.TransactionClient,
  consultSessionId: string,
): Promise<{ clientId: string; actorUserId: string }> {
  const row = await db.consultSession.findUnique({
    where: { id: consultSessionId },
    select: { clientId: true, client: { select: { userId: true } } },
  })
  if (!row?.client.userId) {
    throw new ConsultWriteError('NOT_FOUND', 'Consult session not found.')
  }
  return { clientId: row.clientId, actorUserId: row.client.userId }
}

/**
 * The prerequisite read, shared by the claim transaction, the worker's
 * unlocked read, and the finalize transaction.
 *
 * `db` is the transaction client for the first and third, and the plain client
 * for the second. Identical reads either way — which is exactly what makes the
 * hash the claim recorded comparable with the hash the finalize recomputes.
 */
/**
 * Scope and consent, on their own — and BEFORE the request body is read.
 *
 * That ordering is a deliberate property with a test behind it: a caller who
 * does not own this consult, or who hits it while the feature is dark, must be
 * refused without their JSON ever being parsed. Splitting this out of the
 * context load is what keeps the body read after the gate.
 */
async function requireConsultAnalysisScope(
  db: Prisma.TransactionClient,
  args: {
    consultSessionId: string
    clientId: string
    actorUserId: string
    now: Date
  },
): Promise<AnalysisScope> {
  const session = await requireScope(db, args)
  await requireCurrentConsultAgreementAcceptances(db, session.id)
  return session
}

async function loadConsultAnalysisRunContext(
  db: Prisma.TransactionClient,
  args: {
    session: AnalysisScope
    schemaVersion: number
    promptVersion: string
    now: Date
  },
): Promise<ConsultAnalysisRunContext> {
  const { session } = args
  const intake = await currentCompletedIntake(db, session)
  const inspiration = await requireCompletedConsultInspiration(db, {
    consultSessionId: session.id,
    clientId: session.clientId,
    professionalId: session.professionalId,
    now: args.now,
  })
  const captures = await currentCaptures(db, session, args.now)
  const menu = await loadRecommendationOfferings(db, session)
  const service = await loadServiceContext(db, session, menu.offerings)
  return {
    session,
    intake,
    inspiration,
    captures,
    menu,
    service,
    requestHash: requestHash({
      schemaVersion: args.schemaVersion,
      promptVersion: args.promptVersion,
      intakeRevisionId: intake.revision.id,
      inspirationRevisionId: inspiration.revisionId,
      captures,
    }),
  }
}

/**
 * The safety preflight: a consult whose intake demands a service this pro does
 * not offer is refused BEFORE the client is told her plan is being built, and
 * again at finalize against the condition the model actually observed.
 */
async function requireConsultSafetyOfferings(
  db: Prisma.TransactionClient,
  args: {
    session: AnalysisScope
    intake: ConsultAnalysisRunContext['intake']
    visibleCondition: Parameters<
      typeof determineConsultSafetyRouting
    >[0]['visibleCondition']
  },
): Promise<RecommendationOffering[]> {
  const routing = determineConsultSafetyRouting({
    intakePackId: args.intake.payload.packId,
    intake: args.intake.payload.answers,
    visibleCondition: args.visibleCondition,
  })
  if (routing.requirements.length === 0) return []

  const capability = await loadProLocationCapability(args.session.professionalId, db)
  const offerings = await loadSafetyOfferings(
    db,
    args.session,
    routing.requirements,
    capability,
  )
  requireSafetyOfferings(offerings, args.session, routing.requirements, capability)
  return offerings
}

export type ConsultAnalysisStartResult = {
  state: ConsultAnalysisStateDTO
  /** The run to poll. Null only when a finished artefact was replayed. */
  run: ConsultAnalysisRunDTO | null
  replayed: boolean
}

/**
 * Start — or retry — the analysis. Returns as soon as the claim commits.
 *
 * Four outcomes, all of them fast and none of them paid:
 *   * an artefact already exists under this idempotency key → replay it;
 *   * a run is already live → hand it back so the client keeps polling. A
 *     double-tap, a re-mounted screen and a resumed app all land here rather
 *     than starting a second, duplicately-billed analysis;
 *   * the session is ANALYSIS_PENDING → claim it and create the first run;
 *   * the session is already ANALYZING with no live run → this is the RETRY.
 *     No lifecycle transition happens at all, so the one-claim-per-session
 *     audit index is never touched. See lib/consult/analysisRun.ts.
 */
export async function startConsultAnalysis(args: {
  consultSessionId: string
  clientId: string
  actor: ClientActor
  now?: Date
  loadInput: () => Promise<AnalysisInput>
}): Promise<ConsultAnalysisStartResult> {
  const startedAt = args.now ?? new Date()

  return prisma.$transaction(
    async (tx) => {
      await lockSession(tx, args.consultSessionId, 'UPDATE')
      // Ownership and consent first; only then is the caller's body parsed.
      const session = await requireConsultAnalysisScope(tx, {
        consultSessionId: args.consultSessionId,
        clientId: args.clientId,
        actorUserId: args.actor.id,
        now: startedAt,
      })
      const input = validInput(await args.loadInput())

      // 🔴 The replay checks come BEFORE the prerequisite load, and the order
      // is load-bearing. A completed analysis has already purged its raw
      // captures, so `loadConsultAnalysisRunContext` would refuse it with
      // ANALYSIS_PREREQUISITES_REQUIRED — turning a replay of a finished
      // consult into a spurious "your photos changed", and masking the
      // IDEMPOTENCY_CONFLICT a mismatched key is supposed to raise.
      const existing = await tx.consultRevision.findFirst({
        where: { consultSessionId: session.id, kind: ConsultRevisionKind.ANALYSIS },
        select: {
          id: true,
          revision: true,
          payload: true,
          schemaVersion: true,
          createdAt: true,
          idempotencyKey: true,
          requestHash: true,
        },
      })
      if (existing) {
        if (existing.idempotencyKey !== input.idempotencyKey) {
          throw new ConsultWriteError('IDEMPOTENCY_CONFLICT', 'Analysis retry conflict.')
        }
        const priorRun = await latestConsultAnalysisRun(tx, session.id)
        const run = priorRun ? mapConsultAnalysisRun(priorRun) : null
        return {
          state: {
            consultId: session.id,
            status: session.status,
            schemaVersion: CONSULT_ANALYSIS_SCHEMA_VERSION,
            promptVersion: CONSULT_ANALYSIS_PROMPT_VERSION,
            result: mapStoredConsultAnalysisRevision(existing),
            run,
          },
          run,
          replayed: true,
        }
      }

      const liveRun = await tx.consultAnalysisRun.findFirst({
        where: {
          consultSessionId: session.id,
          status: {
            in: [ConsultAnalysisRunStatus.QUEUED, ConsultAnalysisRunStatus.RUNNING],
          },
        },
        select: CONSULT_ANALYSIS_RUN_SELECT,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      })
      if (liveRun) {
        if (liveRun.idempotencyKey !== input.idempotencyKey) {
          throw new ConsultWriteError('IDEMPOTENCY_CONFLICT', 'Analysis retry conflict.')
        }
        return {
          state: await stateInTransaction(tx, session),
          run: mapConsultAnalysisRun(liveRun),
          replayed: true,
        }
      }

      // Only now — with no artefact and no live run — is a claim on the table,
      // and only a claim needs the full prerequisite read.
      const context = await loadConsultAnalysisRunContext(tx, {
        session,
        schemaVersion: input.schemaVersion,
        promptVersion: input.promptVersion,
        now: startedAt,
      })

      await requireConsultSafetyOfferings(tx, {
        session,
        intake: context.intake,
        visibleCondition: 'UNKNOWN',
      })

      if (session.status === ConsultSessionStatus.ANALYSIS_PENDING) {
        await transitionLockedConsultSession(tx, {
          consultSessionId: session.id,
          actor: args.actor,
          fromStatus: ConsultSessionStatus.ANALYSIS_PENDING,
          toStatus: ConsultSessionStatus.ANALYZING,
        })
      } else if (session.status !== ConsultSessionStatus.ANALYZING) {
        throw new ConsultWriteError('INVALID_STATE', 'Analysis cannot be claimed.')
      }

      const run = await createLockedConsultAnalysisRun(tx, {
        consultSessionId: session.id,
        idempotencyKey: input.idempotencyKey,
        schemaVersion: input.schemaVersion,
        promptVersion: input.promptVersion,
        requestHash: context.requestHash,
        photoCount: context.captures.length,
        now: startedAt,
      })

      return {
        state: {
          consultId: session.id,
          status: ConsultSessionStatus.ANALYZING,
          schemaVersion: CONSULT_ANALYSIS_SCHEMA_VERSION,
          promptVersion: CONSULT_ANALYSIS_PROMPT_VERSION,
          result: null,
          run: mapConsultAnalysisRun(run),
        },
        run: mapConsultAnalysisRun(run),
        replayed: false,
      }
    },
    // Short by construction: reads, one status update, one insert. Nothing in
    // here waits on a service outside the database — which is precisely the
    // property the old 115-second budget did not have.
    { maxWait: 10_000, timeout: 30_000 },
  )
}

export type ConsultAnalysisRunOutcome =
  | { result: 'COMPLETED'; runId: string; state: ConsultAnalysisStateDTO }
  | { result: 'RETRY_SCHEDULED'; runId: string; failureCode: string; runAt: Date }
  | { result: 'FAILED_FINAL'; runId: string; failureCode: string }
  | { result: 'NOT_CLAIMABLE'; runId: string }

/**
 * Failure codes the same inputs would produce again. Retrying one of these
 * spends three more paid calls to reach the same refusal, so the run is marked
 * FAILED immediately and the client is told immediately.
 */
const TERMINAL_ANALYSIS_FAILURE_CODES: ReadonlySet<string> = new Set([
  'NOT_FOUND',
  'INVALID_STATE',
  'INVALID_REQUEST',
  'IDEMPOTENCY_CONFLICT',
  'BOOKING_INELIGIBLE',
  'CONSENT_REQUIRED',
  'ANALYSIS_SCHEMA_VERSION_MISMATCH',
  'ANALYSIS_PROMPT_VERSION_MISMATCH',
  'ANALYSIS_PREREQUISITES_REQUIRED',
  'SAFETY_OFFERING_REQUIRED',
  'CAPTURE_OBJECT_INVALID',
  // The model named nothing at all in this photograph. Reading the SAME
  // photograph twice more buys the same answer and two more paid calls; what
  // the client needs is the "we couldn't read this one" state and a chance to
  // bring a different picture. (Its sibling INSPIRATION_ANALYSIS_UNAVAILABLE
  // is the provider being down, and IS retryable.)
  'INSPIRATION_ANALYSIS_UNREADABLE',
])

/**
 * Every failure this run can have, as ONE client-facing code.
 *
 * 🔴 P2028 is named here for a reason. It is Prisma's "interactive transaction
 * expired or is no longer valid", and before P4b it was the single most likely
 * way a real analysis died — the transaction budget was less than half the
 * provider budget it wrapped. It reached the client as a bare
 * `500 Internal server error`, which says nothing and offers no retry. The
 * split makes it far less likely; naming it makes it legible if it ever
 * happens again.
 */
/**
 * A P2028 anywhere on the analysis path, as a typed consult error.
 *
 * The worker classifies its own failures below; this is the START request's
 * copy of the same rule. Its transaction does no network work and has a 30s
 * budget, so P2028 there means the database itself is pathologically slow —
 * rare, but a bare 500 would tell the client nothing and offer no retry, which
 * is exactly the hole P4b set out to close.
 */
export function asConsultAnalysisTransactionError(
  error: unknown,
): ConsultWriteError | null {
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2028'
  ) {
    return new ConsultWriteError(
      'ANALYSIS_TRANSACTION_EXPIRED',
      'Analysis timed out.',
    )
  }
  return null
}

function consultAnalysisFailureCode(error: unknown): {
  code: string
  terminal: boolean
  message: string
} {
  if (error instanceof ConsultWriteError) {
    return {
      code: error.code,
      terminal: TERMINAL_ANALYSIS_FAILURE_CODES.has(error.code),
      message: error.message,
    }
  }
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2028'
  ) {
    return {
      code: 'ANALYSIS_TRANSACTION_EXPIRED',
      terminal: false,
      message: `Prisma P2028: ${error.message}`,
    }
  }
  // Includes the provider's own timeout, which the SDK surfaces as an
  // APIConnectionTimeoutError and the engines convert to
  // ConsultAnalysisProviderError('unavailable') → ANALYSIS_UNAVAILABLE above.
  // Anything reaching here is unclassified, so it is retryable and loud.
  return {
    code: 'ANALYSIS_UNAVAILABLE',
    terminal: false,
    message: error instanceof Error ? error.message : 'Unknown analysis failure.',
  }
}

/**
 * Execute one claimed run, end to end.
 *
 * Expected failures never throw: each becomes a run-row outcome, because the
 * caller is a cron batch where a thrown error is a failure with no
 * client-visible trace. The run is always marked before anything propagates.
 */
export async function executeConsultAnalysisRun(args: {
  runId: string
  now?: Date
  storage?: ConsultCaptureStorage
  provider?: ConsultAnalysisProvider
  inspirationStorage?: ConsultInspirationStorage
  inspirationProvider?: ConsultInspirationVisionProvider
}): Promise<ConsultAnalysisRunOutcome> {
  const now = args.now ?? new Date()
  const claimed = await claimConsultAnalysisRun({ runId: args.runId, now })
  if (!claimed) return { result: 'NOT_CLAIMABLE', runId: args.runId }

  const storage = args.storage ?? consultCaptureStorage
  const provider = args.provider ?? runConsultAnalysisProvider
  const meter: ConsultProviderMeterSink = {
    consultSessionId: claimed.consultSessionId,
    analysisRunId: claimed.id,
  }
  let consumedCaptureIds: string[] = []

  try {
    const identity = await consultRunIdentity(prisma, claimed.consultSessionId)
    const actor: ClientActor = {
      type: ConsultActorType.CLIENT,
      id: identity.actorUserId,
    }

    // ── Phase A: read, with NO lock and NO transaction ───────────────────
    const context = await loadConsultAnalysisRunContext(prisma, {
      session: await requireConsultAnalysisScope(prisma, {
        consultSessionId: claimed.consultSessionId,
        clientId: identity.clientId,
        actorUserId: identity.actorUserId,
        now,
      }),
      schemaVersion: claimed.schemaVersion,
      promptVersion: claimed.promptVersion,
      now,
    })
    if (context.session.status !== ConsultSessionStatus.ANALYZING) {
      throw new ConsultWriteError('INVALID_STATE', 'Analysis was cancelled.')
    }
    if (context.requestHash !== claimed.requestHash) {
      throw new ConsultWriteError(
        'ANALYSIS_PREREQUISITES_REQUIRED',
        'Analysis inputs changed.',
      )
    }
    const profile = resolveConsultServiceProfile(context.session.serviceCategory)
    const pack = profile.intakePack
    const images = await readVerifiedImages(context.captures, storage)

    // ── Phase B: the paid calls, between transactions ────────────────────
    await advanceConsultAnalysisRunStage({
      runId: claimed.id,
      stage: ConsultAnalysisRunStage.UNDERSTANDING_REFERENCE,
    })
    const inspirationPlan =
      context.inspiration.source === 'NONE'
        ? null
        : await prepareConsultInspirationRead(prisma, {
            session: context.session,
            inspirationRevisionId: context.inspiration.revisionId,
            now,
          })
    const inspirationRead =
      inspirationPlan && !inspirationPlan.artefact
        ? await performConsultInspirationRead({
            plan: inspirationPlan,
            consultSessionId: context.session.id,
            clientId: identity.clientId,
            storage: args.inspirationStorage,
            provider: args.inspirationProvider,
            meter,
          })
        : null
    const inspirationAnalysis =
      inspirationPlan?.artefact?.analysis ?? inspirationRead?.analysis ?? null

    await advanceConsultAnalysisRunStage({
      runId: claimed.id,
      stage: ConsultAnalysisRunStage.BUILDING_PLAN,
    })
    let providerResult
    try {
      providerResult = validateConsultAnalysisProviderResult(
        await provider({
          service: context.service,
          intake: context.intake.payload.answers,
          intakeItems: consultIntakeItems(pack, context.intake.payload.answers),
          capturePack: {
            id: profile.capturePack.id,
            shotKeys: profile.capturePack.shots.map((shot) => shot.key),
          },
          captures: images,
          inspiration: {
            source: context.inspiration.source,
            analysis: inspirationAnalysis,
            answers: consultInspirationPromptAnswers(context.inspiration.answers),
          },
          // The codes this intake can support, narrowing the provider's enum
          // BEFORE the call rather than refusing the answer after it.
          // `visibleCondition` is UNKNOWN here on purpose: the only code that
          // depends on it is VISIBLE_COMPROMISE, which the model raises off
          // the photos and which the schema always allows.
          safetyCodes: [
            ...deriveConsultSafetyFlagPolicy({
              intakePackId: context.intake.payload.packId,
              intake: context.intake.payload.answers,
              visibleCondition: 'UNKNOWN',
            }).supported,
          ],
          meter,
        }),
        {
          menuServiceNames: context.service.menuServiceNames,
          suppliedShotKeys: images.map((image) => image.shotKey),
        },
      )
      providerResult = {
        ...providerResult,
        analysis: applyConsultSafetyFlagPolicy(
          providerResult.analysis,
          deriveConsultSafetyFlagPolicy({
            intakePackId: context.intake.payload.packId,
            intake: context.intake.payload.answers,
            visibleCondition: providerResult.analysis.core.visibleCondition.value,
          }),
        ),
      }
    } catch (error) {
      if (error instanceof ConsultAnalysisProviderError) {
        throw new ConsultWriteError('ANALYSIS_UNAVAILABLE', 'Analysis is unavailable.')
      }
      throw error
    }

    // ── Phase C: finalize, under the lock again ──────────────────────────
    await advanceConsultAnalysisRunStage({
      runId: claimed.id,
      stage: ConsultAnalysisRunStage.FINALIZING,
    })
    const state = await prisma.$transaction(
      async (tx) => {
        await lockSession(tx, claimed.consultSessionId, 'UPDATE')
        const finalizedAt = new Date(Math.max(now.getTime(), Date.now()))
        const finalContext = await loadConsultAnalysisRunContext(tx, {
          session: await requireConsultAnalysisScope(tx, {
            consultSessionId: claimed.consultSessionId,
            clientId: identity.clientId,
            actorUserId: identity.actorUserId,
            now: finalizedAt,
          }),
          schemaVersion: claimed.schemaVersion,
          promptVersion: claimed.promptVersion,
          now: finalizedAt,
        })
        if (finalContext.session.status !== ConsultSessionStatus.ANALYZING) {
          throw new ConsultWriteError('INVALID_STATE', 'Analysis was cancelled.')
        }
        // The client may have re-answered her intake or swapped a photo while
        // the model was thinking. The artefact must describe the inputs it was
        // actually built from, or nothing at all.
        if (finalContext.requestHash !== claimed.requestHash) {
          throw new ConsultWriteError(
            'ANALYSIS_PREREQUISITES_REQUIRED',
            'Analysis inputs changed.',
          )
        }

        if (inspirationPlan && inspirationRead) {
          await persistLockedConsultInspirationAnalysis(tx, {
            consultSessionId: finalContext.session.id,
            inspirationRevisionId: finalContext.inspiration.revisionId,
            plan: inspirationPlan,
            read: inspirationRead,
            analysisIdempotencyKey: claimed.idempotencyKey,
            actor,
          })
        }

        const routing = determineConsultSafetyRouting({
          intakePackId: finalContext.intake.payload.packId,
          intake: finalContext.intake.payload.answers,
          visibleCondition: providerResult.analysis.core.visibleCondition.value,
        })
        const recommendations = resolveRecommendations(
          finalContext.session,
          finalContext.menu,
          await requireConsultSafetyOfferings(tx, {
            session: finalContext.session,
            intake: finalContext.intake,
            visibleCondition: providerResult.analysis.core.visibleCondition.value,
          }),
          providerResult.analysis.recommendations,
          routing,
        )
        const payload = { ...providerResult.analysis, recommendations }
        const captureIds = finalContext.captures.map((capture) => capture.id)
        const revision = await finalizeLockedHairColorAnalysis(tx, {
          consultSessionId: finalContext.session.id,
          payload,
          model: providerResult.model,
          idempotencyKey: claimed.idempotencyKey,
          requestHash: claimed.requestHash,
          captureIds,
          finalizedAt,
          actor,
        })
        await completeLockedConsultAnalysisRun(tx, {
          runId: claimed.id,
          analysisRevisionId: revision.id,
          finishedAt: finalizedAt,
        })
        consumedCaptureIds = captureIds
        return {
          consultId: finalContext.session.id,
          status: ConsultSessionStatus.COMPLETED,
          schemaVersion: CONSULT_ANALYSIS_SCHEMA_VERSION,
          promptVersion: CONSULT_ANALYSIS_PROMPT_VERSION,
          result: {
            revisionId: revision.id,
            revision: revision.revision,
            analysis: payload,
            createdAt: revision.createdAt.toISOString(),
          },
          run: null,
        } satisfies ConsultAnalysisStateDTO
      },
      // No provider call inside. This is writes plus the prerequisite re-read.
      { maxWait: 15_000, timeout: 60_000 },
    )

    await settleConsultAnalysisCaptures({
      consultSessionId: claimed.consultSessionId,
      captureIds: consumedCaptureIds,
      storage,
    })
    // Outside every transaction, so waiting is safe here — and a worker that
    // returns before its meter rows land loses them if the function is torn
    // down straight after.
    await flushConsultProviderMeter()

    const run = await prisma.consultAnalysisRun.findUnique({
      where: { id: claimed.id },
      select: CONSULT_ANALYSIS_RUN_SELECT,
    })
    return {
      result: 'COMPLETED',
      runId: claimed.id,
      state: { ...state, run: run ? mapConsultAnalysisRun(run) : null },
    }
  } catch (error: unknown) {
    const failure = consultAnalysisFailureCode(error)
    const marked = await failConsultAnalysisRunAttempt({
      runId: claimed.id,
      failureCode: failure.code,
      message: failure.message,
      terminal: failure.terminal,
      now: new Date(),
    })
    await flushConsultProviderMeter()
    console.error('consult analysis run failed', {
      runId: claimed.id,
      consultSessionId: claimed.consultSessionId,
      attemptCount: claimed.attemptCount,
      outcome: marked.outcome,
      failureCode: failure.code,
      error: safeError(error),
    })
    if (marked.outcome === 'RETRY_SCHEDULED' && marked.runAt) {
      return {
        result: 'RETRY_SCHEDULED',
        runId: claimed.id,
        failureCode: failure.code,
        runAt: marked.runAt,
      }
    }
    return { result: 'FAILED_FINAL', runId: claimed.id, failureCode: failure.code }
  }
}

/**
 * The post-commit tail: the optional chart copy, then the raw purge.
 *
 * Order is load-bearing (decision 2026-08-26): the copy runs strictly BEFORE
 * the purge and is best-effort, because losing an optional chart copy is an
 * accepted failure mode and retaining unpurged raw client photos is not.
 */
async function settleConsultAnalysisCaptures(args: {
  consultSessionId: string
  captureIds: readonly string[]
  storage: ConsultCaptureStorage
}): Promise<void> {
  if (args.captureIds.length === 0) return

  try {
    await copyConsultCapturesToChart({
      consultSessionId: args.consultSessionId,
      captureIds: args.captureIds,
      storage: args.storage,
    })
  } catch {
    // The raw purge below still runs.
  }

  await Promise.all(
    args.captureIds.map(async (captureId) => {
      try {
        await purgeConsultCaptureRawObject(captureId, new Date(), args.storage)
      } catch {
        // The committed purge markers make cleanup retry. Analysis durability
        // is independent from post-commit storage availability.
      }
    }),
  )
}
