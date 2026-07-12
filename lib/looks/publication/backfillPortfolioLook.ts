// lib/looks/publication/backfillPortfolioLook.ts
//
// §19a — social-first media unification, backfill step. Today "portfolio"
// (MediaAsset.isFeaturedInPortfolio) and "looks" (LookPost) are two parallel
// public-content systems: featuring a MediaAsset to the portfolio never creates
// a LookPost, so featured work never reaches the looks feed/search/boards. The
// unified model (Tori 2026-07-08) makes `LookPost` the single public-content
// atom — "featuring to portfolio publishes a look."
//
// This processor brings *existing* featured media up to that model: for one
// featured, public MediaAsset with no LookPost yet, it marks the asset
// `isEligibleForLooks` and publishes a pro-authored `LookPost` for it (reusing
// the canonical `createOrUpdateProLookFromMediaAsset` so the backfilled look
// gets the exact same tag-sync / score / moderation-scan side effects as an
// interactive publish). Pro-authored looks default to `moderationStatus=APPROVED`
// (schema default), so there is no human gate.
//
// Idempotent + safe to re-run: an asset that already has a LookPost is skipped
// (the upsert is keyed on `primaryMediaAssetId @unique`), and every gate the
// interactive publish enforces still applies here. Assets that can't back a look
// (not public, no bookable service tag, unpromoted client-private media) are
// reported, not forced. `scripts/backfill-portfolio-looks.ts` drives it in
// id-cursor batches with a dry-run default.

import { MediaVisibility, Prisma, PrismaClient } from '@prisma/client'

import { createOrUpdateProLookFromMediaAsset } from './service'
import { resolvePortfolioLookServiceId } from './portfolioLookSync'

// §19b relocated the service-id resolver to the shared live write-path module so
// live-publish and this backfill resolve identically. Kept exported under the
// historical name for callers/tests that reference it here.
export { resolvePortfolioLookServiceId as resolveBackfillServiceId } from './portfolioLookSync'

export type BackfillPortfolioLookStatus =
  | 'CREATED'
  | 'WOULD_CREATE'
  | 'SKIPPED_NOT_FOUND'
  | 'SKIPPED_ALREADY_LOOK'
  | 'SKIPPED_NOT_FEATURED'
  | 'SKIPPED_NOT_PUBLIC'
  | 'SKIPPED_NO_SERVICE'
  | 'FAILED'

export interface BackfillPortfolioLookResult {
  status: BackfillPortfolioLookStatus
  /** The service id the look would be / was created with, when resolved. */
  serviceId?: string
  /** Error message when `status === 'FAILED'`. */
  error?: string
}

const backfillMediaSelect = Prisma.validator<Prisma.MediaAssetSelect>()({
  id: true,
  professionalId: true,
  visibility: true,
  isFeaturedInPortfolio: true,
  isEligibleForLooks: true,
  // Every media asset is anchored to a non-null primary bookable service, and
  // the upload path forces that primary into the `services` M2M — but session /
  // review media created straight through recordMediaAsset may not, so we still
  // fall back to (and validate against) the M2M tags below.
  primaryServiceId: true,
  services: { select: { serviceId: true } },
  lookPostPrimaryFor: { select: { id: true }, take: 1 },
})

/**
 * Backfills a single featured MediaAsset into a published LookPost. Reads the
 * asset, gates it against everything the interactive publish path requires, and
 * (unless `dryRun`) marks it Looks-eligible and publishes the look atomically.
 */
export async function processBackfillPortfolioLook(
  db: PrismaClient,
  args: { mediaAssetId: string; dryRun: boolean },
): Promise<BackfillPortfolioLookResult> {
  const media = await db.mediaAsset.findUnique({
    where: { id: args.mediaAssetId },
    select: backfillMediaSelect,
  })

  if (!media) return { status: 'SKIPPED_NOT_FOUND' }
  if (media.lookPostPrimaryFor.length > 0) {
    return { status: 'SKIPPED_ALREADY_LOOK' }
  }
  if (!media.isFeaturedInPortfolio) return { status: 'SKIPPED_NOT_FEATURED' }
  if (media.visibility !== MediaVisibility.PUBLIC) {
    return { status: 'SKIPPED_NOT_PUBLIC' }
  }

  const serviceId = resolvePortfolioLookServiceId(media)
  if (!serviceId) return { status: 'SKIPPED_NO_SERVICE' }

  if (args.dryRun) return { status: 'WOULD_CREATE', serviceId }

  try {
    await db.$transaction(async (tx) => {
      // Unifying step: featured public portfolio media becomes Looks-eligible,
      // which is also the gate the publish path enforces. Set it in the same
      // transaction that creates the look so the two never diverge.
      if (!media.isEligibleForLooks) {
        await tx.mediaAsset.update({
          where: { id: media.id },
          data: { isEligibleForLooks: true },
        })
      }

      await createOrUpdateProLookFromMediaAsset(tx, {
        professionalId: media.professionalId,
        request: {
          mediaAssetId: media.id,
          primaryServiceId: serviceId,
          // caption falls back to the media asset's caption inside the helper.
          publish: true,
        },
      })
    })

    return { status: 'CREATED', serviceId }
  } catch (error) {
    return {
      status: 'FAILED',
      serviceId,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}
