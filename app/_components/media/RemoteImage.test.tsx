import React from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { act, fireEvent, render } from '@testing-library/react'

import RemoteImage from './RemoteImage'
import type { CropRect } from '@/lib/media/cropRect'

const SRC = 'https://cdn.example.com/tile.jpg'

/** The worked crop, shared with cropRect/cropWindow/MediaFill and iOS. */
const WORKED_CROP: CropRect = { x: 0.25, y: 0.1, w: 0.5, h: 0.4 }
/** (0.6, 0.2) on the uncropped frame, remapped into WORKED_CROP's own space. */
const WORKED_FOCAL_IN_CROP = { x: 0.7, y: 0.25 }

function firstImg(container: HTMLElement): HTMLImageElement {
  const img = container.querySelector('img')
  if (!img) throw new Error('no <img> rendered')
  return img
}

const realGetBoundingClientRect = HTMLElement.prototype.getBoundingClientRect

/**
 * jsdom lays nothing out: every element measures 0×0 and an `<img>` reports
 * `naturalWidth: 0`. The crop path refuses to paint on either — that IS the
 * consent guarantee — so a test that wants the laid-out branch supplies both.
 * The container size must be in place BEFORE mount: jsdom has no
 * `ResizeObserver`, so `useElementSize` only measures once.
 */
function layOutContainersAs(size: { width: number; height: number }) {
  HTMLElement.prototype.getBoundingClientRect = function fake(this: HTMLElement) {
    return {
      width: size.width,
      height: size.height,
      top: 0,
      left: 0,
      right: size.width,
      bottom: size.height,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect
  }
}

afterEach(() => {
  HTMLElement.prototype.getBoundingClientRect = realGetBoundingClientRect
})

async function reportNaturalSize(
  container: HTMLElement,
  natural: { width: number; height: number },
) {
  const img = firstImg(container)
  Object.defineProperty(img, 'naturalWidth', {
    value: natural.width,
    configurable: true,
  })
  Object.defineProperty(img, 'naturalHeight', {
    value: natural.height,
    configurable: true,
  })
  await act(async () => {
    fireEvent.load(img)
  })
}

/** A pixel style value as a number — the exact string carries float noise. */
function px(
  element: HTMLElement,
  property: 'left' | 'top' | 'width' | 'height',
): number {
  return Number.parseFloat(element.style[property])
}

/** wrapper → window box → source box, the crop path's three nested divs. */
function cropBoxes(container: HTMLElement) {
  const wrapper = container.firstElementChild as HTMLElement
  const windowBox = wrapper.firstElementChild as HTMLElement
  return { wrapper, windowBox, sourceBox: windowBox.firstElementChild as HTMLElement }
}

describe('RemoteImage — no stored crop (every row in the database today)', () => {
  it('renders the bare <img>: no wrapper, no measurement', () => {
    const { container } = render(
      <RemoteImage src={SRC} alt="Tile" className="brand-pp-tile-img" intrinsic />,
    )

    // The <img> IS the root. A wrapper here would mean the crop path leaked into
    // the null case and changed the DOM of every existing tile.
    expect(container.firstElementChild?.tagName).toBe('IMG')
    expect(firstImg(container).className).toBe('brand-pp-tile-img')
  })

  it('still spends the focal as object-position, exactly as before', () => {
    const { container } = render(
      <RemoteImage
        src={SRC}
        alt="Tile"
        className="brand-pp-tile-img"
        focalPoint={{ x: 0.6, y: 0.2 }}
        intrinsic
      />,
    )
    expect(firstImg(container).style.objectPosition).toBe('60% 20%')
  })

  it('cropRect={null} and no cropRect prop are the same render', () => {
    const withNull = render(
      <RemoteImage src={SRC} alt="Tile" className="x" cropRect={null} intrinsic />,
    )
    const without = render(<RemoteImage src={SRC} alt="Tile" className="x" intrinsic />)
    expect(withNull.container.innerHTML).toBe(without.container.innerHTML)
  })

  it('the next/image branch is untouched too', () => {
    const { container } = render(
      <RemoteImage src={SRC} alt="Tile" className="h-full w-full object-cover" width={300} height={400} />,
    )
    expect(container.firstElementChild?.tagName).toBe('IMG')
    expect(firstImg(container).className).toContain('object-cover')
  })
})

describe('RemoteImage — a stored crop', () => {
  it('paints NOTHING until both the container and the source are measured', () => {
    layOutContainersAs({ width: 300, height: 400 })
    const { container } = render(
      <RemoteImage src={SRC} alt="Tile" className="brand-pp-tile-img" cropRect={WORKED_CROP} intrinsic />,
    )

    // 🔴 Outside the rect is the frame the client did not agree to publish, so
    // an unmeasured crop composites nothing — never the full frame "just for a
    // moment", which is exactly what a browse grid full of tiles would flash.
    expect(cropBoxes(container).windowBox.style.opacity).toBe('0')
    expect(firstImg(container)).toBeInTheDocument()
  })

  it('covers a 3:4 tile with the crop window, anchored on the crop-space focal', async () => {
    layOutContainersAs({ width: 300, height: 400 })
    const { container } = render(
      <RemoteImage
        src={SRC}
        alt="Tile"
        className="brand-pp-tile-img"
        cropRect={WORKED_CROP}
        focalPoint={WORKED_FOCAL_IN_CROP}
        intrinsic
      />,
    )
    await reportNaturalSize(container, { width: 1000, height: 1000 })

    const { windowBox, sourceBox } = cropBoxes(container)
    expect(windowBox.style.opacity).toBe('')
    // A 500×400 window covering a 300×400 box → scale 1, so 500×400, with the
    // 200px of overflow spent by the focal's x (0.7 → −140).
    expect(px(windowBox, 'width')).toBeCloseTo(500, 6)
    expect(px(windowBox, 'height')).toBeCloseTo(400, 6)
    expect(px(windowBox, 'left')).toBeCloseTo(-140, 6)
    expect(px(windowBox, 'top')).toBeCloseTo(0, 6)

    // The whole source, oversized and back-shifted so the window lands at 0,0.
    expect(px(sourceBox, 'width')).toBeCloseTo(1000, 6)
    expect(px(sourceBox, 'height')).toBeCloseTo(1000, 6)
    expect(px(sourceBox, 'left')).toBeCloseTo(-250, 6)
    expect(px(sourceBox, 'top')).toBeCloseTo(-100, 6)
  })

  it("keeps the caller's className on the BOX, and object-fills the image inside", async () => {
    layOutContainersAs({ width: 300, height: 400 })
    const { container } = render(
      <RemoteImage
        src={SRC}
        alt="Tile"
        // The tile's own fill + its hover treatment. If these moved onto the
        // <img> the tile would collapse: `.brand-pp-tile-img` is what takes the
        // image out of flow inside an `aspect-ratio` cell.
        className="brand-pp-tile-img transition duration-200 group-hover:scale-[1.02]"
        cropRect={WORKED_CROP}
        focalPoint={WORKED_FOCAL_IN_CROP}
        intrinsic
      />,
    )
    await reportNaturalSize(container, { width: 1000, height: 1000 })

    const { wrapper } = cropBoxes(container)
    expect(wrapper.tagName).toBe('DIV')
    expect(wrapper.className).toContain('brand-pp-tile-img')
    expect(wrapper.className).toContain('group-hover:scale-[1.02]')
    expect(wrapper.className).toContain('absolute')

    const img = firstImg(container)
    expect(img.className).toContain('object-fill')
    // 🔴 The focal is spent as GEOMETRY by the frame. Spending it a second time
    // as object-position would move the window twice.
    expect(img.style.objectPosition).toBe('')
  })

  it('re-hides when the source changes, so one photo never wears another’s geometry', async () => {
    layOutContainersAs({ width: 300, height: 400 })
    const { container, rerender } = render(
      <RemoteImage src={SRC} alt="Tile" className="t" cropRect={WORKED_CROP} intrinsic />,
    )
    await reportNaturalSize(container, { width: 1000, height: 1000 })
    expect(cropBoxes(container).windowBox.style.opacity).toBe('')

    rerender(
      <RemoteImage
        src="https://cdn.example.com/other.jpg"
        alt="Tile"
        className="t"
        cropRect={WORKED_CROP}
        intrinsic
      />,
    )
    expect(cropBoxes(container).windowBox.style.opacity).toBe('0')
  })

  it('works through the next/image branch too (a sized tile, not an intrinsic one)', async () => {
    layOutContainersAs({ width: 300, height: 400 })
    const { container } = render(
      <RemoteImage
        src={SRC}
        alt="Tile"
        className="h-full w-full object-cover"
        width={300}
        height={400}
        cropRect={WORKED_CROP}
        focalPoint={WORKED_FOCAL_IN_CROP}
      />,
    )
    await reportNaturalSize(container, { width: 1000, height: 1000 })

    const { windowBox } = cropBoxes(container)
    expect(px(windowBox, 'width')).toBeCloseTo(500, 6)
    expect(px(windowBox, 'left')).toBeCloseTo(-140, 6)
    expect(firstImg(container).className).toContain('object-fill')
  })
})

describe('RemoteImage — an image that was ALREADY loaded when React attached', () => {
  /**
   * 🔴 The defect this pins, found by opening the page in Chromium rather than
   * by any test: React's `load` handler does NOT fire for an `<img>` that is
   * already `complete` when the handler attaches — a cached image, or one the
   * browser finished during HTML parse before hydration. That is the NORMAL
   * case on a scrolling grid and on every revisit.
   *
   * With the crop path waiting only on `onLoad`, the window box stayed at
   * `opacity: 0` forever and the tile rendered BLANK. Measured: cached → blank,
   * same image delayed 1.2 s → correct. Every jsdom test passed either way,
   * because they all fire the load event by hand.
   */
  const DECODED_PROPS = ['complete', 'naturalWidth', 'naturalHeight'] as const

  function pretendImagesAreAlreadyDecoded(natural: { width: number; height: number }) {
    const proto = HTMLImageElement.prototype
    const saved = DECODED_PROPS.map((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(proto, key)
      // Throw rather than skip: a jsdom whose HTMLImageElement has no `complete`
      // would make this whole case pass while testing nothing at all.
      if (!descriptor) throw new Error(`HTMLImageElement.prototype has no '${key}'`)
      return [key, descriptor] as const
    })

    const values = { complete: true, naturalWidth: natural.width, naturalHeight: natural.height }
    for (const key of DECODED_PROPS) {
      Object.defineProperty(proto, key, { configurable: true, get: () => values[key] })
    }

    return () => {
      for (const [key, descriptor] of saved) Object.defineProperty(proto, key, descriptor)
    }
  }

  it('paints the crop window with NO load event ever firing', () => {
    const restore = pretendImagesAreAlreadyDecoded({ width: 1000, height: 1000 })
    try {
      layOutContainersAs({ width: 300, height: 400 })
      const { container } = render(
        <RemoteImage
          src={SRC}
          alt="Tile"
          className="brand-pp-tile-img"
          cropRect={WORKED_CROP}
          focalPoint={WORKED_FOCAL_IN_CROP}
          intrinsic
        />,
      )

      // Note what is NOT here: no fireEvent.load. The size has to arrive from
      // the ref, or this tile is blank on a real, cached grid.
      const { windowBox } = cropBoxes(container)
      expect(windowBox.style.opacity).toBe('')
      expect(px(windowBox, 'width')).toBeCloseTo(500, 6)
      expect(px(windowBox, 'left')).toBeCloseTo(-140, 6)
    } finally {
      restore()
    }
  })

  it('reports the intrinsic size to onNaturalSize from the ref, not just onLoad', () => {
    const restore = pretendImagesAreAlreadyDecoded({ width: 880, height: 800 })
    try {
      const seen: Array<[number, number]> = []
      render(
        <RemoteImage
          src={SRC}
          alt="Tile"
          intrinsic
          onNaturalSize={(w, h) => seen.push([w, h])}
        />,
      )
      // This is what the re-frame editor uses to learn the photo's shape. With
      // only `onLoad`, a cached photo left the editor measuring every drag
      // against a fallback 3:4 box the photo did not have.
      expect(seen).toContainEqual([880, 800])
    } finally {
      restore()
    }
  })
})
