import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
}))

vi.mock('@/lib/brand/BrandProvider', () => ({
  useBrand: () => ({ brand: { displayName: 'TOVIS' } }),
}))

import ClientCheckoutCard from './ClientCheckoutCard'

const METHODS = [{ key: 'cash', label: 'Cash', handle: null }]

describe('ClientCheckoutCard — AWAITING_CONFIRMATION', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    cleanup()
  })

  it('shows the pending banner and hides the confirm / save-tip actions', () => {
    render(
      <ClientCheckoutCard
        bookingId="booking_1"
        checkoutStatus="AWAITING_CONFIRMATION"
        paymentCollectedAt={null}
        selectedPaymentMethod="CASH"
        totalAmount="40.00"
        acceptedMethods={METHODS}
      />,
    )

    // Truthful pending copy is surfaced.
    expect(
      screen.getAllByText(/waiting on your pro/i).length,
    ).toBeGreaterThan(0)
    expect(
      screen.getAllByText(/once your pro confirms they received payment/i)
        .length,
    ).toBeGreaterThan(0)

    // No re-confirm / save-tip buttons while waiting on the pro.
    expect(
      screen.queryByRole('button', { name: /confirm payment/i }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /save tip/i }),
    ).not.toBeInTheDocument()
  })

  it('renders the confirm CTA in the normal READY state', () => {
    render(
      <ClientCheckoutCard
        bookingId="booking_1"
        checkoutStatus="READY"
        paymentCollectedAt={null}
        selectedPaymentMethod="CASH"
        totalAmount="40.00"
        acceptedMethods={METHODS}
      />,
    )

    expect(
      screen.getByRole('button', { name: /confirm payment/i }),
    ).toBeInTheDocument()
  })
})
