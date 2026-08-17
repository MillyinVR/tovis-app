// lib/media/hashStorageObject.ts
//
// Downloads an already-uploaded storage object and hashes its actual bytes.
// This is the only sha256 the app trusts for capture attestation — computed
// from what Supabase stored, never from what a client claims (see
// MediaCaptureAttestation in prisma/schema.prisma).
//
// Mirrors the download-then-hash pattern already used for consult captures
// (lib/consult/captureStorage.ts's downloadVerified/inspectObject) and for
// copying media between buckets (lib/media/copyToPublicBucket.ts) — same
// `getSupabaseAdmin().storage.from(bucket).download(path)` call every other
// server-side byte access in this repo uses. Kept as its own module (rather
// than folded into the consult-only file) because that module's error type
// and content-type allowlist are specific to the hair-color consult pipeline,
// which explicitly never produces a MediaAsset.

import 'server-only'

import { createHash } from 'node:crypto'

import { getSupabaseAdmin } from '@/lib/supabaseAdmin'

export class MediaHashError extends Error {
  constructor(readonly kind: 'missing' | 'too_large') {
    super(
      kind === 'missing'
        ? 'Could not download the uploaded media object to hash it.'
        : 'Uploaded media object exceeds the size this hasher will buffer.',
    )
    this.name = 'MediaHashError'
  }
}

export type HashedStorageObject = {
  sha256: string
  sizeBytes: number
}

/**
 * Downloads `bucket`/`path` and returns the sha256 of its bytes. Bounded by
 * `maxBytes` so a bad object can't be buffered unbounded into memory — checked
 * against the bytes actually downloaded, not a client-declared size.
 */
export async function hashStorageObjectBytes(args: {
  bucket: string
  path: string
  maxBytes: number
}): Promise<HashedStorageObject> {
  const { data, error } = await getSupabaseAdmin()
    .storage.from(args.bucket)
    .download(args.path, {}, { cache: 'no-store' })

  if (error || !data) {
    throw new MediaHashError('missing')
  }

  if (data.size > args.maxBytes) {
    throw new MediaHashError('too_large')
  }

  const bytes = new Uint8Array(await data.arrayBuffer())

  if (bytes.byteLength > args.maxBytes) {
    throw new MediaHashError('too_large')
  }

  const sha256 = createHash('sha256').update(bytes).digest('hex')

  return { sha256, sizeBytes: bytes.byteLength }
}
