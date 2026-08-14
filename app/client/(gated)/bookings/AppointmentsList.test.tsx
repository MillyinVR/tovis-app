import { render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ProNameDisplay, WaitlistStatus } from '@prisma/client'

import type { ClientBookingDTO } from '@/lib/dto/clientBooking'
import type {
  ClientBookingBuckets,
  ClientBookingWaitlistRow,
} from '@/lib/booking/clientBookingBuckets'
import type { ClientAftercareInboxItemDTO } from '@/lib/dto/clientAftercareInbox'

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
      paymentDisputed: false,
      paymentRefundedCents: 0,
      paymentFullyRefunded: false,
      depositDisputed: false,
    },
    locationType: 'SALON',
    locationId: 'loc_1',
    timeZone: 'America/Los_Angeles',
    locationLabel: 'Main Studio',
    locationAddress: '215 Bedford Ave, Brooklyn, NY 11211',
    locationLat: null,
    locationLng: null,
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
    cancellationPolicy: null,
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

function makeAftercare(
  overrides?: Partial<ClientAftercareInboxItemDTO>,
): ClientAftercareInboxItemDTO {
  return {
    notificationId: 'notif_1',
    bookingId: 'past_1',
    aftercareId: 'after_1',
    title: 'Balayage',
    proId: 'pro_1',
    proName: 'Glow Studio',
    scheduledFor: '2026-04-01T15:00:00.000Z',
    timeZone: 'America/Los_Angeles',
    beforeAfter: null,
    rebookMode: null,
    rebookedFor: null,
    body: 'Wash with cool water.',
    unread: false,
    createdAt: '2026-04-01T18:00:00.000Z',
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

    // "booking", never "appointment" — lib/copy.ts's glossary, and the home
    // card that links here says "All bookings →".
    expect(
      screen.getByRole('heading', { level: 1, name: 'Everything you’ve booked' }),
    ).toBeInTheDocument()
    expect(screen.queryByText(/Appointments/)).not.toBeInTheDocument()

    // Every non-tab client page routes back to where it came from.
    expect(screen.getByRole('link', { name: /Home/ })).toHaveAttribute(
      'href',
      '/client',
    )

    for (const title of [
      'Upcoming',
      'Needs your attention',
      'Pre-booked',
      'Waitlist',
      'Past',
    ]) {
      expect(screen.getByRole('heading', { level: 2, name: title })).toBeInTheDocument()
    }

    // Match the row by its href, not by link index — the page header now
    // contributes a back link that would otherwise take position 0.
    const detailLink = screen
      .getAllByRole('link')
      .find((el) => el.getAttribute('href') === '/client/bookings/up_1')
    expect(detailLink).toBeDefined()

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

  // Tori, live-testing as a client: "the pro's name isn't clickable". Every row
  // that names a pro has to reach that pro's profile — including the rows whose
  // card already links somewhere else (the booking).
  it('links the pro name AND avatar to the pro profile on a booking row', () => {
    render(
      <AppointmentsList
        buckets={makeBuckets({ upcoming: [makeBooking({ id: 'up_1' })] })}
      />,
    )

    const proLinks = screen
      .getAllByRole('link')
      .filter((link) => link.getAttribute('href') === '/professionals/pro_1')

    // Two: the avatar and the name.
    expect(proLinks).toHaveLength(2)
    expect(
      screen.getByRole('link', { name: 'Glow Studio' }),
    ).toBeInTheDocument()
  })

  it('links the pro name AND avatar to the pro profile on a waitlist row', () => {
    render(
      <AppointmentsList buckets={makeBuckets({ waitlist: [makeWaitlist()] })} />,
    )

    const proLinks = screen
      .getAllByRole('link')
      .filter((link) => link.getAttribute('href') === '/professionals/pro_1')

    expect(proLinks).toHaveLength(2)
  })

  // The row still opens the booking — but as an overlay, never as an <a> WRAPPING
  // the pro links. Nested anchors are invalid HTML: the browser un-nests them and
  // the inner link silently stops working, which is the exact bug this fixes.
  it('keeps the booking link and the pro links un-nested', () => {
    const { container } = render(
      <AppointmentsList
        buckets={makeBuckets({ upcoming: [makeBooking({ id: 'up_1' })] })}
      />,
    )

    expect(container.querySelector('a a')).toBeNull()

    const bookingLink = screen.getByRole('link', {
      name: /Balayage with Glow Studio/,
    })
    expect(bookingLink).toHaveAttribute('href', '/client/bookings/up_1')
  })

  it('renders the pro name as inert text when the booking has no professional', () => {
    render(
      <AppointmentsList
        buckets={makeBuckets({
          upcoming: [makeBooking({ id: 'up_1', professional: null })],
        })}
      />,
    )

    expect(
      screen.queryByRole('link', { name: /professionals/ }),
    ).not.toBeInTheDocument()
    expect(
      screen.getAllByRole('link').every((link) => {
        const href = link.getAttribute('href') ?? ''
        return !href.startsWith('/professionals/')
      }),
    ).toBe(true)
  })

  it('renders an empty state when there are no bookings', () => {
    render(<AppointmentsList buckets={makeBuckets()} />)

    expect(screen.getByText('No bookings yet')).toBeInTheDocument()
    // /discover has never existed as a route — this assertion pinned a 404.
    // Discovery lives at /search (see CLIENT_TABS in app/config/clientNav.ts).
    expect(screen.getByRole('link', { name: /Find a pro/ })).toHaveAttribute(
      'href',
      '/search',
    )
  })

  // The aftercare inbox page has no nav entry of its own, so this strip is how a
  // client finds their summaries at all. Each row deep-links to that visit's
  // aftercare step rather than to the booking overview.
  it('renders aftercare rows linking to the visit’s aftercare step', () => {
    render(
      <AppointmentsList
        buckets={makeBuckets({ past: [makeBooking({ id: 'past_1' })] })}
        aftercare={[makeAftercare()]}
      />,
    )

    expect(
      screen.getByRole('heading', { level: 2, name: 'Aftercare' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('link', {
        name: 'Aftercare for Balayage with Glow Studio',
      }),
    ).toHaveAttribute('href', '/client/bookings/past_1?step=aftercare')
  })

  // This link is the ONLY entry point to /client/aftercare, so it must not depend
  // on how much aftercare the client happens to have. It used to render only when
  // there were MORE than AFTERCARE_STRIP_SIZE summaries, which locked the inbox
  // away from the common case — one or two visits. Same rule as the /client/bookings
  // tab in app/config/clientNav.ts.
  it('offers the full inbox from a single aftercare summary', () => {
    render(
      <AppointmentsList
        buckets={makeBuckets()}
        aftercare={[makeAftercare()]}
      />,
    )

    expect(screen.getByRole('link', { name: /All aftercare/ })).toHaveAttribute(
      'href',
      '/client/aftercare',
    )
  })

  // A summary whose notification lost its booking link must not build
  // /client/bookings/null — it falls back to the inbox.
  it('falls back to the inbox for an aftercare row with no booking', () => {
    render(
      <AppointmentsList
        buckets={makeBuckets()}
        aftercare={[makeAftercare({ bookingId: null })]}
      />,
    )

    expect(
      screen.getByRole('link', {
        name: 'Aftercare for Balayage with Glow Studio',
      }),
    ).toHaveAttribute('href', '/client/aftercare')
  })

  // Aftercare outliving its booking row would otherwise sit behind the
  // "No appointments yet" card, which renders instead of the sections.
  it('does not show the empty state when only aftercare remains', () => {
    render(
      <AppointmentsList buckets={makeBuckets()} aftercare={[makeAftercare()]} />,
    )

    expect(screen.queryByText('No appointments yet')).not.toBeInTheDocument()
    expect(
      screen.getByRole('heading', { level: 2, name: 'Aftercare' }),
    ).toBeInTheDocument()
  })
})
