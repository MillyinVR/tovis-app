// lib/media/cropDrag.ts
//
// The geometry behind the pro's re-frame editor (capture chain item 4): moving
// and resizing a crop rect under a pointer, always inside the frame the pro is
// allowed to reach.
//
// It is a separate, pure module from the component on purpose. Drag maths is
// exactly the kind of thing that looks right on screen and is wrong at the
// edges, and "the rect never leaves the consent bound" is a claim worth a test
// rather than an eyeball. The component owns pointers and pixels; this owns the
// rect.
//
// 🔴 The clamping here is DEFENCE IN DEPTH, never the enforcement. The bound
// that matters is applied server-side in PUT /api/v1/pro/media/[id]/crop, which
// re-reads it from the database and re-checks at execution. A pro with a console
// open is not stopped by this file, and is not supposed to be.
//
// ── No aspect lock, deliberately ────────────────────────────────────────────
// Item 3 made the feed CONTAIN its media — the whole published frame is shown
// over a blurred backdrop, nothing cropped away — so the rect no longer has to
// match any surface's shape. A locked aspect would add a second, invisible
// constraint on top of the consent bound (which corner wins when both bind?) to
// serve a fit that no longer crops. Free-form, with `suggestCropRect` for a
// sensible starting frame, is the honest control.

import { clamp } from '@/lib/pick'
import { crop as socialExportCrop } from '@/lib/media/socialExportGeometry'
import type { CropRect } from '@/lib/media/cropRect'
import { FULL_FRAME_CROP } from '@/lib/media/cropRect'

/**
 * The smallest edge a crop may be dragged to, as a fraction of the stored
 * frame. Small enough to allow a genuine tight crop of a face; large enough
 * that a stray pointer cannot collapse a photo to a sliver the pro then has to
 * fight to recover — and inside the window, cannot recover at all once it shuts.
 */
export const MIN_CROP_EXTENT = 0.08

/** The eight drag handles, plus the whole-rect move. */
export type CropHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'

/**
 * The minimum extent actually usable inside `bound` — a bound narrower than
 * {@link MIN_CROP_EXTENT} must not make every drag impossible.
 */
function minExtent(boundExtent: number): number {
  return Math.min(MIN_CROP_EXTENT, boundExtent)
}

/**
 * Slide the whole rect by (dx, dy), stopping at the edges of `bound`.
 *
 * The rect keeps its size: a move that would push it out is clamped rather than
 * shrunk, which is what a pointer drag means. If the rect is somehow already
 * bigger than the bound (a bound that shrank underneath it), it is clamped to
 * the bound's own origin rather than snapping to something arbitrary.
 */
export function moveCropRect(
  rect: CropRect,
  delta: { dx: number; dy: number },
  bound: CropRect = FULL_FRAME_CROP,
): CropRect {
  const maxX = Math.max(bound.x, bound.x + bound.w - rect.w)
  const maxY = Math.max(bound.y, bound.y + bound.h - rect.h)

  return {
    x: clamp(rect.x + delta.dx, bound.x, maxX),
    y: clamp(rect.y + delta.dy, bound.y, maxY),
    w: rect.w,
    h: rect.h,
  }
}

/**
 * Drag one handle by (dx, dy).
 *
 * Each edge the handle owns moves; the opposite edge is pinned. Every edge is
 * clamped into `bound` first and then against the minimum extent, so a handle
 * dragged past its opposite edge stops at the minimum instead of inverting the
 * rect (which would render as an empty window, or worse, a negative-extent one
 * that `resolveCropRect` throws away as "no crop" — silently WIDENING the frame
 * to the whole photo).
 */
export function resizeCropRect(
  rect: CropRect,
  handle: CropHandle,
  delta: { dx: number; dy: number },
  bound: CropRect = FULL_FRAME_CROP,
): CropRect {
  const boundRight = bound.x + bound.w
  const boundBottom = bound.y + bound.h

  let left = rect.x
  let right = rect.x + rect.w
  let top = rect.y
  let bottom = rect.y + rect.h

  const minW = minExtent(bound.w)
  const minH = minExtent(bound.h)

  if (handle.includes('w')) {
    left = clamp(left + delta.dx, bound.x, right - minW)
  }
  if (handle.includes('e')) {
    right = clamp(right + delta.dx, left + minW, boundRight)
  }
  if (handle.includes('n')) {
    top = clamp(top + delta.dy, bound.y, bottom - minH)
  }
  if (handle.includes('s')) {
    bottom = clamp(bottom + delta.dy, top + minH, boundBottom)
  }

  return { x: left, y: top, w: right - left, h: bottom - top }
}

/**
 * Force a rect wholly inside `bound` — used when the bound itself changes under
 * an open editor (the undo window shutting mid-session, say), and as the last
 * step before a save.
 *
 * Shrinks before it slides: a rect larger than the bound cannot be moved into
 * it, and returning something that still pokes out would be refused by the
 * server with nothing on screen to explain why.
 */
export function clampCropRect(
  rect: CropRect,
  bound: CropRect = FULL_FRAME_CROP,
): CropRect {
  const w = Math.min(rect.w, bound.w)
  const h = Math.min(rect.h, bound.h)

  return {
    x: clamp(rect.x, bound.x, bound.x + bound.w - w),
    y: clamp(rect.y, bound.y, bound.y + bound.h - h),
    w,
    h,
  }
}

/**
 * A sensible starting frame for a given shape — the "suggest" button.
 *
 * 🔴 Delegates to `socialExportGeometry.crop`, which is where this codebase's
 * framing taste already lives: the largest target-aspect rect that fits, slid so
 * the subject lands on `SUBJECT_ANCHOR_Y = 0.44` (heads sit a little above
 * centre, which is what reads as a portrait rather than a passport photo).
 * Re-deriving that here would give the editor a second opinion about where a
 * face belongs, and the two would drift.
 *
 * The result is then clamped into `bound`, because a suggestion is still a
 * re-frame and obeys the same rule as a drag.
 */
export function suggestCropRect(args: {
  sourceAspect: number
  targetAspect: number
  /** Normalized subject box in the stored frame, when one is known. */
  subject?: { x: number; y: number; width: number; height: number } | null
  bound?: CropRect
}): CropRect {
  const planned = socialExportCrop({
    sourceAspect: args.sourceAspect,
    targetAspect: args.targetAspect,
    subject: args.subject ?? null,
  })

  return clampCropRect(
    { x: planned.x, y: planned.y, w: planned.width, h: planned.height },
    args.bound ?? FULL_FRAME_CROP,
  )
}
