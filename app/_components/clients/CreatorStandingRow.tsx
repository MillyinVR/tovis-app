import { ClientCreatorTier } from '@prisma/client'

import { COPY } from '@/lib/copy'
import { cn } from '@/lib/utils'

/**
 * The shape the standing row renders.
 *
 * Structurally identical to `CreatorStandingValue` in
 * `lib/clients/creatorStanding.ts`, and deliberately NOT imported from it: that
 * module calls `Prisma.validator` to declare its select, so importing it here
 * would pull the Prisma runtime into the client bundle. A type re-stated to
 * keep a server dependency out of a `'use client'` file is not a duplicate
 * helper — and TypeScript still fails the build if the two shapes diverge,
 * because the loaders' values are assigned straight into this prop.
 */
export type CreatorStanding = {
  tier: ClientCreatorTier
  /** "top 5%" — null while the creator is unranked. */
  topPercent: number | null
  /** The creator's opt-in public city. Null until they set one. */
  city: string | null
}

/**
 * "✦ TASTEMAKER · top 5% saver · Brooklyn" — a creator's standing.
 *
 * Extracted from `PublicProfileView` so the OWNER's `/client/me` header and the
 * VISITOR's `/u/[handle]` header render one identical thing (house rule: no
 * duplicate logic). Before this, the owner's own page showed neither their tier
 * nor their city while a stranger visiting their profile saw both — Tori's
 * first note on screen 7.
 *
 * Renders NOTHING below Rising. An unranked creator has no standing to state,
 * and a placeholder pill would be a flattering claim about a creator the tier
 * job has deliberately declined to rank (see `lib/clients/creatorTier.ts` and
 * its population floors).
 */
export default function CreatorStandingRow({
  standing,
  className,
}: {
  standing: CreatorStanding
  className?: string
}) {
  const isTastemaker = standing.tier === ClientCreatorTier.TASTEMAKER
  const isRising = standing.tier === ClientCreatorTier.RISING
  if (!isTastemaker && !isRising) return null

  // "top 5% saver · Brooklyn" — each half only appears when it's real. An
  // unranked creator has no percent, and the city is opt-in, so neither is
  // padded with a placeholder.
  const detail = [
    standing.topPercent !== null
      ? `${COPY.publicProfile.topPercentPrefix} ${standing.topPercent}${COPY.publicProfile.topPercentSuffix}`
      : null,
    standing.city,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <div className={cn('flex flex-wrap items-center gap-2.5', className)}>
      <span className="inline-flex items-center gap-1.5 rounded-full border border-toneWarn px-2.5 py-[3px] text-[10px] font-bold uppercase tracking-[0.1em] text-toneWarn">
        <span aria-hidden="true">✦</span>
        {isTastemaker
          ? COPY.publicProfile.tierTastemaker
          : COPY.publicProfile.tierRising}
      </span>
      {detail ? (
        <span className="text-[12.5px] text-textSecondary">{detail}</span>
      ) : null}
    </div>
  )
}
