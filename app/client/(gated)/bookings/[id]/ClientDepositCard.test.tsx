// app/client/(gated)/bookings/[id]/ClientDepositCard.test.tsx
// @vitest-environment jsdom
//
// The client's itemisation of the up-front charge. Worth testing rather than
// eyeballing for one specific reason: this card adds two numbers that arrive in
// DIFFERENT UNITS — `depositAmount` is dollars (a serialized Decimal) and
// `discoveryFeeCents` is cents. A units slip there renders a $55 charge as
// $5,005.00 and still looks like a plausible currency string, so the arithmetic
// needs an assertion, not a glance.
//
// It also matters more than it used to: the convenience fee is 10% of the deposit
// within a floor and a cap, so it is no longer a flat number a client could learn
// once. The total is the only row that tells them what Stripe is about to charge.

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))

import ClientDepositCard from './ClientDepositCard'

const BASE = {
  bookingId: 'booking_1',
  bookingStatus: 'PENDING',
  depositStatus: 'PENDING',
}

afterEach(cleanup)

describe('ClientDepositCard — the up-front itemisation', () => {
  it('adds a dollars deposit to a cents fee and shows the real charge', () => {
    render(
      <ClientDepositCard {...BASE} depositAmount="50.00" discoveryFeeCents={500} />,
    )

    expect(screen.getByText('Deposit (credited later)')).toBeTruthy()
    expect(screen.getByText('One-time booking fee')).toBeTruthy()
    expect(screen.getByText('Total due today')).toBeTruthy()
    // $50.00 + $5.00 — NOT $5,005.00, which is what mixing the units yields.
    expect(screen.getByText('$55.00')).toBeTruthy()
  })

  it('totals correctly at the fee FLOOR (a small deposit)', () => {
    // $10 deposit -> 10% is $1, floored to $2 -> $12.00 due.
    render(
      <ClientDepositCard {...BASE} depositAmount="10.00" discoveryFeeCents={200} />,
    )
    expect(screen.getByText('$12.00')).toBeTruthy()
  })

  it('totals correctly at the fee CAP (a large deposit)', () => {
    // $400 deposit -> 10% is $40, capped to $10 -> $410.00 due.
    render(
      <ClientDepositCard {...BASE} depositAmount="400.00" discoveryFeeCents={1000} />,
    )
    expect(screen.getByText('$410.00')).toBeTruthy()
  })

  it('handles a deposit with cents without drifting a penny', () => {
    // $37.50 deposit -> 10% is $3.75 -> $41.25 due.
    render(
      <ClientDepositCard {...BASE} depositAmount="37.50" discoveryFeeCents={375} />,
    )
    expect(screen.getByText('$41.25')).toBeTruthy()
  })

  it('shows no fee row and no total when no fee applies', () => {
    // The overwhelmingly common case once this ships: a deposit-only booking,
    // because the fee needs a cold match AND the flag on.
    render(<ClientDepositCard {...BASE} depositAmount="50.00" discoveryFeeCents={0} />)

    expect(screen.getByText('Deposit (credited later)')).toBeTruthy()
    expect(screen.queryByText('One-time booking fee')).toBeNull()
    expect(screen.queryByText('Total due today')).toBeNull()
    // …and the button must not promise a fee that is not being charged.
    expect(screen.getByRole('button', { name: 'Pay deposit' })).toBeTruthy()
  })

  it('names the fee in the CTA when one applies', () => {
    render(
      <ClientDepositCard {...BASE} depositAmount="50.00" discoveryFeeCents={500} />,
    )
    expect(
      screen.getByRole('button', { name: 'Pay deposit & booking fee' }),
    ).toBeTruthy()
  })

  it('explains the fee only for the discovery path that actually incurs it', () => {
    const { container } = render(
      <ClientDepositCard {...BASE} depositAmount="50.00" discoveryFeeCents={500} />,
    )
    expect(container.textContent).toContain('Looks feed or Discovery')

    cleanup()
    const noFee = render(
      <ClientDepositCard {...BASE} depositAmount="50.00" discoveryFeeCents={0} />,
    )
    // A deposit can be required far more widely than the fee (the pro's
    // depositScope, a prepay-required service), so a deposit-only client must
    // not be told they came through Discovery.
    expect(noFee.container.textContent).not.toContain('Looks feed or Discovery')
  })

  it('treats a prepay-in-full charge the same way, fee on top', () => {
    render(
      <ClientDepositCard
        {...BASE}
        depositAmount="120.00"
        discoveryFeeCents={1000}
        prepaysInFull
      />,
    )
    expect(screen.getByText('Service (paid in full)')).toBeTruthy()
    expect(screen.getByText('$130.00')).toBeTruthy()
  })
})
