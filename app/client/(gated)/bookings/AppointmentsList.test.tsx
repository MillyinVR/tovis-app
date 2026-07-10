import { render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ProNameDisplay, WaitlistStatus } from '@prisma/client'

import type { ClientBookingDTO } from '@/lib/dto/clientBooking'
import type {
  ClientBookingBuckets,
  ClientBookingWaitlistRow,
} from '@/lib/booking/clientBookingBuckets'

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

import AppointmentsList from './AppointmentsList'

function makeBooking(overrides?: Partial<ClientBookingDTO>): ClientBookingDTO {
  return {
    id: 'booking_1',
    status: 'ACCEPTED',
    source: 'DIRECT',
    rebookOfBookingId: null,
    sessionStep: null,
    scheduledFor: '2026-04-24T15:00:00.000Z',
    totalDurationMinutes: 60,
    bufferMinutes: 0,
    subtotalSnapshot: '100.00',
    checkout: {
      subtotalSnapshot: '100.00',
      serviceSubtotalSnapshot: '100.00',
      productSubtotalSnapshot: '0.00',
      tipAmount: null,
      taxAmount: null,
      discountAmount: null,
      totalAmount: '100.00',
      checkoutStatus: null,
      selectedPaymentMethod: null,
      paymentAuthorizedAt: null,
      paymentCollectedAt: null,
      depositStatus: null,
      depositAmount: null,
    },
    locationType: 'SALON',
    locationId: 'loc_1',
    timeZone: 'America/Los_Angeles',
    locationLabel: 'Main Studio',
    professional: {
      id: 'pro_1',
      businessName: 'Glow Studio',
      firstName: null,
      lastName: null,
      handle: 'glow',
      nameDisplay: null,
      location: 'Los Angeles',
      timeZone: 'America/Los_Angeles',
    },
    bookedLocation: null,
    display: {
      title: 'Balayage',
      baseName: 'Balayage',
      addOnNames: [],
      addOnCount: 0,
    },
    items: [],
    productSales: [],
    hasUnreadAftercare: false,
    hasPendingConsultationApproval: false,
    hasPendingRebookConfirmation: false,
    rebookProposedFor: null,
    mediaUseConsent: false,
    consultation: null,
    paymentOptions: null,
    ...overrides,
  }
}

function makeWaitlist(
  overrides?: Partial<ClientBookingWaitlistRow>,
): ClientBookingWaitlistRow {
  return {
    id: 'wait_1',
    createdAt: new Date('2026-04-10T10:00:00.000Z'),
    notes: null,
    mediaId: null,
    status: WaitlistStatus.ACTIVE,
    preferenceType: 'ANY_TIME',
    specificDate: null,
    timeOfDay: null,
    windowStartMin: null,
    windowEndMin: null,
    service: { id: 'service_1', name: 'Color correction' },
    professional: {
      id: 'pro_1',
      businessName: 'Glow Studio',
      firstName: 'Glow',
      lastName: 'Owner',
      handle: 'glow',
      nameDisplay: ProNameDisplay.BUSINESS_NAME,
      location: 'Los Angeles',
      timeZone: 'America/Los_Angeles',
    },
    ...overrides,
  }
}

function makeBuckets(
  overrides?: Partial<ClientBookingBuckets>,
): ClientBookingBuckets {
  return {
    upcoming: [],
    pending: [],
    waitlist: [],
    prebooked: [],
    past: [],
    ...overrides,
  }
}

afterEach(() => {
  vi.clearAllMocks()
})

describe('AppointmentsList', () => {
  it('renders each populated bucket as a titled section and links rows to detail', () => {
    render(
      <AppointmentsList
        buckets={makeBuckets({
          upcoming: [makeBooking({ id: 'up_1', display: { title: 'Balayage', baseName: 'Balayage', addOnNames: [], addOnCount: 0 } })],
          pending: [makeBooking({ id: 'pend_1' })],
          prebooked: [makeBooking({ id: 'pre_1' })],
          waitlist: [makeWaitlist()],
          past: [makeBooking({ id: 'past_1', status: 'COMPLETED' })],
        })}
      />,
    )

    expect(
      screen.getByRole('heading', { level: 1, name: 'Appointments' }),
    ).toBeInTheDocument()

    for (const title of [
      'Upcoming',
      'Needs your attention',
      'Pre-booked',
      'Waitlist',
      'Past',
    ]) {
      expect(screen.getByRole('heading', { level: 2, name: title })).toBeInTheDocument()
    }

    const detailLink = screen.getAllByRole('link')[0]
    expect(detailLink).toHaveAttribute('href', '/client/bookings/up_1')

    // Waitlist entry renders its service name + a Waitlisted chip.
    expect(screen.getByText('Color correction')).toBeInTheDocument()
    expect(screen.getByText('Waitlisted')).toBeInTheDocument()
  })

  it('omits empty buckets', () => {
    render(
      <AppointmentsList
        buckets={makeBuckets({ upcoming: [makeBooking()] })}
      />,
    )

    expect(screen.getByRole('heading', { level: 2, name: 'Upcoming' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { level: 2, name: 'Past' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { level: 2, name: 'Waitlist' })).not.toBeInTheDocument()
  })

  it('shows a Review chip for a pending consultation approval instead of the status', () => {
    render(
      <AppointmentsList
        buckets={makeBuckets({
          pending: [
            makeBooking({ id: 'pend_1', hasPendingConsultationApproval: true }),
          ],
        })}
      />,
    )

    const section = screen.getByRole('heading', { level: 2, name: 'Needs your attention' })
      .parentElement!.parentElement!
    expect(within(section).getByText('Review')).toBeInTheDocument()
  })

  it('renders an empty state when there are no appointments', () => {
    render(<AppointmentsList buckets={makeBuckets()} />)

    expect(screen.getByText('No appointments yet')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Find a pro/ })).toHaveAttribute(
      'href',
      '/discover',
    )
  })
})
