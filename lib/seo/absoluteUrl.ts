// lib/seo/absoluteUrl.ts
//
// Absolute URL for crawler-facing surfaces (JSON-LD @id/url, sitemap
// entries). Metadata fields go through Next's metadataBase instead — this is
// only for places that must emit a full URL themselves.
export function absoluteUrl(path: string): string {
  const base = process.env.NEXT_PUBLIC_APP_URL?.trim()
  if (!base) return path

  return new URL(path, base).toString()
}
