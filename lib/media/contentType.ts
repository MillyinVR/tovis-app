// lib/media/contentType.ts
//
// Single source of truth for deriving a file extension + MediaType from a MIME
// content type. Previously inlined as `guessExtFromType` in the pro/client upload
// signing routes and again in copyToPublicBucket; centralized here so the storage
// path extensions and image/video classification stay consistent everywhere.

import { MediaType } from '@prisma/client'

/** Maps a MIME content type to a storage file extension (falls back to 'bin'). */
export function extensionForContentType(contentType: string): string {
  const t = contentType.toLowerCase()
  if (t.includes('png')) return 'png'
  if (t.includes('jpeg') || t.includes('jpg')) return 'jpg'
  if (t.includes('webp')) return 'webp'
  if (t.includes('heic') || t.includes('heif')) return 'heic'
  if (t.includes('mp4')) return 'mp4'
  if (t.includes('quicktime')) return 'mov'
  return 'bin'
}

/** Classifies a MIME content type as VIDEO or (default) IMAGE. */
export function mediaTypeFromContentType(contentType: string): MediaType {
  return contentType.toLowerCase().startsWith('video/')
    ? MediaType.VIDEO
    : MediaType.IMAGE
}
