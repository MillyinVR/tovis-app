// app/(main)/booking/AvailabilityDrawer/components/StickyCTA.test.tsx

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import StickyCTA from './StickyCTA'

function renderStickyCTA(args?: {
  canContinue?: boolean
  loading?: boolean
  navigating?: boolean
  selectedLine?: string | null
  continueLabel?: string
  onContinue?: ReturnType<typeof vi.fn>
}) {
  const onContinue = args?.onContinue ?? vi.fn()

  render(
    <StickyCTA
      canContinue={args?.canContinue ?? true}
      loading={args?.loading ?? false}
      navigating={args?.navigating ?? false}
      onContinue={onContinue}
      selectedLine={args?.selectedLine ?? null}
      continueLabel={args?.continueLabel ?? 'Continue to add-ons'}
    />,
  )

  return { onContinue }
}

describe('StickyCTA', () => {
  it('renders the continue label and fires onContinue when tapped', async () => {
    const user = userEvent.setup()
    const { onContinue } = renderStickyCTA()

    const button = screen.getByRole('button', {
      name: 'Continue to add-ons',
    })

    await user.click(button)

    expect(onContinue).toHaveBeenCalledTimes(1)
  })

  it('disables the button and prompts for a time when nothing is held', async () => {
    const user = userEvent.setup()
    const { onContinue } = renderStickyCTA({ canContinue: false })

    const button = screen.getByRole('button', {
      name: 'Pick a time to continue',
    })

    expect(button).toBeDisabled()

    await user.click(button)

    expect(onContinue).not.toHaveBeenCalled()
  })

  it('shows the holding state while a hold request is in progress', () => {
    renderStickyCTA({ loading: true })

    const button = screen.getByRole('button', {
      name: /Holding your time…/,
    })

    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('aria-busy', 'true')
  })

  it('shows a pending state while navigating to add-ons', async () => {
    const user = userEvent.setup()
    const { onContinue } = renderStickyCTA({ navigating: true })

    const button = screen.getByRole('button', {
      name: /Loading add-ons…/,
    })

    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('aria-busy', 'true')

    await user.click(button)

    expect(onContinue).not.toHaveBeenCalled()
  })

  it('renders the held slot line when provided', () => {
    renderStickyCTA({ selectedLine: 'Fri, May 22 · 9:00 AM' })

    expect(screen.getByText('Fri, May 22 · 9:00 AM')).toBeInTheDocument()
  })
})
