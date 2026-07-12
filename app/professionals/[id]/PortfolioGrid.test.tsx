import React from 'react'
import { MediaType, MediaVisibility } from '@prisma/client'
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'

import PortfolioGrid from './PortfolioGrid'
import type { PublicPortfolioTileDto } from '@/lib/profiles/publicProfileMappers'

function makeTile(
  overrides?: Partial<PublicPortfolioTileDto>,
): PublicPortfolioTileDto {
  return {
    id: 'tile_1',
    lookId: null,
    caption: null,
    src: 'https://cdn.example.com/after.jpg',
    thumbUrl: 'https://cdn.example.com/after_thumb.jpg',
    mediaType: MediaType.IMAGE,
    isVideo: false,
    visibility: MediaVisibility.PUBLIC,
    isEligibleForLooks: false,
    isFeaturedInPortfolio: true,
    serviceIds: [],
    before: null,
    ...(overrides ?? {}),
  }
}

describe('PortfolioGrid', () => {
  it('renders the comparison slider for a paired tile', () => {
    render(
      <PortfolioGrid
        tiles={[
          makeTile({
            before: {
              id: 'before_1',
              thumbUrl: 'https://cdn.example.com/before_thumb.jpg',
              fullUrl: 'https://cdn.example.com/before.jpg',
            },
          }),
        ]}
        emptyMessage="none"
      />,
    )

    expect(screen.getByRole('slider')).toBeInTheDocument()
    // A paired tile is the slider itself, not a post link.
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })

  it('links an unpaired tile to its look detail (§19f)', () => {
    render(
      <PortfolioGrid tiles={[makeTile({ lookId: 'look_1' })]} emptyMessage="none" />,
    )

    expect(screen.queryByRole('slider')).not.toBeInTheDocument()
    expect(screen.getByRole('link')).toHaveAttribute('href', '/looks/look_1')
  })

  it('falls back to the media page when a tile has no backing look', () => {
    render(<PortfolioGrid tiles={[makeTile({ lookId: null })]} emptyMessage="none" />)

    expect(screen.getByRole('link')).toHaveAttribute('href', '/media/tile_1')
  })
})
