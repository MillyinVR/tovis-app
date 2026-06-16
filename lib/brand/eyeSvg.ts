// lib/brand/eyeSvg.ts
//
// The Eye as a raw SVG string + data URL, for contexts that can't render the
// React component — favicon/apple-icon/OG ImageResponse routes. Plus a small
// RGB-triplet → hex helper for manifest/theme-color (brand tokens store RGB
// as space-separated triplets, but those APIs want CSS color strings).

export const TOVIS_EYE_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">' +
  '<defs><radialGradient id="te" cx="48%" cy="40%" r="64%">' +
  '<stop offset="0%" stop-color="#FFF6E2"/>' +
  '<stop offset="22%" stop-color="#F2B43E"/>' +
  '<stop offset="48%" stop-color="#15C9A8"/>' +
  '<stop offset="74%" stop-color="#1574C4"/>' +
  '<stop offset="100%" stop-color="#6B4BE6"/>' +
  '</radialGradient></defs>' +
  '<path d="M50 4 C78 27 78 73 50 96 C22 73 22 27 50 4 Z" fill="url(#te)"/>' +
  '<circle cx="42" cy="38" r="6.5" fill="#FFF6E2"/>' +
  '</svg>'

/** Data URL form for <img src> inside next/og ImageResponse (Satori). */
export const TOVIS_EYE_DATA_URL = `data:image/svg+xml;utf8,${encodeURIComponent(
  TOVIS_EYE_SVG,
)}`

/** "21 201 168" → "#15c9a8". For manifest theme_color / viewport themeColor. */
export function rgbTripletToHex(triplet: string): string {
  const toHex = (n: number) =>
    Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0')
  const [r = 0, g = 0, b = 0] = triplet
    .trim()
    .split(/\s+/)
    .map((n) => Number(n))
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`
}
