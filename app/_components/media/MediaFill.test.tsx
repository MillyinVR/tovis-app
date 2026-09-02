import React from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { act, fireEvent, render } from '@testing-library/react'

import MediaFill from './MediaFill'
import type { CropRect } from '@/lib/media/cropRect'

const SRC = 'https://cdn.example.com/look.jpg'

/** The worked crop, shared with cropRect/cropWindow tests and iOS. */
const WORKED_CROP: CropRect = { x: 0.25, y: 0.1, w: 0.5, h: 0.4 }

function firstImg(container: HTMLElement): HTMLImageElement {
  const img = container.querySelector('img')
  if (!img) throw new Error('no <img> rendered')
  return img
}

/**
 * jsdom lays nothing out: every element measures 0×0 and an `<img>` reports
 * `naturalWidth: 0`. The crop path refuses to paint on either — which is the
 * point — so a test that wants the laid-out branch has to supply both. The
 * container size has to be in place BEFORE mount, because that is when the
 * one-shot measurement runs (jsdom has no `ResizeObserver`).
 */
const realGetBoundingClientRect = HTMLElement.prototype.getBoundingClientRect

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

/**
 * Report the source's intrinsic size, the way a decoded image would.
 *
 * `next/image` does not call `onLoad` from the DOM event — it waits on
 * `img.decode()` and calls the handler from the resulting microtask (see
 * `handleLoading` in next/dist/client/image-component.js). So this has to be
 * awaited inside `act`, or the state update lands after the assertion.
 */
async function reportNaturalSize(
  container: HTMLElement,
  natural: { width: number; height: number },
) {
  const img = firstImg(container)
  Object.defineProperty(img, 'naturalWidth', { value: natural.width, configurable: true })
  Object.defineProperty(img, 'naturalHeight', { value: natural.height, configurable: true })
  await act(async () => {
    fireEvent.load(img)
  })
}

/** A pixel style value as a number — the exact string carries float noise. */
function px(element: HTMLElement, property: 'left' | 'top' | 'width' | 'height'): number {
  return Number.parseFloat(element.style[property])
}

/** wrapper → window box → source box, the crop path's three nested divs. */
function cropBoxes(container: HTMLElement) {
  const wrapper = container.firstElementChild as HTMLElement
  const windowBox = wrapper.firstElementChild as HTMLElement
  return { wrapper, windowBox, sourceBox: windowBox.firstElementChild as HTMLElement }
}

describe('MediaFill — no stored crop (every row in the database today)', () => {
  it('renders the bare media element: no wrapper, no measurement, no style', () => {
    const { container } = render(
      <MediaFill src={SRC} mediaType="IMAGE" alt="Look" fit="cover" />,
    )

    // The <img> IS the root. A wrapper here would mean the crop path leaked
    // into the null case and changed the DOM of every existing surface.
    expect(container.firstElementChild?.tagName).toBe('IMG')
    const img = firstImg(container)
    expect(img.className).toContain('object-cover')
    // Only next/image's own `fill` styles — nothing this change added.
    expect(img.style.objectPosition).toBe('')
    expect(img.style.left).toBe('0px')
  })

  it('still spends the focal as object-position, exactly as before', () => {
    const { container } = render(
      <MediaFill
        src={SRC}
        mediaType="IMAGE"
        alt="Look"
        fit="cover"
        focalPoint={{ x: 0.6, y: 0.2 }}
      />,
    )
    expect(firstImg(container).style.objectPosition).toBe('60% 20%')
  })

  it('contain gets object-contain and no object-position', () => {
    const { container } = render(
      <MediaFill
        src={SRC}
        mediaType="IMAGE"
        alt="Look"
        fit="contain"
        focalPoint={{ x: 0.6, y: 0.2 }}
      />,
    )
    const img = firstImg(container)
    expect(img.className).toContain('object-contain')
    expect(img.style.objectPosition).toBe('')
  })

  it('an unresolvable rect (three of four columns) is treated as no crop at all', () => {
    // resolveCropRect is what callers use; this asserts the component agrees —
    // `cropRect={null}` and "no cropRect prop" are the same render.
    const withNull = render(
      <MediaFill src={SRC} mediaType="IMAGE" alt="Look" fit="cover" cropRect={null} />,
    )
    const without = render(<MediaFill src={SRC} mediaType="IMAGE" alt="Look" fit="cover" />)
    expect(withNull.container.innerHTML).toBe(without.container.innerHTML)
  })
})

describe('MediaFill — a stored crop', () => {
  it('paints NOTHING until both the container and the source are measured', () => {
    layOutContainersAs({ width: 393, height: 787 })
    const { container } = render(
      <MediaFill src={SRC} mediaType="IMAGE" alt="Look" fit="contain" cropRect={WORKED_CROP} />,
    )

    // 🔴 The consent guarantee: outside the rect is the frame the client did
    // not agree to publish, so an unmeasured crop must composite nothing —
    // never the full frame "just for a moment".
    expect(cropBoxes(container).windowBox.style.opacity).toBe('0')

    // …and the media is still mounted, because loading it is how the intrinsic
    // size arrives at all.
    expect(firstImg(container)).toBeInTheDocument()
  })

  it('contains the crop window once measured, and fills its box', async () => {
    layOutContainersAs({ width: 393, height: 787 })
    const { container } = render(
      <MediaFill src={SRC} mediaType="IMAGE" alt="Look" fit="contain" cropRect={WORKED_CROP} />,
    )
    await reportNaturalSize(container, { width: 1000, height: 1000 })

    const { windowBox, sourceBox } = cropBoxes(container)
    expect(windowBox.style.opacity).toBe('')
    // 500×400 window contained in 393×787 → 393×314.4, centred vertically.
    expect(px(windowBox, 'width')).toBeCloseTo(393, 6)
    expect(px(windowBox, 'height')).toBeCloseTo(314.4, 6)
    expect(px(windowBox, 'left')).toBeCloseTo(0, 6)
    expect(px(windowBox, 'top')).toBeCloseTo(236.3, 6)

    // The source is oversized and back-shifted so the window lands at 0,0…
    expect(px(sourceBox, 'width')).toBeCloseTo(786, 6)
    expect(px(sourceBox, 'left')).toBeCloseTo(-196.5, 6)

    // …and because that box carries the SOURCE's aspect ratio, object-fill is
    // exact rather than a stretch.
    expect(firstImg(container).className).toContain('object-fill')
    expect(firstImg(container).style.objectPosition).toBe('')
  })

  it('covers with the crop window, anchored on the focal it is handed', async () => {
    layOutContainersAs({ width: 393, height: 787 })
    const { container } = render(
      <MediaFill
        src={SRC}
        mediaType="IMAGE"
        alt="Look"
        fit="cover"
        cropRect={WORKED_CROP}
        // Already in crop space — (0.6, 0.2) inside this rect. The caller does
        // that remap; MediaFill does not second-guess it.
        focalPoint={{ x: 0.7, y: 0.25 }}
      />,
    )
    await reportNaturalSize(container, { width: 1000, height: 1000 })

    const { windowBox } = cropBoxes(container)
    expect(px(windowBox, 'width')).toBeCloseTo(983.75, 6)
    expect(px(windowBox, 'height')).toBeCloseTo(787, 6)
    expect(px(windowBox, 'left')).toBeCloseTo(-413.525, 6)
    expect(px(windowBox, 'top')).toBeCloseTo(0, 6)
  })

  it('lays a VIDEO out the same way, from its own intrinsic size', async () => {
    // No caller passes a rect with a video today — the Looks feed deliberately
    // excludes clips, matching iOS — but MediaFill is shared, and a crop path
    // that only works for one media type is a trap for the next caller.
    layOutContainersAs({ width: 393, height: 787 })
    const { container } = render(
      <MediaFill src={SRC} mediaType="VIDEO" alt="Look" fit="contain" cropRect={WORKED_CROP} />,
    )

    const video = container.querySelector('video') as HTMLVideoElement
    expect(video.className).toContain('object-fill')
    expect(cropBoxes(container).windowBox.style.opacity).toBe('0')

    Object.defineProperty(video, 'videoWidth', { value: 1000, configurable: true })
    Object.defineProperty(video, 'videoHeight', { value: 1000, configurable: true })
    await act(async () => {
      fireEvent.loadedMetadata(video)
    })

    const { windowBox } = cropBoxes(container)
    expect(windowBox.style.opacity).toBe('')
    expect(px(windowBox, 'width')).toBeCloseTo(393, 6)
    expect(px(windowBox, 'height')).toBeCloseTo(314.4, 6)
  })

  it('re-hides when the source changes, so one photo never wears another’s geometry', async () => {
    layOutContainersAs({ width: 393, height: 787 })
    const { container, rerender } = render(
      <MediaFill src={SRC} mediaType="IMAGE" alt="Look" fit="contain" cropRect={WORKED_CROP} />,
    )
    await reportNaturalSize(container, { width: 1000, height: 1000 })
    expect(cropBoxes(container).windowBox.style.opacity).toBe('')

    rerender(
      <MediaFill
        src="https://cdn.example.com/other.jpg"
        mediaType="IMAGE"
        alt="Look"
        fit="contain"
        cropRect={WORKED_CROP}
      />,
    )
    expect(cropBoxes(container).windowBox.style.opacity).toBe('0')
  })
})
