import 'server-only'

import {
  BookingStatus,
  ConsultInspirationSource,
  ConsultSessionStatus,
} from '@prisma/client'

import { prisma } from '@/lib/prisma'

import { purgeConsultInspirationObject } from './inspirationContract'
import { consultInspirationStorage, type ConsultInspirationStorage } from './inspirationStorage'

export type ConsultInspirationPurgeResult = {
  considered: number
  purged: number
  failed: number
}

async function purgeIds(
  ids: readonly string[],
  now: Date,
  storage: ConsultInspirationStorage,
): Promise<ConsultInspirationPurgeResult> {
  let purged = 0
  let failed = 0
  for (const id of ids) {
    try {
      if (await purgeConsultInspirationObject(id, now, storage)) purged += 1
    } catch (error) {
      failed += 1
      console.error('consult-inspiration-purge failed', {
        recordId: id,
        name: error instanceof Error ? error.name : 'UnknownError',
      })
    }
  }
  return { considered: ids.length, purged, failed }
}

export async function runConsultInspirationPurgeSweep(
  now = new Date(),
  storage: ConsultInspirationStorage = consultInspirationStorage,
): Promise<ConsultInspirationPurgeResult> {
  await prisma.consultInspiration.updateMany({
    where: {
      source: ConsultInspirationSource.EXTERNAL_UPLOAD,
      purgedAt: null,
      OR: [
        { uploadExpiresAt: { lte: now }, status: { not: 'ATTACHED' } },
        { useExpiresAt: { lte: now } },
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
        {
          consultSession: {
            booking: {
              status: {
                notIn: [BookingStatus.PENDING, BookingStatus.ACCEPTED],
              },
            },
          },
        },
      ],
    },
    data: { purgeEligibleAt: now, purgeRequestedAt: now },
  })
  const rows = await prisma.consultInspiration.findMany({
    where: {
      source: ConsultInspirationSource.EXTERNAL_UPLOAD,
      purgedAt: null,
      purgeEligibleAt: { lte: now },
    },
    select: { id: true },
    take: 100,
  })
  return purgeIds(rows.map(({ id }) => id), now, storage)
}

export async function purgeConsultSessionInspirationObjects(
  consultSessionId: string,
  now = new Date(),
  storage: ConsultInspirationStorage = consultInspirationStorage,
): Promise<ConsultInspirationPurgeResult> {
  await prisma.consultInspiration.updateMany({
    where: {
      consultSessionId,
      source: ConsultInspirationSource.EXTERNAL_UPLOAD,
      purgedAt: null,
    },
    data: { purgeEligibleAt: now, purgeRequestedAt: now },
  })
  const rows = await prisma.consultInspiration.findMany({
    where: {
      consultSessionId,
      source: ConsultInspirationSource.EXTERNAL_UPLOAD,
      purgedAt: null,
    },
    select: { id: true },
  })
  return purgeIds(rows.map(({ id }) => id), now, storage)
}
