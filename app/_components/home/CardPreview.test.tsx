import React from 'react'
import { createEvent, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import CardPreview from './CardPreview'
import type { BrandHomeCardPreview } from '@/lib/brand/types'

const card: BrandHomeCardPreview = {
  trigger: 'Preview the card', previewLabel: 'Design concept · Coming soon',
  brandName: 'Example Studio', tier: 'MEMBER', markSrc: '/example-mark.svg',
  serial: 'No. —', note: 'Illustrative engraving.', finish: 'neutral',
}

describe('CardPreview', () => {
  it('supports hover, dismissal and reopening through the disclosure button', () => {
    render(<CardPreview card={card} />)
    const button = screen.getByRole('button', { name: card.trigger })
    expect(button).toHaveAttribute('aria-expanded', 'false')
    const enter = createEvent.pointerOver(button)
    Object.defineProperty(enter, 'pointerType', { value: 'mouse' })
    fireEvent(button, enter)
    expect(button).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText(card.previewLabel)).toBeVisible()
    fireEvent.keyDown(button, { key: 'Escape' })
    expect(button).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(button)
    expect(button).toHaveAttribute('aria-expanded', 'true')
    fireEvent.click(button)
    expect(button).toHaveAttribute('aria-expanded', 'false')
  })

  it('uses the supplied brand engraving and does not invent an issued number', () => {
    render(<CardPreview card={card} />)
    fireEvent.click(screen.getByRole('button', { name: card.trigger }))
    expect(screen.getAllByText('Example Studio')[0]).toBeVisible()
    expect(screen.getAllByText('No. —')[0]).toBeVisible()
    expect(screen.queryByText('TOVIS')).not.toBeInTheDocument()
  })
})
