// app/(main)/search/_components/LooksBookableGrid.test.tsx
import React from 'react'
import { ProNameDisplay } from '@prisma/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'

import type { LooksFeedItemDto } from '@/lib/looks/types'

vi.mock('@/lib/viewerLocation', () => ({
  viewerLocationToDrawerContextFields: () => ({
    viewerLat: null,
    viewerLng: null,
    viewerRadiusMiles: null,
    viewerPlaceId: null,
    viewerLocationLabel: null,
  }),
}))

vi.mock('@/lib/useViewerLocation', () => ({
  useViewerLocation: () => null,
}))

vi.mock('../../booking/AvailabilityDrawer', () => ({
  default: () => <div data-testid="availability-drawer" />,
}))

// The real RemoteImage needs a laid-out box to render its crop path, and jsdom
// lays nothing out. What this grid is responsible for is what it HANDS the
// image — the published rect and a focal already remapped into it — so the stub
// publishes both as data attributes and the cases assert on those.
vi.mock('@/app/_components/media/RemoteImage', () => ({
  default: ({
    alt,
    cropRect,
    focalPoint,
  }: {
    alt: string
    cropRect?: { x: number; y: number; w: number; h: number } | null
    focalPoint?: { x: number; y: number } | null
  }) => (
    <img
      alt={alt}
      data-crop={cropRect ? `${cropRect.x},${cropRect.y},${cropRect.w},${cropRect.h}` : 'none'}
      data-focal={focalPoint ? `${focalPoint.x},${focalPoint.y}` : 'none'}
    />
  ),
}))

vi.mock('@/app/_components/ProProfileLink', () => ({
  default: ({ label }: { label: string }) => <span>{label}</span>,
}))

import LooksBookableGrid from './LooksBookableGrid'

function makeLook(overrides: Partial<LooksFeedItemDto> = {}): LooksFeedItemDto {
  return {
    id: 'look_1',
    primaryMediaId: 'media_1',
    url: 'https://cdn.example.com/look_1.jpg',
    thumbUrl: 'https://cdn.example.com/look_1-thumb.jpg',
    mediaType: 'IMAGE',
    caption: 'Soft honey grow-out',
    createdAt: '2026-04-20T18:00:00.000Z',
    professional: {
      id: 'pro_1',
      businessName: 'TOVIS Studio',
      firstName: 'Tori',
      lastName: 'Morales',
      handle: 'tovisstudio',
      nameDisplay: ProNameDisplay.BUSINESS_NAME,
      professionType: 'BARBER',
      professionLabel: 'Barber',
      avatarUrl: null,
      location: 'San Diego, CA',
      followerCount: 0,
    },
    clientAuthor: null,
    _count: { likes: 3, comments: 1 },
    viewerLiked: false,
    viewerSaved: false,
    viewerFollows: false,
    serviceId: 'service_1',
    serviceName: 'Balayage',
    category: 'Hair',
    serviceIds: ['service_1'],
    focalX: null,
    focalY: null,
    cropX: null,
    cropY: null,
    cropW: null,
    cropH: null,
    priceStartingAt: 250,
    before: null,
    tags: [],
    uploadedByRole: null,
    reviewId: null,
    reviewHelpfulCount: null,
    reviewRating: null,
    reviewHeadline: null,
    ...overrides,
  }
}

function stubFeed(items: LooksFeedItemDto[]) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, items, nextCursor: null }),
      text: async () => JSON.stringify({ ok: true, items, nextCursor: null }),
    })),
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('LooksBookableGrid — Book the Look (B1)', () => {
  it('never renders the look’s service name', async () => {
    stubFeed([makeLook()])
    render(<LooksBookableGrid categorySlug={null} />)

    await waitFor(() => {
      expect(screen.getByText('TOVIS Studio')).toBeInTheDocument()
    })
    expect(screen.queryByText('Balayage')).not.toBeInTheDocument()
  })

  it('never renders the look’s service category', async () => {
    stubFeed([makeLook()])
    render(<LooksBookableGrid categorySlug={null} />)

    await waitFor(() => {
      expect(screen.getByText('TOVIS Studio')).toBeInTheDocument()
    })
    expect(screen.queryByText('Hair')).not.toBeInTheDocument()
  })

  it('keeps the "From $X" starting price', async () => {
    stubFeed([makeLook()])
    render(<LooksBookableGrid categorySlug={null} />)

    await waitFor(() => {
      expect(screen.getByText('From $250')).toBeInTheDocument()
    })
  })

  it('describes the look by its caption, not by its service', async () => {
    stubFeed([makeLook()])
    render(<LooksBookableGrid categorySlug={null} />)

    await waitFor(() => {
      expect(screen.getByText('Soft honey grow-out')).toBeInTheDocument()
    })
    expect(screen.getByRole('img')).toHaveAttribute(
      'alt',
      'Soft honey grow-out',
    )
  })

  it('names no service in the Book button’s accessible label', async () => {
    stubFeed([makeLook()])
    render(<LooksBookableGrid categorySlug={null} />)

    const book = await screen.findByRole('button', { name: /^Book this look/ })
    expect(book).toHaveAccessibleName('Book this look with TOVIS Studio')
  })

  it('falls back to a generic alt when the look has no caption', async () => {
    stubFeed([makeLook({ caption: null })])
    render(<LooksBookableGrid categorySlug={null} />)

    await waitFor(() => {
      expect(screen.getByRole('img')).toHaveAttribute('alt', 'Look')
    })
    // The service name must NOT step in as the fallback description.
    expect(screen.queryByText('Balayage')).not.toBeInTheDocument()
  })

  it('shows no price when the look carries none', async () => {
    stubFeed([makeLook({ priceStartingAt: null })])
    render(<LooksBookableGrid categorySlug={null} />)

    await waitFor(() => {
      expect(screen.getByText('TOVIS Studio')).toBeInTheDocument()
    })
    expect(screen.queryByText(/^From \$/)).not.toBeInTheDocument()
  })
})

// ── One crop per look, applied EVERYWHERE (capture chain item 4) ────────────
// The discover grid derived its own 3:4 window from the master, so a look the
// pro had re-framed appeared here in a different shape from the feed.
describe('LooksBookableGrid — the stored publish crop', () => {
  /** The worked crop, shared with cropRect/cropWindow/MediaFill and iOS. */
  const WORKED = { cropX: 0.25, cropY: 0.1, cropW: 0.5, cropH: 0.4 }

  it('hands the tile the published rect and the focal remapped into it', async () => {
    stubFeed([makeLook({ focalX: 0.6, focalY: 0.2, ...WORKED })])
    render(<LooksBookableGrid categorySlug={null} />)

    const img = await screen.findByAltText('Soft honey grow-out')
    expect(img).toHaveAttribute('data-crop', '0.25,0.1,0.5,0.4')
    // 🔴 The worked example: (0.60, 0.20) on the uncropped frame is
    // (0.70, 0.25) inside this rect. Passing the stored 0.6/0.2 straight
    // through would centre the window on somebody's shoulder, with nothing
    // wrong-looking in the diff. Compared as numbers — the exact decimal
    // carries float noise from the remap.
    const [focalX, focalY] = (img.getAttribute('data-focal') ?? '')
      .split(',')
      .map(Number)
    expect(focalX).toBeCloseTo(0.7, 10)
    expect(focalY).toBeCloseTo(0.25, 10)
  })

  it('leaves an un-cropped look exactly as it was — no rect, focal untouched', async () => {
    stubFeed([makeLook({ focalX: 0.6, focalY: 0.2 })])
    render(<LooksBookableGrid categorySlug={null} />)

    const img = await screen.findByAltText('Soft honey grow-out')
    expect(img).toHaveAttribute('data-crop', 'none')
    expect(img).toHaveAttribute('data-focal', '0.6,0.2')
  })

  it('🔴 a VIDEO look is left uncropped, the same exclusion iOS makes', async () => {
    stubFeed([
      makeLook({ mediaType: 'VIDEO', focalX: 0.6, focalY: 0.2, ...WORKED }),
    ])
    render(<LooksBookableGrid categorySlug={null} />)

    const img = await screen.findByAltText('Soft honey grow-out')
    expect(img).toHaveAttribute('data-crop', 'none')
  })
})
