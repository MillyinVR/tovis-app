import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

import AftercareStepper, { type AftercareStep } from './AftercareStepper'

const STEPS: AftercareStep[] = [
  { key: 'visit', label: 'Your booking', content: <div>visit-content</div> },
  { key: 'checkout', label: 'Checkout', content: <div>checkout-content</div> },
  { key: 'next', label: "What's next", content: <div>next-content</div> },
]

describe('AftercareStepper — initial step (PF6 auto-advance)', () => {
  afterEach(() => {
    cleanup()
  })

  it('opens the first step by default', () => {
    render(<AftercareStepper steps={STEPS} />)
    expect(screen.getByText('visit-content')).toBeInTheDocument()
    expect(screen.queryByText('next-content')).not.toBeInTheDocument()
  })

  it('opens the step named by initialActiveKey', () => {
    render(<AftercareStepper steps={STEPS} initialActiveKey="next" />)
    expect(screen.getByText('next-content')).toBeInTheDocument()
    expect(screen.queryByText('visit-content')).not.toBeInTheDocument()
  })

  it('falls back to the first step when the key is not present', () => {
    render(<AftercareStepper steps={STEPS} initialActiveKey="missing" />)
    expect(screen.getByText('visit-content')).toBeInTheDocument()
    expect(screen.queryByText('next-content')).not.toBeInTheDocument()
  })
})
