// lib/looks/publication/portfolioLookSync.ts
//
// §19b — social-first media unification, live write-path. `LookPost` is the
// single public-content atom (Tori 2026-07-08): featuring a MediaAsset to the
// portfolio *publishes a look*, and un-featuring *retracts* it. Historically the
// two bridges were dead — featuring only flipped `MediaAsset.isFeaturedInPortfolio`
// and never created a LookPost (so featured work never reached the feed/search/
// boards), and flipping `isEligibleForLooks` off never retracted an already-
// published look (divergence b).
//
// This module is the media-side reconciler: after a media write route has set an
// asset's portfolio/looks flags, it looks at the asset's resulting public state
// and drives the canonical publication service accordingly —
// `createOrUpdateProLookFromMediaAsset(publish)` when the asset should be public,
// or `updateProLookPublication(unpublish)` when it should not. The reverse
// direction (a published look implies a grid-visible featured asset) is owned by
// the publication service's flag mirror, so the two flags + the LookPost can
// never diverge again regardless of which side the write came from.
//
// The §19a backfill applies the same transform to *existing* featured media; the
// service-id resolver is shared with it (`resolvePortfolioLookServiceId`). The
// read path (profile grid) still reads `isFeaturedInPortfolio` and is untouched
// here — the grid→LookPost read swap is §19c (gated on §18b).

import { LookPostStatus, MediaVisibility, Prisma } from '@prisma/client'

import { isUnpromotedPrivateMedia } from '@/lib/media/publicShareGuard'
import { normalizeRequiredId } from '@/lib/guards'
import {
  createOrUpdateProLookFromMediaAsset,
  updateProLookPublication,
  withPublicationTx,
  type LookPublicationDb,
} from './service'

const reconcileMediaSelect = Prisma.validator<Prisma.MediaAssetSelect>()({
  id: true,
  professionalId: true,
  visibility: true,
  isFeaturedInPortfolio: true,
  isEligibleForLooks: true,
  reviewId: true,
  storageBucket: true,
  // Every asset anchors to a primary bookable service, but session/review media
  // created straight through recordMediaAsset may not carry it in the `services`
  // M2M the publication helper validates against — so fall back to the M2M tags.
  primaryServiceId: true,
  services: { select: { serviceId: true } },
  // B3b: the booking's client media-use consent also authorises public sharing.
  booking: { select: { mediaUseConsentAt: true } },
  // The single LookPost for this asset (primaryMediaAssetId is @unique).
  lookPostPrimaryFor: {
    select: { id: true, status: true, clientAuthorId: true },
    take: 1,
  },
})

type ReconcileMediaRow = Prisma.MediaAssetGetPayload<{
  select: typeof reconcileMediaSelect
}>

export type ReconcilePortfolioLookArgs = {
  professionalId: string
  mediaAssetId: string
}

export type ReconcilePortfolioLookOutcome =
  | 'PUBLISHED'
  | 'RETRACTED'
  | 'SKIPPED_NOT_FOUND'
  | 'SKIPPED_NOT_OWNED'
  | 'SKIPPED_CLIENT_LOOK'
  | 'SKIPPED_NOT_BACKABLE'
  | 'NOOP'

/**
 * Picks the service id the look will be anchored to. It must be one of the
 * asset's `services` M2M tags (what the publication helper validates against),
 * so prefer the canonical `primaryServiceId` when it is tagged, otherwise fall
 * back to the first tag. Returns `null` when the asset carries no bookable
 * service tag at all — such media can't back a look. Shared with the §19a
 * backfill so live-publish and backfill resolve identically.
 */
export function resolvePortfolioLookServiceId(
  media: Pick<ReconcileMediaRow, 'primaryServiceId' | 'services'>,
): string | null {
  const taggedServiceIds = new Set(media.services.map((s) => s.serviceId))
  if (taggedServiceIds.has(media.primaryServiceId)) {
    return media.primaryServiceId
  }
  return media.services[0]?.serviceId ?? null
}

/**
 * Reconciles the LookPost for one MediaAsset with its *current* portfolio flags.
 * Call it after a media write route has set the flags/visibility.
 *
 * - Asset is public (featured OR Looks-eligible) and can back a look → ensure a
 *   PUBLISHED pro-authored LookPost exists (create or re-publish).
 * - Otherwise → if a published pro-authored LookPost exists, unpublish it.
 *
 * Client-authored looks are never touched (they own their own lifecycle via
 * clientLookService). Idempotent + safe to re-run. Soft-fails to a no-op rather
 * than throwing when the asset can't back a look (e.g. no service tag), so a
 * pro's portfolio action is never blocked on look-publishability.
 */
export async function reconcilePortfolioLookForMediaAsset(
  db: LookPublicationDb,
  args: ReconcilePortfolioLookArgs,
): Promise<ReconcilePortfolioLookOutcome> {
  const professionalId = normalizeRequiredId(
    'professionalId',
    args.professionalId,
  )
  const mediaAssetId = normalizeRequiredId('mediaAssetId', args.mediaAssetId)

  return withPublicationTx(db, async (tx) => {
    const media = await tx.mediaAsset.findUnique({
      where: { id: mediaAssetId },
      select: reconcileMediaSelect,
    })

    if (!media) return 'SKIPPED_NOT_FOUND'
    if (media.professionalId !== professionalId) return 'SKIPPED_NOT_OWNED'

    const existingLook = media.lookPostPrimaryFor[0] ?? null
    if (existingLook && existingLook.clientAuthorId !== null) {
      return 'SKIPPED_CLIENT_LOOK'
    }

    const serviceId = resolvePortfolioLookServiceId(media)

    const wantsPublic =
      media.visibility === MediaVisibility.PUBLIC &&
      (media.isFeaturedInPortfolio || media.isEligibleForLooks)

    const backable =
      wantsPublic &&
      serviceId !== null &&
      !isUnpromotedPrivateMedia({
        storageBucket: media.storageBucket,
        reviewId: media.reviewId,
        clientUseConsentAt: media.booking?.mediaUseConsentAt ?? null,
      })

    if (backable && serviceId) {
      // Featuring implies Looks-eligible under the unified model; set it in the
      // same tx so the publication assert passes when the asset was featured-only.
      if (!media.isEligibleForLooks) {
        await tx.mediaAsset.update({
          where: { id: mediaAssetId },
          data: { isEligibleForLooks: true },
        })
      }

      await createOrUpdateProLookFromMediaAsset(tx, {
        professionalId,
        request: {
          mediaAssetId,
          primaryServiceId: serviceId,
          // caption falls back to the asset's caption inside the helper.
          publish: true,
        },
      })

      return 'PUBLISHED'
    }

    if (existingLook && existingLook.status === LookPostStatus.PUBLISHED) {
      await updateProLookPublication(tx, {
        professionalId,
        lookPostId: existingLook.id,
        request: { stateAction: 'unpublish' },
      })

      return 'RETRACTED'
    }

    return wantsPublic ? 'SKIPPED_NOT_BACKABLE' : 'NOOP'
  })
}
