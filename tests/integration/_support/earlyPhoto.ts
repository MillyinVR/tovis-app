// tests/integration/_support/earlyPhoto.ts
//
// P7a-1. Seeds ONE accepted early photo on a consult, so a suite that is not
// about the capture ingest path can still get a consult past the early-photo
// stage — the database refuses EARLY_PHOTO_READY -> INTAKE_READY without one
// (consult_lifecycle_guard).
//
// 🔴 This writes the rows directly and that is deliberate, but it is NOT a way
// around the guards: every trigger on the path still runs, so the upload/capture
// binding, the consent prerequisite and the quality contract are all enforced
// here exactly as they are in production. What it skips is the HTTP layer and
// the storage fake, which are not what these suites are testing — the real
// mint → attach → judge route flow is covered end to end in
// consult-capture-api.test.ts.

import { randomUUID } from 'node:crypto'

import type { PrismaClient } from '@prisma/client'
import {
  ConsultActorType,
  ConsultAuditAction,
  ConsultCaptureStatus,
  UploadSessionStatus,
  UploadSurface,
} from '@prisma/client'

import {
  CONSULT_EARLY_PHOTO_PACK_VERSION,
  CONSULT_EARLY_PHOTO_SHOT_KEY,
} from '@/lib/consult/capture/earlyPhoto'
import {
  CONSULT_CAPTURE_QUALITY_SCHEMA_VERSION,
  CONSULT_EARLY_PHOTO_QUALITY_PROMPT_VERSION,
} from '@/lib/consult/captureVision'

const CAPTURE_SCHEMA_VERSION = 1
const BUCKET = 'media-private'

export async function seedAcceptedEarlyPhoto(
  db: PrismaClient,
  args: {
    consultSessionId: string
    actorUserId: string
    label: string
    /** Set to record a warning on the accepted photo (dim room, warm lamp…). */
    warningCode?: string | null
    /**
     * The suite's fake private-storage map, if it has one.
     *
     * 🔴 Pass it whenever the consult will run an ANALYSIS. The early photo is
     * an analysis input at the lowest evidence tier (P7a-1), so the runner
     * downloads and re-verifies its object like any other capture — and a
     * seeded row with no bytes behind it fails the whole run with
     * CAPTURE_OBJECT_INVALID, which reads like a broken analysis rather than a
     * missing fixture.
     */
    objects?: Map<
      string,
      { contentType: string; sizeBytes: number; checksumSha256: string | null }
    >
  },
): Promise<string> {
  // 🔴 The scope is READ OFF THE SESSION, never passed in. `consult_upload_
  // session_guard` requires the upload's client, professional, booking and
  // category to match the session's EXACTLY, so a caller that hands over the
  // wrong `clientId` — easy in a suite with several clients, and it happened —
  // gets an opaque 23514 about "exact eligible scope" instead of a seeded
  // photo. There is one right answer and the session already holds it.
  const session = await db.consultSession.findUniqueOrThrow({
    where: { id: args.consultSessionId },
    select: {
      clientId: true,
      professionalId: true,
      bookingId: true,
      serviceCategoryId: true,
    },
  })
  const now = new Date()
  const rawExpiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000)
  // The shape CHECK pins this to `consult-raw/v1/<uuid>.<ext>`, so it is a real
  // UUID and not the label — the label is not URL-shaped and the constraint is
  // what stops a client-supplied path ever reaching storage.
  const storagePath = `consult-raw/v1/${randomUUID()}.jpg`
  const hash = (seed: string) =>
    seed.padEnd(64, '0').slice(0, 64).replace(/[^0-9a-f]/g, 'a')

  // 🔴 One transaction, and it has to be. `consult_capture_guard` requires the
  // upload to still be PENDING when the capture row is INSERTed, while
  // `consult_capture_requires_consumed_upload` is a DEFERRED constraint trigger
  // that requires it to be CONSUMED at COMMIT. Both are satisfied only if the
  // insert and the consume land in the same transaction — which is exactly what
  // the real attach route does.
  const captureId = await db.$transaction(async (tx) => {
    const upload = await tx.uploadSession.create({
      data: {
        surface: UploadSurface.CLIENT_CONSULT,
        status: UploadSessionStatus.PENDING,
        clientId: session.clientId,
        professionalId: session.professionalId,
        bookingId: session.bookingId,
        serviceCategoryId: session.serviceCategoryId,
        consultSessionId: args.consultSessionId,
        consultShotKey: CONSULT_EARLY_PHOTO_SHOT_KEY,
        shotPackVersion: CONSULT_EARLY_PHOTO_PACK_VERSION,
        captureSchemaVersion: CAPTURE_SCHEMA_VERSION,
        idempotencyKey: `early-upload-${args.label}`,
        requestHash: hash(`req${args.label}`),
        contentType: 'image/jpeg',
        maxBytes: 100,
        checksumSha256: null,
        storageBucket: BUCKET,
        storagePath,
        expiresAt: new Date(now.getTime() + 60 * 60 * 1000),
        rawExpiresAt,
      },
      select: { id: true },
    })

    const capture = await tx.consultCapture.create({
      data: {
        consultSessionId: args.consultSessionId,
        uploadSessionId: upload.id,
        shotKey: CONSULT_EARLY_PHOTO_SHOT_KEY,
        shotPackVersion: CONSULT_EARLY_PHOTO_PACK_VERSION,
        schemaVersion: CAPTURE_SCHEMA_VERSION,
        storageBucket: BUCKET,
        storagePath,
        contentType: 'image/jpeg',
        sizeBytes: 100,
        checksumSha256: null,
        attachIdempotencyKey: `early-attach-${args.label}`,
        attachRequestHash: hash(`att${args.label}`),
        rawExpiresAt,
      },
      select: { id: true },
    })

    await tx.uploadSession.update({
      where: { id: upload.id },
      data: { status: UploadSessionStatus.CONSUMED, consumedAt: now },
    })

    await tx.consultCapture.update({
      where: { id: capture.id },
      data: {
        status: ConsultCaptureStatus.ACCEPTED,
        qualityReasonCode: 'PASS',
        qualityWarningCode: args.warningCode ?? null,
        retakeTip: null,
        qualitySchemaVersion: CONSULT_CAPTURE_QUALITY_SCHEMA_VERSION,
        qualityPromptVersion: CONSULT_EARLY_PHOTO_QUALITY_PROMPT_VERSION,
        qualityModel: 'fake-quality-model',
        qualityCheckedAt: now,
        qualityIdempotencyKey: `early-quality-${args.label}`,
        qualityRequestHash: hash(`qua${args.label}`),
      },
    })

    return capture.id
  })

  args.objects?.set(storagePath, {
    contentType: 'image/jpeg',
    sizeBytes: 100,
    checksumSha256: null,
  })

  await db.consultAuditEvent.create({
    data: {
      consultSessionId: args.consultSessionId,
      action: ConsultAuditAction.CAPTURE_QUALITY_CHECKED,
      actorType: ConsultActorType.CLIENT,
      actorId: args.actorUserId,
      captureId,
    },
  })

  return captureId
}

/**
 * Marks every seeded capture and consult upload on a session purged, so a
 * suite's teardown can delete the session.
 *
 * `consult_session_delete_requires_purge` refuses to drop a session that still
 * has unpurged raw objects — which is the right rule, and it is why a suite
 * that seeds a photo has to clean it up rather than the teardown quietly
 * growing a cascade. Mirrors the purged shape the shape CHECKs require:
 * bucket 'purged', path 'purged/<id>'.
 */
export async function purgeSeededConsultObjects(
  db: PrismaClient,
  consultSessionId: string,
): Promise<void> {
  const now = new Date()
  const captures = await db.consultCapture.findMany({
    where: { consultSessionId, purgedAt: null },
    select: { id: true },
  })
  for (const { id } of captures) {
    await db.consultCapture.update({
      where: { id },
      data: {
        purgeEligibleAt: now,
        purgeRequestedAt: now,
        purgedAt: now,
        storageBucket: null,
        storagePath: null,
      },
    })
  }
  const uploads = await db.uploadSession.findMany({
    where: {
      surface: UploadSurface.CLIENT_CONSULT,
      consultSessionId,
      purgedAt: null,
    },
    select: { id: true },
  })
  for (const { id } of uploads) {
    await db.uploadSession.update({
      where: { id },
      data: {
        purgeEligibleAt: now,
        purgedAt: now,
        storageBucket: 'purged',
        storagePath: `purged/${id}`,
      },
    })
  }
}
