import React from 'react'
import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'

import ClickableMedia from './ClickableMedia'

const PROPS = {
  thumbSrc: 'https://cdn.example.com/thumb.jpg',
  fullSrc: 'https://cdn.example.com/full.jpg',
  mediaType: 'IMAGE' as const,
  alt: 'before photo',
}

describe('ClickableMedia', () => {
  // 🔴 The trigger is a <button>, whose `width: auto` is shrink-to-fit even at
  // `display: block`, and the thumbnail inside it is absolutely positioned — so
  // with no width the tile has nothing to size it and collapses to its border
  // box. Two callers styled the tile with an aspect ratio alone and measured
  // 2x2px in a browser: the photo was invisible and the overlay "Feature" pill
  // stayed put, landing on top of the next control. `w-full` is what stops that.
  it('fills its container so an aspect-ratio-only tile cannot collapse', () => {
    const { container } = render(
      <ClickableMedia {...PROPS} className="aspect-square rounded-card" />,
    )

    const button = container.querySelector('button')
    if (!button) throw new Error('expected a trigger button')

    expect(button.className).toContain('w-full')
    expect(button.className).toContain('aspect-square')
  })

  // tailwind-merge resolves the conflict in the caller's favour, so the tiles
  // that deliberately size themselves are untouched.
  it('lets a caller replace the width', () => {
    const { container } = render(
      <ClickableMedia {...PROPS} className="h-32 w-32 shrink-0" />,
    )

    const button = container.querySelector('button')
    if (!button) throw new Error('expected a trigger button')

    expect(button.className).toContain('w-32')
    expect(button.className).not.toContain('w-full')
  })
})
