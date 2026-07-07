// lib/jobs/looksSocial/applyLookViews.ts
import { LookPostStatus, ModerationStatus, Prisma } from '@prisma/client'

import type { ApplyLookViewsJobPayload } from '@/lib/jobs/looksSocial/contracts'

// The narrow slice of Prisma this processor needs. The real client (and any
// transaction client) satisfies it structurally, and a test can hand-build the
// stub without a type escape.
export type LookPostViewIncrementDb = {
  lookPost: {
    updateManyAndReturn(args: {
      where: Prisma.LookPostWhereInput
      data: Prisma.LookPostUpdateManyMutationInput
      select: { id: true }
    }): Promise<{ id: string }[]>
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
 * Apply a batched set of view increments. Resolves the published, approved
 * looks in the batch, bumps their `viewCount` by one via a single atomic
 * `updateMany` (cheap, contention-light), and returns exactly those ids so the
 * caller can refresh their rank scores.
 *
 * Impressions are now the denominator of rate-based rank scoring (spec §4.1), so
 * the caller recomputes rank for the returned ids — a Look that keeps accruing
 * impressions without matching engagement must see its rate (and rank) fall
 * rather than stay frozen at its last engagement-time value.
 *
 * `updateManyAndReturn` increments and hands back exactly the rows it touched in
 * one atomic statement, so the returned ids are precisely the eligible looks —
 * unknown/deleted/ineligible ids never reach the recompute path (which reads
 * each row and would otherwise throw).
 */
export async function processApplyLookViews(
  db: LookPostViewIncrementDb,
  payload: ApplyLookViewsJobPayload,
): Promise<{ appliedCount: number; lookPostIds: string[] }> {
  const { lookPostIds } = buildApplyLookViewsUpdate(payload)

  if (lookPostIds.length === 0) {
    return { appliedCount: 0, lookPostIds: [] }
  }

  const updated = await db.lookPost.updateManyAndReturn({
    where: {
      id: { in: lookPostIds },
      status: LookPostStatus.PUBLISHED,
      moderationStatus: ModerationStatus.APPROVED,
    },
    data: {
      viewCount: { increment: 1 },
    },
    select: { id: true },
  })

  const updatedIds = updated.map((row) => row.id)

  return { appliedCount: updatedIds.length, lookPostIds: updatedIds }
}
