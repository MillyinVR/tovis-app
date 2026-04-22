// lib/media/renderUrls.ts
import 'server-only'

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

  return {
    renderUrl: main ?? safeUrl(m.url),
    renderThumbUrl: thumb ?? safeUrl(m.thumbUrl),
  }
}