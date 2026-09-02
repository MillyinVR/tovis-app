// lib/media/cropWindow.test.ts
//
// The display geometry of the publish crop. Two things are being pinned here:
//
//  1. **The null-crop reduction.** Every row in the database has crop* = NULL,
//     so the numbers this module produces for a null crop must be exactly what
//     `object-fit: cover|contain` + `object-position` already produce. That is
//     what lets `MediaFill` keep its zero-JS CSS path for the null case.
//  2. **The worked example**, shared with `cropRect.test.ts` and with iOS
//     `LookFeedLayoutTests`: crop (0.25, 0.10, 0.50, 0.40), focal (0.60, 0.20)
//     → (0.70, 0.25) in crop space. Same numbers on both platforms, so a sign
//     error cannot live on one side only.

import { describe, expect, it } from 'vitest'
import type { CropRect } from '@/lib/media/cropRect'
import { focalInCropSpace } from '@/lib/media/cropRect'
import {
  cropWindowSize,
  fitWindowBox,
  sourceBoxInWindow,
} from '@/lib/media/cropWindow'

/** The worked crop, identical to cropRect.test.ts and MediaCropRectTests. */
const WORKED_CROP: CropRect = { x: 0.25, y: 0.1, w: 0.5, h: 0.4 }

/** The Looks slide as measured on production, iPhone-width (393 × 787 CSS px). */
const MOBILE_SLIDE = { width: 393, height: 787 }

/** A real portfolio capture: 3024 × 4032 = 3:4, which is every legacy row. */
const CAPTURE_3_4 = { width: 3024, height: 4032 }

describe('cropWindowSize', () => {
  it('is the whole source when there is no crop', () => {
    expect(cropWindowSize(null, CAPTURE_3_4)).toEqual(CAPTURE_3_4)
    expect(cropWindowSize(undefined, CAPTURE_3_4)).toEqual(CAPTURE_3_4)
  })

  it('scales the source by the rect extent', () => {
    expect(cropWindowSize(WORKED_CROP, { width: 1000, height: 1000 })).toEqual({
      width: 500,
      height: 400,
    })
  })

  it('ignores the rect ORIGIN — only the extent sets the size', () => {
    const moved: CropRect = { ...WORKED_CROP, x: 0.5, y: 0.6 }
    expect(cropWindowSize(moved, { width: 1000, height: 1000 })).toEqual(
      cropWindowSize(WORKED_CROP, { width: 1000, height: 1000 }),
    )
  })
})

describe('fitWindowBox — the null-crop reduction to object-fit', () => {
  // A 3:4 capture in the 393 × 787 Looks slide. These are the numbers the
  // browser itself produces, and the reason the letterbox is needed at all:
  // `cover` throws away a third of the width of every legacy row.
  it('cover matches object-fit: cover (centered)', () => {
    const box = fitWindowBox(CAPTURE_3_4, MOBILE_SLIDE, 'cover')
    expect(box.width).toBeCloseTo(590.25, 6)
    expect(box.height).toBeCloseTo(787, 6)
    expect(box.left).toBeCloseTo(-98.625, 6)
    expect(box.top).toBeCloseTo(0, 6)

    // 33% of the photograph's width is off-screen. That is the defect.
    const visibleFraction = MOBILE_SLIDE.width / box.width
    expect(1 - visibleFraction).toBeCloseTo(0.3342, 4)
  })

  it('contain matches object-fit: contain, and shows the WHOLE frame', () => {
    const box = fitWindowBox(CAPTURE_3_4, MOBILE_SLIDE, 'contain')
    expect(box.width).toBeCloseTo(393, 6)
    expect(box.height).toBeCloseTo(524, 6)
    expect(box.left).toBeCloseTo(0, 6)
    // The letterbox bars the blurred backdrop fills: 131.5px top and bottom.
    expect(box.top).toBeCloseTo(131.5, 6)

    expect(box.width / box.height).toBeCloseTo(
      CAPTURE_3_4.width / CAPTURE_3_4.height,
      6,
    )
  })

  it('cover with a focal matches object-position: x% y%', () => {
    // object-position spends the overflow by the anchor fraction, so a focal on
    // the left edge pins the left edge and clips only the right.
    const left = fitWindowBox(CAPTURE_3_4, MOBILE_SLIDE, 'cover', { x: 0, y: 0 })
    expect(left.left).toBeCloseTo(0, 6)
    expect(left.top).toBeCloseTo(0, 6)

    const right = fitWindowBox(CAPTURE_3_4, MOBILE_SLIDE, 'cover', { x: 1, y: 1 })
    expect(right.left).toBeCloseTo(MOBILE_SLIDE.width - right.width, 6)

    // …and no focal is the same as an explicit center.
    expect(fitWindowBox(CAPTURE_3_4, MOBILE_SLIDE, 'cover')).toEqual(
      fitWindowBox(CAPTURE_3_4, MOBILE_SLIDE, 'cover', { x: 0.5, y: 0.5 }),
    )
    expect(fitWindowBox(CAPTURE_3_4, MOBILE_SLIDE, 'cover', null)).toEqual(
      fitWindowBox(CAPTURE_3_4, MOBILE_SLIDE, 'cover'),
    )
  })

  it('a 9:16 frame — what the masked viewfinder will shoot — nearly fills the slide', () => {
    const shotTall = { width: 1080, height: 1920 }
    const box = fitWindowBox(shotTall, MOBILE_SLIDE, 'contain')
    expect(box.width).toBeCloseTo(393, 6)
    expect(box.height).toBeCloseTo(698.667, 3)
    // 44px of bar each side of a 787px slide — the letterbox all but disappears
    // once the camera shoots the feed frame (capture-chain item 1).
    expect(box.top).toBeCloseTo(44.167, 3)
  })

  it('returns a zero box rather than NaN when nothing is measured yet', () => {
    const zero = { left: 0, top: 0, width: 0, height: 0 }
    expect(fitWindowBox({ width: 0, height: 0 }, MOBILE_SLIDE, 'contain')).toEqual(zero)
    expect(fitWindowBox(CAPTURE_3_4, { width: 0, height: 0 }, 'contain')).toEqual(zero)
    expect(
      fitWindowBox({ width: Number.NaN, height: 10 }, MOBILE_SLIDE, 'cover'),
    ).toEqual(zero)
  })
})

describe('sourceBoxInWindow', () => {
  it('is the box itself when there is no crop', () => {
    expect(sourceBoxInWindow(null, { width: 393, height: 524 })).toEqual({
      left: 0,
      top: 0,
      width: 393,
      height: 524,
    })
  })

  it('oversizes and back-shifts the source so the window lands at the origin', () => {
    const box = sourceBoxInWindow(WORKED_CROP, { width: 393, height: 314.4 })
    expect(box.width).toBeCloseTo(786, 6)
    expect(box.height).toBeCloseTo(786, 6)
    expect(box.left).toBeCloseTo(-196.5, 6)
    expect(box.top).toBeCloseTo(-78.6, 6)
  })

  it('keeps the SOURCE aspect ratio, so object-fit: fill cannot distort', () => {
    const natural = { width: 3024, height: 4032 }
    const windowSize = cropWindowSize(WORKED_CROP, natural)
    const windowBox = fitWindowBox(windowSize, MOBILE_SLIDE, 'contain')
    const source = sourceBoxInWindow(WORKED_CROP, windowBox)

    expect(source.width / source.height).toBeCloseTo(
      natural.width / natural.height,
      6,
    )
  })
})

describe('the whole pipeline, on the shared worked example', () => {
  const natural = { width: 1000, height: 1000 }
  const focal = { x: 0.6, y: 0.2 }

  it('contains the crop window and centers it', () => {
    const windowSize = cropWindowSize(WORKED_CROP, natural)
    expect(windowSize).toEqual({ width: 500, height: 400 })

    const box = fitWindowBox(windowSize, MOBILE_SLIDE, 'contain')
    expect(box.width).toBeCloseTo(393, 6)
    expect(box.height).toBeCloseTo(314.4, 6)
    expect(box.left).toBeCloseTo(0, 6)
    expect(box.top).toBeCloseTo(236.3, 6)
  })

  it('covers the slide with the crop window, anchored on the CROP-SPACE focal', () => {
    // 🔴 The dangerous step: the stored focal is measured on the uncropped
    // frame. Handing it straight to a cover fit posts the wrong part of the
    // photograph. (0.60, 0.20) inside this crop is (0.70, 0.25).
    const inCrop = focalInCropSpace(focal, WORKED_CROP)
    expect(inCrop).toEqual({ x: 0.7, y: 0.25 })

    const windowSize = cropWindowSize(WORKED_CROP, natural)
    const box = fitWindowBox(windowSize, MOBILE_SLIDE, 'cover', inCrop)
    expect(box.width).toBeCloseTo(983.75, 6)
    expect(box.height).toBeCloseTo(787, 6)
    expect(box.left).toBeCloseTo(-413.525, 6)
    expect(box.top).toBeCloseTo(0, 6)

    // Using the RAW focal instead would move the window 59px — a face-width on
    // this slide. This assertion is what fails if the remap is ever dropped.
    const wrong = fitWindowBox(windowSize, MOBILE_SLIDE, 'cover', focal)
    expect(Math.abs(wrong.left - box.left)).toBeCloseTo(59.075, 3)
  })
})
