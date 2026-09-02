import React from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { act, fireEvent, render } from '@testing-library/react'

import LookMedia from './LookMedia'
import type { FeedItem } from './lookTypes'

/**
 * The Looks slide as measured on production at iPhone width: 393 × 787 CSS px,
 * i.e. roughly 1:2. Every asset in the database is a 3:4 capture, so a cover
 * crop throws away a third of its width — which is the whole reason this frame
 * contains the photo and fills the leftovers with a blurred copy of itself.
 */
const SLIDE = { width: 393, height: 787 }

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

function item(overrides: Partial<FeedItem> = {}): FeedItem {
  return {
    id: 'look_1',
    primaryMediaId: 'media_1',
    url: 'https://cdn.example.com/look.jpg',
    thumbUrl: 'https://cdn.example.com/look-thumb.jpg',
    mediaType: 'IMAGE',
    caption: 'Balayage',
    createdAt: '2026-09-01T00:00:00.000Z',
    professional: null,
    clientAuthor: null,
    _count: { likes: 0, comments: 0, saves: 0, shares: 0 },
    viewerLiked: false,
    viewerSaved: false,
    viewerFollows: false,
    serviceId: null,
    serviceName: null,
    category: null,
    serviceIds: [],
    focalX: null,
    focalY: null,
    cropX: null,
    cropY: null,
    cropW: null,
    cropH: null,
    priceStartingAt: null,
    uploadedByRole: null,
    reviewId: null,
    reviewHelpfulCount: null,
    reviewRating: null,
    reviewHeadline: null,
    before: null,
    ...overrides,
  } as FeedItem
}

function images(container: HTMLElement) {
  const all = Array.from(container.querySelectorAll('img'))
  const backdrop = all.find((img) => img.getAttribute('aria-hidden') === 'true')
  const photo = all.find((img) => img.getAttribute('aria-hidden') !== 'true')
  return { all, backdrop, photo }
}

/** next/image calls onLoad from a microtask after decode, not from the event. */
async function reportNaturalSize(
  img: HTMLImageElement,
  natural: { width: number; height: number },
) {
  Object.defineProperty(img, 'naturalWidth', { value: natural.width, configurable: true })
  Object.defineProperty(img, 'naturalHeight', { value: natural.height, configurable: true })
  await act(async () => {
    fireEvent.load(img)
  })
}

function px(element: HTMLElement, property: 'left' | 'width'): number {
  return Number.parseFloat(element.style[property])
}

describe('LookMedia — the feed frame', () => {
  it('contains the photo and lays a blurred copy of it behind', () => {
    const { container } = render(<LookMedia item={item()} isActive />)
    const { all, backdrop, photo } = images(container)

    expect(all).toHaveLength(2)
    // Nothing is cropped away: the whole published frame is on screen…
    expect(photo?.className).toContain('object-contain')
    // …and the leftover is the same photograph, blurred and cover-cropped, so
    // the slide is still full-page rather than a picture in two dead bars.
    expect(backdrop?.className).toContain('object-cover')
    expect(backdrop?.style.filter).toContain('blur(')
    expect(backdrop?.getAttribute('src')).toBe(photo?.getAttribute('src'))
    expect(backdrop?.getAttribute('alt')).toBe('')
  })

  it('anchors the backdrop on the focal point when there is no crop', () => {
    const { container } = render(
      <LookMedia item={item({ focalX: 0.6, focalY: 0.2 })} isActive />,
    )
    const { backdrop, photo } = images(container)

    expect(backdrop?.style.objectPosition).toBe('60% 20%')
    // The photo itself is contained, so a focal has nothing to spend — same
    // rule MediaFill has always applied to a contain fit.
    expect(photo?.style.objectPosition).toBe('')
  })

  it('a video slide keeps one moving picture and blurs its POSTER behind it', () => {
    const { container } = render(
      <LookMedia item={item({ mediaType: 'VIDEO' })} isActive />,
    )

    const video = container.querySelector('video')
    expect(video?.className).toContain('object-contain')

    const { all } = images(container)
    expect(all).toHaveLength(1)
    expect(all[0]?.getAttribute('src')).toBe('https://cdn.example.com/look-thumb.jpg')
    expect(container.querySelectorAll('video')).toHaveLength(1)
  })

  it('⚠️ a VIDEO ignores a stored crop, the same way iOS does', () => {
    layOutContainersAs(SLIDE)
    const { container } = render(
      <LookMedia
        item={item({ mediaType: 'VIDEO', cropX: 0.25, cropY: 0.1, cropW: 0.5, cropH: 0.4 })}
        isActive
      />,
    )

    // A clip's frame has to come from its poster and that is unbuilt on both
    // platforms. Honouring the rect here alone would put one look in two shapes.
    const video = container.querySelector('video') as HTMLElement
    expect(video.className).toContain('object-contain')
    expect(video.className).not.toContain('object-fill')

    // …and the poster behind it is not cropped either.
    const { backdrop } = images(container)
    expect(backdrop?.className).toContain('object-cover')
    expect(backdrop?.className).not.toContain('object-fill')
  })

  it('a before/after pair still renders the reveal slider, unframed', () => {
    const { container } = render(
      <LookMedia
        item={item({
          before: {
            id: 'media_0',
            fullUrl: 'https://cdn.example.com/before.jpg',
            thumbUrl: 'https://cdn.example.com/before-thumb.jpg',
          },
        })}
        isActive
      />,
    )
    // The dual-image slider owns its own layout; letterboxing it is a separate
    // design question (whose aspect ratio wins) and is deliberately not done
    // here — iOS makes the same exclusion.
    expect(container.querySelector('[role="slider"]')).toBeTruthy()
    expect(container.querySelector('img[aria-hidden="true"]')).toBeNull()
  })

  it('🔴 remaps the focal into CROP space before the backdrop covers with it', async () => {
    layOutContainersAs(SLIDE)
    const { container } = render(
      <LookMedia
        item={item({
          cropX: 0.25,
          cropY: 0.1,
          cropW: 0.5,
          cropH: 0.4,
          focalX: 0.6,
          focalY: 0.2,
        })}
        isActive
      />,
    )

    const { backdrop } = images(container)
    expect(backdrop).toBeTruthy()
    await reportNaturalSize(backdrop as HTMLImageElement, { width: 1000, height: 1000 })

    // The 500×400 crop window covering a 393×787 slide is 983.75px wide, so
    // 590.75px of it is off-screen and the anchor decides which 393 you see.
    const windowBox = (backdrop as HTMLElement).parentElement?.parentElement as HTMLElement
    expect(px(windowBox, 'width')).toBeCloseTo(983.75, 4)

    // (0.6, 0.2) measured on the UNCROPPED frame is (0.7, 0.25) inside this
    // crop. Anchoring on 0.7 → -413.525. Anchoring on the raw 0.6 would give
    // -354.45: 59px out, a face-width on this slide, and nothing would look
    // broken enough to notice in review.
    expect(px(windowBox, 'left')).toBeCloseTo(-413.525, 4)
    expect(px(windowBox, 'left')).not.toBeCloseTo(-354.45, 4)
  })
})

describe('LookMedia — what it spends bandwidth on', () => {
  // 🔴 The regression this change exists to fix. LookMedia used to read
  // `item.renderThumbUrl` / `item.renderUrl`, two fields `LooksFeedItemDto` has
  // never carried — the server maps its rendered URLs onto `url`/`thumbUrl`
  // before they go over the wire. Both were always undefined, so every slide
  // fell through to `item.url`: the 3024×4032, ~4.5 MB stored original.
  it('draws the downscaled thumb, never the stored original', () => {
    const { container } = render(<LookMedia item={item()} isActive />)
    const { all } = images(container)

    expect(all.length).toBeGreaterThan(0)
    for (const img of all) {
      expect(img.getAttribute('src')).toBe('https://cdn.example.com/look-thumb.jpg')
    }
  })

  it('falls back to the full URL when the asset has no thumb', () => {
    const { container } = render(<LookMedia item={item({ thumbUrl: null })} isActive />)
    const { photo } = images(container)

    expect(photo?.getAttribute('src')).toBe('https://cdn.example.com/look.jpg')
  })

  // A slide two away from the one on screen must not be racing it for
  // bandwidth. Ten full-screen photographs at once is why slide 0 took 3.4 s.
  it('a deferred slide fetches nothing at all', () => {
    const { container } = render(
      <LookMedia item={item()} isActive={false} preload="defer" />,
    )

    expect(images(container).all).toHaveLength(0)
    expect(container.querySelector('video')).toBeNull()
  })

  it('a deferred slide still fills its slot, so the snap geometry cannot move', () => {
    const { container } = render(
      <LookMedia item={item()} isActive={false} preload="defer" />,
    )

    const root = container.firstElementChild as HTMLElement
    expect(root.className).toContain('absolute')
    expect(root.className).toContain('inset-0')
  })

  it('a nearby slide still renders its media', () => {
    const { container } = render(
      <LookMedia item={item()} isActive={false} preload="lazy" />,
    )

    expect(images(container).all.length).toBeGreaterThan(0)
  })

  // next/image renders `priority` by OMITTING loading="lazy" — the img then
  // takes the browser's eager default and is fetched straight away, instead of
  // waiting for the lazy-loading heuristic to decide it is close enough.
  it('drops lazy-loading on an eager slide and keeps it on a distant one', () => {
    const eager = render(<LookMedia item={item()} isActive preload="eager" />)
    expect(images(eager.container).photo?.getAttribute('loading')).toBeNull()

    const lazy = render(<LookMedia item={item()} isActive={false} preload="lazy" />)
    expect(images(lazy.container).photo?.getAttribute('loading')).toBe('lazy')
  })

  // The backdrop is decoration; it must never outrank the photograph. It is the
  // same URL, so on the active slide it costs no second request.
  it('never prioritises the blurred backdrop', () => {
    const { container } = render(<LookMedia item={item()} isActive preload="eager" />)
    const { backdrop, photo } = images(container)

    expect(backdrop?.getAttribute('loading')).toBe('lazy')
    expect(backdrop?.getAttribute('src')).toBe(photo?.getAttribute('src'))
  })

  // 🔴 The derived thumb is a Supabase RENDER-ENDPOINT url, and Supabase
  // documents image transformations as Pro-plan-and-above while this project is
  // on Free. It serves today. If it ever stops, this is the difference between
  // a slow feed and a blank one.
  it('falls back to the stored original if the rendered thumb fails to load', async () => {
    const { container } = render(<LookMedia item={item()} isActive />)

    const photo = images(container).photo as HTMLImageElement
    expect(photo.getAttribute('src')).toBe('https://cdn.example.com/look-thumb.jpg')

    await act(async () => {
      fireEvent.error(photo)
    })

    const after = images(container)
    expect(after.photo?.getAttribute('src')).toBe('https://cdn.example.com/look.jpg')
    // The blurred backdrop is the same photograph, so it falls back with it
    // rather than being left pointing at a URL that just failed.
    expect(after.backdrop?.getAttribute('src')).toBe('https://cdn.example.com/look.jpg')
  })
})

