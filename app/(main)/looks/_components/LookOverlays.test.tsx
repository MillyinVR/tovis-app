import { ProNameDisplay } from '@prisma/client'
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'

vi.mock('next/link', () => ({
  default: ({
    children,
    href,
  }: {
    children: React.ReactNode
    href: string
  }) => <a href={href}>{children}</a>,
}))

import LookOverlays from './LookOverlays'
import type { FeedItem } from './lookTypes'

function makeItem(overrides: Partial<FeedItem> = {}): FeedItem {
  return {
    id: 'look_1',
    primaryMediaId: 'media_1',
    url: 'https://cdn.example.com/look_1.jpg',
    thumbUrl: null,
    mediaType: 'IMAGE',
    caption: 'Fresh fade',
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
    serviceName: 'Fade',
    category: 'Hair',
    serviceIds: ['service_1'],
    focalX: null,
    focalY: null,
    cropX: null,
    cropY: null,
    cropW: null,
    cropH: null,
    priceStartingAt: null,
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

function renderOverlay(item: FeedItem, onToggleFollow = vi.fn()) {
  render(
    <LookOverlays
      item={item}
      rightRailBottom={100}
      onToggleFollow={onToggleFollow}
    />,
  )
  return { onToggleFollow }
}

describe('LookOverlays follower count', () => {
  it('formats thousands compactly', () => {
    renderOverlay(
      makeItem({
        professional: { ...makeItem().professional!, followerCount: 1500 },
      }),
    )
    expect(screen.getByText('1.5K followers')).toBeInTheDocument()
  })

  it('uses the singular for a single follower', () => {
    renderOverlay(
      makeItem({
        professional: { ...makeItem().professional!, followerCount: 1 },
      }),
    )
    expect(screen.getByText('1 follower')).toBeInTheDocument()
  })

  it('hides the count when there are zero followers', () => {
    renderOverlay(makeItem())
    expect(screen.queryByText(/follower/)).not.toBeInTheDocument()
  })
})

describe('LookOverlays service names (Book the Look, B1)', () => {
  it('never renders the look\u2019s service name', () => {
    renderOverlay(makeItem({ serviceName: 'Fade' }))
    expect(screen.queryByText('Fade')).not.toBeInTheDocument()
  })

  it('never renders the look\u2019s service category', () => {
    renderOverlay(makeItem({ category: 'Hair' }))
    expect(screen.queryByText('Hair')).not.toBeInTheDocument()
  })

  it('renders nothing at all when the service name was the only content', () => {
    const { container } = render(
      <LookOverlays
        item={makeItem({
          professional: null,
          clientAuthor: null,
          caption: null,
          serviceName: 'Fade',
          category: 'Hair',
          priceStartingAt: null,
        })}
        rightRailBottom={100}
        onToggleFollow={vi.fn()}
      />,
    )
    // Before B1 the service pill alone kept the overlay alive; it must not.
    expect(container).toBeEmptyDOMElement()
  })
})

describe('LookOverlays starting price', () => {
  it('keeps "From $X" \u2014 the price survives de-servicing', () => {
    renderOverlay(makeItem({ priceStartingAt: 250 }))
    expect(screen.getByText('From $250')).toBeInTheDocument()
  })

  it('renders the price even with no service name on the look', () => {
    renderOverlay(makeItem({ serviceName: null, category: null, priceStartingAt: 85 }))
    expect(screen.getByText('From $85')).toBeInTheDocument()
  })

  it('shows no price pill when the look carries no price', () => {
    renderOverlay(makeItem({ priceStartingAt: null }))
    expect(screen.queryByText(/^From \$/)).not.toBeInTheDocument()
  })
})

describe('LookOverlays follow button', () => {
  it('shows FOLLOW and fires onToggleFollow when not following', () => {
    const { onToggleFollow } = renderOverlay(makeItem())
    const button = screen.getByRole('button', { name: /Follow TOVIS Studio/ })
    expect(button).toHaveTextContent('FOLLOW')
    fireEvent.click(button)
    expect(onToggleFollow).toHaveBeenCalledTimes(1)
  })

  it('shows FOLLOWING when the viewer already follows', () => {
    renderOverlay(makeItem({ viewerFollows: true }))
    const button = screen.getByRole('button', { name: /Unfollow TOVIS Studio/ })
    expect(button).toHaveTextContent('FOLLOWING')
  })
})
