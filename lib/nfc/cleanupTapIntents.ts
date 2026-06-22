// lib/nfc/cleanupTapIntents.ts
//
// Reaps expired TapIntents. Every NFC tap mints a short-lived (30-minute)
// TapIntent; once expired it is dead weight (consumeTapIntent already ignores
// expired rows). Without a sweep the table grows unbounded. A daily cron calls
// this — see app/api/internal/jobs/nfc/tap-intent-cleanup/route.ts.

import { Prisma } from '@prisma/client'

type TapIntentDb = Pick<Prisma.TransactionClient, 'tapIntent'>

/**
 * Delete TapIntents whose `expiresAt` is at or before `now`. Returns the number
 * of rows removed.
 */
export async function pruneExpiredTapIntents(
  db: TapIntentDb,
  now: Date,
): Promise<number> {
  const { count } = await db.tapIntent.deleteMany({
    where: {
      expiresAt: { lte: now },
    },
  })
  return count
}
