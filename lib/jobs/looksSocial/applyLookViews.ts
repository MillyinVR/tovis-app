// lib/jobs/looksSocial/applyLookViews.ts
import { LookPostStatus, ModerationStatus, Prisma } from '@prisma/client'

import type { ApplyLookViewsJobPayload } from '@/lib/jobs/looksSocial/contracts'

// The narrow slice of Prisma this processor needs. The real client (and any
// transaction client) satisfies it structurally, and a test can hand-build the
// stub without a type escape.
export type LookPostViewIncrementDb = {
  lookPost: {
    updateMany(args: {
      where: Prisma.LookPostWhereInput
      data: Prisma.LookPostUpdateManyMutationInput
    }): Promise<{ count: number }>
  }
}

// Hard cap on how many distinct looks a single batch can touch. The client
// flushes small windows, so this only guards against a malformed/oversized
// payload — matches the endpoint's own cap.
export const MAX_APPLY_LOOK_VIEWS_BATCH = 200

/**
 * Pure builder: normalize a view batch into the deduped, capped list of look
 * ids to increment. Each id counts once per batch (the client already dedupes
 * per session), so repeated ids collapse. Blank/invalid ids are dropped.
 */
export function buildApplyLookViewsUpdate(
  payload: ApplyLookViewsJobPayload,
): { lookPostIds: string[] } {
  const raw = Array.isArray(payload.lookPostIds) ? payload.lookPostIds : []

  const seen = new Set<string>()
  for (const value of raw) {
    if (typeof value !== 'string') continue
    const trimmed = value.trim()
    if (!trimmed) continue
    seen.add(trimmed)
    if (seen.size >= MAX_APPLY_LOOK_VIEWS_BATCH) break
  }

  return { lookPostIds: Array.from(seen) }
}

/**
 * Apply a batched set of view increments. A single atomic `updateMany` bumps
 * `viewCount` by one for every published, approved look in the list — cheap,
 * contention-light, and idempotent under job retry (the statement is
 * all-or-nothing, so a retried job re-applies the whole batch exactly once).
 *
 * Deliberately does NOT recompute spotlight/rank scores: view velocity is not a
 * ranking term yet (social-first plan B2 defers it).
 */
export async function processApplyLookViews(
  db: LookPostViewIncrementDb,
  payload: ApplyLookViewsJobPayload,
): Promise<{ appliedCount: number }> {
  const { lookPostIds } = buildApplyLookViewsUpdate(payload)

  if (lookPostIds.length === 0) {
    return { appliedCount: 0 }
  }

  const result = await db.lookPost.updateMany({
    where: {
      id: { in: lookPostIds },
      status: LookPostStatus.PUBLISHED,
      moderationStatus: ModerationStatus.APPROVED,
    },
    data: {
      viewCount: { increment: 1 },
    },
  })

  return { appliedCount: result.count }
}
