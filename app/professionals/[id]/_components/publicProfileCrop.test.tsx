// app/professionals/[id]/_components/publicProfileCrop.test.tsx
//
// One crop per look, applied EVERYWHERE (capture-chain item 4's other half).
// The looks FEED honoured the stored rect from item 3; the public profile's 3:4
// grid tiles and its 4:5 Signature hero derived their own window from the master
// and ignored it — so a pro who re-framed a look watched it change in the feed
// and nowhere else, which reads as broken rather than partial.
//
// These two surfaces share a fixture and an assertion, so they share a file.
import React from 'react'
import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'

import PortfolioFeed from './PortfolioFeed'
import SignatureCard from './SignatureCard'
import type { PublicPortfolioTileDto } from '@/lib/profiles/publicProfileMappers'

/** The worked crop + the raw focal, shared with cropRect/cropWindow and iOS. */
const WORKED = { cropX: 0.25, cropY: 0.1, cropW: 0.5, cropH: 0.4 }

function makeTile(overrides: Partial<PublicPortfolioTileDto> = {}): PublicPortfolioTileDto {
  return {
    id: 'media_1',
    lookId: 'look_1',
    caption: 'Fresh fade',
    src: 'https://cdn.example.com/look_1.jpg',
    thumbUrl: 'https://cdn.example.com/look_1-thumb.jpg',
    mediaType: 'IMAGE',
    isVideo: false,
    visibility: 'PUBLIC',
    isEligibleForLooks: true,
    isFeaturedInPortfolio: false,
    serviceIds: [],
    serviceNames: [],
    focalX: null,
    focalY: null,
    cropX: null,
    cropY: null,
    cropW: null,
    cropH: null,
    before: null,
    engagement: { likeCount: 3, commentCount: 1, recreatedCount: 0 },
    ...overrides,
  }
}

/**
 * `object-fill` is the crop path's signature: the source box already carries the
 * source's own aspect ratio, so any other fit would re-fit an already-fitted
 * box. An `object-cover` image here means the surface is still deriving its own
 * window from the master and ignoring the frame the pro published.
 */
function imageClasses(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('img')).map((img) => img.className)
}

describe('the public profile GRID tile honours the stored crop', () => {
  it('renders a re-framed tile through the crop path', () => {
    const { container } = render(
      <PortfolioFeed
        tiles={[makeTile({ focalX: 0.6, focalY: 0.2, ...WORKED })]}
        emptyMessage="Nothing yet"
      />,
    )
    const classes = imageClasses(container)
    expect(classes).toHaveLength(1)
    expect(classes[0]).toContain('object-fill')
  })

  it('🔴 spends the focal as GEOMETRY, never also as object-position', () => {
    const { container } = render(
      <PortfolioFeed
        tiles={[makeTile({ focalX: 0.6, focalY: 0.2, ...WORKED })]}
        emptyMessage="Nothing yet"
      />,
    )
    const img = container.querySelector('img') as HTMLImageElement
    // Spending it twice moves the window twice. The remap into crop space
    // (0.60 → 0.70) is `resolveDisplayCrop`'s job and is asserted there.
    expect(img.style.objectPosition).toBe('')
  })

  it('leaves an un-cropped tile exactly as it was — the plain cover fit', () => {
    const { container } = render(
      <PortfolioFeed tiles={[makeTile({ focalX: 0.6, focalY: 0.2 })]} emptyMessage="Nothing yet" />,
    )
    const img = container.querySelector('img') as HTMLImageElement
    expect(img.className).toContain('brand-pp-tile-img')
    expect(img.className).not.toContain('object-fill')
    expect(img.style.objectPosition).toBe('60% 20%')
  })

  it('🔴 a VIDEO tile is left uncropped, the same exclusion iOS makes', () => {
    const { container } = render(
      <PortfolioFeed
        tiles={[makeTile({ mediaType: 'VIDEO', isVideo: true, focalX: 0.6, focalY: 0.2, ...WORKED })]}
        emptyMessage="Nothing yet"
      />,
    )
    // A clip's rect has to come from a poster frame, which is unbuilt on both
    // platforms; honouring it here alone would put one look in two shapes.
    expect(imageClasses(container)[0]).not.toContain('object-fill')
  })
})

describe('the SIGNATURE hero honours the same crop', () => {
  it('renders a re-framed signature through the crop path', () => {
    const { container } = render(
      <SignatureCard
        signature={{
          tile: makeTile({ focalX: 0.6, focalY: 0.2, ...WORKED }),
          priceLine: 'Salon: From $250 · 180 min',
          bookHref: '/looks/look_1?book=1',
        }}
      />,
    )
    const classes = imageClasses(container)
    expect(classes).toHaveLength(1)
    expect(classes[0]).toContain('object-fill')
  })

  it('leaves an un-cropped signature exactly as it was', () => {
    const { container } = render(
      <SignatureCard
        signature={{
          tile: makeTile({ focalX: 0.6, focalY: 0.2 }),
          priceLine: null,
          bookHref: null,
        }}
      />,
    )
    const img = container.querySelector('img') as HTMLImageElement
    expect(img.className).toContain('brand-pp-signature-img')
    expect(img.className).not.toContain('object-fill')
    expect(img.style.objectPosition).toBe('60% 20%')
  })
})
