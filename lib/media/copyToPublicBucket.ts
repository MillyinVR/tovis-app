// lib/media/copyToPublicBucket.ts
//
// Copies a private storage object into the public bucket, returning the new
// pointer. Used by the Share-your-look reuse path: when a client publishes a look
// from one of the visit's existing (pro-shot, media-private) session photos, the
// bytes must be duplicated into media-public so the resulting look asset can be
// PUBLIC without violating the MediaAsset bucket invariant
// (lib/media/recordMediaAsset.ts) — and so the original private session photo is
// left untouched.
//
// Implemented as download (service role) + upload, which is SDK-version
// independent (cross-bucket `copy` support varies by storage-js version). The
// destination path is server-minted and namespaced to the client, mirroring the
// signing routes — never derived from client input.
//
// `copyStorageObject` below is the generic form (any bucket → any bucket, with a
// caller-supplied path builder); `copyToPublicBucket` is the client-look wrapper
// that was here first. The practice-shot attach path (a pro promoting a shot
// taken outside a session into a booking's private media or a public look) uses
// the generic one — same download+upload, different namespace.

import { MEDIA_UPLOAD_CACHE_CONTROL } from '@/lib/media/cacheControl'
import { extensionForContentType } from '@/lib/media/contentType'
import { BUCKETS } from '@/lib/storageBuckets'
import { getSupabaseAdmin } from '@/lib/supabaseAdmin'

export class StorageCopyError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'StorageCopyError'
  }
}

export type CopiedObjectPointer = {
  storageBucket: string
  storagePath: string
  contentType: string
}

function buildPublicLookPath(clientId: string, ext: string): string {
  const ym = new Date().toISOString().slice(0, 7)
  const rand = Math.random().toString(16).slice(2)
  return `client/${clientId}/look_public/${ym}/${Date.now()}_${rand}.${ext}`
}

/**
 * Duplicates a source object into `destBucket` under a server-minted path.
 *
 * `buildDestPath` receives the source object's resolved file extension and
 * returns the destination path — it is the caller's namespace, and like the
 * signing routes it must never be derived from client input. Throws
 * {@link StorageCopyError} on any failure so the caller's transaction rolls back.
 */
export async function copyStorageObject(args: {
  sourceBucket: string
  sourcePath: string
  destBucket: string
  buildDestPath: (ext: string) => string
}): Promise<CopiedObjectPointer> {
  const admin = getSupabaseAdmin()

  const { data: blob, error: downloadError } = await admin.storage
    .from(args.sourceBucket)
    .download(args.sourcePath)

  if (downloadError || !blob) {
    throw new StorageCopyError(
      `Failed to read source object: ${downloadError?.message ?? 'not found'}`,
    )
  }

  const contentType = blob.type || 'application/octet-stream'
  const destPath = args.buildDestPath(extensionForContentType(contentType))

  const { error: uploadError } = await admin.storage
    .from(args.destBucket)
    // `cacheControl` is stated rather than left to the SDK default (3600),
    // which would have given a copied object an hour of browser residency
    // that a directly-uploaded one does not have — including copies made BY
    // a retraction. See lib/media/cacheControl.ts.
    .upload(destPath, blob, {
      contentType,
      upsert: false,
      cacheControl: MEDIA_UPLOAD_CACHE_CONTROL,
    })

  if (uploadError) {
    throw new StorageCopyError(
      `Failed to write copy: ${uploadError.message}`,
    )
  }

  return {
    storageBucket: args.destBucket,
    storagePath: destPath,
    contentType,
  }
}

/**
 * Duplicates a source object (typically in media-private) into media-public under
 * a fresh, client-namespaced path. Returns the new bucket/path/contentType to feed
 * into buildMediaAssetCreateData. Throws {@link StorageCopyError} on any failure so
 * the caller's transaction rolls back.
 */
export async function copyToPublicBucket(args: {
  sourceBucket: string
  sourcePath: string
  clientId: string
}): Promise<CopiedObjectPointer> {
  return copyStorageObject({
    sourceBucket: args.sourceBucket,
    sourcePath: args.sourcePath,
    destBucket: BUCKETS.mediaPublic,
    buildDestPath: (ext) => buildPublicLookPath(args.clientId, ext),
  })
}
