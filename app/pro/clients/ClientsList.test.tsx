import React from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

import ClientsList, { type ProClientRow } from './ClientsList'

function row(args: {
  id: string
  displayName: string
  email?: string
  phone?: string
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
})
