// lib/aftercare/featuredPairSeed.ts
//
// Pure resolution of the "featured before/after pair" seed for the aftercare
// authoring form. The pair can arrive two ways:
//   1. A saved `AftercareSummary` (the persisted choice) — the default source.
//   2. An in-session pre-selection carried as `?fb=`/`?fa=` query params from the
//      session "after-photos" wrap-up step, where the pro picks the pair before
//      authoring aftercare (no early DB write — see the AF2 follow-up).
//
// Precedence is PER FIELD:
//   - param key ABSENT (`undefined`) → fall back to the saved value (the pro did
//     not arrive with a pre-selection, e.g. opened /aftercare directly).
//   - param key PRESENT (including empty '') → the pro's explicit in-session pick
//     wins over any stale saved value. An empty string means "explicitly
//     cleared" → null. A non-empty id is validated (must be an IMAGE of the
//     matching phase on THIS booking) or dropped to null.
//
// The IMAGE + matching-phase validation mirrors the client-side clamp in
// `AftercareForm.buildPayload` and the authoritative server check in
// `resolveAftercareFeaturedAssetId` (writeBoundary) — a carried id is never
// trusted blindly. The saved value is not re-validated here: it was validated
// when saved and the `onDelete: SetNull` FK clears it if the photo is deleted.

import { MediaPhase, MediaType } from '@prisma/client'

export type FeaturedSeedMedia = {
  id: string
  phase: MediaPhase
  mediaType: MediaType
}

function isImageOfPhase(
  id: string,
  phase: MediaPhase,
  media: FeaturedSeedMedia[],
): boolean {
  return media.some(
    (m) => m.id === id && m.phase === phase && m.mediaType === MediaType.IMAGE,
  )
}

function resolveField(
  param: string | undefined,
  saved: string | null,
  phase: MediaPhase,
  media: FeaturedSeedMedia[],
): string | null {
  // Key absent → no pre-selection carried; keep the saved value unchanged.
  if (param === undefined) return saved

  const id = param.trim()
  if (!id) return null // explicitly cleared at the after-photos step

  return isImageOfPhase(id, phase, media) ? id : null
}

export function resolveFeaturedPairSeed(args: {
  savedBeforeAssetId: string | null
  savedAfterAssetId: string | null
  paramBeforeAssetId: string | undefined
  paramAfterAssetId: string | undefined
  media: FeaturedSeedMedia[]
}): {
  featuredBeforeAssetId: string | null
  featuredAfterAssetId: string | null
} {
  return {
    featuredBeforeAssetId: resolveField(
      args.paramBeforeAssetId,
      args.savedBeforeAssetId,
      MediaPhase.BEFORE,
      args.media,
    ),
    featuredAfterAssetId: resolveField(
      args.paramAfterAssetId,
      args.savedAfterAssetId,
      MediaPhase.AFTER,
      args.media,
    ),
  }
}
