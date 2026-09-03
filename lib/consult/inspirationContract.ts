import 'server-only'

import { createHash } from 'node:crypto'
import {
  ConsultActorType,
  ConsultAuditAction,
  ConsultCaptureStatus,
  ConsultInspirationSource,
  ConsultInspirationStatus,
  ConsultRevisionKind,
  ConsultSessionStatus,
  Prisma,
  Role,
} from '@prisma/client'

import type {
  ConsultInspirationAnswerDTO,
  ConsultInspirationCatalogGuidanceDTO,
  ConsultInspirationSourceDTO,
  ConsultInspirationStateDTO,
  ConsultInspirationUploadDTO,
} from '@/lib/dto/consult'
import { buildLookPolicyInput, loadLookAccess } from '@/lib/looks/access'
import { canViewLookPost } from '@/lib/looks/guards'
import { prisma } from '@/lib/prisma'

import { requireCurrentConsultAgreementAcceptances } from './agreementContract'
import { isAiConsultC6ExposureEnabledForPro } from './access'
import { CONSULT_ANCHOR_SELECT, evaluateConsultAnchor } from './anchor'
import { ConsultWriteError } from './errors'
import {
  buildExactClientDetails,
  buildPossibleProfessionalInterpretation,
  CONSULT_INSPIRATION_INTRODUCTION,
  CONSULT_INSPIRATION_QUESTIONS,
  CONSULT_INSPIRATION_REFERENCE_NOTE,
  CONSULT_INSPIRATION_REFLECTION_PROMPT,
  CONSULT_INSPIRATION_REQUIRED_DETAIL_COUNT,
  CONSULT_INSPIRATION_SCHEMA_VERSION,
  evaluateConsultInspirationProgress,
  mapStoredInspirationRevision,
  normalizeStoredInspirationPayload,
  toInspirationJsonPayload,
  validateConsultInspirationAnswer,
  type InspirationReviewPayload,
} from './inspirationPack'
import {
  CONSULT_INSPIRATION_BUCKET,
  CONSULT_INSPIRATION_MAX_BYTES,
  CONSULT_INSPIRATION_READ_TTL_SECONDS,
  CONSULT_INSPIRATION_UPLOAD_TTL_MS,
  ConsultInspirationStorageError,
  consultInspirationObjectPath,
  consultInspirationStorage,
  type ConsultInspirationStorage,
} from './inspirationStorage'
import { CONSULT_CAPTURE_MEDIA_TYPES, type ConsultCaptureMediaType } from './captureVision'
import { CONSULT_MAX_CAPTURE_SHOTS } from './capture/registry'
import {
  CONSULT_SERVICE_PROFILE_CATEGORY_SELECT,
  resolveConsultServiceProfile,
} from './serviceProfile'
import {
  appendLockedConsultInspirationRevision,
  transitionLockedConsultSession,
} from './writeBoundary'

type ClientActor = { type: typeof ConsultActorType.CLIENT; id: string }

const MUTABLE_STATUS = ConsultSessionStatus.MEDIA_READY
const READABLE_STATUSES = new Set<ConsultSessionStatus>([
  ConsultSessionStatus.MEDIA_READY,
  ConsultSessionStatus.ANALYSIS_PENDING,
  ConsultSessionStatus.ANALYZING,
  ConsultSessionStatus.COMPLETED,
])

const SCOPE_SELECT = {
  id: true,
  status: true,
  client: { select: { userId: true } },
  ...CONSULT_ANCHOR_SELECT,
  booking: {
    select: {
      totalDurationMinutes: true,
      ...CONSULT_ANCHOR_SELECT.booking.select,
    },
  },
} satisfies Prisma.ConsultSessionSelect

type InspirationScope = Prisma.ConsultSessionGetPayload<{
  select: typeof SCOPE_SELECT
}>

const ACTIVE_SOURCE_STATUSES = [
  ConsultInspirationStatus.UPLOAD_PENDING,
  ConsultInspirationStatus.ATTACHED,
] as const

function hash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

function key(value: string): string {
  const normalized = value.trim()
  if (!normalized || normalized.length > 128) {
    throw new ConsultWriteError('INVALID_REQUEST', 'Invalid idempotency key.')
  }
  return normalized
}

function checksum(value: string | null): string | null {
  if (value === null) return null
  const normalized = value.trim().toLowerCase()
  if (!/^[0-9a-f]{64}$/.test(normalized)) {
    throw new ConsultWriteError('INVALID_REQUEST', 'Invalid checksum.')
  }
  return normalized
}

function mediaType(value: unknown): ConsultCaptureMediaType {
  const found = CONSULT_CAPTURE_MEDIA_TYPES.find((candidate) => candidate === value)
  if (!found) throw new ConsultWriteError('INVALID_REQUEST', 'Unsupported content type.')
  return found
}

function requireSchemaVersion(value: number): void {
  if (value !== CONSULT_INSPIRATION_SCHEMA_VERSION) {
    throw new ConsultWriteError(
      'INSPIRATION_SCHEMA_VERSION_MISMATCH',
      'The inspiration schema version is stale.',
    )
  }
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
  if (rows.length === 0) throw new ConsultWriteError('NOT_FOUND', 'Not found.')
}

async function requireScope(
  tx: Prisma.TransactionClient,
  args: {
    consultSessionId: string
    clientId: string
    actorUserId: string
    now: Date
    mutation: boolean
  },
): Promise<InspirationScope> {
  const session = await tx.consultSession.findUnique({
    where: { id: args.consultSessionId },
    select: SCOPE_SELECT,
  })
  if (
    !session ||
    session.clientId !== args.clientId ||
    session.client.userId !== args.actorUserId
  ) {
    throw new ConsultWriteError('NOT_FOUND', 'Not found.')
  }
  const anchor = evaluateConsultAnchor(session, args.now)
  if (!anchor.eligible) {
    throw new ConsultWriteError(
      anchor.hidden ? 'NOT_FOUND' : 'BOOKING_INELIGIBLE',
      'Consult is unavailable for this booking.',
    )
  }
  if (
    (args.mutation && session.status !== MUTABLE_STATUS) ||
    (!args.mutation && !READABLE_STATUSES.has(session.status))
  ) {
    throw new ConsultWriteError('INVALID_STATE', 'Inspiration is unavailable.')
  }
  return session
}

/**
 * How long an uploaded inspiration photo may be USED for.
 *
 * A booking-anchored consult keys this to the appointment: the pro may look at
 * the reference until a day after the visit ends. A look-anchored consult has
 * no appointment yet (the booking proposal is B4), so it gets a fixed window
 * from the upload instead — long enough to finish the consult and read the
 * results, short enough that a private client upload is not parked
 * indefinitely on a consult that never becomes a visit.
 */
export const CONSULT_LOOK_ANCHOR_INSPIRATION_USE_TTL_MS = 30 * 24 * 60 * 60 * 1000

function useExpiresAt(session: InspirationScope, now: Date): Date {
  if (!session.booking) {
    return new Date(now.getTime() + CONSULT_LOOK_ANCHOR_INSPIRATION_USE_TTL_MS)
  }
  return new Date(
    session.booking.scheduledFor.getTime() +
      session.booking.totalDurationMinutes * 60_000 +
      24 * 60 * 60 * 1000,
  )
}

async function activeSource(tx: Prisma.TransactionClient, consultSessionId: string) {
  return tx.consultInspiration.findFirst({
    where: { consultSessionId, status: { in: [...ACTIVE_SOURCE_STATUSES] } },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  })
}

async function latestReview(
  tx: Prisma.TransactionClient,
  consultSessionId: string,
) {
  const revisions = await tx.consultRevision.findMany({
    where: { consultSessionId, kind: ConsultRevisionKind.INSPIRATION },
    select: { id: true, revision: true, payload: true, createdAt: true },
    orderBy: [{ revision: 'desc' }, { id: 'desc' }],
  })
  for (const revision of revisions) {
    const mapped = mapStoredInspirationRevision(revision)
    if (mapped) return mapped
  }
  return null
}

export async function requireCompletedConsultInspiration(
  tx: Prisma.TransactionClient,
  args: {
    consultSessionId: string
    clientId: string
    professionalId: string
    now: Date
  },
): Promise<{ revisionId: string }> {
  const review = await latestReview(tx, args.consultSessionId)
  if (!review?.complete) {
    throw new ConsultWriteError(
      'ANALYSIS_PREREQUISITES_REQUIRED',
      'Guided inspiration is incomplete.',
    )
  }
  const latestActiveAcceptance = await tx.consultAgreementAcceptance.findFirst({
    where: { consultSessionId: args.consultSessionId, revokedAt: null },
    select: { acceptedAt: true },
    orderBy: [{ acceptedAt: 'desc' }, { id: 'desc' }],
  })
  if (
    !latestActiveAcceptance ||
    new Date(review.createdAt).getTime() < latestActiveAcceptance.acceptedAt.getTime()
  ) {
    throw new ConsultWriteError(
      'ANALYSIS_PREREQUISITES_REQUIRED',
      'Guided inspiration must be completed after current consent.',
    )
  }
  if (review.source === 'NONE') return { revisionId: review.revisionId }
  const source = await tx.consultInspiration.findFirst({
    where: {
      id: review.inspirationId ?? '',
      consultSessionId: args.consultSessionId,
      status: ConsultInspirationStatus.ATTACHED,
    },
  })
  const available = source?.source === ConsultInspirationSource.EXTERNAL_UPLOAD
    ? Boolean(source.storagePath && !source.purgedAt && source.useExpiresAt && source.useExpiresAt > args.now)
    : Boolean(source?.sourceLookPostId && (await lookAvailableToBoth(tx, {
        lookPostId: source.sourceLookPostId,
        clientId: args.clientId,
        professionalId: args.professionalId,
      })).available)
  if (!available) {
    throw new ConsultWriteError(
      'ANALYSIS_PREREQUISITES_REQUIRED',
      'Guided inspiration source is unavailable.',
    )
  }
  return { revisionId: review.revisionId }
}

/** The single cross-step readiness boundary. Either capture or inspiration may
 * finish last; both call here while holding the ConsultSession row lock.
 * Auto-advance (the default) still requires the full accepted pack; the
 * client-initiated partial submission (Tori, 2026-08-27) passes
 * minimumAcceptedShots: 1 through proceedConsultCaptureToAnalysis. */
/** The slot count of the pack the session serves (lib/consult/capture/registry.ts). */
async function requiredAcceptedShotsForSession(
  tx: Prisma.TransactionClient,
  consultSessionId: string,
): Promise<number> {
  const session = await tx.consultSession.findUnique({
    where: { id: consultSessionId },
    select: {
      serviceCategory: { select: CONSULT_SERVICE_PROFILE_CATEGORY_SELECT },
    },
  })
  if (!session) return CONSULT_MAX_CAPTURE_SHOTS
  return resolveConsultServiceProfile(session.serviceCategory).capturePack.shots
    .length
}

export async function advanceLockedConsultToAnalysisIfReady(
  tx: Prisma.TransactionClient,
  args: {
    consultSessionId: string
    clientId: string
    professionalId: string
    actor: ClientActor
    now: Date
  },
  options?: { minimumAcceptedShots?: number },
): Promise<boolean> {
  try {
    await requireCompletedConsultInspiration(tx, args)
  } catch (error) {
    if (
      error instanceof ConsultWriteError &&
      error.code === 'ANALYSIS_PREREQUISITES_REQUIRED'
    ) {
      return false
    }
    throw error
  }
  const captures = await tx.consultCapture.findMany({
    where: {
      consultSessionId: args.consultSessionId,
      status: ConsultCaptureStatus.ACCEPTED,
      purgedAt: null,
      rawExpiresAt: { gt: args.now },
    },
    select: { shotKey: true },
  })
  const accepted = new Set(captures.map(({ shotKey }) => shotKey))
  // A full pack is THIS session's pack — the seven hair views, or the three of
  // the face and area packs. The default used to be the LARGEST pack (seven),
  // which is fail-safe for the hair pilot and wrong for every other family: a
  // three-shot consult whose inspiration finished last could never reach seven
  // and sat in MEDIA_READY forever. The capture and inspiration callers now
  // share this one resolution; only the explicit partial-submit door passes
  // its own (smaller) threshold.
  const minimumAcceptedShots =
    options?.minimumAcceptedShots ??
    (await requiredAcceptedShotsForSession(tx, args.consultSessionId))
  if (accepted.size < minimumAcceptedShots) {
    return false
  }
  await transitionLockedConsultSession(tx, {
    consultSessionId: args.consultSessionId,
    actor: args.actor,
    fromStatus: ConsultSessionStatus.MEDIA_READY,
    toStatus: ConsultSessionStatus.ANALYSIS_PENDING,
  })
  return true
}

async function lookAvailableToBoth(
  tx: Prisma.TransactionClient,
  args: {
    lookPostId: string
    clientId: string
    professionalId: string
  },
): Promise<{
  available: boolean
  source: 'PLATFORM_LOOK' | 'BOOKED_PRO_LOOK' | null
}> {
  const [clientAccess, professionalAccess] = await Promise.all([
    loadLookAccess(tx, {
      lookPostId: args.lookPostId,
      viewerClientId: args.clientId,
    }),
    loadLookAccess(tx, {
      lookPostId: args.lookPostId,
      viewerProfessionalId: args.professionalId,
    }),
  ])
  if (!clientAccess || !professionalAccess) return { available: false, source: null }
  const clientCanView = canViewLookPost(
    buildLookPolicyInput(clientAccess, Role.CLIENT),
  )
  const professionalCanView = canViewLookPost(
    buildLookPolicyInput(professionalAccess, Role.PRO),
  )
  if (!clientCanView || !professionalCanView) {
    return { available: false, source: null }
  }
  return {
    available: true,
    source:
      clientAccess.look.professionalId === args.professionalId &&
      clientAccess.look.clientAuthorId === null
        ? 'BOOKED_PRO_LOOK'
        : 'PLATFORM_LOOK',
  }
}

async function imageAvailable(
  tx: Prisma.TransactionClient,
  source: Awaited<ReturnType<typeof activeSource>>,
  session: InspirationScope,
  now: Date,
): Promise<boolean> {
  if (!source || source.status !== ConsultInspirationStatus.ATTACHED) return false
  if (source.source === ConsultInspirationSource.EXTERNAL_UPLOAD) {
    return Boolean(
      source.storageBucket === CONSULT_INSPIRATION_BUCKET &&
        source.storagePath &&
        !source.purgedAt &&
        source.useExpiresAt &&
        source.useExpiresAt.getTime() > now.getTime(),
    )
  }
  if (!source.sourceLookPostId) return false
  return (
    await lookAvailableToBoth(tx, {
      lookPostId: source.sourceLookPostId,
      clientId: session.clientId,
      professionalId: session.professionalId,
    })
  ).available
}

async function buildState(
  tx: Prisma.TransactionClient,
  session: InspirationScope,
  now: Date,
): Promise<ConsultInspirationStateDTO> {
  const [source, review] = await Promise.all([
    activeSource(tx, session.id),
    latestReview(tx, session.id),
  ])
  const sourceState = source
    ? {
        inspirationId: source.id,
        source: source.source,
        lookPostId: source.sourceLookPostId,
        imageReadEndpoint:
          source.source === ConsultInspirationSource.EXTERNAL_UPLOAD
            ? `/api/v1/client/consult/${encodeURIComponent(session.id)}/inspiration/media`
            : `/api/v1/looks/${encodeURIComponent(source.sourceLookPostId ?? '')}`,
        imageAvailable: await imageAvailable(tx, source, session, now),
        useExpiresAt: source.useExpiresAt?.toISOString() ?? null,
      }
    : null

  if (!review && !sourceState) {
    return {
      consultId: session.id,
      status: session.status,
      schemaVersion: CONSULT_INSPIRATION_SCHEMA_VERSION,
      introduction: CONSULT_INSPIRATION_INTRODUCTION,
      referenceNote: CONSULT_INSPIRATION_REFERENCE_NOTE,
      reflectionPrompt: CONSULT_INSPIRATION_REFLECTION_PROMPT,
      source: null,
      progress: {
        currentQuestion: null,
        answeredQuestionCount: 0,
        specificDetailCount: 0,
        requiredSpecificDetailCount: CONSULT_INSPIRATION_REQUIRED_DETAIL_COUNT,
        canComplete: false,
        blocker: 'SOURCE_DECISION_REQUIRED',
      },
      latestReview: null,
    }
  }

  const activeReview =
    review &&
    (review.source === 'NONE' || review.inspirationId === sourceState?.inspirationId)
      ? review
      : null
  const progress = activeReview
    ? evaluateConsultInspirationProgress(activeReview.answers)
    : evaluateConsultInspirationProgress([])
  return {
    consultId: session.id,
    status: session.status,
    schemaVersion: CONSULT_INSPIRATION_SCHEMA_VERSION,
    introduction: CONSULT_INSPIRATION_INTRODUCTION,
    referenceNote: CONSULT_INSPIRATION_REFERENCE_NOTE,
    reflectionPrompt: CONSULT_INSPIRATION_REFLECTION_PROMPT,
    source: sourceState,
    progress:
      activeReview?.source === 'NONE'
        ? {
            currentQuestion: null,
            answeredQuestionCount: 0,
            specificDetailCount: 0,
            requiredSpecificDetailCount: CONSULT_INSPIRATION_REQUIRED_DETAIL_COUNT,
            canComplete: true,
            blocker: null,
          }
        : {
            ...progress,
            requiredSpecificDetailCount: CONSULT_INSPIRATION_REQUIRED_DETAIL_COUNT,
          },
    latestReview: activeReview,
  }
}

async function appendReview(
  tx: Prisma.TransactionClient,
  args: {
    session: InspirationScope
    actor: ClientActor
    idempotencyKey: string
    requestHash: string
    payload: InspirationReviewPayload
  },
) {
  return appendLockedConsultInspirationRevision(tx, {
    consultSessionId: args.session.id,
    payload: toInspirationJsonPayload(args.payload),
    schemaVersion: CONSULT_INSPIRATION_SCHEMA_VERSION,
    idempotencyKey: args.idempotencyKey,
    requestHash: args.requestHash,
    actor: args.actor,
  })
}

async function replaceActiveSource(
  tx: Prisma.TransactionClient,
  consultSessionId: string,
  now: Date,
  actor: ClientActor,
) {
  const current = await activeSource(tx, consultSessionId)
  if (!current) return null
  await tx.consultInspiration.update({
    where: { id: current.id },
    data: {
      status: ConsultInspirationStatus.REPLACED,
      ...(current.source === ConsultInspirationSource.EXTERNAL_UPLOAD && !current.purgedAt
        ? { purgeEligibleAt: now, purgeRequestedAt: now }
        : {}),
    },
  })
  await tx.consultAuditEvent.create({
    data: {
      consultSessionId,
      action: ConsultAuditAction.INSPIRATION_REMOVED,
      actorType: actor.type,
      actorId: actor.id,
      inspirationId: current.id,
    },
  })
  return current
}

export async function loadConsultInspirationState(args: {
  consultSessionId: string
  clientId: string
  actorUserId: string
  now?: Date
}): Promise<ConsultInspirationStateDTO> {
  const now = args.now ?? new Date()
  return prisma.$transaction(
    async (tx) => {
      await lockSession(tx, args.consultSessionId, 'SHARE')
      const session = await requireScope(tx, { ...args, now, mutation: false })
      await requireCurrentConsultAgreementAcceptances(tx, session.id)
      return buildState(tx, session, now)
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  )
}

export async function chooseConsultInspirationLook(args: {
  consultSessionId: string
  clientId: string
  actor: ClientActor
  now?: Date
  input: {
    idempotencyKey: string
    schemaVersion: number
    source: 'PLATFORM_LOOK' | 'BOOKED_PRO_LOOK'
    lookPostId: string
  }
}): Promise<{ state: ConsultInspirationStateDTO; replayed: boolean }> {
  const now = args.now ?? new Date()
  return prisma.$transaction(async (tx) => {
    await lockSession(tx, args.consultSessionId, 'UPDATE')
    const session = await requireScope(tx, {
      consultSessionId: args.consultSessionId,
      clientId: args.clientId,
      actorUserId: args.actor.id,
      now,
      mutation: true,
    })
    await requireCurrentConsultAgreementAcceptances(tx, session.id)
    requireSchemaVersion(args.input.schemaVersion)
    const idempotencyKey = key(args.input.idempotencyKey)
    const lookPostId = args.input.lookPostId.trim()
    if (!lookPostId) throw new ConsultWriteError('INVALID_REQUEST', 'Invalid Look.')
    const requestHash = hash({
      source: args.input.source,
      lookPostId,
      schemaVersion: args.input.schemaVersion,
    })
    const existing = await tx.consultInspiration.findFirst({
      where: { consultSessionId: session.id, sourceIdempotencyKey: idempotencyKey },
    })
    if (existing) {
      if (existing.sourceRequestHash !== requestHash) {
        throw new ConsultWriteError('IDEMPOTENCY_CONFLICT', 'Idempotency conflict.')
      }
      return { state: await buildState(tx, session, now), replayed: true }
    }
    const access = await lookAvailableToBoth(tx, {
      lookPostId,
      clientId: session.clientId,
      professionalId: session.professionalId,
    })
    if (!access.available || access.source !== args.input.source) {
      throw new ConsultWriteError('INSPIRATION_LOOK_UNAVAILABLE', 'Look unavailable.')
    }
    await replaceActiveSource(tx, session.id, now, args.actor)
    const created = await tx.consultInspiration.create({
      data: {
        consultSessionId: session.id,
        source: args.input.source,
        status: ConsultInspirationStatus.ATTACHED,
        sourceLookPostId: lookPostId,
        sourceIdempotencyKey: idempotencyKey,
        sourceRequestHash: requestHash,
      },
    })
    await tx.consultAuditEvent.create({
      data: {
        consultSessionId: session.id,
        action: ConsultAuditAction.INSPIRATION_SOURCE_SELECTED,
        actorType: args.actor.type,
        actorId: args.actor.id,
        inspirationId: created.id,
      },
    })
    return { state: await buildState(tx, session, now), replayed: false }
  })
}

export async function skipConsultInspiration(args: {
  consultSessionId: string
  clientId: string
  actor: ClientActor
  now?: Date
  input: { idempotencyKey: string; schemaVersion: number }
}): Promise<{ state: ConsultInspirationStateDTO; replayed: boolean }> {
  const now = args.now ?? new Date()
  const result = await prisma.$transaction(async (tx) => {
    await lockSession(tx, args.consultSessionId, 'UPDATE')
    const session = await requireScope(tx, {
      consultSessionId: args.consultSessionId,
      clientId: args.clientId,
      actorUserId: args.actor.id,
      now,
      mutation: true,
    })
    await requireCurrentConsultAgreementAcceptances(tx, session.id)
    requireSchemaVersion(args.input.schemaVersion)
    const idempotencyKey = key(args.input.idempotencyKey)
    const requestHash = hash({ source: 'NONE', schemaVersion: args.input.schemaVersion })
    const existing = await tx.consultRevision.findFirst({
      where: { consultSessionId: session.id, idempotencyKey },
    })
    if (existing) {
      if (
        existing.kind !== ConsultRevisionKind.INSPIRATION ||
        existing.requestHash !== requestHash
      ) {
        throw new ConsultWriteError('IDEMPOTENCY_CONFLICT', 'Idempotency conflict.')
      }
      return {
        state: await buildState(tx, session, now),
        replayed: true,
        previous: null,
      }
    }
    const previous = await replaceActiveSource(tx, session.id, now, args.actor)
    const appended = await appendReview(tx, {
      session,
      actor: args.actor,
      idempotencyKey,
      requestHash,
      payload: {
        contractId: 'hair-color-guided-inspiration',
        contractVersion: 1,
        schemaVersion: 1,
        source: 'NONE',
        inspirationId: null,
        complete: true,
        answers: [],
        exactClientDetails: [],
        possibleProfessionalInterpretation: [],
        catalogGuidance: [],
      },
    })
    const advanced = await advanceLockedConsultToAnalysisIfReady(tx, {
      consultSessionId: session.id,
      clientId: session.clientId,
      professionalId: session.professionalId,
      actor: args.actor,
      now,
    })
    return {
      state: await buildState(
        tx,
        advanced
          ? { ...session, status: ConsultSessionStatus.ANALYSIS_PENDING }
          : session,
        now,
      ),
      replayed: appended.replayed,
      previous,
    }
  })
  if (result.previous?.source === ConsultInspirationSource.EXTERNAL_UPLOAD) {
    await purgeConsultInspirationObject(result.previous.id, now).catch(() => undefined)
  }
  return { state: result.state, replayed: result.replayed }
}

export async function issueConsultInspirationUpload(args: {
  consultSessionId: string
  clientId: string
  actor: ClientActor
  now?: Date
  input: {
    idempotencyKey: string
    schemaVersion: number
    contentType: unknown
    sizeBytes: number
    checksumSha256: string | null
  }
  storage?: ConsultInspirationStorage
}): Promise<{ upload: ConsultInspirationUploadDTO; replayed: boolean }> {
  const now = args.now ?? new Date()
  const storage = args.storage ?? consultInspirationStorage
  return prisma.$transaction(async (tx) => {
    await lockSession(tx, args.consultSessionId, 'UPDATE')
    const session = await requireScope(tx, {
      consultSessionId: args.consultSessionId,
      clientId: args.clientId,
      actorUserId: args.actor.id,
      now,
      mutation: true,
    })
    await requireCurrentConsultAgreementAcceptances(tx, session.id)
    requireSchemaVersion(args.input.schemaVersion)
    const idempotencyKey = key(args.input.idempotencyKey)
    const contentType = mediaType(args.input.contentType)
    if (
      !Number.isInteger(args.input.sizeBytes) ||
      args.input.sizeBytes < 1 ||
      args.input.sizeBytes > CONSULT_INSPIRATION_MAX_BYTES
    ) {
      throw new ConsultWriteError('INVALID_REQUEST', 'Invalid inspiration size.')
    }
    const checksumSha256 = checksum(args.input.checksumSha256)
    const requestHash = hash({
      schemaVersion: args.input.schemaVersion,
      contentType,
      sizeBytes: args.input.sizeBytes,
      checksumSha256,
    })
    let inspiration = await tx.consultInspiration.findFirst({
      where: { consultSessionId: session.id, sourceIdempotencyKey: idempotencyKey },
    })
    const replayed = Boolean(inspiration)
    if (inspiration) {
      if (
        inspiration.sourceRequestHash !== requestHash ||
        inspiration.source !== ConsultInspirationSource.EXTERNAL_UPLOAD ||
        inspiration.status !== ConsultInspirationStatus.UPLOAD_PENDING ||
        !inspiration.storagePath ||
        !inspiration.uploadExpiresAt ||
        inspiration.uploadExpiresAt.getTime() <= now.getTime() ||
        inspiration.purgedAt
      ) {
        throw new ConsultWriteError('IDEMPOTENCY_CONFLICT', 'Upload unavailable.')
      }
    } else {
      await replaceActiveSource(tx, session.id, now, args.actor)
      inspiration = await tx.consultInspiration.create({
        data: {
          consultSessionId: session.id,
          source: ConsultInspirationSource.EXTERNAL_UPLOAD,
          status: ConsultInspirationStatus.UPLOAD_PENDING,
          storageBucket: CONSULT_INSPIRATION_BUCKET,
          storagePath: consultInspirationObjectPath(contentType),
          contentType,
          sizeBytes: args.input.sizeBytes,
          checksumSha256,
          sourceIdempotencyKey: idempotencyKey,
          sourceRequestHash: requestHash,
          uploadExpiresAt: new Date(now.getTime() + CONSULT_INSPIRATION_UPLOAD_TTL_MS),
          useExpiresAt: useExpiresAt(session, now),
        },
      })
      await tx.consultAuditEvent.create({
        data: {
          consultSessionId: session.id,
          action: ConsultAuditAction.INSPIRATION_UPLOAD_ISSUED,
          actorType: args.actor.type,
          actorId: args.actor.id,
          inspirationId: inspiration.id,
        },
      })
    }
    if (!inspiration.storagePath || !inspiration.uploadExpiresAt || !inspiration.useExpiresAt) {
      throw new ConsultWriteError('INSPIRATION_UPLOAD_MISMATCH', 'Upload unavailable.')
    }
    try {
      await storage.assertReady()
      const signed = await storage.createSignedUpload(inspiration.storagePath)
      return {
        upload: {
          inspirationId: inspiration.id,
          schemaVersion: CONSULT_INSPIRATION_SCHEMA_VERSION,
          contentType,
          maxBytes: inspiration.sizeBytes ?? args.input.sizeBytes,
          expiresAt: inspiration.uploadExpiresAt.toISOString(),
          useExpiresAt: inspiration.useExpiresAt.toISOString(),
          token: signed.token,
          signedUrl: signed.signedUrl,
        },
        replayed,
      }
    } catch (error) {
      if (error instanceof ConsultInspirationStorageError) {
        throw new ConsultWriteError(
          'INSPIRATION_STORAGE_UNAVAILABLE',
          'Private inspiration storage is unavailable.',
        )
      }
      throw error
    }
  })
}

export async function attachConsultInspirationUpload(args: {
  consultSessionId: string
  clientId: string
  actor: ClientActor
  now?: Date
  input: { idempotencyKey: string; inspirationId: string; schemaVersion: number }
  storage?: ConsultInspirationStorage
}): Promise<{ state: ConsultInspirationStateDTO; replayed: boolean }> {
  const now = args.now ?? new Date()
  const storage = args.storage ?? consultInspirationStorage
  return prisma.$transaction(async (tx) => {
    await lockSession(tx, args.consultSessionId, 'UPDATE')
    const session = await requireScope(tx, {
      consultSessionId: args.consultSessionId,
      clientId: args.clientId,
      actorUserId: args.actor.id,
      now,
      mutation: true,
    })
    await requireCurrentConsultAgreementAcceptances(tx, session.id)
    requireSchemaVersion(args.input.schemaVersion)
    const idempotencyKey = key(args.input.idempotencyKey)
    const inspirationId = args.input.inspirationId.trim()
    const requestHash = hash({ inspirationId, schemaVersion: args.input.schemaVersion })
    const inspiration = await tx.consultInspiration.findFirst({
      where: { id: inspirationId, consultSessionId: session.id },
    })
    if (!inspiration) throw new ConsultWriteError('NOT_FOUND', 'Not found.')
    if (inspiration.status === ConsultInspirationStatus.ATTACHED) {
      if (
        inspiration.attachIdempotencyKey !== idempotencyKey ||
        inspiration.attachRequestHash !== requestHash
      ) {
        throw new ConsultWriteError('IDEMPOTENCY_CONFLICT', 'Attach conflict.')
      }
      return { state: await buildState(tx, session, now), replayed: true }
    }
    if (
      inspiration.source !== ConsultInspirationSource.EXTERNAL_UPLOAD ||
      inspiration.status !== ConsultInspirationStatus.UPLOAD_PENDING ||
      !inspiration.uploadExpiresAt ||
      inspiration.uploadExpiresAt.getTime() <= now.getTime() ||
      inspiration.purgedAt ||
      !inspiration.storagePath ||
      !inspiration.contentType ||
      !inspiration.sizeBytes
    ) {
      throw new ConsultWriteError('INSPIRATION_UPLOAD_EXPIRED', 'Upload expired.')
    }
    const contentType = mediaType(inspiration.contentType)
    try {
      await storage.assertReady()
      const inspected = await storage.inspectObject({
        path: inspiration.storagePath,
        expectedContentType: contentType,
        maxBytes: inspiration.sizeBytes,
        expectedChecksumSha256: inspiration.checksumSha256,
      })
      if (inspected.sizeBytes !== inspiration.sizeBytes) {
        throw new ConsultInspirationStorageError('invalid')
      }
    } catch (error) {
      if (error instanceof ConsultInspirationStorageError) {
        throw new ConsultWriteError(
          error.kind === 'unavailable'
            ? 'INSPIRATION_STORAGE_UNAVAILABLE'
            : 'INSPIRATION_OBJECT_INVALID',
          'Inspiration object unavailable.',
        )
      }
      throw error
    }
    const updated = await tx.consultInspiration.update({
      where: { id: inspiration.id },
      data: {
        status: ConsultInspirationStatus.ATTACHED,
        attachIdempotencyKey: idempotencyKey,
        attachRequestHash: requestHash,
      },
    })
    await tx.consultAuditEvent.create({
      data: {
        consultSessionId: session.id,
        action: ConsultAuditAction.INSPIRATION_UPLOAD_ATTACHED,
        actorType: args.actor.type,
        actorId: args.actor.id,
        inspirationId: updated.id,
      },
    })
    return { state: await buildState(tx, session, now), replayed: false }
  })
}

const GUIDANCE_COPY =
  'This part of the complete look may involve a separate service your professional already offers. Ask what applies; nothing was added to this booking.'

async function catalogGuidance(
  tx: Prisma.TransactionClient,
  session: InspirationScope,
  answers: readonly ConsultInspirationAnswerDTO[],
): Promise<ConsultInspirationCatalogGuidanceDTO[]> {
  const details = buildExactClientDetails(answers)
  const requested = new Set<'LENGTH' | 'FULLNESS' | 'STYLING'>()
  if (details.some((detail) => detail.questionKey === 'length_goal')) requested.add('LENGTH')
  if (details.some((detail) => detail.questionKey === 'fullness_goal')) requested.add('FULLNESS')
  if (
    details.some(
      (detail) =>
        detail.questionKey === 'current_styling' ||
        detail.questionKey === 'styling_walkthrough',
    )
  ) {
    requested.add('STYLING')
  }
  if (requested.size === 0) return []
  const offerings = await tx.professionalServiceOffering.findMany({
    where: {
      professionalId: session.professionalId,
      isActive: true,
      service: { isActive: true, category: { isActive: true } },
    },
    select: {
      service: { select: { name: true, description: true, category: { select: { name: true, slug: true } } } },
    },
  })
  const text = offerings.map((offering) =>
    `${offering.service.name} ${offering.service.description ?? ''} ${offering.service.category.name} ${offering.service.category.slug}`,
  )
  const patterns: Readonly<Record<'LENGTH' | 'FULLNESS' | 'STYLING', RegExp>> = {
    LENGTH: /\b(cut|trim|length|extension)\b/i,
    FULLNESS: /\b(extension|volume|fullness|thick)\b/i,
    STYLING: /\b(style|styling|blowout|finish|curl|wave)\b/i,
  }
  return [...requested].flatMap((detail) =>
    text.some((value) => patterns[detail].test(value))
      ? [{ detail, message: GUIDANCE_COPY, contextOnly: true, automaticallyAdded: false }]
      : [],
  )
}

export async function answerConsultInspirationQuestion(args: {
  consultSessionId: string
  clientId: string
  actor: ClientActor
  now?: Date
  input: {
    idempotencyKey: string
    schemaVersion: number
    questionKey: unknown
    selectedValues: unknown
    text?: unknown
    sentiment?: unknown
  }
}): Promise<{ state: ConsultInspirationStateDTO; replayed: boolean }> {
  const now = args.now ?? new Date()
  return prisma.$transaction(async (tx) => {
    await lockSession(tx, args.consultSessionId, 'UPDATE')
    const session = await requireScope(tx, {
      consultSessionId: args.consultSessionId,
      clientId: args.clientId,
      actorUserId: args.actor.id,
      now,
      mutation: true,
    })
    await requireCurrentConsultAgreementAcceptances(tx, session.id)
    requireSchemaVersion(args.input.schemaVersion)
    const source = await activeSource(tx, session.id)
    if (!source || source.status !== ConsultInspirationStatus.ATTACHED) {
      throw new ConsultWriteError('INSPIRATION_SOURCE_REQUIRED', 'Select a source first.')
    }
    if (!(await imageAvailable(tx, source, session, now))) {
      throw new ConsultWriteError('INSPIRATION_SOURCE_UNAVAILABLE', 'Source unavailable.')
    }
    let answer: ConsultInspirationAnswerDTO
    try {
      answer = validateConsultInspirationAnswer(args.input)
    } catch {
      throw new ConsultWriteError('INSPIRATION_INVALID_ANSWER', 'Invalid answer.')
    }
    const idempotencyKey = key(args.input.idempotencyKey)
    const requestHash = hash({
      schemaVersion: args.input.schemaVersion,
      answer,
    })
    const existing = await tx.consultRevision.findFirst({
      where: { consultSessionId: session.id, idempotencyKey },
    })
    if (existing) {
      if (
        existing.kind !== ConsultRevisionKind.INSPIRATION ||
        existing.requestHash !== requestHash
      ) {
        throw new ConsultWriteError('IDEMPOTENCY_CONFLICT', 'Idempotency conflict.')
      }
      return { state: await buildState(tx, session, now), replayed: true }
    }
    const previous = await latestReview(tx, session.id)
    const previousPayload = previous
      ? normalizeStoredInspirationPayload(
          (
            await tx.consultRevision.findUnique({
              where: { id: previous.revisionId },
              select: { payload: true },
            })
          )?.payload ?? null,
        )
      : null
    const previousAnswers =
      previousPayload?.inspirationId === source.id ? previousPayload.answers : []
    const progress = evaluateConsultInspirationProgress(previousAnswers)
    if (!previousPayload?.complete && progress.currentQuestion?.key !== answer.questionKey) {
      throw new ConsultWriteError(
        'INSPIRATION_QUESTION_OUT_OF_ORDER',
        'Answer the current question first.',
      )
    }
    const answers = previousAnswers.filter(
      (candidate) => candidate.questionKey !== answer.questionKey,
    )
    const order = new Map(
      CONSULT_INSPIRATION_QUESTIONS.map((question, index) => [question.key, index]),
    )
    answers.push(answer)
    answers.sort(
      (left, right) =>
        (order.get(left.questionKey) ?? 0) - (order.get(right.questionKey) ?? 0),
    )
    const nextProgress = evaluateConsultInspirationProgress(answers)
    const exactClientDetails = buildExactClientDetails(answers)
    const payload: InspirationReviewPayload = {
      contractId: 'hair-color-guided-inspiration',
      contractVersion: 1,
      schemaVersion: 1,
      source: source.source,
      inspirationId: source.id,
      complete: nextProgress.canComplete,
      answers,
      exactClientDetails,
      possibleProfessionalInterpretation:
        buildPossibleProfessionalInterpretation(exactClientDetails),
      catalogGuidance: await catalogGuidance(tx, session, answers),
    }
    const appended = await appendReview(tx, {
      session,
      actor: args.actor,
      idempotencyKey,
      requestHash,
      payload,
    })
    const advanced = payload.complete
      ? await advanceLockedConsultToAnalysisIfReady(tx, {
          consultSessionId: session.id,
          clientId: session.clientId,
          professionalId: session.professionalId,
          actor: args.actor,
          now,
        })
      : false
    return {
      state: await buildState(
        tx,
        advanced
          ? { ...session, status: ConsultSessionStatus.ANALYSIS_PENDING }
          : session,
        now,
      ),
      replayed: appended.replayed,
    }
  })
}

export async function purgeConsultInspirationObject(
  inspirationId: string,
  now = new Date(),
  storage: ConsultInspirationStorage = consultInspirationStorage,
): Promise<boolean> {
  const candidate = await prisma.consultInspiration.findUnique({
    where: { id: inspirationId },
  })
  if (
    !candidate ||
    candidate.source !== ConsultInspirationSource.EXTERNAL_UPLOAD ||
    candidate.purgedAt
  ) {
    return false
  }
  if (!candidate.storagePath) throw new Error('Unpurged inspiration has no pointer.')
  await storage.assertReady()
  await storage.purgeObject(candidate.storagePath)
  return prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT "id" FROM "ConsultInspiration"
      WHERE "id" = ${candidate.id} FOR UPDATE
    `)
    if (locked.length === 0) return false
    const current = await tx.consultInspiration.findUnique({ where: { id: candidate.id } })
    if (!current || current.purgedAt) return false
    if (current.storagePath !== candidate.storagePath) {
      throw new Error('Inspiration storage binding changed during purge.')
    }
    await tx.consultInspiration.update({
      where: { id: current.id },
      data: {
        storageBucket: null,
        storagePath: null,
        purgedAt: now,
        purgeEligibleAt: now,
        purgeRequestedAt: now,
      },
    })
    await tx.consultAuditEvent.create({
      data: {
        consultSessionId: current.consultSessionId,
        action: ConsultAuditAction.INSPIRATION_RAW_PURGED,
        actorType: ConsultActorType.SYSTEM,
        actorId: null,
        inspirationId: current.id,
      },
    })
    return true
  })
}

export async function removeConsultInspiration(args: {
  consultSessionId: string
  clientId: string
  actor: ClientActor
  now?: Date
  storage?: ConsultInspirationStorage
}): Promise<void> {
  const now = args.now ?? new Date()
  const source = await prisma.$transaction(async (tx) => {
    await lockSession(tx, args.consultSessionId, 'UPDATE')
    const session = await requireScope(tx, {
      consultSessionId: args.consultSessionId,
      clientId: args.clientId,
      actorUserId: args.actor.id,
      now,
      mutation: true,
    })
    await requireCurrentConsultAgreementAcceptances(tx, session.id)
    const current = await activeSource(tx, session.id)
    if (!current) return null
    await tx.consultInspiration.update({
      where: { id: current.id },
      data: {
        status: ConsultInspirationStatus.REMOVED,
        ...(current.source === ConsultInspirationSource.EXTERNAL_UPLOAD && !current.purgedAt
          ? { purgeEligibleAt: now, purgeRequestedAt: now }
          : {}),
      },
    })
    await tx.consultAuditEvent.create({
      data: {
        consultSessionId: session.id,
        action: ConsultAuditAction.INSPIRATION_REMOVED,
        actorType: args.actor.type,
        actorId: args.actor.id,
        inspirationId: current.id,
      },
    })
    return current
  })
  if (source?.source === ConsultInspirationSource.EXTERNAL_UPLOAD && !source.purgedAt) {
    try {
      await purgeConsultInspirationObject(
        source.id,
        now,
        args.storage ?? consultInspirationStorage,
      )
    } catch (error) {
      if (error instanceof ConsultInspirationStorageError) {
        throw new ConsultWriteError(
          'INSPIRATION_STORAGE_UNAVAILABLE',
          'Private inspiration storage is unavailable.',
        )
      }
      throw error
    }
  }
}

export async function loadClientInspirationSignedRead(args: {
  consultSessionId: string
  clientId: string
  actorUserId: string
  now?: Date
  storage?: ConsultInspirationStorage
}): Promise<{ url: string; expiresInSeconds: number }> {
  const now = args.now ?? new Date()
  const source = await prisma.$transaction(async (tx) => {
    await lockSession(tx, args.consultSessionId, 'SHARE')
    const session = await requireScope(tx, { ...args, now, mutation: false })
    await requireCurrentConsultAgreementAcceptances(tx, session.id)
    const current = await activeSource(tx, session.id)
    if (
      !current ||
      current.source !== ConsultInspirationSource.EXTERNAL_UPLOAD ||
      !(await imageAvailable(tx, current, session, now)) ||
      !current.storagePath
    ) {
      throw new ConsultWriteError('NOT_FOUND', 'Not found.')
    }
    return current
  })
  try {
    const storage = args.storage ?? consultInspirationStorage
    await storage.assertReady()
    return {
      url: await storage.createSignedRead(
        source.storagePath ?? '',
        CONSULT_INSPIRATION_READ_TTL_SECONDS,
      ),
      expiresInSeconds: CONSULT_INSPIRATION_READ_TTL_SECONDS,
    }
  } catch (error) {
    if (error instanceof ConsultInspirationStorageError) {
      throw new ConsultWriteError(
        'INSPIRATION_STORAGE_UNAVAILABLE',
        'Private inspiration storage is unavailable.',
      )
    }
    throw error
  }
}

export async function loadProInspirationSignedRead(args: {
  consultSessionId: string
  professionalId: string
  now?: Date
  storage?: ConsultInspirationStorage
}): Promise<{ url: string; expiresInSeconds: number }> {
  if (!isAiConsultC6ExposureEnabledForPro(args.professionalId)) {
    throw new ConsultWriteError('NOT_FOUND', 'Not found.')
  }
  const now = args.now ?? new Date()
  const source = await prisma.consultInspiration.findFirst({
    where: {
      consultSessionId: args.consultSessionId,
      source: ConsultInspirationSource.EXTERNAL_UPLOAD,
      status: ConsultInspirationStatus.ATTACHED,
      purgedAt: null,
      useExpiresAt: { gt: now },
      consultSession: {
        professionalId: args.professionalId,
        status: ConsultSessionStatus.COMPLETED,
      },
    },
  })
  if (!source?.storagePath) throw new ConsultWriteError('NOT_FOUND', 'Not found.')
  try {
    const storage = args.storage ?? consultInspirationStorage
    await storage.assertReady()
    return {
      url: await storage.createSignedRead(
        source.storagePath,
        CONSULT_INSPIRATION_READ_TTL_SECONDS,
      ),
      expiresInSeconds: CONSULT_INSPIRATION_READ_TTL_SECONDS,
    }
  } catch (error) {
    if (error instanceof ConsultInspirationStorageError) {
      throw new ConsultWriteError(
        'INSPIRATION_STORAGE_UNAVAILABLE',
        'Private inspiration storage is unavailable.',
      )
    }
    throw error
  }
}

export function sourceDto(value: ConsultInspirationSource): Exclude<ConsultInspirationSourceDTO, 'NONE'> {
  return value
}
