// lib/looks/hides.ts
//
// Shared read-path helpers for the per-viewer "not for me" hide (spec §2.2).
// A hide is an explicit, reversible negative signal (see the POST/DELETE
// /api/v1/looks/[id]/hide route + the LookHide model). Two things consume it:
//
//   1. HARD EXCLUSION — a hidden look never appears in that viewer's feeds
//      (personalized, chronological, board). This module's `loadHiddenLookIds`
//      is the id list the feed queries exclude. Item-level hides are treated as
//      durable: you dismissed THIS card, you don't want it back. (Guardrail #10's
//      "every suppression decays" governs the softer CATEGORY signal below, not
//      the removal of a card the viewer explicitly dismissed.)
//   2. CATEGORY SUPPRESSION — after repeated hides in a category, that category
//      is DOWN-RANKED (never hard-filtered) by a decayed penalty. The decayed
//      aggregation lives in lib/looks/personalizedFeed.ts (it shares the affinity
//      decay math); this module only exposes the row select it reads.
//
// Keeping this module free of personalizedFeed imports avoids a cycle
// (personalizedFeed → hides is the only direction).

import type { Prisma } from '@prisma/client'

// Upper bound on the hidden-id exclusion list a single viewer contributes to a
// feed query, so a prolific hider can't blow up the `notIn` clause. Most recent
// hides win; beyond this the category-suppression signal carries the pattern.
export const HIDDEN_LOOK_IDS_CAP = 500

/** Minimal db surface: just the model methods this module calls. */
type HidesReaderDb = {
  lookHide: {
    findMany: (args: {
      where: { userId: string }
      orderBy: { createdAt: 'desc' }
      take: number
      select: { lookPostId: true }
    }) => Promise<Array<{ lookPostId: string }>>
  }
}

/**
 * The freshest hidden look ids for a viewer, capped, for feed exclusion. Empty
 * for a signed-out viewer (no userId) — callers should skip the query then.
 */
export async function loadHiddenLookIds(
  db: HidesReaderDb,
  args: { userId: string },
): Promise<string[]> {
  const rows = await db.lookHide.findMany({
    where: { userId: args.userId },
    orderBy: { createdAt: 'desc' },
    take: HIDDEN_LOOK_IDS_CAP,
    select: { lookPostId: true },
  })
  return rows.map((row) => row.lookPostId)
}

/**
 * Row select for the category-suppression aggregation (spec §2.2): the hidden
 * look's id, when it was hidden (the decay input), and its service category.
 * Consumed by lib/looks/personalizedFeed.ts. `satisfies` keeps it a valid
 * LookHideSelect without widening the inferred field types.
 */
export const hideCategorySelect = {
  lookPostId: true,
  createdAt: true,
  lookPost: {
    select: {
      service: {
        select: {
          category: {
            select: { slug: true },
          },
        },
      },
    },
  },
} satisfies Prisma.LookHideSelect
