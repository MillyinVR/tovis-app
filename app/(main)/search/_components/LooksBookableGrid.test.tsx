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

vi.mock('@/app/_components/media/RemoteImage', () => ({
  default: ({ alt }: { alt: string }) => <img alt={alt} />,
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
