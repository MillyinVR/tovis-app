import React from 'react'
import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'

import ProTilePlaceholder from './ProTilePlaceholder'

/**
 * This component exists only to hold two class strings that used to be written
 * out byte-identically in `DiscoverGridView` and `TrendingProRail`. The whole
 * point of the consolidation is that it moves ZERO pixels, so the strings are
 * pinned as LITERALS — asserting against the component's own output would
 * compare it with itself and pass on exactly the drift it exists to catch.
 *
 * Not verified in a browser, and the reason is worth recording: `/search`'s pro
 * grid returns "No pros found nearby" on the dev seed at the pros' own
 * coordinates, so neither consumer renders a tile there. An empty grid is an
 * unmeasured surface, not a clean one.
 */
describe('ProTilePlaceholder', () => {
  it('emits the sheen and hatch exactly as the two call sites used to write them', () => {
    const { container } = render(<ProTilePlaceholder />)
    const layers = Array.from(container.querySelectorAll('div'))

    expect(layers).toHaveLength(2)
    expect(layers[0]?.getAttribute('class')).toBe(
      'absolute inset-0 bg-[linear-gradient(135deg,rgba(255,255,255,0.08)_0,rgba(255,255,255,0.02)_35%,rgba(0,0,0,0.24)_100%)]',
    )
    expect(layers[1]?.getAttribute('class')).toBe(
      'absolute inset-0 opacity-20 [background-image:repeating-linear-gradient(135deg,transparent_0,transparent_10px,rgba(255,255,255,0.12)_11px,transparent_12px)]',
    )
    // Decorative: both layers must stay out of the accessibility tree.
    for (const layer of layers) expect(layer.getAttribute('aria-hidden')).toBe('true')
  })
})
