import React from 'react'
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'

import AftercareBeforeAfter from './AftercareBeforeAfter'

const FULL_PAIR = {
  beforeUrl: 'https://cdn.example.com/before-thumb.jpg',
  afterUrl: 'https://cdn.example.com/after-thumb.jpg',
  beforeFullUrl: 'https://cdn.example.com/before-full.jpg',
  afterFullUrl: 'https://cdn.example.com/after-full.jpg',
}

describe('AftercareBeforeAfter', () => {
  it('renders the interactive reveal slider when both halves exist', () => {
    render(<AftercareBeforeAfter media={FULL_PAIR} />)
    expect(screen.getByRole('slider')).toBeInTheDocument()
  })

  it('falls back to side-by-side tiles when only one half exists', () => {
    const { container } = render(
      <AftercareBeforeAfter
        media={{ ...FULL_PAIR, afterUrl: null, afterFullUrl: null }}
      />,
    )

    expect(screen.queryByRole('slider')).not.toBeInTheDocument()
    expect(
      container.querySelector('.brand-pro-session-photo-grid'),
    ).not.toBeNull()
  })

  it('renders nothing when neither half exists', () => {
    const { container } = render(
      <AftercareBeforeAfter
        media={{
          beforeUrl: null,
          afterUrl: null,
          beforeFullUrl: null,
          afterFullUrl: null,
        }}
      />,
    )
    expect(container).toBeEmptyDOMElement()
  })
})
