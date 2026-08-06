import React from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

import ClientsList, { type ProClientRow } from './ClientsList'

function row(args: {
  id: string
  displayName: string
  email?: string
  phone?: string
  requirements?: ProClientRow['requirements']
  profileHref?: string | null
  chartHref?: string | null
}): ProClientRow {
  const email = args.email ?? ''
  const phone = args.phone ?? ''
  return {
    id: args.id,
    displayName: args.displayName,
    contactLine: `${email || 'No email'}${phone ? ` • ${phone}` : ''}`,
    searchText: `${args.displayName} ${email} ${phone}`.toLowerCase().trim(),
    lastBookingLabel: 'No bookings yet',
    messageHref: '/messages/start',
    profileHref:
      args.profileHref === undefined
        ? `/pro/clients/${args.id}`
        : args.profileHref,
    chartHref:
      args.chartHref === undefined ? `/pro/clients/${args.id}` : args.chartHref,
    requirements: args.requirements ?? [],
  }
}

const clients: ProClientRow[] = [
  row({
    id: 'c1',
    displayName: 'Ada Lovelace',
    email: 'ada@example.com',
    phone: '+16195550001',
  }),
  row({
    id: 'c2',
    displayName: 'Grace Hopper',
    email: 'grace@navy.mil',
    phone: '+16195550002',
  }),
  row({ id: 'c3', displayName: 'Katherine Johnson' }),
]

describe('ClientsList', () => {
  afterEach(cleanup)

  it('renders every client and the visible count when unfiltered', () => {
    render(<ClientsList clients={clients} />)

    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument()
    expect(screen.getByText('Grace Hopper')).toBeInTheDocument()
    expect(screen.getByText('Katherine Johnson')).toBeInTheDocument()
    expect(screen.getByText('3 visible')).toBeInTheDocument()
  })

  it('filters by name and updates the match count', () => {
    render(<ClientsList clients={clients} />)

    fireEvent.change(screen.getByPlaceholderText(/Search by name/i), {
      target: { value: 'grace' },
    })

    expect(screen.getByText('Grace Hopper')).toBeInTheDocument()
    expect(screen.queryByText('Ada Lovelace')).not.toBeInTheDocument()
    expect(screen.queryByText('Katherine Johnson')).not.toBeInTheDocument()
    expect(screen.getByText('1 of 3')).toBeInTheDocument()
  })

  it('filters by email', () => {
    render(<ClientsList clients={clients} />)

    fireEvent.change(screen.getByPlaceholderText(/Search by name/i), {
      target: { value: 'navy.mil' },
    })

    expect(screen.getByText('Grace Hopper')).toBeInTheDocument()
    expect(screen.queryByText('Ada Lovelace')).not.toBeInTheDocument()
  })

  it('requires every term to match (space-separated narrowing)', () => {
    render(<ClientsList clients={clients} />)

    fireEvent.change(screen.getByPlaceholderText(/Search by name/i), {
      target: { value: 'ada gmail' },
    })

    // "ada" matches but "gmail" does not (her email is example.com).
    expect(screen.queryByText('Ada Lovelace')).not.toBeInTheDocument()
    expect(screen.getByText(/No clients match/i)).toBeInTheDocument()
  })

  it('shows the visibility empty state when there are no clients', () => {
    render(<ClientsList clients={[]} />)

    expect(
      screen.getByText(/No clients with active visibility/i),
    ).toBeInTheDocument()
    // No search box when the list is empty.
    expect(screen.queryByPlaceholderText(/Search by name/i)).toBeNull()
  })

  // ─── K16-B: booking requirements on the roster ─────────────────────────────

  const withRequirements: ProClientRow[] = [
    row({
      id: 'c1',
      displayName: 'Ada Lovelace',
      requirements: [
        { key: 'deposit', label: 'Deposit', inactive: false },
        { key: 'noOnlineBooking', label: 'No online booking', inactive: false },
      ],
    }),
    row({ id: 'c2', displayName: 'Grace Hopper' }),
    row({
      id: 'c3',
      displayName: 'Katherine Johnson',
      requirements: [
        { key: 'cardOnFile', label: 'Card on file', inactive: true },
      ],
    }),
  ]

  it('shows each requirement the pro set, on the client it belongs to', () => {
    render(<ClientsList clients={withRequirements} />)

    expect(screen.getByText('Deposit')).toBeInTheDocument()
    expect(screen.getByText('No online booking')).toBeInTheDocument()
  })

  it('marks a requirement the pro set but the server will not enforce', () => {
    render(<ClientsList clients={withRequirements} />)

    // Card-on-file stored ON while the save-card rail is dark: it must still
    // appear (the pro DID restrict this client) and must not read as active.
    expect(screen.getByText(/Card on file \(not active\)/)).toBeInTheDocument()
  })

  it('offers a requirements-only filter counting just the restricted clients', () => {
    render(<ClientsList clients={withRequirements} />)

    const filter = screen.getByLabelText(
      /Only clients with booking requirements \(2\)/,
    )
    expect(filter).toBeInTheDocument()

    fireEvent.click(filter)

    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument()
    expect(screen.getByText('Katherine Johnson')).toBeInTheDocument()
    expect(screen.queryByText('Grace Hopper')).not.toBeInTheDocument()
  })

  it('moves the header count when the requirements filter narrows the list', () => {
    // Caught by loading the page, not by a test: the count keyed only off the
    // search box, so it read "3 visible" above a two-row list.
    render(<ClientsList clients={withRequirements} />)

    expect(screen.getByText('3 visible')).toBeInTheDocument()

    fireEvent.click(
      screen.getByLabelText(/Only clients with booking requirements/),
    )

    expect(screen.getByText('2 of 3')).toBeInTheDocument()
    expect(screen.queryByText('3 visible')).not.toBeInTheDocument()
  })

  it('hides the filter entirely when no client has requirements', () => {
    // Also the technical-record-gate-off case: the page sends empty
    // requirements for every client, so nothing about the feature appears.
    render(<ClientsList clients={clients} />)

    expect(
      screen.queryByLabelText(/Only clients with booking requirements/),
    ).toBeNull()
  })

  it('combines the filter with the search rather than replacing it', () => {
    render(<ClientsList clients={withRequirements} />)

    fireEvent.click(
      screen.getByLabelText(/Only clients with booking requirements/),
    )
    fireEvent.change(screen.getByPlaceholderText(/Search by name/i), {
      target: { value: 'grace' },
    })

    // Grace matches the search but has no requirements, so both filters apply.
    expect(screen.queryByText('Grace Hopper')).not.toBeInTheDocument()
    expect(screen.getByText(/No clients match/i)).toBeInTheDocument()
  })
})


// The roster's name is the pro's most-used way into a client. Both directions
// matter: a resolved href must be a real link, and a null one must leave NO
// href in the DOM rather than a link that refuses on arrival.
describe('ClientsList — the client name links', () => {
  it('links the name to the resolved destination', () => {
    render(<ClientsList clients={[row({ id: 'c9', displayName: 'Rae Kim' })]} />)

    expect(screen.getByRole('link', { name: 'Rae Kim' })).toHaveAttribute(
      'href',
      '/pro/clients/c9',
    )
  })

  it('renders plain text — no href — when there is nowhere to go', () => {
    render(
      <ClientsList
        clients={[row({ id: 'c9', displayName: 'Rae Kim', profileHref: null })]}
      />,
    )

    expect(screen.queryByRole('link', { name: 'Rae Kim' })).toBeNull()
    expect(screen.getByText('Rae Kim')).toBeInTheDocument()
  })
})

describe('ClientsList — the "View chart" button is the SAME decision as the name', () => {
  it('links to the chart the server resolved, not one rebuilt from the id', () => {
    render(
      <ClientsList
        clients={[row({ id: 'c9', displayName: 'Rae Kim', chartHref: '/pro/clients/c9' })]}
      />,
    )

    expect(screen.getByRole('link', { name: 'View chart' })).toHaveAttribute(
      'href',
      '/pro/clients/c9',
    )
  })

  it('is absent for a client this pro may not open', () => {
    // A booking-less client the pro created: on the roster, name resolves to
    // their public profile, chart refuses. A "View chart" button here would
    // navigate to a page that redirects straight back to this list.
    render(
      <ClientsList
        clients={[
          row({
            id: 'c9',
            displayName: 'Rae Kim',
            profileHref: '/u/raekim',
            chartHref: null,
          }),
        ]}
      />,
    )

    expect(screen.queryByRole('link', { name: 'View chart' })).toBeNull()
    // The row is still useful: the name goes to their public page, and the pro
    // can still message them.
    expect(screen.getByRole('link', { name: 'Rae Kim' })).toHaveAttribute('href', '/u/raekim')
    expect(screen.getByRole('link', { name: 'Message' })).toBeInTheDocument()
  })
})
