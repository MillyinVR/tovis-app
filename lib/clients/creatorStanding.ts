// lib/clients/creatorStanding.ts
//
// The one place a `ClientProfile` row becomes a creator STANDING — the
// "✦ Tastemaker · top 5% saver · Brooklyn" line.
//
// Two surfaces render it: the public profile a visitor sees (`/u/[handle]`) and
// the owner's own dashboard (`/client/me`). Before screen 7 only the visitor's
// did, so a creator could not see their own standing on their own page. Now
// that both read it, the select and the null-handling live here rather than
// being typed out twice — the tier's absence, the unranked percentile and the
// opt-in city each have a specific correct rendering, and two copies of that
// reasoning is two chances to get one of them wrong.
import { ClientCreatorTier, Prisma } from '@prisma/client'

import { topPercentFromPercentile } from '@/lib/clients/creatorTier'

/**
 * The `ClientProfile` columns a standing derives from. Spread into any
 * surface's select so the two readers cannot diverge on their inputs.
 *
 * `creatorStat` is a relation and is ABSENT until the hourly job has scored the
 * client (`lib/clients/creatorTier.ts`); absence is not an error, it renders as
 * no badge.
 */
export const CREATOR_STANDING_SELECT =
  Prisma.validator<Prisma.ClientProfileSelect>()({
    publicCity: true,
    creatorStat: {
      select: { tier: true, savePercentile: true },
    },
  })

export type CreatorStandingRow = Prisma.ClientProfileGetPayload<{
  select: typeof CREATOR_STANDING_SELECT
}>

export type CreatorStandingValue = {
  tier: ClientCreatorTier
  /** e.g. 5 for "top 5% saver". Null when the creator is unranked. */
  topPercent: number | null
  /** The creator's own opted-in public city. Null until they set one. */
  city: string | null
}

/**
 * Build the standing for a client profile row.
 *
 * An unscored client (no `creatorStat` row) is `NONE` with no percentile, which
 * the row component renders as nothing at all — the honest state for a creator
 * the tier job has declined to rank, rather than a bottom-of-the-table badge.
 */
export function buildCreatorStanding(
  row: CreatorStandingRow,
): CreatorStandingValue {
  const stat = row.creatorStat

  return {
    tier: stat?.tier ?? ClientCreatorTier.NONE,
    topPercent: topPercentFromPercentile(stat?.savePercentile ?? null),
    city: row.publicCity ?? null,
  }
}
