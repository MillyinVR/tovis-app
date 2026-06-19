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

import { BUCKETS } from '@/lib/storageBuckets'
import { getSupabaseAdmin } from '@/lib/supabaseAdmin'

export class StorageCopyError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'StorageCopyError'
  }
}

function extensionForContentType(type: string): string {
  const t = type.toLowerCase()
  if (t.includes('png')) return 'png'
  if (t.includes('jpeg') || t.includes('jpg')) return 'jpg'
  if (t.includes('webp')) return 'webp'
  if (t.includes('heic') || t.includes('heif')) return 'heic'
  if (t.includes('mp4')) return 'mp4'
  if (t.includes('quicktime')) return 'mov'
  return 'bin'
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
  const ext = extensionForContentType(contentType)
  const destPath = buildPublicLookPath(args.clientId, ext)

  const { error: uploadError } = await admin.storage
    .from(BUCKETS.mediaPublic)
    .upload(destPath, blob, { contentType, upsert: false })

  if (uploadError) {
    throw new StorageCopyError(
      `Failed to write public copy: ${uploadError.message}`,
    )
  }

  return {
    storageBucket: BUCKETS.mediaPublic,
    storagePath: destPath,
    contentType,
  }
}
