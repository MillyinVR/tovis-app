import 'server-only'

import { safeUrl } from '@/lib/media'
import { BUCKETS } from '@/lib/storageBuckets'
import { getSupabaseAdmin } from '@/lib/supabaseAdmin'

const SIGNED_TTL_SECONDS = 60 * 10

function isPublicBucket(bucket: string) {
  return bucket === BUCKETS.mediaPublic
}

function isPrivateBucket(bucket: string) {
  return bucket === BUCKETS.mediaPrivate
}

function getSupabaseUrl(): string | null {
  const url =
    process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ||
    process.env.SUPABASE_URL?.trim()

  return url ? url.replace(/\/+$/, '') : null
}

function encodeStoragePath(path: string): string {
  return path
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/')
}

function publicUrl(bucket: string, path: string): string | null {
  if (!isPublicBucket(bucket)) return null

  const baseUrl = getSupabaseUrl()
  if (!baseUrl) return null

  return safeUrl(
    `${baseUrl}/storage/v1/object/public/${encodeURIComponent(bucket)}/${encodeStoragePath(path)}`,
  )
}

async function signedUrl(
  bucket: string,
  path: string,
): Promise<string | null> {
  if (!isPrivateBucket(bucket)) return null

  const admin = getSupabaseAdmin()
  const { data, error } = await admin.storage
    .from(bucket)
    .createSignedUrl(path, SIGNED_TTL_SECONDS)

  if (error) return null

  return safeUrl(data?.signedUrl)
}

type MediaPointers = {
  storageBucket?: string | null
  storagePath?: string | null
  thumbBucket?: string | null
  thumbPath?: string | null
  url?: string | null
  thumbUrl?: string | null
}

export type RenderedMediaUrls = {
  renderUrl: string | null
  renderThumbUrl: string | null
}

function normalizePointer(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * Batched sibling of {@link renderMediaUrls}. Signs every private object across
 * a whole list of media in **one `createSignedUrls` round-trip per distinct
 * private bucket** (run concurrently) instead of two sequential `createSignedUrl`
 * calls per asset — the per-item version is an N+1 waterfall when a caller has to
 * resolve many assets at once (e.g. a booking's before/after grid). Public and
 * fallback URLs resolve synchronously. Returns results aligned to the input
 * order; semantics per item are identical to `renderMediaUrls`.
 */
export async function renderMediaUrlsBatch(
  items: readonly MediaPointers[],
): Promise<RenderedMediaUrls[]> {
  // Collect every private (bucket, path) that needs signing, deduped per bucket.
  const privatePathsByBucket = new Map<string, Set<string>>()

  const collect = (bucket: string, path: string) => {
    if (!bucket || !path || !isPrivateBucket(bucket)) return
    const set = privatePathsByBucket.get(bucket) ?? new Set<string>()
    set.add(path)
    privatePathsByBucket.set(bucket, set)
  }

  for (const m of items) {
    collect(normalizePointer(m.storageBucket), normalizePointer(m.storagePath))
    collect(normalizePointer(m.thumbBucket), normalizePointer(m.thumbPath))
  }

  const signedKey = (bucket: string, path: string) => `${bucket}\n${path}`
  const signed = new Map<string, string>()

  await Promise.all(
    [...privatePathsByBucket.entries()].map(async ([bucket, paths]) => {
      const admin = getSupabaseAdmin()
      const { data, error } = await admin.storage
        .from(bucket)
        .createSignedUrls([...paths], SIGNED_TTL_SECONDS)

      if (error || !data) return

      for (const row of data) {
        const url = safeUrl(row.signedUrl)
        if (row.path && url) signed.set(signedKey(bucket, row.path), url)
      }
    }),
  )

  const resolve = (
    bucket: string,
    path: string,
    fallback: string | null | undefined,
  ): string | null => {
    if (bucket && path) {
      if (isPrivateBucket(bucket)) {
        // Private objects always sign or resolve to null — never fall back to a
        // stored (possibly stale/public) URL.
        return signed.get(signedKey(bucket, path)) ?? null
      }
      const pub = publicUrl(bucket, path)
      if (pub) return pub
    }
    return safeUrl(fallback)
  }

  return items.map((m) => ({
    renderUrl: resolve(
      normalizePointer(m.storageBucket),
      normalizePointer(m.storagePath),
      m.url,
    ),
    renderThumbUrl: resolve(
      normalizePointer(m.thumbBucket),
      normalizePointer(m.thumbPath),
      m.thumbUrl,
    ),
  }))
}

export async function renderMediaUrls(m: MediaPointers) {
  const bucket =
    typeof m.storageBucket === 'string' ? m.storageBucket.trim() : ''
  const path = typeof m.storagePath === 'string' ? m.storagePath.trim() : ''

  const main =
    bucket && path
      ? isPrivateBucket(bucket)
        ? await signedUrl(bucket, path)
        : publicUrl(bucket, path)
      : null

  const thumbBucket =
    typeof m.thumbBucket === 'string' ? m.thumbBucket.trim() : ''
  const thumbPath =
    typeof m.thumbPath === 'string' ? m.thumbPath.trim() : ''

  const thumb =
    thumbBucket && thumbPath
      ? isPrivateBucket(thumbBucket)
        ? await signedUrl(thumbBucket, thumbPath)
        : publicUrl(thumbBucket, thumbPath)
      : null

  const fallbackMain =
    bucket && path && isPrivateBucket(bucket) ? null : safeUrl(m.url)

  const fallbackThumb =
    thumbBucket && thumbPath && isPrivateBucket(thumbBucket)
      ? null
      : safeUrl(m.thumbUrl)

  return {
    renderUrl: main ?? fallbackMain,
    renderThumbUrl: thumb ?? fallbackThumb,
  }
}