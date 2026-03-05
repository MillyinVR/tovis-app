// lib/media/renderUrls.ts
import { getSupabaseAdmin } from '@/lib/supabaseAdmin'
import { BUCKETS } from '@/lib/storageBuckets'
import { safeUrl } from '@/lib/media'

const SIGNED_TTL_SECONDS = 60 * 10

function isPublicBucket(bucket: string) {
  return bucket === BUCKETS.mediaPublic
}

function isPrivateBucket(bucket: string) {
  return bucket === BUCKETS.mediaPrivate
}

function publicUrl(bucket: string, path: string): string | null {
  if (!isPublicBucket(bucket)) return null
  const admin = getSupabaseAdmin()
  const { data } = admin.storage.from(bucket).getPublicUrl(path)
  return safeUrl(data?.publicUrl)
}

async function signedUrl(bucket: string, path: string): Promise<string | null> {
  if (!isPrivateBucket(bucket)) return null
  const admin = getSupabaseAdmin()
  const { data, error } = await admin.storage.from(bucket).createSignedUrl(path, SIGNED_TTL_SECONDS)
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

export async function renderMediaUrls(m: MediaPointers) {
  // ✅ Single source of truth: storageBucket/storagePath (+ thumbBucket/thumbPath)
  // url/thumbUrl are legacy fallbacks ONLY if already valid http(s).

  const bucket = typeof m.storageBucket === 'string' ? m.storageBucket.trim() : ''
  const path = typeof m.storagePath === 'string' ? m.storagePath.trim() : ''

  const main =
    bucket && path
      ? isPrivateBucket(bucket)
        ? await signedUrl(bucket, path)
        : publicUrl(bucket, path)
      : null

  const tBucket = typeof m.thumbBucket === 'string' ? m.thumbBucket.trim() : ''
  const tPath = typeof m.thumbPath === 'string' ? m.thumbPath.trim() : ''

  const thumb =
    tBucket && tPath
      ? isPrivateBucket(tBucket)
        ? await signedUrl(tBucket, tPath)
        : publicUrl(tBucket, tPath)
      : null

  return {
    renderUrl: main ?? safeUrl(m.url),
    renderThumbUrl: thumb ?? safeUrl(m.thumbUrl),
  }
}