// lib/media/cropUndoWindow.ts
//
// The UNDO WINDOW on a re-frame (capture chain item 4).
//
// ── The problem it solves ────────────────────────────────────────────────────
//
// The consent bound (lib/media/cropRect.ts, docs/design/media-crop-rect.md) is a
// one-way ratchet: a re-frame may move and narrow inside the current rect and
// never reach outside it. That is right for disclosure — reaching outside shows
// pixels the published frame had removed — but it made a pro's own mistake
// permanent. Drag the handle one notch too far, hit save, and the photograph is
// cropped that tight forever, with no re-consent flow to undo it.
//
// 🔴 Tori's decision (2026-09-01): a pro may re-widen freely for a set period
// after a crop — 24h, or until the look is viewed by anyone, whichever comes
// first — and after that it narrows only. No client re-consent flow. The
// argument is that nobody has seen the tighter frame yet, so putting it back is
// not a disclosure to anyone.
//
// ── What "freely" means here, precisely ──────────────────────────────────────
//
// ⚠️ "Freely" is bounded by the frame that stood BEFORE the narrowing, not by
// the whole photograph. The window is an UNDO, not an escape hatch: it lets a
// pro return to exactly where they were allowed to be a moment ago, and no
// further. Widening past the pre-narrowing frame would still be a fresh
// disclosure of somebody's photo, and no window makes that the pro's alone to
// make. Read Tori's wording either way and this is the reading that cannot
// leak: it permits strictly less than an unbounded window, and it delivers the
// undo she asked for.
//
// ── Why the window does not reset on every save ──────────────────────────────
//
// 🔴 Load-bearing. If each crop write restarted the 24h clock, a pro could hold
// the window open forever by re-cropping every 23 hours, and the ratchet would
// never engage at all — the bound would be permanently as wide as the day they
// first touched it. So an OPEN window is left exactly as it is by a further
// write: same bound, same expiry, same view baseline. Only a write made while
// NO window is open opens a new one, and it opens it around the rect standing at
// that moment. Across windows the bound is therefore monotonically
// non-increasing: it can only ever settle onto a frame that survived a full 24h
// (or was seen), which is the ratchet the consent rule wanted.
//
// ── The "viewed by anyone" half ──────────────────────────────────────────────
//
// ⚠️ `LookPost.viewCount` is the only view signal this codebase has, and it is
// SAMPLED and applied in batches by the APPLY_LOOK_VIEWS job — never written on
// the view hot path. So it lags, and it can miss views entirely. That is stated
// rather than papered over: the window is closed when the total view count
// across an asset's looks has RISEN above the baseline captured when the window
// opened, which answers "did anyone see it after the crop" as well as the data
// allows. Its failure direction is a window that stays open slightly too long —
// which is safe here, because the widest it can reach is a frame the client
// already consented to, and it is capped by the 24h expiry regardless.

import type { CropRect } from '@/lib/media/cropRect'
import { FULL_FRAME_CROP, resolveCropRect } from '@/lib/media/cropRect'

/** How long a re-frame stays undoable when nothing views the look first. */
export const CROP_UNDO_WINDOW_MS = 24 * 60 * 60 * 1000

/**
 * The undo-window columns on MediaAsset.
 *
 * `cropUndoExpiresAt` is the flag: null means no window has ever been opened (or
 * the row predates the feature). The bound columns are only meaningful while a
 * window is open, and all four move together exactly like the crop rect itself.
 */
export type CropUndoWindowState = {
  cropUndoBoundX: number | null
  cropUndoBoundY: number | null
  cropUndoBoundW: number | null
  cropUndoBoundH: number | null
  cropUndoExpiresAt: Date | null
  cropUndoViewBaseline: number | null
}

/** The stored rect columns, in the shape both this module and the route read. */
export type StoredCropColumns = {
  cropX: number | null
  cropY: number | null
  cropW: number | null
  cropH: number | null
}

/**
 * Is the undo window still open?
 *
 * Both closers are checked, and either one shuts it: the clock, and a view that
 * landed after the window opened. A `null` baseline (a window opened before this
 * field existed, or an asset backing no look at all) is read as 0 views, which
 * makes the view test a no-op rather than a refusal — the expiry still bounds it.
 */
export function isCropUndoWindowOpen(
  state: CropUndoWindowState,
  args: { now: Date; viewCountTotal: number },
): boolean {
  if (!state.cropUndoExpiresAt) return false
  if (state.cropUndoExpiresAt.getTime() <= args.now.getTime()) return false

  const baseline = state.cropUndoViewBaseline ?? 0
  return args.viewCountTotal <= baseline
}

/**
 * The rect a re-frame must stay inside.
 *
 * With the window open that is the frame standing before the narrowing it is
 * undoing; otherwise it is the rect as stored, which is the pre-existing
 * one-way rule. An asset with no rect at all is bounded by the whole photo —
 * the frame the client consented to when it was published — so a first re-frame
 * may go anywhere inside it.
 */
export function cropConsentBound(
  stored: StoredCropColumns,
  state: CropUndoWindowState,
  args: { now: Date; viewCountTotal: number },
): CropRect {
  if (isCropUndoWindowOpen(state, args)) {
    return (
      resolveCropRect(
        state.cropUndoBoundX,
        state.cropUndoBoundY,
        state.cropUndoBoundW,
        state.cropUndoBoundH,
      ) ?? FULL_FRAME_CROP
    )
  }

  return (
    resolveCropRect(stored.cropX, stored.cropY, stored.cropW, stored.cropH) ??
    FULL_FRAME_CROP
  )
}

/**
 * The undo-window columns a crop write should persist, or `null` to leave every
 * one of them untouched.
 *
 * 🔴 Returning `null` for an already-open window is the whole anti-ratchet rule
 * (see the header). Do not "refresh" it — a caller that spreads a fresh expiry
 * in here every save silently removes the bound.
 */
export function cropUndoWindowColumnsForWrite(
  bound: CropRect,
  state: CropUndoWindowState,
  args: { now: Date; viewCountTotal: number },
): {
  cropUndoBoundX: number
  cropUndoBoundY: number
  cropUndoBoundW: number
  cropUndoBoundH: number
  cropUndoExpiresAt: Date
  cropUndoViewBaseline: number
} | null {
  if (isCropUndoWindowOpen(state, args)) return null

  return {
    cropUndoBoundX: bound.x,
    cropUndoBoundY: bound.y,
    cropUndoBoundW: bound.w,
    cropUndoBoundH: bound.h,
    cropUndoExpiresAt: new Date(args.now.getTime() + CROP_UNDO_WINDOW_MS),
    cropUndoViewBaseline: args.viewCountTotal,
  }
}
