// lib/idempotency/retention.ts
//
// Bounded retention for the idempotency ledger.
//
// WHY THIS EXISTS: `IdempotencyKey` stores `responseBodyJson` — a verbatim copy
// of the API response the original request produced — so a replay can return
// the identical body. Those bodies routinely contain client and pro identity
// fields. Until 2026-08-21 the model had no expiry column and NOTHING anywhere
// deleted a row, so every idempotent write added a permanent record. The
// deletion boundary's own justification for retaining them said they "expire on
// their own"; they did not.
//
// The account-deletion path clears the body for a deleted user
// (`lib/privacy/deleteRules.ts`). This is the other half: rows for users who are
// still here also stop accumulating forever.
import { prisma } from '@/lib/prisma'

/**
 * How long a completed ledger row stays replayable.
 *
 * The lock window is two minutes (`LOCK_MINUTES` in `idempotencyLedger.ts`) and
 * clients mint a key per attempt, so a genuine retry lands in seconds. Seven
 * days is far beyond any real retry while still bounding how long a stored
 * response body lives. Deleting a row a client would still have replayed is the
 * one way this can do harm — it would re-execute the write — so the number is
 * deliberately generous rather than tight.
 */
export const IDEMPOTENCY_RETENTION_DAYS = 7

/**
 * Delete ledger rows whose replay window has passed.
 *
 * Keyed on `createdAt`, not `completedAt`: a row that never completed (STARTED
 * whose handler died, or FAILED) has a null `completedAt` and would otherwise be
 * immortal — which is exactly the class of row that accumulates.
 */
export async function purgeExpiredIdempotencyKeys(
  args: { now?: Date; retentionDays?: number } = {},
): Promise<{ deleted: number; cutoff: Date }> {
  const now = args.now ?? new Date()
  const retentionDays = args.retentionDays ?? IDEMPOTENCY_RETENTION_DAYS

  const cutoff = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000)

  const { count } = await prisma.idempotencyKey.deleteMany({
    where: { createdAt: { lt: cutoff } },
  })

  return { deleted: count, cutoff }
}
