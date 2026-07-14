// lib/media/focalPoint.ts
//
// A normalized focal point on a MediaAsset — the (x, y) of the subject (a face,
// per camera C6) in the ORIGINAL, EXIF-corrected upright image, both in [0, 1]
// from the TOP-LEFT origin. It exists so cover-cropped surfaces (the full-screen
// Looks feed above all) can center their visible window on the subject instead
// of the blind geometric center a plain `object-fit: cover` picks.
//
// `null` (no focal stored) means "center" — identical to the pre-C6 behavior —
// so every legacy row and every surface renders byte-identically until a focal
// is supplied (the iOS capture path, C6b, is the v1 source).
//
// Storage: MediaAsset.focalX / focalY. Render: CSS `object-position` (web) /
// UnitPoint (iOS). The top-left origin is chosen to map 1:1 onto both.

export type FocalPoint = { x: number; y: number }

function isNormalizedCoord(value: number | null | undefined): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 1
  )
}

/**
 * Builds a validated {@link FocalPoint} from a stored/incoming focalX/focalY
 * pair, or `null` when either coordinate is missing or outside the [0, 1] range.
 * Lenient by design: a malformed focal degrades to `null` (center) rather than
 * erroring, because focal is a non-critical crop hint, never load-bearing.
 */
export function resolveFocalPoint(
  focalX: number | null | undefined,
  focalY: number | null | undefined,
): FocalPoint | null {
  if (!isNormalizedCoord(focalX) || !isNormalizedCoord(focalY)) return null
  return { x: focalX, y: focalY }
}

/**
 * The CSS `object-position` value for a focal point, or `undefined` when there
 * is no focal — so the caller omits the property entirely and the browser
 * default (`50% 50%`, dead center) applies, keeping a null focal byte-identical
 * to the pre-C6 render.
 */
export function focalObjectPosition(
  focal: FocalPoint | null | undefined,
): string | undefined {
  if (!focal) return undefined
  // One decimal place is plenty of precision for a crop origin and keeps the
  // emitted string stable/short.
  const x = Math.round(focal.x * 1000) / 10
  const y = Math.round(focal.y * 1000) / 10
  return `${x}% ${y}%`
}

/**
 * Convenience: `object-position` string straight from a stored focalX/focalY
 * pair (validates + formats in one call), or `undefined` for a missing/invalid
 * focal → center.
 */
export function focalObjectPositionFromCoords(
  focalX: number | null | undefined,
  focalY: number | null | undefined,
): string | undefined {
  return focalObjectPosition(resolveFocalPoint(focalX, focalY))
}
