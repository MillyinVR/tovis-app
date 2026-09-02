// lib/media/cropWindow.ts
//
// DISPLAY geometry for the publish crop — where a crop window lands inside a
// container, in pixels. The read-side twin of `lib/media/cropRect.ts` (which
// owns the rect itself and the consent bound) and the display counterpart of
// `lib/media/socialExportGeometry.ts` (which plans an EXPORT canvas, not a
// screen). Pure arithmetic: no DOM, no React, no units beyond "px".
//
// ── Why this exists at all ─────────────────────────────────────────────────
// CSS `object-fit` can only fit the WHOLE image. Once a stored rect says
// "display this window of the image", `object-fit` has no way to express it —
// the window is smaller than the source, so the browser would have to zoom, and
// `cover`/`contain` do not take a zoom. So a cropped surface positions the
// source by hand: a clipping box the size of the window, with the source
// oversized and offset inside it. These three functions are that arithmetic.
//
// ── The invariant that keeps the two paths honest ──────────────────────────
// With `crop = null` (the full frame — every row in the database today) the
// numbers this module produces are EXACTLY what `object-fit: cover|contain` +
// `object-position` already produce. That is asserted in cropWindow.test.ts, and
// it is what lets `MediaFill` keep its zero-JS CSS path for the null case while
// the cropped case goes through here. See docs/design/media-crop-rect.md.
//
// 🔴 Load-bearing arithmetic, like its iOS twin (`LookFeedLayout` in TovisKit):
// a sign error here does not crash and does not look wrong in a diff — it just
// shows the wrong part of somebody's photograph. Both sides are pinned to the
// same worked numbers.

import type { CropRect } from '@/lib/media/cropRect'
import type { FocalPoint } from '@/lib/media/focalPoint'

/** A pixel size. */
export type Size = { width: number; height: number }

/** A pixel rect, positioned relative to its containing box's top-left. */
export type Box = { left: number; top: number; width: number; height: number }

/** `object-position: 50% 50%` — the CSS default, and what a null focal means. */
const CENTER: FocalPoint = { x: 0.5, y: 0.5 }

function isUsableSize(size: Size | null | undefined): size is Size {
  return (
    !!size &&
    Number.isFinite(size.width) &&
    Number.isFinite(size.height) &&
    size.width > 0 &&
    size.height > 0
  )
}

/**
 * The pixel size of the crop window on a source of intrinsic size `natural`.
 * A null crop is the full frame, so the window IS the source.
 */
export function cropWindowSize(
  crop: CropRect | null | undefined,
  natural: Size,
): Size {
  if (!crop) return { width: natural.width, height: natural.height }
  return { width: natural.width * crop.w, height: natural.height * crop.h }
}

/**
 * Place a window of size `window` inside `container`, scaled to `fit` and
 * positioned by `focal`.
 *
 * This is `object-fit` + `object-position` expressed in pixels, on purpose:
 *  • `contain` → the largest scale that fits (letterbox bars appear),
 *  • `cover`   → the smallest scale that covers (the overflow is clipped),
 *  • `focal`   → where the overflow (or the bars) is spent, exactly as
 *    `object-position: x% y%` spends it. Null/undefined → dead center.
 *
 * Returns a zero box for a degenerate window or container rather than emitting
 * NaN/Infinity into a style attribute — a caller with nothing measured yet
 * renders nothing, which is also the consent-safe answer (see MediaFill).
 */
export function fitWindowBox(
  window: Size,
  container: Size,
  fit: 'contain' | 'cover',
  focal?: FocalPoint | null,
): Box {
  if (!isUsableSize(window) || !isUsableSize(container)) {
    return { left: 0, top: 0, width: 0, height: 0 }
  }

  const scaleX = container.width / window.width
  const scaleY = container.height / window.height
  const scale = fit === 'contain' ? Math.min(scaleX, scaleY) : Math.max(scaleX, scaleY)

  const width = window.width * scale
  const height = window.height * scale

  const anchor = focal ?? CENTER
  // Identical to CSS `object-position`: the free space (negative when covering)
  // is distributed by the anchor fraction. 0.5 → centered → the CSS default.
  return {
    left: (container.width - width) * anchor.x,
    top: (container.height - height) * anchor.y,
    width,
    height,
  }
}

/**
 * Where the WHOLE source sits inside a window box of size `windowBox`, so that
 * the window's own origin lands at the box's top-left.
 *
 * The source is scaled up by 1/w × 1/h (so the window fills the box exactly) and
 * pulled back by the window's origin. The result always has the source's own
 * aspect ratio when `windowBox` has the window's — which is what
 * {@link fitWindowBox} guarantees — so the caller can render the image with
 * `object-fit: fill` into this box without distorting it.
 *
 * A null crop is the full frame: the source is the box, unscaled and unshifted.
 */
export function sourceBoxInWindow(
  crop: CropRect | null | undefined,
  windowBox: Size,
): Box {
  if (!isUsableSize(windowBox)) {
    return { left: 0, top: 0, width: 0, height: 0 }
  }
  if (!crop) {
    return { left: 0, top: 0, width: windowBox.width, height: windowBox.height }
  }

  const width = windowBox.width / crop.w
  const height = windowBox.height / crop.h

  return { left: -crop.x * width, top: -crop.y * height, width, height }
}
