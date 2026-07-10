import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

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

// Regression guard for CHK-tip-live (origin 9ec115fb0). The persisted
// `totalAmount` snapshot is almost always non-null, so the old
// `totalSnapshot ?? livePreviewTotal` short-circuit froze the on-screen Total and
// the off-platform deep-link at the pre-tip value until the client tapped
// "Save tip". Both must now reflect the FULL live amount owed the instant a tip
// is chosen — no save round-trip.
describe('ClientCheckoutCard — live total tracks the tip (CHK-tip-live)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    cleanup()
  })

  // The Total row renders label + value as sibling divs (SummaryRow); read the
  // value that sits next to the "Total" label.
  function totalRowValue(): string {
    const label = screen.getByText('Total')
    return label.nextElementSibling?.textContent ?? ''
  }

  it('updates the Total and the Venmo deep-link amount live when a 20% preset is picked — no save', () => {
    render(
      <ClientCheckoutCard
        bookingId="booking_1"
        checkoutStatus="READY"
        paymentCollectedAt={null}
        selectedPaymentMethod="VENMO"
        // $60 service, no products/tax/discount; the frozen server snapshot
        // (pre-tip) is $60.00.
        serviceSubtotalSnapshot="60.00"
        totalAmount="60.00"
        acceptedMethods={[
          { key: 'venmo', label: 'Venmo', handle: 'tovispro' },
        ]}
      />,
    )

    const venmoLink = () =>
      screen.getByRole('link', { name: /with Venmo/i }) as HTMLAnchorElement

    // Before any tip: Total and deep-link both sit at the $60 service amount.
    expect(totalRowValue()).toBe('$60.00')
    expect(venmoLink().getAttribute('href')).toContain('amount=60.00')

    // Pick 20% on a $60 service → $12 tip.
    fireEvent.click(screen.getByRole('button', { name: /20%/ }))

    // Total row jumps to $72.00 immediately...
    expect(totalRowValue()).toBe('$72.00')
    // ...the Venmo link is pre-filled with 72.00 (no "Save tip" needed)...
    expect(venmoLink().getAttribute('href')).toContain('amount=72.00')
    expect(venmoLink().getAttribute('href')).not.toContain('amount=60.00')
    // ...and the confirm CTA quotes the same full amount.
    expect(
      screen.getByRole('button', { name: /confirm payment of \$72\.00/i }),
    ).toBeInTheDocument()

    // Crucially: nothing was saved. selecting a preset must not round-trip.
    expect(mocks.refresh).not.toHaveBeenCalled()
  })

  it('reflects the full total (service + products + tax) in the PayPal deep-link amount', () => {
    render(
      <ClientCheckoutCard
        bookingId="booking_1"
        checkoutStatus="READY"
        paymentCollectedAt={null}
        selectedPaymentMethod="PAYPAL"
        serviceSubtotalSnapshot="60.00"
        productSubtotalSnapshot="20.00"
        taxAmount="5.00"
        // Frozen pre-tip snapshot = 60 + 20 + 5 = $85.00. The live total must
        // NOT show this stale value once a tip is added.
        totalAmount="85.00"
        acceptedMethods={[
          { key: 'paypal', label: 'PayPal', handle: 'tovispro' },
        ]}
      />,
    )

    const paypalLink = () =>
      screen.getByRole('link', { name: /with PayPal/i }) as HTMLAnchorElement

    // 20% of the $60 service = $12 tip → 60 + 20 + 12 + 5 = $97.00.
    fireEvent.click(screen.getByRole('button', { name: /20%/ }))

    expect(totalRowValue()).toBe('$97.00')
    expect(totalRowValue()).not.toBe('$85.00')
    // PayPal.Me locks the amount into the URL path: /{amount}.
    expect(paypalLink().getAttribute('href')).toContain('/97.00')

    expect(mocks.refresh).not.toHaveBeenCalled()
  })
})
