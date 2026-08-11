import 'server-only'

import { createHash } from 'node:crypto'
import {
  ConsultActorType,
  ConsultCaptureStatus,
  ConsultRevisionKind,
  ConsultSessionStatus,
  Prisma,
  UploadSessionStatus,
  UploadSurface,
} from '@prisma/client'

import type { ConsultAnalysisStateDTO } from '@/lib/dto/consult'
import { prisma } from '@/lib/prisma'

import { requireCurrentConsultAgreementAcceptances } from './agreementContract'
import {
  CONSULT_ANALYSIS_PROMPT_VERSION,
  CONSULT_ANALYSIS_SCHEMA_VERSION,
  CONSULT_ANALYSIS_SAFETY_CODES,
  ConsultAnalysisProviderError,
  runHairColorAnalysis,
  validateHairColorAnalysisProviderResult,
  type ConsultAnalysisSafetyCode,
  type ConsultAnalysisServiceIntent,
  type HairColorAnalysisProvider,
  type HairColorAnalysisProviderOutput,
} from './analysisEngine'
import {
  HAIR_COLOR_CAPTURE_PACK_VERSION,
  HAIR_COLOR_CAPTURE_SCHEMA_VERSION,
  HAIR_COLOR_CAPTURE_SHOT_KEYS,
  isHairColorCaptureShotKey,
  type HairColorCaptureShotKey,
} from './capturePack'
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
import {
  AI_CONSULT_ELIGIBILITY_BOOKING_SELECT,
  evaluateAiConsultBookingEligibility,
} from './eligibility'
import { ConsultWriteError } from './errors'
import { mapStoredHairColorAnalysisRevision } from './analysisRevision'
import {
  HAIR_COLOR_INTAKE_PACK_VERSION,
  HAIR_COLOR_INTAKE_SCHEMA_VERSION,
  normalizeHairColorIntakePayload,
} from './intakePack'
import { purgeConsultCaptureRawObject } from './capturePurge'
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
  clientId: true,
  professionalId: true,
  serviceCategoryId: true,
  status: true,
  revisionSequence: true,
  client: { select: { userId: true } },
  serviceCategory: { select: { id: true, slug: true, isActive: true } },
  professional: {
    select: { homeTenantId: true, homeTenant: { select: { isActive: true } } },
  },
  booking: {
    select: {
      clientId: true,
      proTenantId: true,
      ...AI_CONSULT_ELIGIBILITY_BOOKING_SELECT,
    },
  },
} satisfies Prisma.ConsultSessionSelect

type AnalysisScope = Prisma.ConsultSessionGetPayload<{
  select: typeof ANALYSIS_SCOPE_SELECT
}>

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
  captures: readonly AnalysisCapture[]
}): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        schemaVersion: args.schemaVersion,
        promptVersion: args.promptVersion,
        intakeRevisionId: args.intakeRevisionId,
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
    session.booking.clientId !== session.clientId ||
    session.booking.professionalId !== session.professionalId ||
    session.booking.service.categoryId !== session.serviceCategoryId ||
    session.booking.proTenantId !== session.professional.homeTenantId ||
    session.serviceCategory.slug !== 'hair-color'
  ) {
    throw new ConsultWriteError('NOT_FOUND', 'Consult session not found.')
  }
  const eligibility = evaluateAiConsultBookingEligibility(session.booking, args.now)
  if (!eligibility.eligible || !session.serviceCategory.isActive || !session.professional.homeTenant.isActive) {
    throw new ConsultWriteError(
      eligibility.eligible || !eligibility.hidden ? 'BOOKING_INELIGIBLE' : 'NOT_FOUND',
      'Consult is unavailable for this booking.',
    )
  }
  return session
}

async function currentCompletedIntake(
  tx: Prisma.TransactionClient,
  consultSessionId: string,
) {
  const revision = await tx.consultRevision.findFirst({
    where: { consultSessionId, kind: ConsultRevisionKind.INTAKE },
    select: { id: true, revision: true, payload: true },
    orderBy: { revision: 'desc' },
  })
  const payload = revision ? normalizeHairColorIntakePayload(revision.payload) : null
  if (
    !revision ||
    !payload ||
    !payload.complete ||
    payload.packVersion !== HAIR_COLOR_INTAKE_PACK_VERSION ||
    payload.schemaVersion !== HAIR_COLOR_INTAKE_SCHEMA_VERSION
  ) {
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
  const byShot = new Map<HairColorCaptureShotKey, AnalysisCapture>()
  for (const capture of captures) {
    if (!isHairColorCaptureShotKey(capture.shotKey) || byShot.has(capture.shotKey)) {
      throw new ConsultWriteError(
        'ANALYSIS_PREREQUISITES_REQUIRED',
        'The current capture pack is incomplete.',
      )
    }
    const upload = capture.uploadSession
    if (
      capture.shotPackVersion !== HAIR_COLOR_CAPTURE_PACK_VERSION ||
      capture.schemaVersion !== HAIR_COLOR_CAPTURE_SCHEMA_VERSION ||
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
  if (byShot.size !== HAIR_COLOR_CAPTURE_SHOT_KEYS.length) {
    throw new ConsultWriteError(
      'ANALYSIS_PREREQUISITES_REQUIRED',
      'Four accepted, unexpired captures are required.',
    )
  }
  return HAIR_COLOR_CAPTURE_SHOT_KEYS.map((shotKey) => {
    const capture = byShot.get(shotKey)
    if (!capture) {
      throw new ConsultWriteError('ANALYSIS_PREREQUISITES_REQUIRED', 'Capture missing.')
    }
    return capture
  })
}

async function readVerifiedImages(
  captures: readonly AnalysisCapture[],
  storage: ConsultCaptureStorage,
): Promise<Array<{ shotKey: HairColorCaptureShotKey; image: ConsultCaptureImage }>> {
  try {
    await storage.assertReady()
    const images = []
    for (const capture of captures) {
      if (!isHairColorCaptureShotKey(capture.shotKey) || !capture.storagePath) {
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

const INTENT_PATTERNS: Readonly<Record<ConsultAnalysisServiceIntent, RegExp>> = {
  COLOR_CONSULTATION: /\b(color|colour).*\bconsult|\bconsult.*\b(color|colour)/i,
  ROOT_TOUCH_UP: /\broot\b|touch[ -]?up/i,
  ALL_OVER_COLOR: /all[ -]?over|single[ -]?process|full[ -]?color/i,
  HIGHLIGHTS: /highlight|foil/i,
  BALAYAGE: /balayage|hand[ -]?paint/i,
  COLOR_CORRECTION: /corrective|correction/i,
  TONER_GLOSS: /toner|gloss|glaze/i,
  VIVID_COLOR: /vivid|fantasy|fashion color/i,
  OTHER_HAIR_COLOR: /color|colour|blond|brunette|copper/i,
}

async function resolveRecommendations(
  tx: Prisma.TransactionClient,
  session: AnalysisScope,
  recommendations: HairColorAnalysisProviderOutput['recommendations'],
) {
  const offerings = await tx.professionalServiceOffering.findMany({
    where: {
      professionalId: session.professionalId,
      isActive: true,
      service: {
        isActive: true,
        categoryId: session.serviceCategoryId,
        category: { isActive: true, slug: 'hair-color' },
      },
    },
    select: {
      serviceId: true,
      service: { select: { name: true, description: true, categoryId: true } },
    },
    orderBy: { serviceId: 'asc' },
  })
  return recommendations.map((recommendation) => {
    const pattern = INTENT_PATTERNS[recommendation.serviceIntent]
    const match = offerings.find((offering) =>
      pattern.test(`${offering.service.name} ${offering.service.description ?? ''}`),
    )
    return {
      ...recommendation,
      reference: match
        ? {
            type: 'SERVICE' as const,
            serviceId: match.serviceId,
            serviceCategoryId: match.service.categoryId,
          }
        : {
            type: 'SERVICE_CATEGORY' as const,
            serviceId: null,
            serviceCategoryId: session.serviceCategoryId,
          },
    }
  })
}

const SAFETY_COPY: Readonly<Record<ConsultAnalysisSafetyCode, string>> = {
  PRIOR_REACTION:
    'The intake reports a prior color-service reaction. Discuss this history and appropriate precautions with your professional before any chemical service.',
  REACTION_HISTORY_UNKNOWN:
    'Reaction history is uncertain. Discuss prior sensitivities and appropriate precautions with your professional before any chemical service.',
  RECENT_BOX_DYE:
    'Recent box dye can affect color predictability and achievability. Discuss the exact product and timing with your professional.',
  RECENT_LIGHTENING:
    'Recent lightening can affect the next safe, achievable color direction. Discuss timing and strand-condition checks with your professional.',
  CHEMICAL_HISTORY_UNKNOWN:
    'Some chemical history is uncertain. Review prior color and lightening details with your professional before choosing a service.',
  ALLERGY_HISTORY_UNKNOWN:
    'Allergy information was not collected in this intake. Discuss known allergies, sensitivities, and appropriate precautions with your professional.',
  VISIBLE_COMPROMISE:
    'The photos may show cosmetic signs of compromised hair. Have your professional assess condition before setting a chemical-service plan.',
}

function addRequiredSafetyFlags(
  analysis: HairColorAnalysisProviderOutput,
  intake: Readonly<Record<string, string>>,
): HairColorAnalysisProviderOutput {
  if (
    !/\b(unknown|not collected|not provided)\b/i.test(
      analysis.hairColorLens.constraints,
    ) ||
    !/\b(unknown|not collected|not provided)\b/i.test(
      analysis.hairColorLens.maintenance,
    )
  ) {
    throw new ConsultAnalysisProviderError('bad_output')
  }
  const supported = new Set<ConsultAnalysisSafetyCode>(['ALLERGY_HISTORY_UNKNOWN'])
  if (intake.prior_reaction === 'yes') supported.add('PRIOR_REACTION')
  if (intake.prior_reaction === 'not-sure') supported.add('REACTION_HISTORY_UNKNOWN')
  if (intake.box_dye_history === 'within-6-months') supported.add('RECENT_BOX_DYE')
  if (intake.box_dye_history === 'not-sure') supported.add('CHEMICAL_HISTORY_UNKNOWN')
  if (
    intake.prior_lightening === 'within-3-months' ||
    intake.prior_lightening === '3-6-months'
  ) {
    supported.add('RECENT_LIGHTENING')
  }
  if (intake.prior_lightening === 'not-sure') supported.add('CHEMICAL_HISTORY_UNKNOWN')
  if (analysis.core.visibleCondition.value === 'POSSIBLE_COMPROMISE') {
    supported.add('VISIBLE_COMPROMISE')
  }
  if (analysis.safetyFlags.some((flag) => !supported.has(flag.code))) {
    throw new ConsultAnalysisProviderError('bad_output')
  }
  const required = new Set<ConsultAnalysisSafetyCode>(['ALLERGY_HISTORY_UNKNOWN'])
  if (intake.prior_reaction === 'yes') required.add('PRIOR_REACTION')
  if (intake.prior_reaction === 'not-sure') required.add('REACTION_HISTORY_UNKNOWN')
  if (intake.box_dye_history === 'within-6-months') required.add('RECENT_BOX_DYE')
  if (intake.box_dye_history === 'not-sure') required.add('CHEMICAL_HISTORY_UNKNOWN')
  if (
    intake.prior_lightening === 'within-3-months' ||
    intake.prior_lightening === '3-6-months'
  ) {
    required.add('RECENT_LIGHTENING')
  }
  if (intake.prior_lightening === 'not-sure') required.add('CHEMICAL_HISTORY_UNKNOWN')
  if (analysis.core.visibleCondition.value === 'POSSIBLE_COMPROMISE') {
    required.add('VISIBLE_COMPROMISE')
  }
  const flags = [...analysis.safetyFlags]
  for (const code of required) {
    if (!flags.some((flag) => flag.code === code)) {
      flags.push({ code, summary: SAFETY_COPY[code], discussWithProfessional: true })
    }
  }
  if (flags.length > CONSULT_ANALYSIS_SAFETY_CODES.length) {
    throw new ConsultAnalysisProviderError('bad_output')
  }
  return { ...analysis, safetyFlags: flags }
}

async function stateInTransaction(
  tx: Prisma.TransactionClient,
  session: AnalysisScope,
): Promise<ConsultAnalysisStateDTO> {
  const revision = await tx.consultRevision.findFirst({
    where: { consultSessionId: session.id, kind: ConsultRevisionKind.ANALYSIS },
    select: { id: true, revision: true, payload: true, createdAt: true },
    orderBy: { revision: 'desc' },
  })
  return {
    consultId: session.id,
    status: session.status,
    schemaVersion: CONSULT_ANALYSIS_SCHEMA_VERSION,
    promptVersion: CONSULT_ANALYSIS_PROMPT_VERSION,
    result: revision ? mapStoredHairColorAnalysisRevision(revision) : null,
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
  provider?: HairColorAnalysisProvider
}): Promise<{ state: ConsultAnalysisStateDTO; replayed: boolean }> {
  const startedAt = args.now ?? new Date()
  const storage = args.storage ?? consultCaptureStorage
  const provider = args.provider ?? runHairColorAnalysis
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
        const intake = await currentCompletedIntake(tx, session.id)
        const existing = await tx.consultRevision.findFirst({
          where: { consultSessionId: session.id, kind: ConsultRevisionKind.ANALYSIS },
          select: {
            id: true,
            revision: true,
            payload: true,
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
              result: mapStoredHairColorAnalysisRevision(existing),
            },
            replayed: true,
          }
        }
        const captures = await currentCaptures(tx, session, startedAt)
        const hash = requestHash({
          schemaVersion: input.schemaVersion,
          promptVersion: input.promptVersion,
          intakeRevisionId: intake.revision.id,
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
        let providerResult
        try {
          providerResult = validateHairColorAnalysisProviderResult(
            await provider({ intake: intake.payload.answers, captures: images }),
          )
          providerResult = {
            ...providerResult,
            analysis: addRequiredSafetyFlags(
              providerResult.analysis,
              intake.payload.answers,
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
        const finalIntake = await currentCompletedIntake(tx, session.id)
        const finalCaptures = await currentCaptures(tx, session, finalizedAt)
        if (
          finalIntake.revision.id !== intake.revision.id ||
          requestHash({
            schemaVersion: input.schemaVersion,
            promptVersion: input.promptVersion,
            intakeRevisionId: finalIntake.revision.id,
            captures: finalCaptures,
          }) !== hash
        ) {
          throw new ConsultWriteError(
            'ANALYSIS_PREREQUISITES_REQUIRED',
            'Analysis inputs changed.',
          )
        }

        const recommendations = await resolveRecommendations(
          tx,
          session,
          providerResult.analysis.recommendations,
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
      { maxWait: 55_000, timeout: 55_000 },
    )

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
