import { describe, expect, it } from 'vitest'

import {
  CAPTURE_ASPECT,
  DIPTYCH_GUTTER,
  coverSafeRect,
  crop,
  formatAspect,
  formatPixelSize,
  halves,
  pairArrangement,
  planPair,
  planSingle,
  publishCropRect,
  signatureBox,
} from '@/lib/media/socialExportGeometry'

describe('formatPixelSize / formatAspect', () => {
  it('reports a pixel size whose ratio matches its own aspect', () => {
    for (const format of ['feed916', 'instagram45'] as const) {
      const { width, height } = formatPixelSize(format)
      expect(width / height).toBeCloseTo(formatAspect(format), 10)
    }
  })

  it('feed916 is the tall 9:16 canvas, instagram45 the 4:5 feed post', () => {
    expect(formatPixelSize('feed916')).toEqual({ width: 1080, height: 1920 })
    expect(formatPixelSize('instagram45')).toEqual({ width: 1080, height: 1350 })
  })
})

describe('pairArrangement', () => {
  it('stacks the tall canvas and sits the squarer one side by side', () => {
    expect(pairArrangement('feed916')).toBe('stacked')
    expect(pairArrangement('instagram45')).toBe('sideBySide')
  })
})

describe('publishCropRect', () => {
  it('ships the whole frame when the aspects match', () => {
    expect(publishCropRect(CAPTURE_ASPECT, CAPTURE_ASPECT)).toEqual({
      x: 0,
      y: 0,
      width: 1,
      height: 1,
    })
  })

  it('crops height (full width) when the target is wider than the frame', () => {
    // A 9:16 target (portrait, narrow) is actually NARROWER than 3:4, so use a
    // deliberately wide target to exercise the width-full branch.
    const rect = publishCropRect(16 / 9, CAPTURE_ASPECT)
    expect(rect.x).toBe(0)
    expect(rect.width).toBe(1)
    expect(rect.height).toBeCloseTo(CAPTURE_ASPECT / (16 / 9), 10)
    // Centered vertically.
    expect(rect.y).toBeCloseTo((1 - rect.height) / 2, 10)
  })

  it('crops width (full height) when the target is narrower than the frame', () => {
    const rect = publishCropRect(3 / 5, CAPTURE_ASPECT)
    expect(rect.y).toBe(0)
    expect(rect.height).toBe(1)
    expect(rect.width).toBeCloseTo((3 / 5) / CAPTURE_ASPECT, 10)
    expect(rect.x).toBeCloseTo((1 - rect.width) / 2, 10)
  })

  it('degrades to the full frame for a non-positive aspect', () => {
    expect(publishCropRect(0)).toEqual({ x: 0, y: 0, width: 1, height: 1 })
    expect(publishCropRect(-1)).toEqual({ x: 0, y: 0, width: 1, height: 1 })
  })
})

describe('coverSafeRect', () => {
  it('insets the published Reels top/bottom chrome fractions of a 1920-tall rect', () => {
    const full = { x: 0, y: 0, width: 1080, height: 1920 }
    const safe = coverSafeRect(full)
    expect(safe.y).toBeCloseTo(220, 5)
    expect(safe.height).toBeCloseTo(1920 - 220 - 450, 5)
    expect(safe.x).toBe(0)
    expect(safe.width).toBe(1080)
  })

  it('returns the original rect rather than a negative/zero height on a degenerate input', () => {
    const degenerate = { x: 0, y: 0, width: 100, height: 0 }
    expect(coverSafeRect(degenerate)).toEqual(degenerate)
  })
})

describe('crop', () => {
  // A source TALLER than the target (sourceAspect 0.5, a 1:2 portrait) crops
  // its HEIGHT to fit a less-tall target (4:5) — full width, vertical slack.
  const TALL_SOURCE_ASPECT = 0.5
  const TARGET_ASPECT = 4 / 5

  it('centers when there is no subject', () => {
    const rect = crop({ sourceAspect: TALL_SOURCE_ASPECT, targetAspect: TARGET_ASPECT })
    const base = publishCropRect(TARGET_ASPECT, TALL_SOURCE_ASPECT)
    expect(base.width).toBe(1) // confirms this scenario has vertical (not horizontal) slack
    expect(rect.width).toBeCloseTo(base.width, 10)
    expect(rect.height).toBeCloseTo(base.height, 10)
    // Centered: half the remaining vertical slack sits above the crop.
    expect(rect.y).toBeCloseTo((1 - base.height) / 2, 10)
  })

  it('anchors on the subject when one is given', () => {
    // A subject near the TOP of the source should pull the crop upward
    // (smaller y) relative to the centered default.
    const centered = crop({ sourceAspect: TALL_SOURCE_ASPECT, targetAspect: TARGET_ASPECT })
    const anchored = crop({
      sourceAspect: TALL_SOURCE_ASPECT,
      targetAspect: TARGET_ASPECT,
      subject: { x: 0.4, y: 0.05, width: 0.2, height: 0.2 },
    })
    expect(anchored.y).toBeLessThan(centered.y)
  })

  it('the manual adjust reaches both extremes of the remaining travel', () => {
    const base = publishCropRect(TARGET_ASPECT, TALL_SOURCE_ASPECT)
    const slack = 1 - base.height

    const top = crop({ sourceAspect: TALL_SOURCE_ASPECT, targetAspect: TARGET_ASPECT, adjust: -1 })
    expect(top.y).toBeCloseTo(0, 10)

    const bottom = crop({ sourceAspect: TALL_SOURCE_ASPECT, targetAspect: TARGET_ASPECT, adjust: 1 })
    expect(bottom.y).toBeCloseTo(slack, 10)
  })

  it('adjust and subject are irrelevant once the aspects match — nothing to decide', () => {
    const rect = crop({
      sourceAspect: 4 / 5,
      targetAspect: 4 / 5,
      subject: { x: 0.1, y: 0.1, width: 0.1, height: 0.1 },
      adjust: 1,
    })
    expect(rect).toEqual({ x: 0, y: 0, width: 1, height: 1 })
  })
})

describe('planSingle', () => {
  it('produces one placement filling the whole canvas', () => {
    const plan = planSingle('instagram45', { pixelWidth: 3000, pixelHeight: 4000 })
    expect(plan.canvasWidth).toBe(1080)
    expect(plan.canvasHeight).toBe(1350)
    expect(plan.arrangement).toBeNull()
    expect(plan.placements).toHaveLength(1)
    const [only] = plan.placements
    expect(only?.role).toBe('single')
    expect(only?.destination).toEqual({ x: 0, y: 0, width: 1080, height: 1350 })
  })
})

describe('planPair', () => {
  it('stacks before/after for feed916, in that order', () => {
    const plan = planPair(
      'feed916',
      { pixelWidth: 1000, pixelHeight: 1000 },
      { pixelWidth: 1000, pixelHeight: 1000 },
    )
    expect(plan.arrangement).toBe('stacked')
    expect(plan.placements.map((p) => p.role)).toEqual(['before', 'after'])
    // Before on top, after on the bottom.
    const [beforePlacement, afterPlacement] = plan.placements
    expect(beforePlacement?.destination.y).toBeLessThan(afterPlacement?.destination.y ?? Infinity)
  })

  it('sits before/after side by side for instagram45, before on the left', () => {
    const plan = planPair(
      'instagram45',
      { pixelWidth: 1000, pixelHeight: 1000 },
      { pixelWidth: 1000, pixelHeight: 1000 },
    )
    expect(plan.arrangement).toBe('sideBySide')
    const [beforePlacement, afterPlacement] = plan.placements
    expect(beforePlacement?.destination.x).toBeLessThan(afterPlacement?.destination.x ?? Infinity)
  })

  it('the two halves plus the gutter exactly fill the canvas', () => {
    const [a, b] = halves(1080, 1920, 'stacked')
    expect(a.height + b.height + DIPTYCH_GUTTER).toBeCloseTo(1920, 10)
    const [c, d] = halves(1080, 1920, 'sideBySide')
    expect(c.width + d.width + DIPTYCH_GUTTER).toBeCloseTo(1080, 10)
  })
})

describe('signatureBox', () => {
  it('4:5 uses a plain symmetric inset, no cover-safe band', () => {
    const box = signatureBox(1080, 1350, 'instagram45')
    const inset = Math.min(1080, 1350) * 0.045
    expect(box).toEqual({
      x: inset,
      y: inset,
      width: 1080 - inset * 2,
      height: 1350 - inset * 2,
    })
  })

  it('9:16 is inset further to the Reels cover-safe band', () => {
    const inset = Math.min(1080, 1920) * 0.045
    const full = { x: inset, y: inset, width: 1080 - inset * 2, height: 1920 - inset * 2 }
    const expected = coverSafeRect(full)

    const box = signatureBox(1080, 1920, 'feed916')
    expect(box).toEqual(expected)
    // Materially smaller than the plain inset — the whole point of the band.
    expect(box.height).toBeLessThan(full.height)
  })
})
