import 'server-only'

import {
  BookingStatus,
  ConsultActorType,
  ConsultAuditAction,
  ConsultSessionStatus,
  Prisma,
  UploadSessionStatus,
  UploadSurface,
} from '@prisma/client'

import { prisma } from '@/lib/prisma'
import { safeError } from '@/lib/security/logging'

import {
  consultCaptureStorage,
  type ConsultCaptureStorage,
} from './captureStorage'

import type { PrismaClient } from '@prisma/client'

const SYSTEM_ACTOR = {
  type: ConsultActorType.SYSTEM,
  id: null,
} as const

async function lockCapture(
  tx: Prisma.TransactionClient,
  captureId: string,
): Promise<void> {
  await tx.$queryRaw(Prisma.sql`
    SELECT "id" FROM "ConsultCapture" WHERE "id" = ${captureId} FOR UPDATE
  `)
}

export async function purgeConsultCaptureRawObject(
  captureId: string,
  now = new Date(),
  storage: ConsultCaptureStorage = consultCaptureStorage,
): Promise<boolean> {
  const candidate = await prisma.consultCapture.findUnique({
    where: { id: captureId },
    select: {
      id: true,
      consultSessionId: true,
      uploadSessionId: true,
      storageBucket: true,
      storagePath: true,
      purgedAt: true,
    },
  })
  if (!candidate || candidate.purgedAt) return false
  if (!candidate.storagePath || !candidate.storageBucket) {
    throw new Error('Unpurged consult capture is missing its storage pointer.')
  }

  await storage.assertReady()
  await storage.purgeObject(candidate.storagePath)

  return prisma.$transaction(async (tx) => {
    await lockCapture(tx, candidate.id)
    const current = await tx.consultCapture.findUnique({
      where: { id: candidate.id },
      select: { storagePath: true, storageBucket: true, purgedAt: true },
    })
    if (!current || current.purgedAt) return false
    if (
      current.storagePath !== candidate.storagePath ||
      current.storageBucket !== candidate.storageBucket
    ) {
      throw new Error('Consult capture storage binding changed during purge.')
    }

    await tx.consultCapture.update({
      where: { id: candidate.id },
      data: {
        storageBucket: null,
        storagePath: null,
        purgedAt: now,
        purgeEligibleAt: now,
        purgeRequestedAt: now,
      },
    })
    await tx.uploadSession.updateMany({
      where: {
        id: candidate.uploadSessionId,
        surface: UploadSurface.CLIENT_CONSULT,
        purgedAt: null,
      },
      data: {
        storageBucket: 'purged',
        storagePath: `purged/${candidate.uploadSessionId}`,
        purgedAt: now,
        purgeEligibleAt: now,
      },
    })
    await tx.consultAuditEvent.create({
      data: {
        consultSessionId: candidate.consultSessionId,
        action: ConsultAuditAction.RAW_OBJECT_PURGED,
        actorType: SYSTEM_ACTOR.type,
        actorId: SYSTEM_ACTOR.id,
        captureId: candidate.id,
      },
    })
    return true
  })
}

export async function purgeConsultUploadSessionRawObject(
  uploadSessionId: string,
  now = new Date(),
  storage: ConsultCaptureStorage = consultCaptureStorage,
): Promise<boolean> {
  const candidate = await prisma.uploadSession.findFirst({
    where: {
      id: uploadSessionId,
      surface: UploadSurface.CLIENT_CONSULT,
      purgedAt: null,
    },
    select: {
      id: true,
      consultSessionId: true,
      storagePath: true,
      status: true,
    },
  })
  if (!candidate) return false

  await storage.assertReady()
  await storage.purgeObject(candidate.storagePath)

  return prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT "id" FROM "UploadSession"
      WHERE "id" = ${candidate.id} AND "surface" = 'CLIENT_CONSULT'
      FOR UPDATE
    `)
    if (locked.length === 0) return false
    const current = await tx.uploadSession.findUnique({
      where: { id: candidate.id },
      select: { storagePath: true, purgedAt: true, status: true },
    })
    if (!current || current.purgedAt) return false
    if (current.storagePath !== candidate.storagePath) {
      throw new Error('Consult upload storage binding changed during purge.')
    }

    await tx.uploadSession.update({
      where: { id: candidate.id },
      data: {
        storageBucket: 'purged',
        storagePath: `purged/${candidate.id}`,
        purgedAt: now,
        purgeEligibleAt: now,
        ...(current.status === UploadSessionStatus.PENDING
          ? { status: UploadSessionStatus.EXPIRED }
          : {}),
      },
    })
    if (candidate.consultSessionId) {
      await tx.consultAuditEvent.create({
        data: {
          consultSessionId: candidate.consultSessionId,
          action: ConsultAuditAction.RAW_OBJECT_PURGED,
          actorType: SYSTEM_ACTOR.type,
          actorId: SYSTEM_ACTOR.id,
        },
      })
    }
    return true
  })
}

export type ConsultCapturePurgeSweepResult = {
  considered: number
  purged: number
  failed: number
}

async function tryPurge(
  id: string,
  kind: 'capture' | 'upload',
  now: Date,
  storage: ConsultCaptureStorage,
): Promise<{ ok: boolean; changed: boolean }> {
  try {
    const changed = kind === 'capture'
      ? await purgeConsultCaptureRawObject(id, now, storage)
      : await purgeConsultUploadSessionRawObject(id, now, storage)
    // A concurrent purge that won the row lock is an idempotent success, not a
    // provider failure. Only a thrown verification/storage error is failed.
    return { ok: true, changed }
  } catch (error) {
    console.error('consult-capture-purge failed', {
      kind,
      recordId: id,
      error: safeError(error),
    })
    return { ok: false, changed: false }
  }
}

export async function runConsultCapturePurgeSweep(
  now = new Date(),
  storage: ConsultCaptureStorage = consultCaptureStorage,
): Promise<ConsultCapturePurgeSweepResult> {
  // First make booking cancellation/expiry visible as an explicit purge due
  // time. Revocation and consult cancellation are stamped by the DB trigger.
  await prisma.consultCapture.updateMany({
    where: {
      purgedAt: null,
      OR: [
        { rawExpiresAt: { lte: now } },
        {
          consultSession: {
            booking: {
              OR: [
                { status: { notIn: [BookingStatus.PENDING, BookingStatus.ACCEPTED] } },
                { scheduledFor: { lte: now } },
              ],
            },
          },
        },
      ],
    },
    data: { purgeEligibleAt: now, purgeRequestedAt: now },
  })

  const [captures, uploads] = await Promise.all([
    prisma.consultCapture.findMany({
      where: {
        purgedAt: null,
        OR: [
          { purgeEligibleAt: { lte: now } },
          { rawExpiresAt: { lte: now } },
          {
            consultSession: {
              status: {
                in: [
                  ConsultSessionStatus.CONSENT_REVOKED,
                  ConsultSessionStatus.CANCELLED,
                ],
              },
            },
          },
        ],
      },
      select: { id: true },
      take: 100,
    }),
    prisma.uploadSession.findMany({
      where: {
        surface: UploadSurface.CLIENT_CONSULT,
        status: { not: UploadSessionStatus.CONSUMED },
        purgedAt: null,
        OR: [
          { expiresAt: { lte: now } },
          { purgeEligibleAt: { lte: now } },
          { rawExpiresAt: { lte: now } },
          {
            consultSession: {
              OR: [
                {
                  status: {
                    in: [
                      ConsultSessionStatus.CONSENT_REVOKED,
                      ConsultSessionStatus.CANCELLED,
                    ],
                  },
                },
                {
                  booking: {
                    OR: [
                      {
                        status: {
                          notIn: [BookingStatus.PENDING, BookingStatus.ACCEPTED],
                        },
                      },
                      { scheduledFor: { lte: now } },
                    ],
                  },
                },
              ],
            },
          },
        ],
      },
      select: { id: true },
      take: 100,
    }),
  ])

  let purged = 0
  let failed = 0
  for (const capture of captures) {
    const result = await tryPurge(capture.id, 'capture', now, storage)
    if (!result.ok) failed += 1
    else if (result.changed) purged += 1
  }
  for (const upload of uploads) {
    const result = await tryPurge(upload.id, 'upload', now, storage)
    if (!result.ok) failed += 1
    else if (result.changed) purged += 1
  }
  return { considered: captures.length + uploads.length, purged, failed }
}

export async function purgeConsultSessionRawObjects(
  consultSessionId: string,
  now = new Date(),
  storage: ConsultCaptureStorage = consultCaptureStorage,
): Promise<ConsultCapturePurgeSweepResult> {
  await prisma.$transaction([
    prisma.consultCapture.updateMany({
      where: { consultSessionId, purgedAt: null },
      data: { purgeEligibleAt: now, purgeRequestedAt: now },
    }),
    prisma.uploadSession.updateMany({
      where: {
        consultSessionId,
        surface: UploadSurface.CLIENT_CONSULT,
        purgedAt: null,
      },
      data: { purgeEligibleAt: now },
    }),
  ])
  const [captures, uploads] = await Promise.all([
    prisma.consultCapture.findMany({
      where: { consultSessionId, purgedAt: null },
      select: { id: true },
    }),
    prisma.uploadSession.findMany({
      where: {
        consultSessionId,
        surface: UploadSurface.CLIENT_CONSULT,
        status: { not: UploadSessionStatus.CONSUMED },
        purgedAt: null,
      },
      select: { id: true },
    }),
  ])
  let purged = 0
  let failed = 0
  for (const capture of captures) {
    const result = await tryPurge(capture.id, 'capture', now, storage)
    if (!result.ok) failed += 1
    else if (result.changed) purged += 1
  }
  for (const upload of uploads) {
    const result = await tryPurge(upload.id, 'upload', now, storage)
    if (!result.ok) failed += 1
    else if (result.changed) purged += 1
  }
  return { considered: captures.length + uploads.length, purged, failed }
}

/** Account-deletion preflight. Raw objects are provider state and must be
 * removed before the database transaction cascades their pointer rows. */
export async function purgeUserConsultRawObjects(args: {
  db: PrismaClient
  userId: string
  now?: Date
  storage?: ConsultCaptureStorage
}): Promise<void> {
  const profile = await args.db.clientProfile.findUnique({
    where: { userId: args.userId },
    select: {
      consultSessions: { select: { id: true } },
    },
  })
  if (!profile) return
  for (const session of profile.consultSessions) {
    const result = await purgeConsultSessionRawObjects(
      session.id,
      args.now ?? new Date(),
      args.storage ?? consultCaptureStorage,
    )
    if (result.failed > 0) {
      throw new Error('Raw consult object purge did not complete.')
    }
  }
}
