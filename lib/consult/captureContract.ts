import 'server-only'

import { createHash } from 'node:crypto'
import {
  ConsultActorType,
  ConsultAuditAction,
  ConsultCaptureStatus,
  ConsultSessionStatus,
  Prisma,
  UploadSessionStatus,
  UploadSurface,
} from '@prisma/client'

import type {
  ConsultCaptureQualityReasonCodeDTO,
  ConsultCaptureQualityResultDTO,
  ConsultCaptureSlotStateDTO,
  ConsultCaptureStateDTO,
  ConsultCaptureUploadDTO,
} from '@/lib/dto/consult'
import { prisma } from '@/lib/prisma'

import { requireCurrentConsultAgreementAcceptances } from './agreementContract'
import {
  HAIR_COLOR_CAPTURE_PACK,
  HAIR_COLOR_CAPTURE_PACK_VERSION,
  HAIR_COLOR_CAPTURE_SCHEMA_VERSION,
  HAIR_COLOR_CAPTURE_SHOT_KEYS,
  isHairColorCaptureShotKey,
  type HairColorCaptureShotKey,
} from './capturePack'
import { purgeConsultCaptureRawObject } from './capturePurge'
import {
  CONSULT_CAPTURE_BUCKET,
  CONSULT_CAPTURE_MAX_BYTES,
  ConsultCaptureStorageError,
  consultCaptureObjectPath,
  consultCaptureStorage,
  type ConsultCaptureStorage,
} from './captureStorage'
import {
  checkHairColorCapture,
  CONSULT_CAPTURE_MEDIA_TYPES,
  CONSULT_CAPTURE_QUALITY_PROMPT_VERSION,
  CONSULT_CAPTURE_QUALITY_SCHEMA_VERSION,
  ConsultCaptureVisionError,
  type ConsultCaptureMediaType,
  type ConsultCaptureQualityResult,
} from './captureVision'
import {
  AI_CONSULT_ELIGIBILITY_BOOKING_SELECT,
  evaluateAiConsultBookingEligibility,
} from './eligibility'
import { ConsultWriteError } from './errors'
import { transitionLockedConsultSession } from './writeBoundary'

export const CONSULT_CAPTURE_RAW_TTL_MS = 24 * 60 * 60 * 1000
export const CONSULT_CAPTURE_UPLOAD_TTL_MS = 60 * 60 * 1000

const CAPTURE_STATES = new Set<ConsultSessionStatus>([
  ConsultSessionStatus.MEDIA_READY,
  ConsultSessionStatus.ANALYSIS_PENDING,
])

const QUALITY_REASON_CODES = new Set<ConsultCaptureQualityReasonCodeDTO>([
  'PASS',
  'WARM_INDOOR_LIGHT',
  'COLOR_CAST',
  'VIEW_MISMATCH',
  'HAIR_NOT_VISIBLE',
  'BLURRY',
  'TOO_DARK',
  'TOO_BRIGHT',
  'OTHER_QUALITY_FAILURE',
])

type ClientActor = {
  type: typeof ConsultActorType.CLIENT
  id: string
}

const CAPTURE_SCOPE_SELECT = {
  id: true,
  clientId: true,
  professionalId: true,
  serviceCategoryId: true,
  bookingId: true,
  status: true,
  client: { select: { userId: true } },
  booking: {
    select: {
      clientId: true,
      ...AI_CONSULT_ELIGIBILITY_BOOKING_SELECT,
    },
  },
} satisfies Prisma.ConsultSessionSelect

type CaptureScope = Prisma.ConsultSessionGetPayload<{
  select: typeof CAPTURE_SCOPE_SELECT
}>

function hash(value: Readonly<Record<string, unknown>>): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

function validKey(value: string): string {
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > 128) {
    throw new ConsultWriteError('INVALID_REQUEST', 'Invalid idempotency key.')
  }
  return trimmed
}

function validChecksum(value: string | null): string | null {
  if (value === null) return null
  const normalized = value.trim().toLowerCase()
  if (!/^[0-9a-f]{64}$/.test(normalized)) {
    throw new ConsultWriteError('INVALID_REQUEST', 'Invalid checksum.')
  }
  return normalized
}

function validMediaType(value: unknown): ConsultCaptureMediaType {
  const mediaType = CONSULT_CAPTURE_MEDIA_TYPES.find((type) => type === value)
  if (!mediaType) {
    throw new ConsultWriteError('INVALID_REQUEST', 'Unsupported content type.')
  }
  return mediaType
}

function requireVersions(packVersion: number, schemaVersion: number): void {
  if (packVersion !== HAIR_COLOR_CAPTURE_PACK_VERSION) {
    throw new ConsultWriteError(
      'CAPTURE_PACK_VERSION_MISMATCH',
      'Capture pack version is stale.',
    )
  }
  if (schemaVersion !== HAIR_COLOR_CAPTURE_SCHEMA_VERSION) {
    throw new ConsultWriteError(
      'CAPTURE_SCHEMA_VERSION_MISMATCH',
      'Capture schema version is stale.',
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
): Promise<CaptureScope> {
  const session = await tx.consultSession.findUnique({
    where: { id: args.consultSessionId },
    select: CAPTURE_SCOPE_SELECT,
  })
  if (
    !session ||
    session.clientId !== args.clientId ||
    session.client.userId !== args.actorUserId ||
    session.booking.clientId !== session.clientId ||
    session.booking.professionalId !== session.professionalId ||
    session.booking.service.categoryId !== session.serviceCategoryId
  ) {
    throw new ConsultWriteError('NOT_FOUND', 'Consult session not found.')
  }
  const eligibility = evaluateAiConsultBookingEligibility(session.booking, args.now)
  if (!eligibility.eligible) {
    throw new ConsultWriteError(
      eligibility.hidden ? 'NOT_FOUND' : 'BOOKING_INELIGIBLE',
      'Consult is unavailable for this booking.',
    )
  }
  return session
}

function assertCaptureState(session: CaptureScope): void {
  if (!CAPTURE_STATES.has(session.status)) {
    throw new ConsultWriteError(
      'INVALID_STATE',
      'Consult lifecycle does not permit capture access.',
    )
  }
}

function stateForCapture(capture: {
  id: string
  shotKey: string
  status: ConsultCaptureStatus
  qualityReasonCode: string | null
  retakeTip: string | null
  rawExpiresAt: Date
  purgedAt: Date | null
}): ConsultCaptureSlotStateDTO {
  const shotKey = HAIR_COLOR_CAPTURE_SHOT_KEYS.find(
    (candidate) => candidate === capture.shotKey,
  )
  if (!shotKey) {
    throw new ConsultWriteError('CAPTURE_INVALID_SLOT', 'Invalid capture slot.')
  }
  const reasonCode = capture.qualityReasonCode
    ? [...QUALITY_REASON_CODES].find((candidate) => candidate === capture.qualityReasonCode) ?? null
    : null
  const state = capture.purgedAt
    ? 'PURGED'
    : capture.status === ConsultCaptureStatus.ACCEPTED
      ? 'ACCEPTED'
      : capture.status === ConsultCaptureStatus.REJECTED
        ? 'REJECTED'
        : 'UPLOADED'
  return {
    shotKey,
    state,
    captureId: capture.id,
    qualityReasonCode: reasonCode,
    retakeTip: capture.retakeTip,
    rawExpiresAt: capture.purgedAt ? null : capture.rawExpiresAt.toISOString(),
    purgedAt: capture.purgedAt?.toISOString() ?? null,
  }
}

async function buildState(
  tx: Prisma.TransactionClient,
  session: CaptureScope,
  now: Date,
): Promise<ConsultCaptureStateDTO> {
  // The durable audit trail may contain arbitrarily many rejected replacements,
  // but this read is intentionally fixed at one row per one of the four slots.
  const captures = await Promise.all(
    HAIR_COLOR_CAPTURE_SHOT_KEYS.map((shotKey) =>
      tx.consultCapture.findFirst({
        where: { consultSessionId: session.id, shotKey },
        select: {
          id: true,
          shotKey: true,
          status: true,
          qualityReasonCode: true,
          retakeTip: true,
          rawExpiresAt: true,
          purgedAt: true,
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      }),
    ),
  )
  const latest = new Map(
    captures.flatMap((capture) =>
      capture && isHairColorCaptureShotKey(capture.shotKey)
        ? [[capture.shotKey, capture] as const]
        : [],
    ),
  )

  return {
    consultId: session.id,
    status: session.status,
    shotPack: HAIR_COLOR_CAPTURE_PACK,
    slots: HAIR_COLOR_CAPTURE_SHOT_KEYS.map((shotKey) => {
      const capture = latest.get(shotKey)
      if (!capture) {
        return {
          shotKey,
          state: 'EMPTY',
          captureId: null,
          qualityReasonCode: null,
          retakeTip: null,
          rawExpiresAt: null,
          purgedAt: null,
        }
      }
      if (!capture.purgedAt && capture.rawExpiresAt.getTime() <= now.getTime()) {
        return {
          ...stateForCapture(capture),
          state: 'EXPIRED',
          rawExpiresAt: null,
        }
      }
      return stateForCapture(capture)
    }),
  }
}

export async function loadConsultCaptureState(args: {
  consultSessionId: string
  clientId: string
  actorUserId: string
  now?: Date
}): Promise<ConsultCaptureStateDTO> {
  const now = args.now ?? new Date()
  return prisma.$transaction(
    async (tx) => {
      await lockSession(tx, args.consultSessionId, 'SHARE')
      const session = await requireScope(tx, { ...args, now })
      await requireCurrentConsultAgreementAcceptances(tx, session.id)
      assertCaptureState(session)
      return buildState(tx, session, now)
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  )
}

export async function issueConsultCaptureUpload(args: {
  consultSessionId: string
  clientId: string
  actor: ClientActor
  now?: Date
  loadInput: () => Promise<{
    idempotencyKey: string
    shotKey: unknown
    shotPackVersion: number
    schemaVersion: number
    contentType: unknown
    sizeBytes: number
    checksumSha256: string | null
  }>
  storage?: ConsultCaptureStorage
}): Promise<{ upload: ConsultCaptureUploadDTO; replayed: boolean }> {
  const now = args.now ?? new Date()
  const storage = args.storage ?? consultCaptureStorage
  return prisma.$transaction(
    async (tx) => {
      await lockSession(tx, args.consultSessionId, 'UPDATE')
      const session = await requireScope(tx, {
        consultSessionId: args.consultSessionId,
        clientId: args.clientId,
        actorUserId: args.actor.id,
        now,
      })
      await requireCurrentConsultAgreementAcceptances(tx, session.id)
      if (session.status !== ConsultSessionStatus.MEDIA_READY) {
        throw new ConsultWriteError('INVALID_STATE', 'Capture upload is unavailable.')
      }

      const input = await args.loadInput()
      requireVersions(input.shotPackVersion, input.schemaVersion)
      if (!isHairColorCaptureShotKey(input.shotKey)) {
        throw new ConsultWriteError('CAPTURE_INVALID_SLOT', 'Invalid capture slot.')
      }
      const idempotencyKey = validKey(input.idempotencyKey)
      const contentType = validMediaType(input.contentType)
      if (
        !Number.isInteger(input.sizeBytes) ||
        input.sizeBytes < 1 ||
        input.sizeBytes > CONSULT_CAPTURE_MAX_BYTES
      ) {
        throw new ConsultWriteError('INVALID_REQUEST', 'Invalid capture size.')
      }
      const checksumSha256 = validChecksum(input.checksumSha256)
      const requestHash = hash({
        shotKey: input.shotKey,
        shotPackVersion: input.shotPackVersion,
        schemaVersion: input.schemaVersion,
        contentType,
        sizeBytes: input.sizeBytes,
        checksumSha256,
      })

      let uploadSession = await tx.uploadSession.findFirst({
        where: { consultSessionId: session.id, idempotencyKey },
      })
      const replayed = Boolean(uploadSession)
      if (uploadSession) {
        if (uploadSession.requestHash !== requestHash) {
          throw new ConsultWriteError(
            'IDEMPOTENCY_CONFLICT',
            'The idempotency key was already used.',
          )
        }
        if (
          uploadSession.status !== UploadSessionStatus.PENDING ||
          uploadSession.expiresAt.getTime() <= now.getTime() ||
          uploadSession.purgedAt
        ) {
          throw new ConsultWriteError(
            'CAPTURE_UPLOAD_EXPIRED',
            'Capture upload has expired.',
          )
        }
      } else {
        const path = consultCaptureObjectPath(contentType)
        const expiresAt = new Date(now.getTime() + CONSULT_CAPTURE_UPLOAD_TTL_MS)
        const rawExpiresAt = new Date(now.getTime() + CONSULT_CAPTURE_RAW_TTL_MS)
        uploadSession = await tx.uploadSession.create({
          data: {
            surface: UploadSurface.CLIENT_CONSULT,
            status: UploadSessionStatus.PENDING,
            professionalId: session.professionalId,
            clientId: session.clientId,
            bookingId: session.bookingId,
            consultSessionId: session.id,
            serviceCategoryId: session.serviceCategoryId,
            consultShotKey: input.shotKey,
            shotPackVersion: input.shotPackVersion,
            captureSchemaVersion: input.schemaVersion,
            idempotencyKey,
            requestHash,
            storageBucket: CONSULT_CAPTURE_BUCKET,
            storagePath: path,
            contentType,
            maxBytes: input.sizeBytes,
            checksumSha256,
            expiresAt,
            rawExpiresAt,
            createdAt: now,
          },
        })
        await tx.consultAuditEvent.create({
          data: {
            consultSessionId: session.id,
            action: ConsultAuditAction.CAPTURE_UPLOAD_ISSUED,
            actorType: args.actor.type,
            actorId: args.actor.id,
          },
        })
      }

      await storage.assertReady()
      const signed = await storage.createSignedUpload(uploadSession.storagePath)
      if (
        !isHairColorCaptureShotKey(uploadSession.consultShotKey) ||
        !uploadSession.rawExpiresAt
      ) {
        throw new ConsultWriteError(
          'CAPTURE_UPLOAD_MISMATCH',
          'Capture upload binding is invalid.',
        )
      }
      return {
        upload: {
          uploadSessionId: uploadSession.id,
          shotKey: uploadSession.consultShotKey,
          shotPackVersion: uploadSession.shotPackVersion ?? 0,
          schemaVersion: uploadSession.captureSchemaVersion ?? 0,
          contentType,
          maxBytes: uploadSession.maxBytes,
          expiresAt: uploadSession.expiresAt.toISOString(),
          rawExpiresAt: uploadSession.rawExpiresAt.toISOString(),
          token: signed.token,
          signedUrl: signed.signedUrl,
        },
        replayed,
      }
    },
    { maxWait: 10_000, timeout: 60_000 },
  ).catch((error: unknown) => {
    if (error instanceof ConsultCaptureStorageError) {
      throw new ConsultWriteError(
        'CAPTURE_STORAGE_UNAVAILABLE',
        'Private capture storage is unavailable.',
      )
    }
    throw error
  })
}

export async function attachConsultCaptureUpload(args: {
  consultSessionId: string
  clientId: string
  actor: ClientActor
  now?: Date
  loadInput: () => Promise<{
    idempotencyKey: string
    uploadSessionId: string
    shotKey: unknown
    shotPackVersion: number
    schemaVersion: number
  }>
  storage?: ConsultCaptureStorage
}): Promise<{ captureId: string; replayed: boolean }> {
  const now = args.now ?? new Date()
  const storage = args.storage ?? consultCaptureStorage
  return prisma.$transaction(
    async (tx) => {
      await lockSession(tx, args.consultSessionId, 'UPDATE')
      const session = await requireScope(tx, {
        consultSessionId: args.consultSessionId,
        clientId: args.clientId,
        actorUserId: args.actor.id,
        now,
      })
      await requireCurrentConsultAgreementAcceptances(tx, session.id)
      const input = await args.loadInput()
      requireVersions(input.shotPackVersion, input.schemaVersion)
      if (!isHairColorCaptureShotKey(input.shotKey)) {
        throw new ConsultWriteError('CAPTURE_INVALID_SLOT', 'Invalid capture slot.')
      }
      const idempotencyKey = validKey(input.idempotencyKey)
      const requestHash = hash({
        uploadSessionId: input.uploadSessionId,
        shotKey: input.shotKey,
        shotPackVersion: input.shotPackVersion,
        schemaVersion: input.schemaVersion,
      })
      const existing = await tx.consultCapture.findFirst({
        where: { consultSessionId: session.id, attachIdempotencyKey: idempotencyKey },
      })
      if (existing) {
        if (existing.attachRequestHash !== requestHash) {
          throw new ConsultWriteError('IDEMPOTENCY_CONFLICT', 'Idempotency conflict.')
        }
        return { captureId: existing.id, replayed: true }
      }
      if (session.status !== ConsultSessionStatus.MEDIA_READY) {
        throw new ConsultWriteError('INVALID_STATE', 'Capture attach is unavailable.')
      }

      const upload = await tx.uploadSession.findUnique({
        where: { id: input.uploadSessionId },
      })
      if (
        !upload ||
        upload.surface !== UploadSurface.CLIENT_CONSULT ||
        upload.clientId !== session.clientId ||
        upload.professionalId !== session.professionalId ||
        upload.consultSessionId !== session.id ||
        upload.bookingId !== session.bookingId ||
        upload.serviceCategoryId !== session.serviceCategoryId ||
        upload.consultShotKey !== input.shotKey ||
        upload.shotPackVersion !== input.shotPackVersion ||
        upload.captureSchemaVersion !== input.schemaVersion
      ) {
        throw new ConsultWriteError(
          'CAPTURE_UPLOAD_MISMATCH',
          'Capture upload does not match.',
        )
      }
      if (
        upload.status !== UploadSessionStatus.PENDING ||
        upload.expiresAt.getTime() <= now.getTime() ||
        !upload.rawExpiresAt ||
        upload.rawExpiresAt.getTime() <= now.getTime() ||
        upload.purgedAt
      ) {
        throw new ConsultWriteError('CAPTURE_UPLOAD_EXPIRED', 'Capture upload expired.')
      }
      const liveCapture = await tx.consultCapture.findFirst({
        where: {
          consultSessionId: session.id,
          shotKey: input.shotKey,
          status: {
            in: [ConsultCaptureStatus.ATTACHED, ConsultCaptureStatus.ACCEPTED],
          },
          purgedAt: null,
          rawExpiresAt: { gt: now },
        },
        select: { id: true },
      })
      if (liveCapture) {
        throw new ConsultWriteError('INVALID_STATE', 'This capture slot is already active.')
      }

      let object
      try {
        await storage.assertReady()
        object = await storage.inspectObject({
          path: upload.storagePath,
          expectedContentType: validMediaType(upload.contentType),
          maxBytes: upload.maxBytes,
          expectedChecksumSha256: upload.checksumSha256,
        })
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
      if (object.sizeBytes !== upload.maxBytes) {
        throw new ConsultWriteError(
          'CAPTURE_OBJECT_INVALID',
          'Capture object size does not match.',
        )
      }

      const capture = await tx.consultCapture.create({
        data: {
          consultSessionId: session.id,
          uploadSessionId: upload.id,
          shotKey: input.shotKey,
          shotPackVersion: input.shotPackVersion,
          schemaVersion: input.schemaVersion,
          storageBucket: upload.storageBucket,
          storagePath: upload.storagePath,
          contentType: object.contentType,
          sizeBytes: object.sizeBytes,
          checksumSha256: object.checksumSha256 ?? upload.checksumSha256,
          attachIdempotencyKey: idempotencyKey,
          attachRequestHash: requestHash,
          rawExpiresAt: upload.rawExpiresAt,
        },
      })
      const consumed = await tx.uploadSession.updateMany({
        where: { id: upload.id, status: UploadSessionStatus.PENDING },
        data: { status: UploadSessionStatus.CONSUMED, consumedAt: now },
      })
      if (consumed.count !== 1) {
        throw new ConsultWriteError('CAPTURE_UPLOAD_MISMATCH', 'Capture upload changed.')
      }
      await tx.consultAuditEvent.create({
        data: {
          consultSessionId: session.id,
          action: ConsultAuditAction.CAPTURE_ATTACHED,
          actorType: args.actor.type,
          actorId: args.actor.id,
          captureId: capture.id,
        },
      })
      return { captureId: capture.id, replayed: false }
    },
    { maxWait: 10_000, timeout: 60_000 },
  )
}

function qualityDto(capture: {
  id: string
  status: ConsultCaptureStatus
  qualityReasonCode: string | null
  retakeTip: string | null
  qualityCheckedAt: Date | null
}): ConsultCaptureQualityResultDTO {
  const reasonCode = [...QUALITY_REASON_CODES].find(
    (candidate) => candidate === capture.qualityReasonCode,
  )
  if (!reasonCode || !capture.qualityCheckedAt) {
    throw new ConsultWriteError('CAPTURE_QUALITY_UNAVAILABLE', 'Quality result unavailable.')
  }
  return {
    captureId: capture.id,
    accepted: capture.status === ConsultCaptureStatus.ACCEPTED,
    reasonCode,
    retakeTip: capture.retakeTip,
    checkedAt: capture.qualityCheckedAt.toISOString(),
  }
}

export async function checkConsultCaptureQuality(args: {
  consultSessionId: string
  captureId: string
  clientId: string
  actor: ClientActor
  now?: Date
  loadInput: () => Promise<{
    idempotencyKey: string
    shotPackVersion: number
    schemaVersion: number
  }>
  storage?: ConsultCaptureStorage
  qualityCheck?: (input: {
    shotKey: HairColorCaptureShotKey
    image: { base64: string; mediaType: ConsultCaptureMediaType }
  }) => Promise<ConsultCaptureQualityResult>
}): Promise<{ quality: ConsultCaptureQualityResultDTO; replayed: boolean }> {
  const now = args.now ?? new Date()
  const storage = args.storage ?? consultCaptureStorage
  const qualityCheck = args.qualityCheck ?? checkHairColorCapture
  const result = await prisma.$transaction(
    async (tx) => {
      await lockSession(tx, args.consultSessionId, 'UPDATE')
      const session = await requireScope(tx, {
        consultSessionId: args.consultSessionId,
        clientId: args.clientId,
        actorUserId: args.actor.id,
        now,
      })
      await requireCurrentConsultAgreementAcceptances(tx, session.id)
      const input = await args.loadInput()
      requireVersions(input.shotPackVersion, input.schemaVersion)
      const idempotencyKey = validKey(input.idempotencyKey)
      const requestHash = hash({
        captureId: args.captureId,
        shotPackVersion: input.shotPackVersion,
        schemaVersion: input.schemaVersion,
      })
      const capture = await tx.consultCapture.findFirst({
        where: { id: args.captureId, consultSessionId: session.id },
      })
      if (!capture || !isHairColorCaptureShotKey(capture.shotKey)) {
        throw new ConsultWriteError('NOT_FOUND', 'Capture not found.')
      }
      if (capture.qualityIdempotencyKey === idempotencyKey) {
        if (capture.qualityRequestHash !== requestHash) {
          throw new ConsultWriteError('IDEMPOTENCY_CONFLICT', 'Idempotency conflict.')
        }
        return { quality: qualityDto(capture), replayed: true, rejectedId: null }
      }
      if (capture.qualityCheckedAt) {
        return { quality: qualityDto(capture), replayed: true, rejectedId: null }
      }
      if (session.status !== ConsultSessionStatus.MEDIA_READY) {
        throw new ConsultWriteError('INVALID_STATE', 'Capture quality is unavailable.')
      }
      if (
        capture.status !== ConsultCaptureStatus.ATTACHED ||
        capture.purgedAt ||
        !capture.storagePath ||
        capture.rawExpiresAt.getTime() <= now.getTime()
      ) {
        throw new ConsultWriteError('CAPTURE_UPLOAD_EXPIRED', 'Capture has expired.')
      }

      let image
      try {
        await storage.assertReady()
        image = await storage.readObject({
          path: capture.storagePath,
          expectedContentType: validMediaType(capture.contentType),
          maxBytes: capture.sizeBytes,
        })
      } catch (error) {
        if (error instanceof ConsultCaptureStorageError) {
          throw new ConsultWriteError(
            error.kind === 'unavailable'
              ? 'CAPTURE_STORAGE_UNAVAILABLE'
              : 'CAPTURE_OBJECT_INVALID',
            'Capture object is unavailable.',
          )
        }
        throw error
      }

      let quality: ConsultCaptureQualityResult
      try {
        quality = await qualityCheck({ shotKey: capture.shotKey, image })
      } catch (error) {
        if (error instanceof ConsultCaptureVisionError) {
          throw new ConsultWriteError(
            'CAPTURE_QUALITY_UNAVAILABLE',
            'Capture quality checking is unavailable.',
          )
        }
        throw error
      }
      const finalizedAt = new Date(Math.max(now.getTime(), Date.now()))
      // Provider work happens while the session lock fences canonical
      // revocation. Re-read mutable booking/legal prerequisites and the purge
      // marker before committing so any independent cancellation/expiry race
      // discards the in-flight result.
      await requireScope(tx, {
        consultSessionId: args.consultSessionId,
        clientId: args.clientId,
        actorUserId: args.actor.id,
        now: finalizedAt,
      })
      await requireCurrentConsultAgreementAcceptances(tx, session.id)
      const finalizeFence = await tx.consultCapture.findUnique({
        where: { id: capture.id },
        select: {
          rawExpiresAt: true,
          purgeRequestedAt: true,
          purgedAt: true,
        },
      })
      if (
        !finalizeFence ||
        finalizeFence.rawExpiresAt.getTime() <= finalizedAt.getTime() ||
        finalizeFence.purgeRequestedAt ||
        finalizeFence.purgedAt
      ) {
        throw new ConsultWriteError('CAPTURE_UPLOAD_EXPIRED', 'Capture has expired.')
      }
      if (
        !QUALITY_REASON_CODES.has(quality.reasonCode) ||
        (quality.accepted && quality.reasonCode !== 'PASS') ||
        (!quality.accepted && quality.reasonCode === 'PASS') ||
        typeof quality.model !== 'string' ||
        !quality.model.trim() ||
        quality.model !== quality.model.trim() ||
        quality.model.length > 128 ||
        (quality.retakeTip !== null &&
          (!quality.retakeTip.trim() || quality.retakeTip.length > 160))
      ) {
        throw new ConsultWriteError(
          'CAPTURE_QUALITY_UNAVAILABLE',
          'Capture quality output is invalid.',
        )
      }
      const status = quality.accepted
        ? ConsultCaptureStatus.ACCEPTED
        : ConsultCaptureStatus.REJECTED
      const updated = await tx.consultCapture.update({
        where: { id: capture.id },
        data: {
          status,
          qualityReasonCode: quality.reasonCode,
          retakeTip: quality.retakeTip,
          qualitySchemaVersion: CONSULT_CAPTURE_QUALITY_SCHEMA_VERSION,
          qualityPromptVersion: CONSULT_CAPTURE_QUALITY_PROMPT_VERSION,
          qualityModel: quality.model,
          qualityCheckedAt: finalizedAt,
          qualityIdempotencyKey: idempotencyKey,
          qualityRequestHash: requestHash,
          ...(!quality.accepted
            ? { purgeEligibleAt: finalizedAt, purgeRequestedAt: finalizedAt }
            : {}),
        },
      })
      await tx.consultAuditEvent.create({
        data: {
          consultSessionId: session.id,
          action: ConsultAuditAction.CAPTURE_QUALITY_CHECKED,
          actorType: args.actor.type,
          actorId: args.actor.id,
          captureId: capture.id,
        },
      })

      if (quality.accepted) {
        const accepted = await tx.consultCapture.findMany({
          where: {
            consultSessionId: session.id,
            status: ConsultCaptureStatus.ACCEPTED,
            purgedAt: null,
            rawExpiresAt: { gt: now },
          },
          select: { shotKey: true },
        })
        const acceptedKeys = new Set(accepted.map((item) => item.shotKey))
        if (
          HAIR_COLOR_CAPTURE_SHOT_KEYS.every((shotKey) => acceptedKeys.has(shotKey))
        ) {
          await transitionLockedConsultSession(tx, {
            consultSessionId: session.id,
            actor: args.actor,
            fromStatus: ConsultSessionStatus.MEDIA_READY,
            toStatus: ConsultSessionStatus.ANALYSIS_PENDING,
          })
        }
      }
      return {
        quality: qualityDto(updated),
        replayed: false,
        rejectedId: quality.accepted ? null : capture.id,
      }
    },
    { maxWait: 10_000, timeout: 60_000 },
  )
  if (result.rejectedId) {
    try {
      await purgeConsultCaptureRawObject(
        result.rejectedId,
        new Date(Math.max(now.getTime(), Date.now())),
        storage,
      )
    } catch {
      // The durable purgeEligibleAt marker makes the cleanup job retry. Do not
      // replace the bounded quality result with storage/provider detail.
    }
  }
  return { quality: result.quality, replayed: result.replayed }
}

export async function deleteConsultCapture(args: {
  consultSessionId: string
  captureId: string
  clientId: string
  actor: ClientActor
  now?: Date
  storage?: ConsultCaptureStorage
}): Promise<void> {
  const now = args.now ?? new Date()
  await prisma.$transaction(async (tx) => {
    await lockSession(tx, args.consultSessionId, 'UPDATE')
    const session = await tx.consultSession.findUnique({
      where: { id: args.consultSessionId },
      select: CAPTURE_SCOPE_SELECT,
    })
    if (
      !session ||
      session.clientId !== args.clientId ||
      session.client.userId !== args.actor.id
    ) {
      throw new ConsultWriteError('NOT_FOUND', 'Capture not found.')
    }
    const capture = await tx.consultCapture.findFirst({
      where: { id: args.captureId, consultSessionId: session.id },
    })
    if (!capture) throw new ConsultWriteError('NOT_FOUND', 'Capture not found.')
    if (!capture.purgedAt && !capture.purgeRequestedAt) {
      await tx.consultCapture.update({
        where: { id: capture.id },
        data: { purgeEligibleAt: now, purgeRequestedAt: now },
      })
      await tx.consultAuditEvent.create({
        data: {
          consultSessionId: session.id,
          action: ConsultAuditAction.CAPTURE_DELETED,
          actorType: args.actor.type,
          actorId: args.actor.id,
          captureId: capture.id,
        },
      })
    }
    if (session.status === ConsultSessionStatus.ANALYSIS_PENDING) {
      await transitionLockedConsultSession(tx, {
        consultSessionId: session.id,
        actor: args.actor,
        fromStatus: ConsultSessionStatus.ANALYSIS_PENDING,
        toStatus: ConsultSessionStatus.CANCELLED,
      })
    }
  })
  await purgeConsultCaptureRawObject(
    args.captureId,
    now,
    args.storage ?? consultCaptureStorage,
  )
}
