// lib/media/imageTransform.ts
//
// Supabase's on-the-fly image render endpoint, expressed as a small set of
// NAMED variants.
//
// Why this exists: `MediaAsset.thumbUrl` is null on every row in the database —
// nothing has ever generated a thumbnail — so every surface falls through to
// the stored original, which for a phone capture is a ~4.5 MB, 3024×4032 JPEG.
// Five of those is 21.5 MB, and on a slow 4G connection the looks feed spent
// 40 s waiting on photographs. Rendering a variant on demand costs one URL.
//
// Storing pre-generated thumbs at upload time stays the fallback if the render
// endpoint's metering ever bites: `thumbBucket`/`thumbPath` are already in the
// schema and `recordMediaAsset` already accepts them, and a stored thumb always
// wins over a derived one (see `renderUrls.ts`).

import { BUCKETS } from '@/lib/storageBuckets'

/**
 * 🔴 `resize=contain` is MANDATORY and is why this is a helper rather than a
 * string concatenation at the call site.
 *
 * `?width=1080` **on its own does not preserve the aspect ratio.** Against a
 * real 3024×4032 look on production it returns **1080×4032** — the photograph
 * stretched to two and a half times its height. The byte count still looks like
 * a win (4.46 MB → 648 KB), so nothing downstream notices; only the picture is
 * wrong. `resize=contain` returns 1080×1440, the correct 3:4, at 283 KB.
 *
 * It is therefore hard-coded here, not a parameter, and there is a test on it.
 */
const RESIZE_MODE = 'contain'

/**
 * The variants, named for the surface that asks for one.
 *
 * ⚠️ Pick per call site, and never blanket-default to `feed`: `feed` is sized
 * for ONE full-screen slide, and 60 of them on a profile grid is 17 MB again —
 * the very problem this module exists to fix.
 */
export const IMAGE_VARIANTS = {
  /** A full-bleed slide — the looks feed and look detail. 393pt @3x ≈ 1179px. */
  feed: { width: 1080, quality: 70 },
  /** One cell of a grid — profile, portfolio, boards, moderation, digests. */
  tile: { width: 512, quality: 68 },
} as const

export type ImageVariant = keyof typeof IMAGE_VARIANTS

/**
 * Percent-encode each path segment while leaving the `/` separators intact.
 * `encodeURIComponent` on the whole path would escape the separators too.
 */
export function encodeStoragePath(path: string): string {
  return path
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/')
}

/** `<base>/storage/v1/object/public/<bucket>/<path>` — the stored original. */
export function publicObjectUrl(
  baseUrl: string,
  bucket: string,
  path: string,
): string | null {
  if (!baseUrl || !bucket || !path) return null

  return `${baseUrl}/storage/v1/object/public/${encodeURIComponent(bucket)}/${encodeStoragePath(path)}`
}

/**
 * The render-endpoint URL for one variant of a **public** object, or `null`.
 *
 * Public-bucket only, deliberately. Private media is served through a signed
 * URL whose token is bound to the `object` path, so pointing the render
 * endpoint at it would simply 400 — and `recordMediaAsset` forbids `PRO_CLIENT`
 * media in the public bucket, so refusing here is also the privacy-safe answer
 * rather than merely the working one.
 */
export function transformedImageUrl(args: {
  baseUrl: string | null | undefined
  bucket: string
  path: string
  variant: ImageVariant
}): string | null {
  const { baseUrl, bucket, path, variant } = args

  if (!baseUrl || !path) return null
  if (bucket !== BUCKETS.mediaPublic) return null

  const spec = IMAGE_VARIANTS[variant]
  if (!spec) return null

  const query = new URLSearchParams({
    width: String(spec.width),
    resize: RESIZE_MODE,
    quality: String(spec.quality),
  })

  return `${baseUrl}/storage/v1/render/image/public/${encodeURIComponent(bucket)}/${encodeStoragePath(path)}?${query.toString()}`
}
