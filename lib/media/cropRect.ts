// lib/media/cropRect.ts
//
// The non-destructive publish CROP of a MediaAsset — the rect of the STORED
// image a surface should display, normalized [0,1] from the TOP-LEFT origin.
// Same convention and same space as the focal point (lib/media/focalPoint.ts):
// the original, EXIF-corrected upright image at `storagePath`.
//
// `null` (no crop stored) means "the full stored frame" — identical to the
// pre-crop behavior — so every legacy row and every surface renders
// byte-identically until a rect is supplied.
//
// ── Why a stored rect and not baked pixels ──────────────────────────────────
// The web upload editor (lib/media/processImageForUpload.ts +
// app/pro/media/new/ImageEditModal.tsx) crops DESTRUCTIVELY: it cuts the file
// before upload, so the pixels outside the cut are gone forever and the framing
// can never be revisited. This module is the opposite and is the canonical one
// going forward — see docs/design/media-crop-rect.md for the decision and
// the retirement plan for the destructive path.
//
// ── The consent bound (enforced at the WRITE) ───────────────────────────────
// The stored rect is the frame the pro published and the client consented to
// seeing. A re-frame may move and narrow ANYWHERE inside that rect, but may
// never reach outside it — reaching outside reveals pixels the published frame
// had removed (the rest of the room, another client, the body below a head
// crop). {@link cropContains} is that rule; PUT /api/v1/pro/media/[id]/crop is
// where it is applied, so a UI bug cannot widen a frame on its own.
//
// Storage: MediaAsset.cropX / cropY / cropW / cropH.

import { resolveFocalPoint, type FocalPoint } from '@/lib/media/focalPoint'
import type { MediaType } from '@prisma/client'

/** A normalized crop rect: origin (x, y) + extent (w, h), all in [0,1]. */
export type CropRect = { x: number; y: number; w: number; h: number }

/** The whole stored image — what a null crop means, and the bound at creation. */
export const FULL_FRAME_CROP: CropRect = { x: 0, y: 0, w: 1, h: 1 }

/**
 * Slack for float comparisons. A rect that round-trips through JSON, a Float8
 * column and a device's Double can land a few ULPs outside the unit square
 * without meaning to; refusing that would reject a rect the pro legitimately
 * dragged to an edge. Small enough that it can never hide a real widening — a
 * micron of a frame is not a pixel of anybody's photograph.
 */
const EPSILON = 1e-6

function isFiniteNumber(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

/**
 * Builds a validated {@link CropRect} from a stored/incoming quadruple, or
 * `null` when the rect is incomplete, degenerate, or reaches outside the stored
 * frame.
 *
 * Lenient by design, like {@link resolveFocalPoint}: a malformed rect degrades
 * to `null` (the full frame) rather than throwing, because a crop is a framing
 * hint and must never cost a pro their photo. The leniency is also what keeps
 * a PARTIAL rect out of the database — three columns set and one null has no
 * meaning, so the whole rect resolves to null instead.
 */
export function resolveCropRect(
  cropX: number | null | undefined,
  cropY: number | null | undefined,
  cropW: number | null | undefined,
  cropH: number | null | undefined,
): CropRect | null {
  if (
    !isFiniteNumber(cropX) ||
    !isFiniteNumber(cropY) ||
    !isFiniteNumber(cropW) ||
    !isFiniteNumber(cropH)
  ) {
    return null
  }

  // A zero-extent rect would display nothing at all; a negative one is a sign
  // error upstream. Both are "no crop", never a blank tile.
  if (cropW <= 0 || cropH <= 0) return null

  if (cropX < -EPSILON || cropY < -EPSILON) return null
  if (cropX + cropW > 1 + EPSILON || cropY + cropH > 1 + EPSILON) return null

  return { x: cropX, y: cropY, w: cropW, h: cropH }
}

/**
 * The scalar columns for a rect, ready to spread into a Prisma write. Always
 * all four keys, so a write can never leave three columns set and one stale.
 */
export function cropRectColumns(crop: CropRect | null): {
  cropX: number | null
  cropY: number | null
  cropW: number | null
  cropH: number | null
} {
  return {
    cropX: crop?.x ?? null,
    cropY: crop?.y ?? null,
    cropW: crop?.w ?? null,
    cropH: crop?.h ?? null,
  }
}

/**
 * Is `inner` wholly inside `outer`? The consent rule: a re-frame is allowed
 * exactly when the new rect stays within the frame already published.
 *
 * Equality passes (a no-op save is not a widening). Every edge is compared with
 * {@link EPSILON} slack, in the permissive direction — the alternative is
 * refusing a pro's own unchanged rect after a float round-trip.
 */
export function cropContains(outer: CropRect, inner: CropRect): boolean {
  return (
    inner.x >= outer.x - EPSILON &&
    inner.y >= outer.y - EPSILON &&
    inner.x + inner.w <= outer.x + outer.w + EPSILON &&
    inner.y + inner.h <= outer.y + outer.h + EPSILON
  )
}

/**
 * Re-express a focal point in a crop's OWN [0,1] space.
 *
 * 🔴 THE DANGEROUS ONE. The focal is computed on the UNCROPPED frame (iOS
 * PhotoQC / camera C6 measure the face in the full capture), and the stored
 * rect is in that same frame — but a surface that displays only the crop window
 * needs the focal relative to THAT window. Handing it the uncropped focal
 * silently mis-centers the cover-crop: no crash, no error, nothing that looks
 * wrong in review, just somebody's shoulder where their face should be.
 *
 * The mapping is `(focal − origin) / extent` — the exact twin of iOS
 * `PublishCrop.inCropSpace`, which is why both sides are tested against the
 * same worked numbers.
 *
 * Returns `null` when the focal falls OUTSIDE the crop (the subject was framed
 * out), because a focal outside [0,1] is not a position a cover-crop can honor;
 * the caller then centers, which is the honest answer.
 */
export function focalInCropSpace(
  focal: FocalPoint | null | undefined,
  crop: CropRect | null | undefined,
): FocalPoint | null {
  if (!focal) return null
  // No crop = the full frame, where crop space IS frame space.
  if (!crop) return focal
  if (crop.w <= 0 || crop.h <= 0) return focal

  const x = (focal.x - crop.x) / crop.w
  const y = (focal.y - crop.y) / crop.h

  if (x < -EPSILON || x > 1 + EPSILON) return null
  if (y < -EPSILON || y > 1 + EPSILON) return null

  // Clamp the epsilon slack away so a caller never sees 1.0000000001.
  return { x: Math.min(1, Math.max(0, x)), y: Math.min(1, Math.max(0, y)) }
}

/**
 * Everything a cover-cropping surface needs from a media row: the rect to
 * display, and the focal ALREADY remapped into that rect's space.
 *
 * One helper because every surface that honours the rect — the looks feed, every
 * 3:4 browse tile, the 4:5 heroes — needs exactly the same three steps, and doing
 * them by hand at each call site is precisely how one of them ends up handing a
 * cropping box an uncropped focal (see {@link focalInCropSpace}: no crash, no
 * error, just somebody's shoulder where their face should be).
 *
 * 🔴 VIDEO is excluded, and iOS makes the SAME exclusion. A clip's frame has to
 * come from its poster and that is unbuilt on both platforms; honouring a rect
 * here but not on the device would put one look in two shapes, which is the exact
 * defect this whole track exists to fix.
 */
export function resolveDisplayCrop(source: {
  mediaType: MediaType | 'IMAGE' | 'VIDEO'
  focalX: number | null | undefined
  focalY: number | null | undefined
  cropX: number | null | undefined
  cropY: number | null | undefined
  cropW: number | null | undefined
  cropH: number | null | undefined
}): { cropRect: CropRect | null; focalPoint: FocalPoint | null } {
  const cropRect =
    source.mediaType === 'VIDEO'
      ? null
      : resolveCropRect(source.cropX, source.cropY, source.cropW, source.cropH)

  // Null crop → crop space IS frame space, so this returns the focal unchanged
  // and the surface renders byte-identically to before it honoured the rect.
  return {
    cropRect,
    focalPoint: focalInCropSpace(
      resolveFocalPoint(source.focalX, source.focalY),
      cropRect,
    ),
  }
}
