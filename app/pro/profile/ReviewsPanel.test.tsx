import React from 'react'
import { MediaType } from '@prisma/client'
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'

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
