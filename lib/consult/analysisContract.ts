import 'server-only'

import { createHash } from 'node:crypto'
import {
  ConsultActorType,
  ConsultCaptureStatus,
  ConsultRevisionKind,
  ConsultSessionStatus,
  Prisma,
  ServiceLocationType,
  UploadSessionStatus,
  UploadSurface,
} from '@prisma/client'

import type {
  ConsultAnalysisStateDTO,
  ConsultCaptureShotKeyDTO,
} from '@/lib/dto/consult'
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
  CONSULT_CAPTURE_QUALITY_PROMPT_VERSION,
  CONSULT_CAPTURE_QUALITY_SCHEMA_VERSION,
  CONSULT_CAPTURE_MEDIA_TYPES,
  type ConsultCaptureMediaType,
} from './captureVision'
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
      capture.qualityPromptVersion !== CONSULT_CAPTURE_QUALITY_PROMPT_VERSION ||
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
): Promise<Array<{ shotKey: ConsultCaptureShotKeyDTO; image: ConsultCaptureImage }>> {
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
      images.push({ shotKey: capture.shotKey, image })
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
  return {
    consultId: session.id,
    status: session.status,
    schemaVersion: CONSULT_ANALYSIS_SCHEMA_VERSION,
    promptVersion: CONSULT_ANALYSIS_PROMPT_VERSION,
    result: revision ? mapStoredConsultAnalysisRevision(revision) : null,
  }
}

export async function loadConsultAnalysisState(args: {
  consultSessionId: string
  clientId: string
  actorUserId: string
  now?: Date
}): Promise<ConsultAnalysisStateDTO> {
  const now = args.now ?? new Date()
  return prisma.$transaction(
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
}

export async function runConsultAnalysis(args: {
  consultSessionId: string
  clientId: string
  actor: ClientActor
  now?: Date
  loadInput: () => Promise<AnalysisInput>
  storage?: ConsultCaptureStorage
  provider?: ConsultAnalysisProvider
}): Promise<{ state: ConsultAnalysisStateDTO; replayed: boolean }> {
  const startedAt = args.now ?? new Date()
  const storage = args.storage ?? consultCaptureStorage
  const provider = args.provider ?? runConsultAnalysisProvider
  let consumedCaptureIds: string[] = []
  const result = await prisma
    .$transaction(
      async (tx) => {
        await lockSession(tx, args.consultSessionId, 'UPDATE')
        let session = await requireScope(tx, {
          consultSessionId: args.consultSessionId,
          clientId: args.clientId,
          actorUserId: args.actor.id,
          now: startedAt,
        })
        await requireCurrentConsultAgreementAcceptances(tx, session.id)
        const input = validInput(await args.loadInput())
        const intake = await currentCompletedIntake(tx, session)
        const inspiration = await requireCompletedConsultInspiration(tx, {
          consultSessionId: session.id,
          clientId: session.clientId,
          professionalId: session.professionalId,
          now: startedAt,
        })
        const intakeRouting = determineConsultSafetyRouting({
          intakePackId: intake.payload.packId,
          intake: intake.payload.answers,
          visibleCondition: 'UNKNOWN',
        })
        if (intakeRouting.requirements.length > 0) {
          const capability = await loadProLocationCapability(
            session.professionalId,
            tx,
          )
          requireSafetyOfferings(
            await loadSafetyOfferings(
              tx,
              session,
              intakeRouting.requirements,
              capability,
            ),
            session,
            intakeRouting.requirements,
            capability,
          )
        }
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
          return {
            state: {
              consultId: session.id,
              status: session.status,
              schemaVersion: CONSULT_ANALYSIS_SCHEMA_VERSION,
              promptVersion: CONSULT_ANALYSIS_PROMPT_VERSION,
              result: mapStoredConsultAnalysisRevision(existing),
            },
            replayed: true,
          }
        }
        const captures = await currentCaptures(tx, session, startedAt)
        const hash = requestHash({
          schemaVersion: input.schemaVersion,
          promptVersion: input.promptVersion,
          intakeRevisionId: intake.revision.id,
          inspirationRevisionId: inspiration.revisionId,
          captures,
        })
        if (session.status !== ConsultSessionStatus.ANALYSIS_PENDING) {
          throw new ConsultWriteError('INVALID_STATE', 'Analysis cannot be claimed.')
        }

        await transitionLockedConsultSession(tx, {
          consultSessionId: session.id,
          actor: args.actor,
          fromStatus: ConsultSessionStatus.ANALYSIS_PENDING,
          toStatus: ConsultSessionStatus.ANALYZING,
        })
        const images = await readVerifiedImages(captures, storage)
        const menu = await loadRecommendationOfferings(tx, session)
        const service = await loadServiceContext(tx, session, menu.offerings)
        const profile = resolveConsultServiceProfile(session.serviceCategory)
        const pack = profile.intakePack
        let providerResult
        try {
          providerResult = validateConsultAnalysisProviderResult(
            await provider({
              service,
              intake: intake.payload.answers,
              intakeItems: consultIntakeItems(pack, intake.payload.answers),
              capturePack: {
                id: profile.capturePack.id,
                shotKeys: profile.capturePack.shots.map((shot) => shot.key),
              },
              captures: images,
            }),
            {
              menuServiceNames: service.menuServiceNames,
              suppliedShotKeys: images.map((image) => image.shotKey),
            },
          )
          providerResult = {
            ...providerResult,
            analysis: applyConsultSafetyFlagPolicy(
              providerResult.analysis,
              deriveConsultSafetyFlagPolicy({
                intakePackId: intake.payload.packId,
                intake: intake.payload.answers,
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

        const finalizedAt = new Date(Math.max(startedAt.getTime(), Date.now()))
        session = await requireScope(tx, {
          consultSessionId: session.id,
          clientId: args.clientId,
          actorUserId: args.actor.id,
          now: finalizedAt,
        })
        await requireCurrentConsultAgreementAcceptances(tx, session.id)
        if (session.status !== ConsultSessionStatus.ANALYZING) {
          throw new ConsultWriteError('INVALID_STATE', 'Analysis was cancelled.')
        }
        const finalIntake = await currentCompletedIntake(tx, session)
        const finalInspiration = await requireCompletedConsultInspiration(tx, {
          consultSessionId: session.id,
          clientId: session.clientId,
          professionalId: session.professionalId,
          now: finalizedAt,
        })
        const finalCaptures = await currentCaptures(tx, session, finalizedAt)
        if (
          finalIntake.revision.id !== intake.revision.id ||
          requestHash({
            schemaVersion: input.schemaVersion,
            promptVersion: input.promptVersion,
            intakeRevisionId: finalIntake.revision.id,
            inspirationRevisionId: finalInspiration.revisionId,
            captures: finalCaptures,
          }) !== hash
        ) {
          throw new ConsultWriteError(
            'ANALYSIS_PREREQUISITES_REQUIRED',
            'Analysis inputs changed.',
          )
        }

        const routing = determineConsultSafetyRouting({
          intakePackId: intake.payload.packId,
          intake: intake.payload.answers,
          visibleCondition: providerResult.analysis.core.visibleCondition.value,
        })
        const recommendations = resolveRecommendations(
          session,
          menu,
          routing.requirements.length > 0
            ? await loadSafetyOfferings(
                tx,
                session,
                routing.requirements,
                menu.capability,
              )
            : [],
          providerResult.analysis.recommendations,
          routing,
        )
        const payload = {
          ...providerResult.analysis,
          recommendations,
        }
        const captureIds = finalCaptures.map((capture) => capture.id)
        const revision = await finalizeLockedHairColorAnalysis(tx, {
          consultSessionId: session.id,
          payload,
          model: providerResult.model,
          idempotencyKey: input.idempotencyKey,
          requestHash: hash,
          captureIds,
          finalizedAt,
          actor: args.actor,
        })
        consumedCaptureIds = captureIds
        return {
          state: {
            consultId: session.id,
            status: ConsultSessionStatus.COMPLETED,
            schemaVersion: CONSULT_ANALYSIS_SCHEMA_VERSION,
            promptVersion: CONSULT_ANALYSIS_PROMPT_VERSION,
            result: {
              revisionId: revision.id,
              revision: revision.revision,
              analysis: payload,
              createdAt: revision.createdAt.toISOString(),
            },
          },
          replayed: false,
        }
      },
      // v2 sends seven images and a larger structured output; the provider
      // timeout is 90s, so the claim transaction must outlive it.
      { maxWait: 55_000, timeout: 115_000 },
    )

  if (consumedCaptureIds.length > 0) {
    try {
      // Chart copy (decision 2026-08-26) runs strictly BEFORE the raw purge and
      // is best-effort: a failed copy never blocks the purge or the analysis.
      await copyConsultCapturesToChart({
        consultSessionId: args.consultSessionId,
        captureIds: consumedCaptureIds,
        storage,
      })
    } catch {
      // Raw purge below still runs; losing the optional chart copy is the
      // accepted failure mode, retaining unpurged raw photos is not.
    }
  }

  await Promise.all(
    consumedCaptureIds.map(async (captureId) => {
      try {
        await purgeConsultCaptureRawObject(captureId, new Date(), storage)
      } catch {
        // The committed purge markers make cleanup retry. Analysis durability
        // is independent from post-commit storage availability.
      }
    }),
  )
  return result
}
