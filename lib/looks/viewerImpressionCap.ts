// lib/looks/viewerImpressionCap.ts
//
// Read-path helper for the per-viewer impression cap (spec §4.6 "impression
// capping"). The session `seen` list dedupes WITHIN a browsing session but is
// client-supplied and resets every session, so nothing stops the personalized
// feed from re-surfacing the same look session after session. The cap closes
// that gap: the APPLY_LOOK_VIEWS job persists a per-(viewer, look) FEED-exposure
// counter (LookViewerImpressionStat), and once a viewer has seen a look enough
// times it is hard-excluded from their personalized feed.
//
//   - Only FEED exposures count (a DETAIL open is explicit navigation), and the
//     cap only governs the FEED — a capped look can still be opened directly.
//   - The exclusion is durable (no time decay): a look seen past the cap
//     "reappears only via a state change or explicit nav" (spec §4.6). The
//     badge-state-change nuance ("a couple more if the badge meaningfully
//     changed") is a deferred refinement — v1 is a flat cap.
//
// Keeping this module free of personalizedFeed imports avoids a cycle
// (personalizedFeed → viewerImpressionCap is the only direction), mirroring
// lib/looks/hides.ts.

// How many FEED exposures a viewer may have of a look before it is capped out of
// their personalized feed. The client dedupes impressions per session, so a
// count increments ≈ once per browsing session the look was on-screen — spec
// §4.6's "~3–4 unbadged exposures."
export const IMPRESSION_CAP_EXPOSURES = 4

// Upper bound on the capped-id exclusion list a single viewer contributes to a
// feed query, so a heavy viewer can't blow up the `notIn` clause. Most recently
// seen capped looks win (they are the ones most likely to re-surface); mirrors
// HIDDEN_LOOK_IDS_CAP.
export const CAPPED_LOOK_IDS_CAP = 500

/** Minimal db surface: just the model method this module calls. */
type ViewerImpressionCapReaderDb = {
  lookViewerImpressionStat: {
    findMany: (args: {
      where: { userId: string; count: { gte: number } }
      orderBy: { lastSeenAt: 'desc' }
      take: number
      select: { lookPostId: true }
    }) => Promise<Array<{ lookPostId: string }>>
  }
}

/**
 * The look ids a viewer has seen at/above the cap, capped for feed exclusion.
 * Empty for a viewer with no exposure history (byte-identical to the pre-cap
 * feed). Callers fold these into the personalized feed's hard-exclusion set.
 */
export async function loadCappedLookIds(
  db: ViewerImpressionCapReaderDb,
  args: { userId: string; cap?: number },
): Promise<string[]> {
  const cap = args.cap ?? IMPRESSION_CAP_EXPOSURES
  const rows = await db.lookViewerImpressionStat.findMany({
    where: { userId: args.userId, count: { gte: cap } },
    orderBy: { lastSeenAt: 'desc' },
    take: CAPPED_LOOK_IDS_CAP,
    select: { lookPostId: true },
  })
  return rows.map((row) => row.lookPostId)
}
