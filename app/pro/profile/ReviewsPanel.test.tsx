import React from 'react'
import { MediaType } from '@prisma/client'
import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'

import ReviewsPanel from './ReviewsPanel'

const BASE_REVIEW = {
  id: 'r1',
  rating: 5,
  headline: null,
  body: null,
  createdAt: '2026-07-01T00:00:00.000Z',
  clientName: 'Jane',
}

describe('ReviewsPanel before/after slider', () => {
  it('renders the slider for a paired after and hides its before + after from the strip', () => {
    render(
      <ReviewsPanel
        reviews={[
          {
            ...BASE_REVIEW,
            mediaAssets: [
              {
                id: 'after1',
                url: 'https://cdn.example.com/after.jpg',
                thumbUrl: null,
                mediaType: MediaType.IMAGE,
                before: {
                  id: 'before1',
                  thumbUrl: 'https://cdn.example.com/before-thumb.jpg',
                  fullUrl: 'https://cdn.example.com/before.jpg',
                },
              },
              {
                id: 'before1',
                url: 'https://cdn.example.com/before.jpg',
                thumbUrl: null,
                mediaType: MediaType.IMAGE,
                before: null,
              },
              {
                id: 'other1',
                url: 'https://cdn.example.com/other.jpg',
                thumbUrl: null,
                mediaType: MediaType.IMAGE,
                before: null,
              },
            ],
          },
        ]}
      />,
    )

    // The paired after renders as the comparison slider.
    expect(screen.getByRole('slider')).toBeInTheDocument()
    expect(screen.getByAltText('Before')).toBeInTheDocument()
    expect(screen.getByAltText('After')).toBeInTheDocument()

    // Only the un-paired photo remains in the thumbnail strip (after + before
    // are subsumed by the slider, so nothing shows twice).
    expect(screen.getAllByAltText('Review media')).toHaveLength(1)
  })

  it('renders no slider when a review has no paired media', () => {
    render(
      <ReviewsPanel
        reviews={[
          {
            ...BASE_REVIEW,
            mediaAssets: [
              {
                id: 'm1',
                url: 'https://cdn.example.com/m1.jpg',
                thumbUrl: null,
                mediaType: MediaType.IMAGE,
                before: null,
              },
            ],
          },
        ]}
      />,
    )

    expect(screen.queryByRole('slider')).not.toBeInTheDocument()
    expect(screen.getAllByAltText('Review media').length).toBeGreaterThan(0)
  })
})

describe('ReviewsPanel lightbox scrim', () => {
  // The other four inline-style scrims this migration touched were driven in a
  // browser in both modes. This one cannot be: no Review in the dev database
  // carries media, so the lightbox never opens there. jsdom can reach it, and
  // what needs holding is the literal — a raw `rgba(0,0,0,0.6)` renders black
  // over a paper page in light mode, which is the bug #922/#926 fixed for the
  // scrims that were written as Tailwind classes.
  it('opens onto the scrim TOKEN, not a raw black', () => {
    render(
      <ReviewsPanel
        reviews={[
          {
            ...BASE_REVIEW,
            mediaAssets: [
              {
                id: 'm1',
                url: 'https://cdn.example.com/m1.jpg',
                thumbUrl: null,
                mediaType: MediaType.IMAGE,
                before: null,
              },
            ],
          },
        ]}
      />,
    )

    fireEvent.click(screen.getByTitle('View full size'))

    // The scrim is the fixed root the lightbox panel sits inside.
    const panel = screen.getByAltText('Full size').closest('div')
    const scrim = panel?.parentElement
    expect(scrim).toBeTruthy()
    expect(scrim?.style.position).toBe('fixed')
    expect(scrim?.style.background).toBe('rgb(var(--scrim) / 0.6)')
  })
})
