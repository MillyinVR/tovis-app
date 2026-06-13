import React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

const mocks = vi.hoisted(() => ({
  useFormStatus: vi.fn(),
}))

vi.mock('react-dom', async (importOriginal) => {
  const original = await importOriginal<typeof import('react-dom')>()
  return {
    ...original,
    useFormStatus: mocks.useFormStatus,
  }
})

import PendingActionButton from './PendingActionButton'

describe('PendingActionButton', () => {
  it('renders children when idle', () => {
    mocks.useFormStatus.mockReturnValue({ pending: false })

    render(<PendingActionButton>Start service</PendingActionButton>)

    const button = screen.getByRole('button', { name: /start service/i })
    expect(button).not.toBeDisabled()
    expect(button).not.toHaveAttribute('data-pending')
  })

  it('shows pendingLabel and disables when pending', () => {
    mocks.useFormStatus.mockReturnValue({ pending: true })

    render(
      <PendingActionButton pendingLabel="Starting…">
        Start service
      </PendingActionButton>,
    )

    const button = screen.getByRole('button', { name: /starting/i })
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('data-pending')
  })

  it('falls back to children when pending and no pendingLabel', () => {
    mocks.useFormStatus.mockReturnValue({ pending: true })

    render(<PendingActionButton>Go</PendingActionButton>)

    const button = screen.getByRole('button', { name: /go/i })
    expect(button).toBeDisabled()
  })

  it('respects disabled prop even when not pending', () => {
    mocks.useFormStatus.mockReturnValue({ pending: false })

    render(<PendingActionButton disabled>Go</PendingActionButton>)

    expect(screen.getByRole('button')).toBeDisabled()
  })

  it('applies variant and grow data attributes', () => {
    mocks.useFormStatus.mockReturnValue({ pending: false })

    render(
      <PendingActionButton variant="danger" grow={2}>
        Delete
      </PendingActionButton>,
    )

    const button = screen.getByRole('button')
    expect(button).toHaveAttribute('data-variant', 'danger')
    expect(button).toHaveAttribute('data-grow', '2')
  })
})
