// lib/brand/eyeSvg.ts
//
// The Eye — the single source of truth for the tovis mark's artwork.
//
// The mark is drawn in six places (three React components, two static SVG
// files, and the raw string below), and for two months they disagreed: the
// rebrand that introduced the mark drew the plume at 20/46/72% from a
// #FFF0C2 core, and two follow-up commits that said they were reproducing it
// hand-retyped 22/48/74% from a #FFF6E2 core. Both halves shipped — the
// footer mark and the wordmark's i-dot rendered one, the favicon, apple-icon,
// OG cards and loading splash the other. `assets.mark.src` and
// `assets.mark.svg` are documented as the same artwork in two transports and
// pointed at the two different versions.
//
// The rebrand's values are the mark (`public/brand/tovis/mark.svg` is the
// asset `assets.mark.src` names, and the drift arrived in commits whose own
// messages describe reproducing it, not changing it). Everything that draws
// the mark now composes these constants, so a copy cannot drift again; the
// two static files that cannot import are pinned by eyeSvg.test.ts.
//
// Also here: a small RGB-triplet -> hex helper for manifest/theme-color
// (brand tokens store RGB as space-separated triplets, but those APIs want
// CSS color strings).

/** The ocellus outline, on a 0 0 100 100 viewBox. */
export const TOVIS_EYE_PATH = 'M50 4 C78 27 78 73 50 96 C22 73 22 27 50 4 Z'

/** Plume origin — up and left of centre, so the light reads as a source. */
export const TOVIS_EYE_GRADIENT = { cx: '48%', cy: '40%', r: '64%' } as const

/** The plume: cream core -> gold -> teal -> blue -> iris. */
export const TOVIS_EYE_STOPS = [
  { offset: '0%', color: '#FFF0C2' },
  { offset: '20%', color: '#F2B43E' },
  { offset: '46%', color: '#15C9A8' },
  { offset: '72%', color: '#1574C4' },
  { offset: '100%', color: '#6B4BE6' },
] as const

/**
 * The cream glint. Dropped deliberately by the footer's feather (so the mark
 * reads as a luminous aperture rather than a cat's eye) and animated in a
 * brighter white by the loading splash; both are choices at those call sites,
 * not drift.
 */
export const TOVIS_EYE_GLINT = {
  cx: 42,
  cy: 38,
  r: 6.5,
  color: '#FFF6E2',
} as const

/**
 * The Eye as raw SVG markup, for contexts that can't render the React
 * component — favicon/apple-icon/OG ImageResponse routes.
 */
export const TOVIS_EYE_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">' +
  `<defs><radialGradient id="te" cx="${TOVIS_EYE_GRADIENT.cx}" cy="${TOVIS_EYE_GRADIENT.cy}" r="${TOVIS_EYE_GRADIENT.r}">` +
  TOVIS_EYE_STOPS.map(
    (s) => `<stop offset="${s.offset}" stop-color="${s.color}"/>`,
  ).join('') +
  '</radialGradient></defs>' +
  `<path d="${TOVIS_EYE_PATH}" fill="url(#te)"/>` +
  `<circle cx="${TOVIS_EYE_GLINT.cx}" cy="${TOVIS_EYE_GLINT.cy}" r="${TOVIS_EYE_GLINT.r}" fill="${TOVIS_EYE_GLINT.color}"/>` +
  '</svg>'

/** Wrap any SVG markup as a data URL for <img src> inside ImageResponse. */
export function svgToDataUrl(svg: string): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
}

/** Data URL form for <img src> inside next/og ImageResponse (Satori). */
export const TOVIS_EYE_DATA_URL = svgToDataUrl(TOVIS_EYE_SVG)

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
