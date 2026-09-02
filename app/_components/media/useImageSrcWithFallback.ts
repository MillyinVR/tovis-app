// app/_components/media/useImageSrcWithFallback.ts
//
// Safety net for a DERIVED image URL. `thumbUrl`-shaped fields are now usually
// a Supabase *render-endpoint* URL (lib/media/imageTransform) rather than a
// stored file, and Supabase documents image transformations as a Pro-plan
// feature while this project is on Free. It works today — the response carries
// `x-transformations: width:1080,resizing_type:fit,quality:70` — but if that
// ever stops being served, every photograph on the surface would break at
// once. Falling back to the stored original turns a blank surface into a slow
// one, which is exactly where we were before the renders.
//
// One hook so the feed, the booking sheet's cover and the add-ons strip make
// the same decision the same way; each used to be a candidate for its own copy.
'use client'

import { useCallback, useState } from 'react'

/**
 * `src` is `preferred` until it fails to load, then `fallback`. Re-failing on
 * the fallback sets the same state, so there is no loop; a consumer that keys
 * its element on the media id gets a fresh instance per photo, so no reset is
 * needed either.
 *
 * Hand the returned `onError` to the `<img>` that renders `src`.
 */
export function useImageSrcWithFallback(
  preferred: string | null,
  fallback: string | null,
): {
  src: string | null
  /** `preferred` until it fails, then null — for a use that must NOT fall back (a video's poster). */
  preferredOrNull: string | null
  onError: () => void
} {
  const [preferredFailed, setPreferredFailed] = useState(false)
  const onError = useCallback(() => setPreferredFailed(true), [])
  const preferredOrNull = preferredFailed ? null : preferred
  const src = preferredOrNull ?? fallback
  return { src, preferredOrNull, onError }
}
