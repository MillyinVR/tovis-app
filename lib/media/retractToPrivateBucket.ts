// lib/media/retractToPrivateBucket.ts
//
// True retraction: when a pro takes their own public upload down, the BYTES are
// withdrawn from the world-readable bucket, not just the label. The public URL
// stops resolving.
//
// 🔴 Why this exists. `media-public` is served by URL with no authorization, so
// un-featuring a photo while its object stays there means anyone who ever saw
// the URL keeps the full-resolution file forever. Clearing the flags takes the
// photo off every product surface; only deleting the object takes it off the
// internet. This module is the second half.
//
// ── The ordering contract ────────────────────────────────────────────────────
//
//   copy → VERIFY → re-point → delete
//
// Every step is ordered so that a failure at any point leaves the row VALID and
// the operation RETRYABLE, never stranded pointing at bytes that do not exist:
//
//   fails during copy/verify   → row untouched, still public and renderable. A
//                                private copy may be left behind as garbage; the
//                                retry mints a fresh path and never reuses it.
//   fails during the re-point  → same: the row still points at the public object
//                                that still exists. Retryable.
//   fails during the delete    → the row is already correct and private. The
//                                public object survives, so the bytes are still
//                                exposed — this is the ONLY window that leaves
//                                real-world exposure, so it is never swallowed:
//                                the orphaned paths come back in the result and
//                                are logged for a follow-up sweep.
//
// Deleting BEFORE the re-point commits would invert this: a crash in between
// would leave a row pointing at a deleted object — an unrenderable, unrecoverable
// asset. Prod has no restorable backup, so that ordering is not negotiable.
//
// ── What deliberately does NOT retract ───────────────────────────────────────
//
// Only the two explicit retract doors call this: the portfolio DELETE and the
// media PATCH that un-ticks the last flag. Both mean "take this down".
//
// `mirrorMediaAssetPublicationState` (lib/looks/publication/service.ts) also
// clears `isFeaturedInPortfolio` when a look is unpublished, and must NOT
// withdraw the bytes: that is a pro drafting an edit they intend to re-publish,
// it leaves `isEligibleForLooks` set, and there is no private→public move to
// bring the object back — retracting there would strand them mid-edit. The
// asset therefore still reads as shown to {@link isShownOnPublicSurfaces}, which
// is the safe direction: never delete bytes something might still show.

import { MediaVisibility, type Prisma } from '@prisma/client'

import { extensionForContentType } from '@/lib/media/contentType'
import { copyStorageObject, StorageCopyError } from '@/lib/media/copyToPublicBucket'
import {
  isShownOnPublicSurfaces,
  resolveMediaVisibility,
} from '@/lib/media/mediaVisibility'
import { safeError } from '@/lib/security/logging'
import { BUCKETS } from '@/lib/storageBuckets'
import { getSupabaseAdmin } from '@/lib/supabaseAdmin'

/** A public object that could not be deleted after its row was re-pointed. */
export type OrphanedPublicObject = {
  bucket: string
  path: string
  reason: string
}

export type RetractionOutcome =
  /** The bytes were copied to the private bucket and the public original removed. */
  | {
      status: 'RETRACTED'
      storageBucket: string
      storagePath: string
      thumbBucket: string | null
      thumbPath: string | null
      /**
       * Empty on a clean retraction. Non-empty means the row is correct but the
       * public bytes are STILL world-readable and need a sweep — callers must
       * surface this, never treat it as success.
       */
      orphanedPublicObjects: OrphanedPublicObject[]
    }
  /** Nothing to do — the bytes were never in the public bucket. */
  | { status: 'ALREADY_PRIVATE' }

/**
 * The narrow slice of Prisma this module needs.
 *
 * Hand-written rather than `Pick<PrismaClient, 'mediaAsset'>` so the contract is
 * the two calls actually made — which is also what lets a test supply a fake
 * without casting through `any`, and keeps the retraction rules readable without
 * the whole delegate surface.
 */
export type MediaAssetUpdater = {
  mediaAsset: {
    update(args: {
      where: { id: string }
      data: Prisma.MediaAssetUpdateInput
    }): PromiseLike<unknown>
  }
}

export type RetractableMedia = {
  id: string
  professionalId: string
  storageBucket: string
  storagePath: string
  thumbBucket: string | null
  thumbPath: string | null
  isFeaturedInPortfolio: boolean
  isEligibleForLooks: boolean
}

function buildRetractedPath(professionalId: string, ext: string): string {
  const ym = new Date().toISOString().slice(0, 7)
  const rand = Math.random().toString(16).slice(2)
  return `pro/${professionalId}/retracted/${ym}/${Date.now()}_${rand}.${ext}`
}

/**
 * Byte size of a stored object, or null when it cannot be seen.
 *
 * Used to PROVE a copy landed before the original is deleted. `list` is used
 * rather than a second `download` because it returns the size from metadata
 * without moving the bytes again — the check runs inline on a pro's request.
 */
async function storedObjectSize(
  bucket: string,
  path: string,
): Promise<number | null> {
  const admin = getSupabaseAdmin()

  const lastSlash = path.lastIndexOf('/')
  const dir = lastSlash === -1 ? '' : path.slice(0, lastSlash)
  const name = lastSlash === -1 ? path : path.slice(lastSlash + 1)

  const { data, error } = await admin.storage
    .from(bucket)
    .list(dir, { search: name, limit: 100 })

  if (error || !data) return null

  const match = data.find((entry) => entry.name === name)
  if (!match) return null

  const size = match.metadata?.size
  return typeof size === 'number' ? size : null
}

/**
 * Copies one public object into the private bucket and PROVES it arrived intact
 * before the caller is allowed to delete anything.
 *
 * Throws {@link StorageCopyError} if the copy cannot be verified, which aborts
 * the retraction with the row still pointing at the intact public original.
 */
async function copyAndVerify(args: {
  sourceBucket: string
  sourcePath: string
  professionalId: string
}): Promise<{ storageBucket: string; storagePath: string }> {
  const sourceSize = await storedObjectSize(args.sourceBucket, args.sourcePath)

  const copied = await copyStorageObject({
    sourceBucket: args.sourceBucket,
    sourcePath: args.sourcePath,
    destBucket: BUCKETS.mediaPrivate,
    buildDestPath: (ext: string) =>
      buildRetractedPath(args.professionalId, ext),
  })

  const destSize = await storedObjectSize(copied.storageBucket, copied.storagePath)

  if (destSize === null) {
    throw new StorageCopyError(
      `Copy could not be verified: ${copied.storageBucket}/${copied.storagePath} is not readable after upload.`,
    )
  }

  // 🔴 A size we could not read on the SOURCE is not proof of a mismatch, so it
  // must not fail the retraction — but a size we read on BOTH that disagrees is
  // a corrupt copy, and deleting the original after that would destroy the only
  // good bytes.
  if (sourceSize !== null && sourceSize !== destSize) {
    throw new StorageCopyError(
      `Copy verification failed: source ${sourceSize} bytes, copy ${destSize} bytes.`,
    )
  }

  return { storageBucket: copied.storageBucket, storagePath: copied.storagePath }
}

async function deletePublicObject(
  bucket: string,
  path: string,
): Promise<OrphanedPublicObject | null> {
  const admin = getSupabaseAdmin()

  try {
    const { error } = await admin.storage.from(bucket).remove([path])
    if (error) return { bucket, path, reason: error.message }
    return null
  } catch (e: unknown) {
    return { bucket, path, reason: String(safeError(e)) }
  }
}

/**
 * Withdraws a pro's own public upload from the world-readable bucket.
 *
 * Call this AFTER the flags have been cleared (or in the same request), so the
 * asset is genuinely being taken down. It re-points every pointer the row
 * carries — canonical (`storageBucket`/`storagePath`, `thumbBucket`/`thumbPath`)
 * AND the cached legacy `url`/`thumbUrl`, which are cleared: a stored public URL
 * for bytes that no longer exist there is a stale claim, and `renderMediaUrls`
 * signs private objects on demand rather than reading those columns.
 *
 * 🔴 It also stamps `retractedFromPublicAt`, WITHOUT which the pro could never
 * re-publish their own photograph — see `lib/media/publicShareGuard.ts`.
 *
 * Never throws for a delete failure (the row is already correct by then); the
 * orphaned objects come back in the result instead.
 */
export async function retractMediaAssetToPrivate(
  db: MediaAssetUpdater,
  media: RetractableMedia,
): Promise<RetractionOutcome> {
  if (media.storageBucket !== BUCKETS.mediaPublic) {
    return { status: 'ALREADY_PRIVATE' }
  }

  // ── 1. copy + verify ───────────────────────────────────────────────────────
  const movedMain = await copyAndVerify({
    sourceBucket: media.storageBucket,
    sourcePath: media.storagePath,
    professionalId: media.professionalId,
  })

  const thumbIsPublic =
    media.thumbBucket === BUCKETS.mediaPublic && Boolean(media.thumbPath)

  const movedThumb = thumbIsPublic
    ? await copyAndVerify({
        sourceBucket: media.thumbBucket as string,
        sourcePath: media.thumbPath as string,
        professionalId: media.professionalId,
      })
    : null

  // ── 2. re-point the row ────────────────────────────────────────────────────
  // Only once every byte is provably in place. Until this commits, the row still
  // describes the public originals, which still exist.
  const retractedFromPublicAt = new Date()

  await db.mediaAsset.update({
    where: { id: media.id },
    data: {
      storageBucket: movedMain.storageBucket,
      storagePath: movedMain.storagePath,
      ...(movedThumb
        ? {
            thumbBucket: movedThumb.storageBucket,
            thumbPath: movedThumb.storagePath,
          }
        : {}),
      // Cached public URLs for bytes that are about to stop existing.
      url: null,
      thumbUrl: null,
      retractedFromPublicAt,
      visibility: resolveMediaVisibility({
        storageBucket: movedMain.storageBucket,
        isFeaturedInPortfolio: media.isFeaturedInPortfolio,
        isEligibleForLooks: media.isEligibleForLooks,
      }),
    },
  })

  // ── 3. delete the public originals ─────────────────────────────────────────
  // The row is correct from here on. A failure below leaves bytes exposed, so it
  // is reported rather than thrown — throwing would suggest the retraction did
  // not happen, and a caller retrying the whole thing would copy again.
  const orphanedPublicObjects: OrphanedPublicObject[] = []

  const mainOrphan = await deletePublicObject(
    media.storageBucket,
    media.storagePath,
  )
  if (mainOrphan) orphanedPublicObjects.push(mainOrphan)

  if (thumbIsPublic) {
    const thumbOrphan = await deletePublicObject(
      media.thumbBucket as string,
      media.thumbPath as string,
    )
    if (thumbOrphan) orphanedPublicObjects.push(thumbOrphan)
  }

  if (orphanedPublicObjects.length > 0) {
    console.error('retractMediaAssetToPrivate: public object still exposed', {
      mediaAssetId: media.id,
      orphanedPublicObjects,
    })
  }

  return {
    status: 'RETRACTED',
    storageBucket: movedMain.storageBucket,
    storagePath: movedMain.storagePath,
    thumbBucket: movedThumb?.storageBucket ?? media.thumbBucket,
    thumbPath: movedThumb?.storagePath ?? media.thumbPath,
    orphanedPublicObjects,
  }
}

/**
 * The columns {@link retractMediaAssetIfNoLongerShown} needs.
 *
 * Exported so both retract routes select exactly the same thing — the decision
 * to delete production bytes must not depend on which handler asked.
 */
export const RETRACTION_SELECT = {
  id: true,
  professionalId: true,
  storageBucket: true,
  storagePath: true,
  thumbBucket: true,
  thumbPath: true,
  isFeaturedInPortfolio: true,
  isEligibleForLooks: true,
  reviewId: true,
} satisfies Prisma.MediaAssetSelect

export type RetractionCandidate = RetractableMedia & { reviewId: string | null }

/** The visibility a retracted asset lands on, for callers that echo it back. */
export const RETRACTED_VISIBILITY = MediaVisibility.PRO_CLIENT


/**
 * The retract-path entry point: withdraw the bytes IF the asset is no longer
 * shown anywhere.
 *
 * Pass a row the caller re-read with {@link RETRACTION_SELECT} AFTER writing the
 * flags. The decision to delete production bytes must be made against committed
 * state, not against what a handler intended to write — reading it in the route
 * (rather than here) is only so this module never needs the whole Prisma client.
 * A `null` row is treated as "leave it alone", never as "safe to delete".
 *
 * 🔴 It refuses to retract anything still on a public surface — including review
 * media, which is PUBLIC with both flags false and would otherwise be withdrawn
 * out from under the client who promoted it (see {@link isShownOnPublicSurfaces}).
 */
export async function retractMediaAssetIfNoLongerShown(
  db: MediaAssetUpdater,
  media: RetractionCandidate | null,
): Promise<RetractionOutcome | { status: 'STILL_SHOWN' }> {
  if (!media) return { status: 'STILL_SHOWN' }

  if (isShownOnPublicSurfaces(media)) return { status: 'STILL_SHOWN' }

  return retractMediaAssetToPrivate(db, media)
}


/**
 * Route-facing wrapper: attempt the byte withdrawal, but never let a storage
 * failure break an unpublish that has already succeeded.
 *
 * 🔴 Why this does not throw. By the time it runs, the flags are written and the
 * LookPost is retracted — the photo is already off every product surface, which
 * is what the pro asked for. Letting a storage hiccup turn that into a 500 would
 * tell them their photo is still published when it is not, and they would have
 * no way to take it down at all while storage was unhealthy.
 *
 * The bytes staying public is a real, ongoing exposure though, so it is never
 * silent: it is logged with the asset id, and `scripts/retract-public-bucket-pro-
 * client-media.ts` re-selects exactly these rows (public bucket, shown by
 * nothing) and finishes the job. The next retract of the same asset also retries
 * it.
 */
export async function attemptRetraction(
  db: MediaAssetUpdater,
  media: RetractionCandidate | null,
): Promise<RetractionOutcome | { status: 'STILL_SHOWN' } | { status: 'FAILED' }> {
  try {
    return await retractMediaAssetIfNoLongerShown(db, media)
  } catch (e: unknown) {
    console.error('attemptRetraction: bytes remain in the public bucket', {
      mediaAssetId: media?.id ?? null,
      error: safeError(e),
    })
    return { status: 'FAILED' }
  }
}
