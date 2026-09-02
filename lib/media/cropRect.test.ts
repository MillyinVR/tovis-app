import { describe, expect, it } from 'vitest'

import {
  cropContains,
  cropRectColumns,
  focalInCropSpace,
  FULL_FRAME_CROP,
  resolveCropRect,
  type CropRect,
} from '@/lib/media/cropRect'
import { resolveFocalPoint } from '@/lib/media/focalPoint'

describe('resolveCropRect', () => {
  it('accepts a rect inside the frame', () => {
    expect(resolveCropRect(0.1, 0.2, 0.5, 0.6)).toEqual({
      x: 0.1,
      y: 0.2,
      w: 0.5,
      h: 0.6,
    })
  })

  it('accepts the full frame exactly', () => {
    expect(resolveCropRect(0, 0, 1, 1)).toEqual(FULL_FRAME_CROP)
  })

  // The load-bearing one: three of four columns is not a degraded crop, it is
  // an unanswerable one. It must resolve to "no crop", never a rect built from
  // whatever the missing coordinate defaults to.
  it.each([
    ['no x', [null, 0.2, 0.5, 0.6]],
    ['no y', [0.1, null, 0.5, 0.6]],
    ['no w', [0.1, 0.2, null, 0.6]],
    ['no h', [0.1, 0.2, 0.5, null]],
  ] as const)('refuses a partial rect (%s)', (_label, [x, y, w, h]) => {
    expect(resolveCropRect(x, y, w, h)).toBeNull()
  })

  it.each([
    ['zero width', [0.1, 0.2, 0, 0.6]],
    ['zero height', [0.1, 0.2, 0.5, 0]],
    ['negative width', [0.1, 0.2, -0.5, 0.6]],
    ['negative origin', [-0.1, 0.2, 0.5, 0.6]],
    ['runs off the right edge', [0.7, 0.2, 0.5, 0.6]],
    ['runs off the bottom edge', [0.1, 0.7, 0.5, 0.6]],
    ['not a number', [Number.NaN, 0.2, 0.5, 0.6]],
    ['infinite', [0.1, 0.2, Number.POSITIVE_INFINITY, 0.6]],
  ] as const)('refuses %s', (_label, [x, y, w, h]) => {
    expect(resolveCropRect(x, y, w, h)).toBeNull()
  })

  it('tolerates a rect a few ULPs past the edge after a float round-trip', () => {
    // 0.3 + 0.7 is 0.9999999999999999 in IEEE 754 — a rect a pro dragged flush
    // to the edge must not be refused for arriving one ULP short of the frame.
    expect(resolveCropRect(0.3, 0, 0.7000000000000001, 1)).not.toBeNull()
  })
})

describe('cropRectColumns', () => {
  it('always writes all four columns', () => {
    expect(cropRectColumns({ x: 0.1, y: 0.2, w: 0.5, h: 0.6 })).toEqual({
      cropX: 0.1,
      cropY: 0.2,
      cropW: 0.5,
      cropH: 0.6,
    })
  })

  it('clears all four when there is no rect, so a write cannot leave a stale one', () => {
    expect(cropRectColumns(null)).toEqual({
      cropX: null,
      cropY: null,
      cropW: null,
      cropH: null,
    })
  })
})

describe('cropContains — the consent bound', () => {
  const published: CropRect = { x: 0.2, y: 0.2, w: 0.6, h: 0.6 }

  it('allows tightening inside the published frame', () => {
    expect(cropContains(published, { x: 0.3, y: 0.3, w: 0.2, h: 0.2 })).toBe(true)
  })

  it('allows moving within the published frame', () => {
    expect(cropContains(published, { x: 0.6, y: 0.6, w: 0.2, h: 0.2 })).toBe(true)
  })

  it('allows an unchanged rect (a no-op save is not a widening)', () => {
    expect(cropContains(published, published)).toBe(true)
  })

  it.each([
    ['left', { x: 0.1, y: 0.3, w: 0.2, h: 0.2 }],
    ['top', { x: 0.3, y: 0.1, w: 0.2, h: 0.2 }],
    ['right', { x: 0.7, y: 0.3, w: 0.2, h: 0.2 }],
    ['bottom', { x: 0.3, y: 0.7, w: 0.2, h: 0.2 }],
    ['every side at once', { x: 0.1, y: 0.1, w: 0.8, h: 0.8 }],
  ])('refuses a re-frame that reaches outside it (%s)', (_side, next) => {
    expect(cropContains(published, next)).toBe(false)
  })

  // An asset with no rect yet is bounded by the whole photo — the frame the
  // client consented to when it was published — so the FIRST re-frame is free.
  it('lets the first re-frame go anywhere inside the full frame', () => {
    expect(cropContains(FULL_FRAME_CROP, { x: 0, y: 0.4, w: 0.35, h: 0.35 })).toBe(true)
    expect(cropContains(FULL_FRAME_CROP, FULL_FRAME_CROP)).toBe(true)
  })
})

// 🔴 The dangerous one. The focal is measured on the UNCROPPED frame; a surface
// that displays only the crop window needs it in the window's own coordinates.
// A sign error here does not crash and does not look wrong in review — it just
// centers on somebody's shoulder. These are worked numbers, not round-trips, so
// a flipped sign cannot cancel itself out.
describe('focalInCropSpace', () => {
  it('maps a focal into a crop whose origin is not the frame origin', () => {
    // Crop covers x ∈ [0.25, 0.75], y ∈ [0.10, 0.50].
    // A face at (0.50, 0.30) is the crop's exact centre:
    //   x: (0.50 − 0.25) / 0.50 = 0.5
    //   y: (0.30 − 0.10) / 0.40 = 0.5
    const mapped = focalInCropSpace(
      { x: 0.5, y: 0.3 },
      { x: 0.25, y: 0.1, w: 0.5, h: 0.4 },
    )
    expect(mapped?.x).toBeCloseTo(0.5, 10)
    expect(mapped?.y).toBeCloseTo(0.5, 10)
  })

  // The asymmetric case is the one that catches a sign flip: with a symmetric
  // crop, `(f − x) / w` and `(x − f) / w`-style errors land on the same number.
  it('maps an off-centre focal to an off-centre position, on the same side', () => {
    // Crop x ∈ [0.20, 0.60] (w 0.40), y ∈ [0.00, 0.50] (h 0.50).
    // Face at (0.30, 0.40) sits LEFT of the crop's centre and LOW in it:
    //   x: (0.30 − 0.20) / 0.40 = 0.25   → still left of centre
    //   y: (0.40 − 0.00) / 0.50 = 0.80   → still low
    const mapped = focalInCropSpace(
      { x: 0.3, y: 0.4 },
      { x: 0.2, y: 0, w: 0.4, h: 0.5 },
    )
    expect(mapped?.x).toBeCloseTo(0.25, 10)
    expect(mapped?.y).toBeCloseTo(0.8, 10)
    // The invariant a sign error breaks: left of centre stays left of centre.
    expect(mapped!.x).toBeLessThan(0.5)
    expect(mapped!.y).toBeGreaterThan(0.5)
  })

  it('matches the iOS PublishCrop.inCropSpace worked example', () => {
    // The same numbers TovisKit's MediaCropRectTests pins, so the two sides
    // cannot drift: crop (0.25, 0.10, 0.50, 0.40), focal (0.60, 0.20)
    //   x: (0.60 − 0.25) / 0.50 = 0.70
    //   y: (0.20 − 0.10) / 0.40 = 0.25
    const mapped = focalInCropSpace(
      { x: 0.6, y: 0.2 },
      { x: 0.25, y: 0.1, w: 0.5, h: 0.4 },
    )
    expect(mapped?.x).toBeCloseTo(0.7, 10)
    expect(mapped?.y).toBeCloseTo(0.25, 10)
  })

  it('is the identity when there is no crop (crop space IS frame space)', () => {
    const focal = resolveFocalPoint(0.42, 0.18)
    expect(focalInCropSpace(focal, null)).toEqual({ x: 0.42, y: 0.18 })
  })

  it('returns null when the subject was framed out', () => {
    // Face at x 0.9, crop stops at 0.75 → nothing sensible to centre on.
    expect(
      focalInCropSpace({ x: 0.9, y: 0.3 }, { x: 0.25, y: 0.1, w: 0.5, h: 0.4 }),
    ).toBeNull()
  })

  it('has nothing to map without a focal', () => {
    expect(focalInCropSpace(null, { x: 0.25, y: 0.1, w: 0.5, h: 0.4 })).toBeNull()
  })

  it('clamps the epsilon slack away at the edges', () => {
    // A focal exactly on the crop's bottom-right corner maps to (1, 1) — never
    // 1.0000000001, which a consumer would treat as out of range.
    const mapped = focalInCropSpace(
      { x: 0.75, y: 0.5 },
      { x: 0.25, y: 0.1, w: 0.5, h: 0.4 },
    )
    expect(mapped).toEqual({ x: 1, y: 1 })
  })
})
