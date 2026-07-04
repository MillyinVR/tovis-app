import React from 'react'
import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'

import BeforeAfterReveal from './BeforeAfterReveal'

const PROPS = {
  beforeSrc: 'https://cdn.example.com/before.jpg',
  afterSrc: 'https://cdn.example.com/after.jpg',
  beforeAlt: 'Before photo — Balayage',
  afterAlt: 'After photo — Balayage',
}

describe('BeforeAfterReveal', () => {
  it('renders both photos and a slider centred at 50%', () => {
    render(<BeforeAfterReveal {...PROPS} />)

    expect(screen.getByAltText('Before photo — Balayage')).toBeInTheDocument()
    expect(screen.getByAltText('After photo — Balayage')).toBeInTheDocument()

    const slider = screen.getByRole('slider')
    expect(slider).toHaveAttribute('aria-valuenow', '50')
  })

  it('nudges the divider with the arrow keys and clamps with Home/End', () => {
    render(<BeforeAfterReveal {...PROPS} />)
    const slider = screen.getByRole('slider')

    fireEvent.keyDown(slider, { key: 'ArrowRight' })
    expect(slider).toHaveAttribute('aria-valuenow', '54')

    fireEvent.keyDown(slider, { key: 'ArrowLeft' })
    fireEvent.keyDown(slider, { key: 'ArrowLeft' })
    expect(slider).toHaveAttribute('aria-valuenow', '46')

    fireEvent.keyDown(slider, { key: 'Home' })
    expect(slider).toHaveAttribute('aria-valuenow', '0')

    fireEvent.keyDown(slider, { key: 'End' })
    expect(slider).toHaveAttribute('aria-valuenow', '100')
  })

  it('owns every gesture by default (touch-action: none via CSS class)', () => {
    render(<BeforeAfterReveal {...PROPS} />)
    // No inline touch-action override → the CSS `touch-action: none` rule wins,
    // so small tiles claim the whole gesture as before.
    expect(screen.getByRole('slider').style.touchAction).toBeFalsy()
  })

  it('lets vertical scroll pass through in passVerticalScroll mode', () => {
    render(<BeforeAfterReveal {...PROPS} passVerticalScroll />)
    const slider = screen.getByRole('slider')
    // pan-y hands vertical panning back to the feed pager; only horizontal
    // drags engage the wipe.
    expect(slider.style.touchAction).toBe('pan-y')
    // Keyboard control is unaffected by the mode.
    fireEvent.keyDown(slider, { key: 'ArrowRight' })
    expect(slider).toHaveAttribute('aria-valuenow', '54')
  })
})
