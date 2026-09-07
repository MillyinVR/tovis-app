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
  ConsultCaptureQualityWarningCodeDTO,
  ConsultCaptureShotKeyDTO,
  ConsultCaptureSlotStateDTO,
  ConsultCaptureStateDTO,
  ConsultCaptureUploadDTO,
} from '@/lib/dto/consult'
import { prisma } from '@/lib/prisma'

import { requireCurrentConsultAgreementAcceptances } from './agreementContract'
import {
  CONSULT_EARLY_PHOTO_PACK_VERSION,
  CONSULT_EARLY_PHOTO_SHOT_KEY,
} from './capture/earlyPhoto'
import {
  CONSULT_MAX_ANALYSIS_CAPTURES,
  findConsultCaptureShot,
  packHasShot,
} from './capture/registry'
import {
  shotMayWarn,
  type ConsultCapturePackDefinition,
} from './capture/types'
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
  checkConsultCapture,
  CONSULT_CAPTURE_MEDIA_TYPES,
  consultCaptureQualityPromptVersion,
  CONSULT_CAPTURE_QUALITY_SCHEMA_VERSION,
  ConsultCaptureVisionError,
  type ConsultCaptureMediaType,
  type ConsultCaptureQualityResult,
} from './captureVision'
import {
  flushConsultProviderMeter,
  type ConsultProviderMeterSink,
} from './providerMeter'
import { recordLockedConsultRerunRequest } from './analysisRerun'
import {
  assertConsultInputOpen,
  assertConsultReadableScope,
  CONSULT_OPEN_WINDOW_SELECT,
} from './openWindow'
import {
  CONSULT_SERVICE_PROFILE_CATEGORY_SELECT,
  resolveConsultServiceProfile,
} from './serviceProfile'
import { ConsultWriteError } from './errors'
import {
  advanceLockedConsultToAnalysisIfReady,
  requireCompletedConsultInspiration,
} from './inspirationContract'
import { transitionLockedConsultSession } from './writeBoundary'

export const CONSULT_CAPTURE_RAW_TTL_MS = 24 * 60 * 60 * 1000
export const CONSULT_CAPTURE_UPLOAD_TTL_MS = 60 * 60 * 1000

// Structural ceiling on paid quality checks per consult session. Each check is
// a provider vision call, and retakes mint a fresh capture row each time, so
// without a per-session bound a stuck client (or automation) could spend
// without limit inside one consult. 48 = the 8 shots a consult can hold — the
// largest pack's 7, plus P7a-1's early photo — × 6 attempts each. Far beyond
// real use (a client failing six checks on one slot has a lighting problem the
// retake tips address, not a reason for a seventh paid call), and it holds when
// the redis-only route bucket fails open, because it is counted in the same
// transaction that runs the check. Replays of an already-checked capture return
// before this bound and stay free.
//
// 🔴 Derived, not typed: leaving the literal at 42 while adding an eighth shot
// silently cut the per-slot budget from six attempts to five for whoever hit it
// last, which is the client having the worst time with her camera.
export const CONSULT_CAPTURE_QUALITY_ATTEMPTS_PER_SLOT = 6
/**
 * The LARGEST ceiling any session can have — the hair pack's seven slots plus
 * the early photo, six attempts each. Other packs scale down by their own slot
 * count; `maxQualityChecksFor` is the rule, and this is its maximum.
 */
export const CONSULT_CAPTURE_MAX_QUALITY_CHECKS_PER_SESSION =
  CONSULT_MAX_ANALYSIS_CAPTURES * CONSULT_CAPTURE_QUALITY_ATTEMPTS_PER_SLOT

// P7a-1: EARLY_PHOTO_READY is a capture state too. It is the SAME ingest path
// — mint, attach, judge, the P2d durable queue — carrying one shot that is not
// in any pack; only the gate's verdict differs (capture/earlyPhoto.ts).
const CAPTURE_STATES = new Set<ConsultSessionStatus>([
  ConsultSessionStatus.EARLY_PHOTO_READY,
  ConsultSessionStatus.MEDIA_READY,
  ConsultSessionStatus.ANALYSIS_PENDING,
  // P7a-3: readable while the plan is being built and after it exists.
  // 🔴 These two absences are why the thread ate its own history: the loader
  // threw INVALID_STATE from ANALYZING onward, `optionalStage` turned that into
  // "no photos to show", and every photo message — the early one that unlocked
  // the booking included — disappeared the moment the run started.
  ConsultSessionStatus.ANALYZING,
  ConsultSessionStatus.COMPLETED,
])

const QUALITY_REASON_CODES = new Set<ConsultCaptureQualityReasonCodeDTO>([
  'PASS',
  'WARM_INDOOR_LIGHT',
  'COLOR_CAST',
  'VIEW_MISMATCH',
  'HAIR_NOT_VISIBLE',
  'SUBJECT_NOT_VISIBLE',
  'BLURRY',
  'TOO_DARK',
  'TOO_BRIGHT',
  'OTHER_QUALITY_FAILURE',
])

// Every code that CAN be a warning — that is, every finding except 'PASS',
// which is the absence of one. Whether a given shot may actually carry a given warning is
// `shotMayWarn` — a colour finding on a tight crop (B3), or anything short of
// "no person here" on the early photo (P7a-1). This set is only the vocabulary
// check that comes first.
const QUALITY_WARNING_CODES = new Set<ConsultCaptureQualityWarningCodeDTO>(
  [...QUALITY_REASON_CODES].filter(
    (code): code is ConsultCaptureQualityWarningCodeDTO => code !== 'PASS',
  ),
)

type ClientActor = {
  type: typeof ConsultActorType.CLIENT
  id: string
}

const CAPTURE_SCOPE_SELECT = {
  id: true,
  status: true,
  chartCopyOptIn: true,
  chartCopyDecidedAt: true,
  client: { select: { userId: true } },
  ...CONSULT_OPEN_WINDOW_SELECT,
  serviceCategory: { select: CONSULT_SERVICE_PROFILE_CATEGORY_SELECT },
} satisfies Prisma.ConsultSessionSelect

type CaptureScope = Prisma.ConsultSessionGetPayload<{
  select: typeof CAPTURE_SCOPE_SELECT
}>

/** The shot pack THIS session serves (lib/consult/capture/registry.ts). */
function packFor(session: CaptureScope): ConsultCapturePackDefinition {
  return resolveConsultServiceProfile(session.serviceCategory).capturePack
}

/**
 * Structural ceiling on paid quality checks per consult session: six attempts
 * per shot the session can hold (see CONSULT_CAPTURE_QUALITY_ATTEMPTS_PER_SLOT).
 * Sized by the pack the session serves, so a three-shot pack does not inherit
 * the hair pack's headroom.
 *
 * `+ 1` is the early photo (P7a-1). It is a paid check counted by the same
 * `qualityCheckedAt IS NOT NULL` tally, so leaving it out of the budget would
 * have silently taken one of the SIX attempts the client has on her last pack
 * slot — the client having the worst time with her camera pays for it.
 */
function maxQualityChecksFor(pack: ConsultCapturePackDefinition): number {
  return (
    (pack.shots.length + 1) * CONSULT_CAPTURE_QUALITY_ATTEMPTS_PER_SLOT
  )
}

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

/**
 * The shot/version pair a capture write names, validated against whatever
 * OWNS that shot (P7a-1).
 *
 * A guided shot is owned by the session's pack and keeps exactly the checks it
 * had. The early photo is owned by nothing — it belongs to no pack — so it is
 * checked against its own constants instead. Both arms still refuse an unknown
 * key and a stale version; what changed is that "unknown" is no longer the same
 * question as "not in this pack".
 */
/**
 * Is this shot key one this CONSULT may write — its pack's, or the early photo?
 *
 * `packHasShot` alone is no longer that question (P7a-1): the early photo is a
 * legitimate capture on every consult and a member of no pack, so every place
 * that asked "is it in the pack" as a proxy for "is it ours" has to ask this
 * instead. Missing one of them is how the early photo got minted an upload and
 * then refused at the response, which is exactly what happened first time.
 */
function shotBelongsToConsult(
  pack: ConsultCapturePackDefinition,
  shotKey: unknown,
): shotKey is ConsultCaptureShotKeyDTO {
  return shotKey === CONSULT_EARLY_PHOTO_SHOT_KEY || packHasShot(pack, shotKey)
}

function requireShotAndVersions(
  pack: ConsultCapturePackDefinition,
  shotKey: unknown,
  packVersion: number,
  schemaVersion: number,
): asserts shotKey is ConsultCaptureShotKeyDTO {
  if (shotKey === CONSULT_EARLY_PHOTO_SHOT_KEY) {
    if (packVersion !== CONSULT_EARLY_PHOTO_PACK_VERSION) {
      throw new ConsultWriteError(
        'CAPTURE_PACK_VERSION_MISMATCH',
        'Capture pack version is stale.',
      )
    }
    if (schemaVersion !== pack.schemaVersion) {
      throw new ConsultWriteError(
        'CAPTURE_SCHEMA_VERSION_MISMATCH',
        'Capture schema version is stale.',
      )
    }
    return
  }
  requireVersions(pack, packVersion, schemaVersion)
  if (!packHasShot(pack, shotKey)) {
    throw new ConsultWriteError('CAPTURE_INVALID_SLOT', 'Invalid capture slot.')
  }
}

function requireVersions(
  pack: ConsultCapturePackDefinition,
  packVersion: number,
  schemaVersion: number,
): void {
  if (packVersion !== pack.version) {
    throw new ConsultWriteError(
      'CAPTURE_PACK_VERSION_MISMATCH',
      'Capture pack version is stale.',
    )
  }
  if (schemaVersion !== pack.schemaVersion) {
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
    session.client.userId !== args.actorUserId
  ) {
    throw new ConsultWriteError('NOT_FOUND', 'Consult session not found.')
  }
  // P7a-3: SCOPE only. The appointment rule moved to the WRITE paths
  // (`assertConsultInputOpen`) so that a consult which can no longer be changed
  // can still be read — before this split, a passed appointment threw out of
  // every stage loader and `optionalStage` erased the thread's own history.
  assertConsultReadableScope(session)
  return session
}

/**
 * May THIS shot be written in THIS lifecycle state? (P7a-1.)
 *
 * Deliberately not a widening of the old `status !== MEDIA_READY` checks to
 * "MEDIA_READY or EARLY_PHOTO_READY". That would have opened the whole guided
 * pack in the early stage — a client at EARLY_PHOTO_READY could mint and attach
 * a `hair_back` upload before she had answered anything, and the prep checklist
 * would already be half-filled with photos taken in the wrong place in the
 * flow. The two windows are different because the two shots are different:
 *
 *   - the early photo may be taken in the early stage AND later, because the
 *     thread is a living document and she can replace it until the appointment;
 *   - every guided shot stays exactly where it was, in MEDIA_READY.
 */
/**
 * P7a-3: the states a GUIDED shot may be written in, and the states the early
 * photo may be REPLACED in.
 *
 * MEDIA_READY was the whole list. The consult is a living document until the
 * appointment now, so a client who sees her plan and wants a better photo in it
 * can send one — and the rerun that follows reads it.
 */
const POST_INTAKE_CAPTURE_WRITE_STATES = new Set<ConsultSessionStatus>([
  ConsultSessionStatus.MEDIA_READY,
  ConsultSessionStatus.ANALYSIS_PENDING,
  ConsultSessionStatus.ANALYZING,
  ConsultSessionStatus.COMPLETED,
])

/**
 * May a GUIDED shot be written in this state? (P3b.)
 *
 * 🔴 Exported so the THREAD can ask the same question the write boundary
 * answers, instead of holding a second opinion about it. That divergence is
 * the whole of the bug this exists to close: the thread emitted all seven
 * guided photo requests at EARLY_PHOTO_READY, both clients rendered a working
 * camera button on them, and `assertCaptureWriteState` — correctly — refused
 * the upload. The client had already taken the photograph by then, so the
 * refusal read as "This consult changed" on a shot she had just been invited
 * to take. Proven on Tori's phone, 2026-09-06: two `eyes_closeup` captures
 * blocked at issue, `bytesUploaded: false`.
 *
 * Ask this before OFFERING a guided shot. `assertCaptureWriteState` still
 * refuses one that arrives anyway — a projection is not a permission check.
 */
export function guidedCaptureWritable(status: ConsultSessionStatus): boolean {
  return POST_INTAKE_CAPTURE_WRITE_STATES.has(status)
}

/**
 * May the EARLY photo be written in this state? The early photo's window is
 * wider than the pack's on purpose: it may be taken in the early stage AND
 * replaced later, because the thread is a living document until the
 * appointment.
 */
export function earlyPhotoWritable(status: ConsultSessionStatus): boolean {
  return (
    status === ConsultSessionStatus.EARLY_PHOTO_READY ||
    POST_INTAKE_CAPTURE_WRITE_STATES.has(status)
  )
}

function assertCaptureWriteState(
  session: CaptureScope,
  shotKey: string,
  action: string,
  now: Date,
): void {
  const allowed =
    shotKey === CONSULT_EARLY_PHOTO_SHOT_KEY
      ? earlyPhotoWritable(session.status)
      : guidedCaptureWritable(session.status)
  if (!allowed) {
    throw new ConsultWriteError('INVALID_STATE', `Capture ${action} is unavailable.`)
  }
  // P7a-3: and the consult must still be open. What closes it is the
  // APPOINTMENT, not the analysis — a spark consult had no timing rule at all
  // until now, so this is the only thing standing between a client in the chair
  // and a plan that changes under her pro.
  assertConsultInputOpen(session, now)
}

function assertCaptureState(session: CaptureScope): void {
  if (!CAPTURE_STATES.has(session.status)) {
    throw new ConsultWriteError(
      'INVALID_STATE',
      'Consult lifecycle does not permit capture access.',
    )
  }
}

function stateForCapture(
  pack: ConsultCapturePackDefinition,
  capture: {
    id: string
    shotKey: string
    status: ConsultCaptureStatus
    qualityReasonCode: string | null
    qualityWarningCode: string | null
    retakeTip: string | null
    rawExpiresAt: Date
    purgedAt: Date | null
  },
): ConsultCaptureSlotStateDTO {
  // Not `pack.shots.find` — the early photo is a capture of this consult and a
  // member of no pack, so the pack is the wrong place to ask (P7a-1).
  const shotKey = capture.shotKey
  if (!shotBelongsToConsult(pack, shotKey)) {
    throw new ConsultWriteError('CAPTURE_INVALID_SLOT', 'Invalid capture slot.')
  }
  const reasonCode = capture.qualityReasonCode
    ? [...QUALITY_REASON_CODES].find((candidate) => candidate === capture.qualityReasonCode) ?? null
    : null
  // A rejected capture is purge-marked in the same commit and its raw object
  // is purged immediately after, so purgedAt must NOT eclipse the rejection:
  // the client still needs the REJECTED state, reason code, and retake tip to
  // explain the slot. PURGED is reserved for non-rejected rows (post-analysis
  // or client-deleted captures).
  const state = capture.status === ConsultCaptureStatus.REJECTED
    ? 'REJECTED'
    : capture.purgedAt
      ? 'PURGED'
      : capture.status === ConsultCaptureStatus.ACCEPTED
        ? 'ACCEPTED'
        : 'UPLOADED'
  return {
    shotKey,
    state,
    captureId: capture.id,
    qualityReasonCode: reasonCode,
    qualityWarningCode:
      [...QUALITY_WARNING_CODES].find(
        (candidate) => candidate === capture.qualityWarningCode,
      ) ?? null,
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
  const pack = packFor(session)
  // The durable audit trail may contain arbitrarily many rejected replacements,
  // but this read is intentionally fixed at one row per pack slot.
  //
  // P7a-1: the early photo is queried alongside them and lands in its own field
  // — NOT in `slots`. It is not one of this pack's slots (it belongs to no
  // pack), and putting it there would have added a phantom "todo" to the guided
  // checklist and moved every N/M counter the client renders.
  const captures = await Promise.all(
    [...pack.shots.map((shot) => shot.key), CONSULT_EARLY_PHOTO_SHOT_KEY].map(
      (shotKey) =>
      tx.consultCapture.findFirst({
        where: { consultSessionId: session.id, shotKey },
        select: {
          id: true,
          shotKey: true,
          status: true,
          qualityReasonCode: true,
          qualityWarningCode: true,
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
      capture && packHasShot(pack, capture.shotKey)
        ? [[capture.shotKey, capture] as const]
        : [],
    ),
  )
  const earlyCapture =
    captures.find(
      (capture) => capture?.shotKey === CONSULT_EARLY_PHOTO_SHOT_KEY,
    ) ?? null
  const earlyPhoto = !earlyCapture
    ? null
    : !earlyCapture.purgedAt &&
        earlyCapture.rawExpiresAt.getTime() <= now.getTime()
      ? {
          ...stateForCapture(pack, earlyCapture),
          state: 'EXPIRED' as const,
          rawExpiresAt: null,
        }
      : stateForCapture(pack, earlyCapture)

  return {
    consultId: session.id,
    status: session.status,
    // The wire shape: the acceptance rules stay server-side.
    shotPack: {
      id: pack.id,
      categorySlug: pack.categorySlug,
      version: pack.version,
      schemaVersion: pack.schemaVersion,
      shots: pack.shots.map(
        ({ key, title, instruction, requirement, framing }) => ({
          key,
          title,
          instruction,
          requirement,
          // P3: the camera crops a TIGHT_CROP shot on device. `acceptance` and
          // `gate` stay server-side; `framing` is the one server fact the
          // client has to be told (see ConsultCaptureShotFramingDTO).
          framing,
        }),
      ),
    },
    earlyPhoto,
    chartCopy: {
      optIn: session.chartCopyOptIn,
      decidedAt: session.chartCopyDecidedAt?.toISOString() ?? null,
    },
    slots: pack.shots.map(({ key: shotKey }) => {
      const capture = latest.get(shotKey)
      if (!capture) {
        return {
          shotKey,
          state: 'EMPTY',
          captureId: null,
          qualityReasonCode: null,
          qualityWarningCode: null,
          retakeTip: null,
          rawExpiresAt: null,
          purgedAt: null,
        }
      }
      if (!capture.purgedAt && capture.rawExpiresAt.getTime() <= now.getTime()) {
        return {
          ...stateForCapture(pack, capture),
          state: 'EXPIRED',
          rawExpiresAt: null,
        }
      }
      return stateForCapture(pack, capture)
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
      const pack = packFor(session)
      const input = await args.loadInput()
      requireShotAndVersions(
        pack,
        input.shotKey,
        input.shotPackVersion,
        input.schemaVersion,
      )
      assertCaptureWriteState(session, String(input.shotKey), 'upload', now)
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
        !shotBelongsToConsult(pack, uploadSession.consultShotKey) ||
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
      const pack = packFor(session)
      const input = await args.loadInput()
      requireShotAndVersions(
        pack,
        input.shotKey,
        input.shotPackVersion,
        input.schemaVersion,
      )
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
      assertCaptureWriteState(session, input.shotKey, 'attach', now)

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
  qualityWarningCode: string | null
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
    warningCode:
      [...QUALITY_WARNING_CODES].find(
        (candidate) => candidate === capture.qualityWarningCode,
      ) ?? null,
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
    shotKey: string
    image: { base64: string; mediaType: ConsultCaptureMediaType }
    meter?: ConsultProviderMeterSink | null
  }) => Promise<ConsultCaptureQualityResult>
}): Promise<{ quality: ConsultCaptureQualityResultDTO; replayed: boolean }> {
  const now = args.now ?? new Date()
  const storage = args.storage ?? consultCaptureStorage
  const qualityCheck = args.qualityCheck ?? checkConsultCapture
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
      const pack = packFor(session)
      const input = await args.loadInput()
      const idempotencyKey = validKey(input.idempotencyKey)
      const requestHash = hash({
        captureId: args.captureId,
        shotPackVersion: input.shotPackVersion,
        schemaVersion: input.schemaVersion,
      })
      const capture = await tx.consultCapture.findFirst({
        where: { id: args.captureId, consultSessionId: session.id },
      })
      // Which shot this capture IS decides which versions are current for it
      // and whether it belongs to this consult at all — the early photo is
      // owned by no pack, so `packHasShot` is the wrong question for it.
      if (!capture || !shotBelongsToConsult(pack, capture.shotKey)) {
        throw new ConsultWriteError('NOT_FOUND', 'Capture not found.')
      }
      requireShotAndVersions(
        pack,
        capture.shotKey,
        input.shotPackVersion,
        input.schemaVersion,
      )
      // This shot's own definition — what says whether a finding may ride
      // along as a warning here (B3, and P7a-1's warning-only early photo).
      // Resolved through the REGISTRY, not the pack: the early photo is not a
      // pack member, and asking the pack would refuse to judge it at all.
      const shotForCapture = findConsultCaptureShot(capture.shotKey)
      if (!shotForCapture || !shotBelongsToConsult(pack, capture.shotKey)) {
        throw new ConsultWriteError('CAPTURE_INVALID_SLOT', 'Invalid capture slot.')
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
      assertCaptureWriteState(session, capture.shotKey, 'quality', now)
      if (
        capture.status !== ConsultCaptureStatus.ATTACHED ||
        capture.purgedAt ||
        !capture.storagePath ||
        capture.rawExpiresAt.getTime() <= now.getTime()
      ) {
        throw new ConsultWriteError('CAPTURE_UPLOAD_EXPIRED', 'Capture has expired.')
      }
      const priorQualityChecks = await tx.consultCapture.count({
        where: { consultSessionId: session.id, qualityCheckedAt: { not: null } },
      })
      if (priorQualityChecks >= maxQualityChecksFor(pack)) {
        throw new ConsultWriteError(
          'CAPTURE_QUALITY_LIMIT_EXCEEDED',
          'This consult has reached its photo-check limit.',
        )
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
        // P4b: the gate is a PAID call, billed in this request — one per
        // photo, before any analysis run exists. It carries the session and a
        // null run, which is what makes a consult's true cost the sum over
        // this table rather than just the run's three calls.
        quality = await qualityCheck({
          shotKey: capture.shotKey,
          image,
          meter: { consultSessionId: session.id, analysisRunId: null },
        })
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
        // A warning only ever rides on an ACCEPTED capture, and only where
        // THIS shot is allowed to downgrade THAT finding. On a rejection, or
        // with a code this shot may not warn on, it is inconsistent output and
        // is refused like any other — `shotMayWarn` is the same predicate the
        // gate used, so this boundary cannot drift from what produced it.
        (quality.warningCode !== null &&
          (!quality.accepted ||
            !QUALITY_WARNING_CODES.has(quality.warningCode) ||
            !shotMayWarn(shotForCapture, quality.warningCode))) ||
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
          qualityWarningCode: quality.warningCode,
          retakeTip: quality.retakeTip,
          qualitySchemaVersion: CONSULT_CAPTURE_QUALITY_SCHEMA_VERSION,
          qualityPromptVersion: consultCaptureQualityPromptVersion(
            capture.shotKey,
          ),
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
        // P7a-3: a new photo on a consult whose plan already exists asks for a
        // new plan version. Only an ACCEPTED one — a rejected shot changed
        // nothing the analysis would read, so paying for a rerun over it would
        // be spending money on a photo the client is about to retake.
        await recordLockedConsultRerunRequest(tx, {
          consultSessionId: session.id,
          actor: args.actor,
        })
        // A full pack is THIS session's pack — resolved inside the advance,
        // so the inspiration step's two callers cannot disagree with this one.
        await advanceLockedConsultToAnalysisIfReady(tx, {
          consultSessionId: session.id,
          clientId: session.clientId,
          professionalId: session.professionalId,
          actor: args.actor,
          now: finalizedAt,
        })
      }
      return {
        quality: qualityDto(updated),
        replayed: false,
        rejectedId: quality.accepted ? null : capture.id,
      }
    },
    { maxWait: 10_000, timeout: 60_000 },
  )
  // The transaction has committed, so the ConsultSession row lock is gone and
  // the meter's FK insert can finally take the FOR KEY SHARE it needs. Waiting
  // for it INSIDE the transaction above is a self-deadlock — see
  // lib/consult/providerMeter.ts.
  await flushConsultProviderMeter()
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

/**
 * Client-initiated advance to analysis with an incomplete accepted pack
 * (Tori, 2026-08-27). Auto-advance still requires all seven accepted shots;
 * this explicit action needs the finished inspiration step plus at least ONE
 * accepted, unexpired capture — the analysis prompt (full-analysis-v2) is told
 * which views are missing and must keep their observations UNKNOWN.
 */
export async function proceedConsultCaptureToAnalysis(args: {
  consultSessionId: string
  clientId: string
  actor: ClientActor
  now?: Date
}): Promise<{ capture: ConsultCaptureStateDTO; advanced: boolean }> {
  const now = args.now ?? new Date()
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
      if (session.status === ConsultSessionStatus.ANALYSIS_PENDING) {
        // Replay: an earlier proceed (or the full-pack auto-advance) already
        // moved the session forward.
        return { capture: await buildState(tx, session, now), advanced: false }
      }
      if (session.status !== ConsultSessionStatus.MEDIA_READY) {
        throw new ConsultWriteError('INVALID_STATE', 'Capture proceed is unavailable.')
      }
      try {
        await requireCompletedConsultInspiration(tx, {
          consultSessionId: session.id,
          clientId: session.clientId,
          professionalId: session.professionalId,
          now,
        })
      } catch (error) {
        if (
          error instanceof ConsultWriteError &&
          error.code === 'ANALYSIS_PREREQUISITES_REQUIRED'
        ) {
          throw new ConsultWriteError(
            'ANALYSIS_INSPIRATION_REQUIRED',
            'Finish the inspiration step before continuing to analysis.',
          )
        }
        throw error
      }
      const advanced = await advanceLockedConsultToAnalysisIfReady(
        tx,
        {
          consultSessionId: session.id,
          clientId: session.clientId,
          professionalId: session.professionalId,
          actor: args.actor,
          now,
        },
        { minimumAcceptedShots: 1 },
      )
      if (!advanced) {
        throw new ConsultWriteError(
          'ANALYSIS_CAPTURES_REQUIRED',
          'At least one accepted photo is required before analysis.',
        )
      }
      return {
        capture: await buildState(
          tx,
          { ...session, status: ConsultSessionStatus.ANALYSIS_PENDING },
          now,
        ),
        advanced: true,
      }
    },
    { maxWait: 10_000, timeout: 60_000 },
  )
}

/**
 * Records the client's chart-copy choice (decision 2026-08-26: default-on but
 * visibly optional). The choice can be changed freely until analysis runs; the
 * post-analysis copy in lib/consult/chartCopy.ts reads the committed value.
 */
export async function updateConsultChartCopyChoice(args: {
  consultSessionId: string
  clientId: string
  actor: ClientActor
  optIn: boolean
  now?: Date
}): Promise<ConsultCaptureStateDTO> {
  const now = args.now ?? new Date()
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
      assertCaptureState(session)
      await tx.consultSession.update({
        where: { id: session.id },
        data: { chartCopyOptIn: args.optIn, chartCopyDecidedAt: now },
      })
      return buildState(
        tx,
        {
          ...session,
          chartCopyOptIn: args.optIn,
          chartCopyDecidedAt: now,
        },
        now,
      )
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  )
}
