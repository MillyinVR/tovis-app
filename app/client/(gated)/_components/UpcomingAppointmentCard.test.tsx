// app/client/(gated)/_components/UpcomingAppointmentCard.test.tsx
//
// The client footer used to carry a Bookings tab whose whole job was being an
// UNCONDITIONAL route to /client/bookings. The tab is gone (bookings live in the
// home area now — see CLIENT_TABS), so this card is that route, and the
// constraint the tab carried moves here with it:
//
//   /client/bookings is the ONLY surface listing a client's PENDING bookings.
//   The home Upcoming card is fed an ACCEPTED/IN_PROGRESS booking, and
//   Me → HISTORY filters to ACCEPTED/IN_PROGRESS/COMPLETED. So a client whose
//   single booking is still awaiting their pro's approval sees the EMPTY card —
//   and if the link only rendered on the populated one, they could not open, or
//   cancel, their own request at all.
//
// That is exactly the hole the old conditional link left: it read
// `moreCount > 0`, i.e. it needed 2+ upcoming bookings to appear. Both states
// are asserted below; making either one conditional again is a red test rather
// than a client silently stranded.

import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { Prisma } from '@prisma/client'

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    ...props
  }: {
    href: string
    children: React.ReactNode
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}))

// ProProfileLink is a client component that reaches for the pro's public route;
// the card's own links are what this suite is about.
vi.mock('@/app/_components/ProProfileLink', () => ({
  default: ({
    label,
    children,
  }: {
    label: string
    children?: React.ReactNode
  }) => <span>{children ?? label}</span>,
}))

import UpcomingAppointmentCard from './UpcomingAppointmentCard'
import type { ClientHomeBooking } from '../_data/getClientHomeData'

function booking(): ClientHomeBooking {
  return {
    id: 'bk_1',
    status: 'ACCEPTED',
    source: 'REQUESTED',
    sessionStep: 'NONE',
    scheduledFor: new Date('2026-09-01T15:00:00.000Z'),
    finishedAt: null,

    subtotalSnapshot: new Prisma.Decimal(120),
    serviceSubtotalSnapshot: new Prisma.Decimal(120),
    productSubtotalSnapshot: new Prisma.Decimal(0),
    totalAmount: new Prisma.Decimal(120),
    tipAmount: null,
    taxAmount: null,
    discountAmount: null,
    checkoutStatus: 'NOT_READY',
    selectedPaymentMethod: null,
    paymentAuthorizedAt: null,
    paymentCollectedAt: null,

    totalDurationMinutes: 90,
    bufferMinutes: 0,

    locationType: 'SALON',
    locationId: 'loc_1',
    locationTimeZone: 'America/New_York',
    locationAddressSnapshot: null,

    service: { id: 'svc_1', name: 'Balayage' },

    professional: {
      id: 'pro_1',
      businessName: 'Studio Nine',
      firstName: 'Nine',
      lastName: 'Studio',
      nameDisplay: 'BUSINESS_NAME',
      handle: 'studionine',
      avatarUrl: null,
      location: 'Brooklyn, NY',
      timeZone: 'America/New_York',
    },

    location: {
      id: 'loc_1',
      name: 'Studio Nine',
      formattedAddress: null,
      city: 'Brooklyn',
      state: 'NY',
      timeZone: 'America/New_York',
    },

    serviceItems: [],
    productSales: [],

    consultationNotes: null,
    consultationPrice: null,
    consultationConfirmedAt: null,
    consultationApproval: null,
  }
}

function bookingsListLink() {
  return screen
    .getAllByRole('link')
    .find((link) => link.getAttribute('href') === '/client/bookings')
}

describe('UpcomingAppointmentCard', () => {
  // The load-bearing case: no approved booking is precisely the state a
  // pending-only client lands in, and it is the one the old link never covered.
  it('links to the bookings list from its empty state', () => {
    render(<UpcomingAppointmentCard booking={null} />)

    expect(bookingsListLink()).toBeDefined()
    expect(screen.getByText('All bookings →')).toBeInTheDocument()
  })

  // One upcoming booking — the common case, and the one `moreCount > 0` dropped.
  it('links to the bookings list with a single upcoming booking', () => {
    render(<UpcomingAppointmentCard booking={booking()} upcomingCount={1} />)

    expect(bookingsListLink()).toBeDefined()
    expect(screen.getByText('All bookings →')).toBeInTheDocument()
  })

  // With more to see, the link keeps saying so — the count is a label change,
  // never a condition on whether the link renders at all.
  it('names the remaining count when there is more than one upcoming', () => {
    render(<UpcomingAppointmentCard booking={booking()} upcomingCount={3} />)

    expect(bookingsListLink()).toBeDefined()
    expect(screen.getByText('2 more upcoming →')).toBeInTheDocument()
  })
})
