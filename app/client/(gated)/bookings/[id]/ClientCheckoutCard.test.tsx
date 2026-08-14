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
    // With no rebook option, the reassuring "nothing else to do" line stands.
    expect(
      screen.getAllByText(/nothing else you need to do/i).length,
    ).toBeGreaterThan(0)

    // No re-confirm / save-tip buttons while waiting on the pro.
    expect(
      screen.queryByRole('button', { name: /confirm payment/i }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /save tip/i }),
    ).not.toBeInTheDocument()
  })

  it('swaps to rebook-guiding copy when a rebook option is available (PF6)', () => {
    render(
      <ClientCheckoutCard
        bookingId="booking_1"
        checkoutStatus="AWAITING_CONFIRMATION"
        paymentCollectedAt={null}
        selectedPaymentMethod="CASH"
        totalAmount="40.00"
        acceptedMethods={METHODS}
        rebookOptionAvailable
      />,
    )

    // Still confirms the pending state...
    expect(
      screen.getAllByText(/waiting on your pro/i).length,
    ).toBeGreaterThan(0)
    // ...but points the client at rebooking instead of "nothing else to do".
    expect(
      screen.getAllByText(/suggested a time to rebook/i).length,
    ).toBeGreaterThan(0)
    expect(
      screen.queryByText(/nothing else you need to do/i),
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

// The bug Tori hit in the field: tapping "Pay with Venmo" on a phone did
// nothing. The https URL is not a Venmo universal link (venmo.com's
// apple-app-site-association claims /u/*, not a bare /<username>), so iOS handed
// it to Safari, which followed a 302→307 chain ending at venmo://paycharge — a
// server redirect into a custom scheme, out of a target=_blank tab, which Safari
// refuses. The fix is to navigate to that scheme ourselves from the click.
describe('ClientCheckoutCard — Venmo hands off to the app on mobile', () => {
  const realUserAgent = navigator.userAgent
  let assigned: string | null

  function setUserAgent(value: string) {
    Object.defineProperty(navigator, 'userAgent', {
      value,
      configurable: true,
    })
  }

  beforeEach(() => {
    vi.clearAllMocks()
    assigned = null

    // jsdom won't navigate; capture the assignment instead.
    Object.defineProperty(window, 'location', {
      value: {
        set href(value: string) {
          assigned = value
        },
        get href() {
          return 'http://localhost/'
        },
        assign: (value: string) => {
          assigned = value
        },
      },
      configurable: true,
      writable: true,
    })
  })

  afterEach(() => {
    cleanup()
    setUserAgent(realUserAgent)
  })

  function renderVenmoCard() {
    render(
      <ClientCheckoutCard
        bookingId="booking_1"
        checkoutStatus="READY"
        paymentCollectedAt={null}
        selectedPaymentMethod="VENMO"
        serviceSubtotalSnapshot="65.00"
        totalAmount="65.00"
        acceptedMethods={[{ key: 'venmo', label: 'Venmo', handle: '@tovispro' }]}
      />,
    )
    return screen.getByRole('link', { name: /with Venmo/i }) as HTMLAnchorElement
  }

  it('navigates to venmo://paycharge instead of the dead https URL on iPhone', () => {
    setUserAgent(
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1',
    )

    const link = renderVenmoCard()
    // The anchor still carries the https URL, so it degrades gracefully.
    expect(link.getAttribute('href')).toContain('https://venmo.com/tovispro')

    const event = new window.MouseEvent('click', {
      bubbles: true,
      cancelable: true,
    })
    fireEvent(link, event)

    // The default https navigation was suppressed in favour of the app scheme.
    expect(event.defaultPrevented).toBe(true)
    expect(assigned).toBe(
      'venmo://paycharge?txn=pay&recipients=tovispro&amount=65.00&note=TOVIS',
    )
  })

  it('leaves the https URL alone on desktop, where the web pay page works', () => {
    setUserAgent(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0 Safari/537.36',
    )

    const link = renderVenmoCard()

    const event = new window.MouseEvent('click', {
      bubbles: true,
      cancelable: true,
    })
    fireEvent(link, event)

    expect(event.defaultPrevented).toBe(false)
    expect(assigned).toBeNull()
  })
})

// Choosing a payment method hands off to that provider's app immediately
// (Tori, 2026-08-14) instead of waiting for a second tap on "Pay with X".
//
// 🔴 This fires off a SELECTION rather than a button that says "pay", so the
// guards matter as much as the behaviour: only on an actual change, and only on
// a device where an app could resolve. On a desktop the select must stay inert.
describe('ClientCheckoutCard — choosing a method opens its app', () => {
  const realUserAgent = navigator.userAgent
  let assigned: string | null

  function setUserAgent(value: string) {
    Object.defineProperty(navigator, 'userAgent', { value, configurable: true })
  }

  beforeEach(() => {
    vi.clearAllMocks()
    assigned = null
    Object.defineProperty(window, 'location', {
      value: {
        set href(value: string) {
          assigned = value
        },
        get href() {
          return 'http://localhost/'
        },
      },
      configurable: true,
      writable: true,
    })
  })

  afterEach(() => {
    cleanup()
    setUserAgent(realUserAgent)
  })

  function renderCard() {
    render(
      <ClientCheckoutCard
        bookingId="booking_1"
        checkoutStatus="READY"
        paymentCollectedAt={null}
        selectedPaymentMethod="CASH"
        serviceSubtotalSnapshot="65.00"
        totalAmount="65.00"
        acceptedMethods={[
          { key: 'cash', label: 'Cash', handle: null },
          { key: 'venmo', label: 'Venmo', handle: '@tovispro' },
        ]}
      />,
    )
    return screen.getByLabelText('Payment method') as HTMLSelectElement
  }

  it('opens Venmo the moment the client picks it, on a phone', () => {
    setUserAgent(
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1',
    )

    const select = renderCard()
    fireEvent.change(select, { target: { value: 'venmo' } })

    expect(assigned).toBe(
      'venmo://paycharge?txn=pay&recipients=tovispro&amount=65.00&note=TOVIS',
    )
  })

  it('stays put on desktop, where there is no app to open', () => {
    setUserAgent(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0 Safari/537.36',
    )

    const select = renderCard()
    fireEvent.change(select, { target: { value: 'venmo' } })

    expect(assigned).toBeNull()
  })

  it('does nothing for a method with no app to hand off to', () => {
    setUserAgent(
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1',
    )

    const select = renderCard()
    // Cash is already selected; re-picking it is not a request to pay again,
    // and cash has no scheme even if it were.
    fireEvent.change(select, { target: { value: 'cash' } })

    expect(assigned).toBeNull()
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

// K10-A — a deposit the client already paid must come off everything they are
// SHOWN or HANDED, not just off the Stripe charge. The off-platform deep link
// is the sharp edge: it pre-fills an amount the client sends by hand, and there
// is no charge object to correct afterwards if it quotes the whole bill.
describe('ClientCheckoutCard — the paid deposit comes off the amount due', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    cleanup()
  })

  function rowValue(label: string): string {
    return screen.getByText(label).nextElementSibling?.textContent ?? ''
  }

  it('quotes the balance, not the bill, in the Venmo hand-off and the CTA', () => {
    render(
      <ClientCheckoutCard
        bookingId="booking_1"
        checkoutStatus="READY"
        paymentCollectedAt={null}
        selectedPaymentMethod="VENMO"
        serviceSubtotalSnapshot="200.00"
        totalAmount="200.00"
        // $60 already paid up front.
        depositCreditCents={6_000}
        acceptedMethods={[{ key: 'venmo', label: 'Venmo', handle: 'tovispro' }]}
      />,
    )

    // The bill still reads $200 — that is what the service cost.
    expect(rowValue('Total')).toBe('$200.00')
    // ...but the deposit is shown coming off it, and the balance is named.
    expect(rowValue('Deposit already paid')).toBe('−$60.00')
    expect(rowValue('Amount due')).toBe('$140.00')

    // 🔴 The bug: pre-K10-A this said amount=200.00 and the client sent the
    // deposit a second time, by hand, with no way to claw it back.
    const venmoHref = (
      screen.getByRole('link', { name: /with Venmo/i }) as HTMLAnchorElement
    ).getAttribute('href')
    expect(venmoHref).toContain('amount=140.00')
    expect(venmoHref).not.toContain('amount=200.00')

    expect(
      screen.getByRole('button', { name: /confirm payment of \$140\.00/i }),
    ).toBeInTheDocument()
  })

  it('adds the tip to the BALANCE, not to the full bill', () => {
    render(
      <ClientCheckoutCard
        bookingId="booking_1"
        checkoutStatus="READY"
        paymentCollectedAt={null}
        selectedPaymentMethod="VENMO"
        serviceSubtotalSnapshot="200.00"
        totalAmount="200.00"
        depositCreditCents={6_000}
        acceptedMethods={[{ key: 'venmo', label: 'Venmo', handle: 'tovispro' }]}
      />,
    )

    // 20% of the $200 service = $40 tip. Bill $240, less the $60 deposit = $180.
    fireEvent.click(screen.getByRole('button', { name: /20%/ }))

    expect(rowValue('Total')).toBe('$240.00')
    expect(rowValue('Amount due')).toBe('$180.00')
    expect(
      (
        screen.getByRole('link', { name: /with Venmo/i }) as HTMLAnchorElement
      ).getAttribute('href'),
    ).toContain('amount=180.00')
  })

  it('shows no deposit rows and charges the full bill when there is no deposit', () => {
    render(
      <ClientCheckoutCard
        bookingId="booking_1"
        checkoutStatus="READY"
        paymentCollectedAt={null}
        selectedPaymentMethod="VENMO"
        serviceSubtotalSnapshot="200.00"
        totalAmount="200.00"
        depositCreditCents={0}
        acceptedMethods={[{ key: 'venmo', label: 'Venmo', handle: 'tovispro' }]}
      />,
    )

    expect(rowValue('Total')).toBe('$200.00')
    expect(screen.queryByText('Deposit already paid')).toBeNull()
    expect(screen.queryByText('Amount due')).toBeNull()
    expect(
      (
        screen.getByRole('link', { name: /with Venmo/i }) as HTMLAnchorElement
      ).getAttribute('href'),
    ).toContain('amount=200.00')
  })

  it('quotes nothing due when the deposit covers the whole bill', () => {
    render(
      <ClientCheckoutCard
        bookingId="booking_1"
        checkoutStatus="READY"
        paymentCollectedAt={null}
        selectedPaymentMethod="VENMO"
        serviceSubtotalSnapshot="200.00"
        totalAmount="200.00"
        depositCreditCents={20_000}
        acceptedMethods={[{ key: 'venmo', label: 'Venmo', handle: 'tovispro' }]}
      />,
    )

    expect(rowValue('Amount due')).toBe('$0.00')
    // buildPaymentDeepLink refuses a non-positive amount, so a prepaid client
    // is never handed a "send $0" link at all.
    expect(screen.queryByRole('link', { name: /with Venmo/i })).toBeNull()
  })
})
