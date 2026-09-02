// lib/media/cropUndoWindow.test.ts
//
// The window is a disclosure control, so the tests are written around the two
// ways it can be wrong: staying shut when a pro is trying to undo their own
// mistake, and staying OPEN long enough to stop being an undo.

import { describe, expect, it } from 'vitest'

import { FULL_FRAME_CROP } from '@/lib/media/cropRect'
import {
  CROP_UNDO_WINDOW_MS,
  cropConsentBound,
  cropUndoWindowColumnsForWrite,
  isCropUndoWindowOpen,
  type CropUndoWindowState,
} from './cropUndoWindow'

const NOW = new Date('2026-09-02T12:00:00.000Z')

/** The rect standing before the pro narrowed — what an undo may return to. */
const PRIOR = { x: 0.1, y: 0.1, w: 0.8, h: 0.8 }
/** What they narrowed to. */
const NARROWED = { cropX: 0.4, cropY: 0.4, cropW: 0.2, cropH: 0.2 }

const NO_WINDOW: CropUndoWindowState = {
  cropUndoBoundX: null,
  cropUndoBoundY: null,
  cropUndoBoundW: null,
  cropUndoBoundH: null,
  cropUndoExpiresAt: null,
  cropUndoViewBaseline: null,
}

function openWindow(over: Partial<CropUndoWindowState> = {}): CropUndoWindowState {
  return {
    cropUndoBoundX: PRIOR.x,
    cropUndoBoundY: PRIOR.y,
    cropUndoBoundW: PRIOR.w,
    cropUndoBoundH: PRIOR.h,
    cropUndoExpiresAt: new Date(NOW.getTime() + 60_000),
    cropUndoViewBaseline: 7,
    ...over,
  }
}

describe('isCropUndoWindowOpen', () => {
  it('is shut for a row that never opened one', () => {
    expect(isCropUndoWindowOpen(NO_WINDOW, { now: NOW, viewCountTotal: 0 })).toBe(false)
  })

  it('is open inside the expiry with no new views', () => {
    expect(isCropUndoWindowOpen(openWindow(), { now: NOW, viewCountTotal: 7 })).toBe(true)
  })

  it('shuts the instant the expiry is reached', () => {
    const state = openWindow({ cropUndoExpiresAt: NOW })
    expect(isCropUndoWindowOpen(state, { now: NOW, viewCountTotal: 0 })).toBe(false)
  })

  it('shuts as soon as ONE view lands after it opened', () => {
    // Tori's second closer: the argument for undoing is that nobody has seen the
    // tighter frame. One person seeing it ends that argument.
    expect(isCropUndoWindowOpen(openWindow(), { now: NOW, viewCountTotal: 8 })).toBe(false)
  })

  it('stays open when the view total has not moved', () => {
    expect(isCropUndoWindowOpen(openWindow(), { now: NOW, viewCountTotal: 7 })).toBe(true)
  })

  it('reads a missing baseline as zero views rather than as a refusal', () => {
    // A window opened before this column existed still has a working expiry;
    // treating null as "already viewed" would silently disable the undo.
    const state = openWindow({ cropUndoViewBaseline: null })
    expect(isCropUndoWindowOpen(state, { now: NOW, viewCountTotal: 0 })).toBe(true)
    expect(isCropUndoWindowOpen(state, { now: NOW, viewCountTotal: 1 })).toBe(false)
  })
})

describe('cropConsentBound', () => {
  it('is the PRE-NARROWING frame while the window is open', () => {
    const bound = cropConsentBound(NARROWED, openWindow(), {
      now: NOW,
      viewCountTotal: 7,
    })
    expect(bound).toEqual(PRIOR)
  })

  it('is the narrowed rect once the window has shut', () => {
    const bound = cropConsentBound(NARROWED, openWindow({ cropUndoExpiresAt: NOW }), {
      now: NOW,
      viewCountTotal: 0,
    })
    expect(bound).toEqual({ x: 0.4, y: 0.4, w: 0.2, h: 0.2 })
  })

  it('never widens past the pre-narrowing frame, even with the window open', () => {
    // 🔴 The reading that cannot leak. "Widen freely" is an UNDO, not an escape
    // hatch — the bound is where the pro was allowed to be, not the whole photo.
    const bound = cropConsentBound(NARROWED, openWindow(), {
      now: NOW,
      viewCountTotal: 7,
    })
    expect(bound).not.toEqual(FULL_FRAME_CROP)
    expect(bound.w).toBe(0.8)
  })

  it('is the whole photo for an asset that has no rect at all', () => {
    const bound = cropConsentBound(
      { cropX: null, cropY: null, cropW: null, cropH: null },
      NO_WINDOW,
      { now: NOW, viewCountTotal: 0 },
    )
    expect(bound).toEqual(FULL_FRAME_CROP)
  })
})

describe('cropUndoWindowColumnsForWrite', () => {
  it('opens a window around the bound it was enforced against', () => {
    const columns = cropUndoWindowColumnsForWrite(PRIOR, NO_WINDOW, {
      now: NOW,
      viewCountTotal: 3,
    })

    expect(columns).toEqual({
      cropUndoBoundX: 0.1,
      cropUndoBoundY: 0.1,
      cropUndoBoundW: 0.8,
      cropUndoBoundH: 0.8,
      cropUndoExpiresAt: new Date(NOW.getTime() + CROP_UNDO_WINDOW_MS),
      cropUndoViewBaseline: 3,
    })
  })

  it('leaves an OPEN window completely alone', () => {
    // 🔴 The anti-ratchet rule. If a save refreshed the clock, a pro could keep
    // the window open forever by re-cropping every 23 hours and the consent
    // ratchet would never engage at all.
    const columns = cropUndoWindowColumnsForWrite(PRIOR, openWindow(), {
      now: NOW,
      viewCountTotal: 7,
    })
    expect(columns).toBeNull()
  })

  it('opens a NEW window around the narrower rect once the old one expired', () => {
    // The bound is monotonically non-increasing across windows: it can only
    // settle onto a frame that survived a whole window.
    const expired = openWindow({ cropUndoExpiresAt: new Date(NOW.getTime() - 1) })
    const narrower = { x: 0.4, y: 0.4, w: 0.2, h: 0.2 }

    const columns = cropUndoWindowColumnsForWrite(narrower, expired, {
      now: NOW,
      viewCountTotal: 9,
    })

    expect(columns?.cropUndoBoundW).toBe(0.2)
    expect(columns?.cropUndoViewBaseline).toBe(9)
  })

  it('re-opens after a view closed the previous window', () => {
    const viewed = openWindow()
    const columns = cropUndoWindowColumnsForWrite(PRIOR, viewed, {
      now: NOW,
      viewCountTotal: 8,
    })
    expect(columns).not.toBeNull()
    expect(columns?.cropUndoViewBaseline).toBe(8)
  })
})
