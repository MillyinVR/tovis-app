// lib/media/cropDrag.test.ts
//
// The editor's geometry. Written around the edges rather than the happy path —
// a drag that looks right in the middle of the frame and inverts at the corner
// is the whole reason this is a module and not inline in a component.

import { describe, expect, it } from 'vitest'

import {
  clampCropRect,
  MIN_CROP_EXTENT,
  moveCropRect,
  resizeCropRect,
  suggestCropRect,
} from './cropDrag'
import { resolveCropRect, type CropRect } from './cropRect'

/** Rects are float arithmetic — compare per field with slack, never toEqual. */
function expectRect(actual: CropRect, expected: CropRect) {
  expect(actual.x).toBeCloseTo(expected.x, 10)
  expect(actual.y).toBeCloseTo(expected.y, 10)
  expect(actual.w).toBeCloseTo(expected.w, 10)
  expect(actual.h).toBeCloseTo(expected.h, 10)
}

const FULL = { x: 0, y: 0, w: 1, h: 1 }
/** A pro who has already narrowed once — the interesting bound. */
const BOUND = { x: 0.2, y: 0.2, w: 0.6, h: 0.6 }

describe('moveCropRect', () => {
  it('slides the rect and keeps its size', () => {
    const moved = moveCropRect({ x: 0.3, y: 0.3, w: 0.2, h: 0.2 }, { dx: 0.1, dy: -0.05 }, BOUND)
    expectRect(moved, { x: 0.4, y: 0.25, w: 0.2, h: 0.2 })
  })

  it('stops at the bound instead of leaving it', () => {
    const moved = moveCropRect({ x: 0.3, y: 0.3, w: 0.2, h: 0.2 }, { dx: 5, dy: 5 }, BOUND)
    // Flush against the bottom-right of the bound, same size.
    expectRect(moved, { x: 0.6, y: 0.6, w: 0.2, h: 0.2 })
  })

  it('stops at the bound going the other way too', () => {
    const moved = moveCropRect({ x: 0.3, y: 0.3, w: 0.2, h: 0.2 }, { dx: -5, dy: -5 }, BOUND)
    expectRect(moved, { x: 0.2, y: 0.2, w: 0.2, h: 0.2 })
  })

  it('never produces a rect outside the bound, for any delta', () => {
    for (const dx of [-2, -0.31, -0.05, 0, 0.05, 0.31, 2]) {
      for (const dy of [-2, -0.31, 0, 0.31, 2]) {
        const r = moveCropRect({ x: 0.3, y: 0.3, w: 0.2, h: 0.2 }, { dx, dy }, BOUND)
        expect(r.x).toBeGreaterThanOrEqual(BOUND.x)
        expect(r.y).toBeGreaterThanOrEqual(BOUND.y)
        expect(r.x + r.w).toBeLessThanOrEqual(BOUND.x + BOUND.w + 1e-9)
        expect(r.y + r.h).toBeLessThanOrEqual(BOUND.y + BOUND.h + 1e-9)
      }
    }
  })
})

describe('resizeCropRect', () => {
  it('moves only the edges the handle owns', () => {
    const r = resizeCropRect({ x: 0.3, y: 0.3, w: 0.3, h: 0.3 }, 'se', { dx: 0.1, dy: 0.1 }, FULL)
    expectRect(r, { x: 0.3, y: 0.3, w: 0.4, h: 0.4 })
  })

  it('pins the opposite edge when dragging north-west', () => {
    const r = resizeCropRect({ x: 0.3, y: 0.3, w: 0.3, h: 0.3 }, 'nw', { dx: -0.1, dy: -0.1 }, FULL)
    expectRect(r, { x: 0.2, y: 0.2, w: 0.4, h: 0.4 })
  })

  it('leaves the free axis alone on an edge handle', () => {
    const r = resizeCropRect({ x: 0.3, y: 0.3, w: 0.3, h: 0.3 }, 'e', { dx: 0.1, dy: 0.9 }, FULL)
    expectRect(r, { x: 0.3, y: 0.3, w: 0.4, h: 0.3 })
  })

  it('cannot resize past the bound', () => {
    const r = resizeCropRect({ x: 0.3, y: 0.3, w: 0.2, h: 0.2 }, 'se', { dx: 5, dy: 5 }, BOUND)
    expect(r.x + r.w).toBeCloseTo(0.8, 10)
    expect(r.y + r.h).toBeCloseTo(0.8, 10)
  })

  // 🔴 The one that matters. An inverted rect has negative extent, which
  // `resolveCropRect` discards as "no crop" — and "no crop" means the FULL
  // FRAME. A handle dragged through its opposite edge would therefore widen the
  // photo to everything, which is exactly what the consent bound forbids.
  it('stops at the minimum instead of inverting the rect', () => {
    const r = resizeCropRect({ x: 0.3, y: 0.3, w: 0.3, h: 0.3 }, 'se', { dx: -5, dy: -5 }, FULL)

    expect(r.w).toBeCloseTo(MIN_CROP_EXTENT, 10)
    expect(r.h).toBeCloseTo(MIN_CROP_EXTENT, 10)
    expect(r.w).toBeGreaterThan(0)
    expect(resolveCropRect(r.x, r.y, r.w, r.h)).not.toBeNull()
  })

  it('stops at the minimum dragging the north-west handle through the far corner', () => {
    const r = resizeCropRect({ x: 0.3, y: 0.3, w: 0.3, h: 0.3 }, 'nw', { dx: 5, dy: 5 }, FULL)
    expect(r.w).toBeCloseTo(MIN_CROP_EXTENT, 10)
    expect(r.x + r.w).toBeCloseTo(0.6, 10)
  })

  it('shrinks the minimum to fit a bound narrower than it', () => {
    // A pro who already cropped very tight must still be able to drag at all.
    const tiny = { x: 0.5, y: 0.5, w: 0.04, h: 0.04 }
    const r = resizeCropRect({ x: 0.5, y: 0.5, w: 0.04, h: 0.04 }, 'se', { dx: -5, dy: -5 }, tiny)
    expect(r.w).toBeCloseTo(0.04, 10)
    expect(r.w).toBeGreaterThan(0)
  })
})

describe('clampCropRect', () => {
  it('shrinks before it slides when the rect is bigger than the bound', () => {
    // A rect larger than the bound cannot be moved into it. Returning something
    // that still pokes out would be refused by the server with nothing on
    // screen to explain why.
    const r = clampCropRect({ x: 0, y: 0, w: 1, h: 1 }, BOUND)
    expectRect(r, { x: 0.2, y: 0.2, w: 0.6, h: 0.6 })
  })

  it('slides a small rect back inside without resizing it', () => {
    const r = clampCropRect({ x: 0.9, y: 0.9, w: 0.1, h: 0.1 }, BOUND)
    expectRect(r, { x: 0.7, y: 0.7, w: 0.1, h: 0.1 })
  })

  it('leaves a rect that already fits untouched', () => {
    const inside = { x: 0.3, y: 0.3, w: 0.2, h: 0.2 }
    expectRect(clampCropRect(inside, BOUND), inside)
  })
})

describe('suggestCropRect', () => {
  it('lifts the crop toward the subject instead of centring it', () => {
    // The 0.44 anchor from socialExportGeometry — heads sit high. A dead-centre
    // crop is the signature of having re-derived this instead of reusing it.
    //
    // ⚠️ The target must be WIDER than the source for the vertical anchor to do
    // anything: a 9:16 target in a 3:4 photo fits full-height, leaving no
    // vertical slack, and only SUBJECT_ANCHOR_X applies. A square target in a
    // 3:4 photo leaves 0.25 of vertical travel, which is where 0.44 shows up.
    const withSubject = suggestCropRect({
      sourceAspect: 3 / 4,
      targetAspect: 1,
      subject: { x: 0.35, y: 0.1, width: 0.3, height: 0.3 },
    })
    const centred = suggestCropRect({ sourceAspect: 3 / 4, targetAspect: 1 })

    expect(centred.y).toBeCloseTo(0.125, 10)
    expect(withSubject.y).toBeLessThan(centred.y)
  })

  it('slides along X instead when the target is narrower than the source', () => {
    // The other branch of the same planner, pinned so the test above cannot be
    // read as "the anchor does nothing for 9:16".
    const withSubject = suggestCropRect({
      sourceAspect: 3 / 4,
      targetAspect: 9 / 16,
      subject: { x: 0.6, y: 0.1, width: 0.3, height: 0.3 },
    })
    const centred = suggestCropRect({ sourceAspect: 3 / 4, targetAspect: 9 / 16 })

    expect(withSubject.y).toBe(0)
    expect(centred.y).toBe(0)
    expect(withSubject.x).toBeGreaterThan(centred.x)
  })

  it('returns a rect the consent rule would accept', () => {
    const r = suggestCropRect({ sourceAspect: 3 / 4, targetAspect: 9 / 16 })
    expect(resolveCropRect(r.x, r.y, r.w, r.h)).not.toBeNull()
  })

  it('obeys the bound — a suggestion is still a re-frame', () => {
    const r = suggestCropRect({ sourceAspect: 3 / 4, targetAspect: 1, bound: BOUND })
    expect(r.x).toBeGreaterThanOrEqual(BOUND.x)
    expect(r.y).toBeGreaterThanOrEqual(BOUND.y)
    expect(r.x + r.w).toBeLessThanOrEqual(BOUND.x + BOUND.w + 1e-9)
    expect(r.y + r.h).toBeLessThanOrEqual(BOUND.y + BOUND.h + 1e-9)
  })
})
