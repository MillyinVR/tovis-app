// lib/media/recordMediaAsset.ts
//
// Single source of truth for constructing a MediaAsset row's scalar `data`.
//
// Before this existed, four call sites hand-maintained their own MediaAsset
// create payloads (the booking write boundary, POST /api/pro/media, the two
// client review media routes). That spread the field defaults — and, more
// dangerously, the bucket/visibility safety invariants — across the codebase.
//
// This module centralizes:
//   1. Field defaults (url/thumbUrl null, flags false, phase OTHER, etc.) so
//      every row is shaped identically.
//   2. Two safety invariants, asserted on every build:
//        - PRO_CLIENT visibility MUST live in the private bucket. media-public
//          is world-readable by URL, so a private (pro↔client) asset there
//          would leak.
//        - PUBLIC visibility is only allowed when canProSharePublicly() is true
//          — i.e. the asset is in the public bucket, or a client has promoted
//          it via a review (reviewId set). This mirrors the consent model in
//          lib/media/publicShareGuard.ts.
//
// It deliberately does NOT own the Prisma call: callers keep their own
// select/include, transaction, audit logging, and proTenantId resolution. The
// builder returns a Prisma.MediaAssetCreateManyInput (pure scalars), which can
// be passed straight to createMany() or spread into a create()'s data.

import { MediaPhase, MediaType, MediaVisibility, Prisma, Role } from '@prisma/client'
import { BUCKETS } from '@/lib/storageBuckets'
import { canProSharePublicly, UNPROMOTED_MEDIA_MESSAGE } from '@/lib/media/publicShareGuard'

/** Thrown when a MediaAsset write would violate a bucket/visibility invariant. */
export class MediaAssetInvariantError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MediaAssetInvariantError'
  }
}

export type MediaAssetWriteInput = {
  // Required ownership + storage pointers.
  professionalId: string
  proTenantId: string | null
  storageBucket: string
  storagePath: string
  mediaType: MediaType
  visibility: MediaVisibility

  // Optional context (default null).
  bookingId?: string | null
  reviewId?: string | null
  uploadedByUserId?: string | null
  uploadedByRole?: Role | null
  thumbBucket?: string | null
  thumbPath?: string | null
  url?: string | null
  thumbUrl?: string | null
  caption?: string | null

  // Optional, schema-defaulted fields.
  phase?: MediaPhase
  isEligibleForLooks?: boolean
  isFeaturedInPortfolio?: boolean
  reviewLocked?: boolean
}

/**
 * Validates the storage-pointer + bucket/visibility safety invariants for a
 * MediaAsset write. Throws {@link MediaAssetInvariantError} on violation.
 *
 * This is defense-in-depth: the API routes also validate their inputs before
 * reaching here, so a throw indicates a caller bug rather than bad user input.
 *
 * Note: this does NOT re-validate that the bucket is one of the two canonical
 * names — the upload routes already constrain that (and the booking media route
 * rejects anything but media-private). What it DOES enforce are the two rules
 * that protect client privacy and must hold no matter which route writes:
 * private media never lands in a world-readable bucket, and public media is
 * only ever client-consented.
 */
export function assertMediaAssetInvariant(input: MediaAssetWriteInput): void {
  if (!input.storagePath.trim()) {
    throw new MediaAssetInvariantError('MediaAsset requires a non-empty storagePath.')
  }

  if (input.thumbBucket != null && (!input.thumbPath || !input.thumbPath.trim())) {
    throw new MediaAssetInvariantError(
      'MediaAsset thumbPath is required when thumbBucket is set.',
    )
  }

  if (input.visibility === MediaVisibility.PRO_CLIENT) {
    // Private (pro↔client) media must never sit in the world-readable bucket.
    if (input.storageBucket !== BUCKETS.mediaPrivate) {
      throw new MediaAssetInvariantError(
        'PRO_CLIENT media must live in the private bucket (media-public is world-readable).',
      )
    }
    return
  }

  // visibility === PUBLIC
  if (!canProSharePublicly({ storageBucket: input.storageBucket, reviewId: input.reviewId ?? null })) {
    throw new MediaAssetInvariantError(UNPROMOTED_MEDIA_MESSAGE)
  }
}

/**
 * Builds the canonical scalar `data` for a MediaAsset create, after asserting
 * the safety invariants. Pass the result straight to `createMany`, or spread it
 * into a `create`'s `data` (e.g. alongside a nested `services` create).
 */
export function buildMediaAssetCreateData(
  input: MediaAssetWriteInput,
): Prisma.MediaAssetCreateManyInput {
  assertMediaAssetInvariant(input)

  return {
    professionalId: input.professionalId,
    proTenantId: input.proTenantId,

    bookingId: input.bookingId ?? null,
    reviewId: input.reviewId ?? null,
    uploadedByUserId: input.uploadedByUserId ?? null,
    uploadedByRole: input.uploadedByRole ?? null,

    storageBucket: input.storageBucket,
    storagePath: input.storagePath,
    thumbBucket: input.thumbBucket ?? null,
    thumbPath: input.thumbPath ?? null,

    url: input.url ?? null,
    thumbUrl: input.thumbUrl ?? null,

    mediaType: input.mediaType,
    caption: input.caption ?? null,
    phase: input.phase ?? MediaPhase.OTHER,
    visibility: input.visibility,

    isEligibleForLooks: input.isEligibleForLooks ?? false,
    isFeaturedInPortfolio: input.isFeaturedInPortfolio ?? false,
    reviewLocked: input.reviewLocked ?? false,
  }
}
