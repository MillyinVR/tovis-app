import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  BookingCheckoutStatus,
  BookingServiceItemType,
  BookingStatus,
  Prisma,
  SessionStep,
} from '@prisma/client'

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  redirect: vi.fn(),

  bookingFindMany: vi.fn(),
  professionalLocationFindMany: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  redirect: mocks.redirect,
}))

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    className,
  }: {
    href: string
    children: React.ReactNode
    className?: string
  }) => React.createElement('a', { href, className }, children),
}))

vi.mock('@/lib/currentUser', () => ({
  getCurrentUser: mocks.getCurrentUser,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    booking: {
      findMany: mocks.bookingFindMany,
    },
    professionalLocation: {
      findMany: mocks.professionalLocationFindMany,
    },
  },
}))

vi.mock('./BookingActions', () => ({
  default: ({
    bookingId,
    status,
    sessionStep,
  }: {
    bookingId: string
    status: BookingStatus
    sessionStep: SessionStep | null
  }) =>
    React.createElement(
      'div',
      {
        'data-testid': 'booking-actions',
        'data-booking-id': bookingId,
        'data-status': status,
        'data-session-step': sessionStep ?? SessionStep.NONE,
      },
      `BookingActions:${status}:${sessionStep ?? SessionStep.NONE}`,
    ),
}))

vi.mock('@/app/_components/ClientNameLink', () => ({
  default: ({
    children,
    clientId,
    canLink,
  }: {
    children: React.ReactNode
    clientId: string
    canLink: boolean
  }) =>
    React.createElement(
      canLink ? 'a' : 'span',
      canLink ? { href: `/pro/clients/${clientId}` } : {},
      children,
    ),
}))

import ProBookingsPage from './page'

type PageNode = React.ReactNode

function makeRedirectError(href: string) {
  return Object.assign(new Error(`redirect:${href}`), {
    href,
    digest: 'NEXT_REDIRECT',
  })
}

function makeCurrentUser() {
  return {
    id: 'user_1',
    role: 'PRO',
    professionalProfile: {
      id: 'pro_1',
      timeZone: 'America/Los_Angeles',
    },
  }
}

function makeBooking(overrides?: {
  id?: string
  status?: BookingStatus
  sessionStep?: SessionStep | null
  scheduledFor?: Date
  startedAt?: Date | null
  finishedAt?: Date | null
  clientId?: string
  firstName?: string
  lastName?: string
  checkoutStatus?: BookingCheckoutStatus
  paymentCollectedAt?: Date | null
  aftercareSentAt?: Date | null
}) {
  return {
    id: overrides?.id ?? 'booking_1',
    status: overrides?.status ?? BookingStatus.ACCEPTED,
    sessionStep: overrides?.sessionStep ?? SessionStep.NONE,
    scheduledFor:
      overrides?.scheduledFor ?? new Date('2026-04-12T18:00:00.000Z'),
    startedAt:
      overrides && 'startedAt' in overrides
        ? overrides.startedAt
        : null,
    finishedAt:
      overrides && 'finishedAt' in overrides
        ? overrides.finishedAt
        : null,
    locationTimeZone: 'America/Los_Angeles',

    checkoutStatus: overrides?.checkoutStatus ?? BookingCheckoutStatus.NOT_READY,
    paymentCollectedAt:
      overrides && 'paymentCollectedAt' in overrides
        ? overrides.paymentCollectedAt
        : null,
    aftercareSummary:
      overrides && 'aftercareSentAt' in overrides
        ? { sentToClientAt: overrides.aftercareSentAt ?? null }
        : null,

    totalDurationMinutes: 75,
    subtotalSnapshot: new Prisma.Decimal(100),
    totalAmount: new Prisma.Decimal(125),
    discountAmount: null,
    taxAmount: null,
    tipAmount: null,

    service: {
      name: 'Haircut',
    },

    serviceItems: [
      {
        id: 'booking_item_1',
        itemType: BookingServiceItemType.BASE,
        sortOrder: 0,
        service: {
          name: 'Haircut',
        },
        priceSnapshot: new Prisma.Decimal(100),
        durationMinutesSnapshot: 75,
        parentItemId: null,
      },
    ],

    client: {
      id: overrides?.clientId ?? 'client_1',
      firstName: overrides?.firstName ?? 'Tori',
      lastName: overrides?.lastName ?? 'Morales',
      phone: '555-123-4567',
      user: {
        email: 'tori@example.com',
      },
    },
  }
}

async function renderPage(args?: {
  status?: string
  visibleClientRows?: Array<{ clientId: string }>
  todayBookings?: ReturnType<typeof makeBooking>[]
  upcomingBookings?: ReturnType<typeof makeBooking>[]
  pastBookings?: ReturnType<typeof makeBooking>[]
  cancelledBookings?: ReturnType<typeof makeBooking>[]
}) {
  mocks.professionalLocationFindMany.mockResolvedValueOnce([
    {
      timeZone: 'America/Los_Angeles',
    },
  ])

  mocks.bookingFindMany
    .mockResolvedValueOnce(args?.visibleClientRows ?? [{ clientId: 'client_1' }])
    .mockResolvedValueOnce(args?.todayBookings ?? [])
    .mockResolvedValueOnce(args?.upcomingBookings ?? [])
    .mockResolvedValueOnce(args?.pastBookings ?? [])

  const normalizedStatus =
    args?.status &&
    ['PENDING', 'ACCEPTED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'].includes(
        args.status.toUpperCase(),
    )
        ? args.status.toUpperCase()
        : 'ALL'

    if (normalizedStatus === 'ALL' || normalizedStatus === 'CANCELLED') {
    mocks.bookingFindMany.mockResolvedValueOnce(args?.cancelledBookings ?? [])
    }

  return ProBookingsPage({
    searchParams: Promise.resolve(
      args?.status ? { status: args.status } : {},
    ),
  })
}

function isFunctionComponent(
  type: React.JSXElementConstructor<unknown>,
): type is (props: unknown) => React.ReactNode {
  return !(
    'prototype' in type &&
    type.prototype &&
    'isReactComponent' in type.prototype
  )
}

function extractText(node: PageNode): string {
  if (node == null || typeof node === 'boolean') return ''

  if (typeof node === 'string' || typeof node === 'number') {
    return String(node)
  }

  if (Array.isArray(node)) {
    return node.map(extractText).join(' ')
  }

  if (React.isValidElement<{ children?: React.ReactNode }>(node)) {
    const element = node

    if (typeof element.type === 'function' && isFunctionComponent(element.type)) {
      const rendered = element.type(element.props)
      return extractText(rendered)
    }

    return extractText(element.props.children)
  }

  return ''
}

function hasText(node: PageNode, text: string): boolean {
  return extractText(node).includes(text)
}

type AnchorProps = {
  href?: string
  children?: React.ReactNode
}

function findAnchors(node: PageNode): Array<React.ReactElement<AnchorProps>> {
  if (node == null || typeof node === 'boolean') return []

  if (typeof node === 'string' || typeof node === 'number') return []

  if (Array.isArray(node)) {
    return node.flatMap(findAnchors)
  }

  if (React.isValidElement<AnchorProps>(node)) {
    const element = node

    if (typeof element.type === 'function' && isFunctionComponent(element.type)) {
      const rendered = element.type(element.props)
      return findAnchors(rendered)
    }

    const matches = element.type === 'a' ? [element] : []

    return [
      ...matches,
      ...findAnchors(element.props.children),
    ]
  }

  return []
}

describe('app/pro/bookings/page.tsx', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mocks.redirect.mockImplementation((href: string) => {
      throw makeRedirectError(href)
    })

    mocks.getCurrentUser.mockResolvedValue(makeCurrentUser())
  })

  it('redirects to login when the current user is not a pro', async () => {
    mocks.getCurrentUser.mockResolvedValueOnce(null)

    await expect(
      ProBookingsPage({
        searchParams: Promise.resolve({}),
      }),
    ).rejects.toMatchObject({
      href: '/login?from=/pro/bookings',
    })

    expect(mocks.bookingFindMany).not.toHaveBeenCalled()
  })

  it('renders the Active filter pill for IN_PROGRESS bookings', async () => {
    const page = await renderPage()

    expect(hasText(page, 'Filter')).toBe(true)
    expect(hasText(page, 'All')).toBe(true)
    expect(hasText(page, 'Pending')).toBe(true)
    expect(hasText(page, 'Accepted')).toBe(true)
    expect(hasText(page, 'Active')).toBe(true)
    expect(hasText(page, 'Completed')).toBe(true)
    expect(hasText(page, 'Cancelled')).toBe(true)

    const anchors = findAnchors(page)
    expect(
      anchors.some((anchor) => anchor.props.href === '/pro/bookings?status=IN_PROGRESS'),
    ).toBe(true)
  })

  it('accepts status=IN_PROGRESS and queries active bookings', async () => {
    const activeBooking = makeBooking({
      id: 'booking_active_1',
      status: BookingStatus.IN_PROGRESS,
      sessionStep: SessionStep.AFTER_PHOTOS,
      startedAt: new Date('2026-04-12T18:00:00.000Z'),
      finishedAt: null,
    })

    const page = await renderPage({
      status: 'IN_PROGRESS',
      todayBookings: [activeBooking],
    })

    expect(hasText(page, 'Active')).toBe(true)
    expect(hasText(page, 'In progress')).toBe(true)
    expect(hasText(page, 'Resume session')).toBe(true)
    expect(hasText(page, 'AFTER PHOTOS')).toBe(true)

    expect(mocks.bookingFindMany).toHaveBeenCalledTimes(4)

    const visibleClientQuery = mocks.bookingFindMany.mock.calls[0]?.[0]
    expect(visibleClientQuery.where.OR).toContainEqual({
      status: BookingStatus.IN_PROGRESS,
    })

    const todayQuery = mocks.bookingFindMany.mock.calls[1]?.[0]
    expect(todayQuery.where.status).toBe(BookingStatus.IN_PROGRESS)
  })

  it('renders a Resume session link for IN_PROGRESS rows', async () => {
    const activeBooking = makeBooking({
      id: 'booking_active_1',
      status: BookingStatus.IN_PROGRESS,
      sessionStep: SessionStep.SERVICE_IN_PROGRESS,
      startedAt: new Date('2026-04-12T18:00:00.000Z'),
      finishedAt: null,
    })

    const page = await renderPage({
      status: 'IN_PROGRESS',
      todayBookings: [activeBooking],
    })

    const anchors = findAnchors(page)

    expect(
      anchors.some(
        (anchor) =>
          anchor.props.href === '/pro/bookings/booking_active_1/session',
      ),
    ).toBe(true)

    expect(hasText(page, 'Resume session')).toBe(true)
    expect(hasText(page, 'SERVICE IN PROGRESS')).toBe(true)
  })

  it('renders a Payment due badge linking to the session for aftercare-sent-but-unpaid bookings', async () => {
    const needsCloseoutBooking = makeBooking({
      id: 'booking_closeout_1',
      status: BookingStatus.IN_PROGRESS,
      startedAt: new Date('2026-04-12T18:00:00.000Z'),
      finishedAt: null,
      aftercareSentAt: new Date('2026-04-12T19:00:00.000Z'),
      checkoutStatus: BookingCheckoutStatus.NOT_READY,
      paymentCollectedAt: null,
    })

    const page = await renderPage({
      status: 'IN_PROGRESS',
      todayBookings: [needsCloseoutBooking],
    })

    expect(hasText(page, 'Payment due')).toBe(true)

    const anchors = findAnchors(page)
    expect(
      anchors.some(
        (anchor) =>
          anchor.props.href === '/pro/bookings/booking_closeout_1/session',
      ),
    ).toBe(true)
  })

  it('does not render the Payment due badge once payment + checkout closeout is complete', async () => {
    const closedOutBooking = makeBooking({
      id: 'booking_closeout_done_1',
      status: BookingStatus.IN_PROGRESS,
      startedAt: new Date('2026-04-12T18:00:00.000Z'),
      finishedAt: null,
      aftercareSentAt: new Date('2026-04-12T19:00:00.000Z'),
      checkoutStatus: BookingCheckoutStatus.PAID,
      paymentCollectedAt: new Date('2026-04-12T19:05:00.000Z'),
    })

    const page = await renderPage({
      status: 'IN_PROGRESS',
      todayBookings: [closedOutBooking],
    })

    expect(hasText(page, 'Payment due')).toBe(false)
  })

  it('does not render the Payment due badge before aftercare is sent', async () => {
    const activeBooking = makeBooking({
      id: 'booking_active_no_aftercare',
      status: BookingStatus.IN_PROGRESS,
      startedAt: new Date('2026-04-12T18:00:00.000Z'),
      finishedAt: null,
    })

    const page = await renderPage({
      status: 'IN_PROGRESS',
      todayBookings: [activeBooking],
    })

    expect(hasText(page, 'Payment due')).toBe(false)
  })

  it('falls back to All when an unknown status filter is provided', async () => {
    const page = await renderPage({
      status: 'nonsense',
      todayBookings: [
        makeBooking({
          id: 'booking_accepted_1',
          status: BookingStatus.ACCEPTED,
        }),
      ],
    })

    expect(hasText(page, 'Bookings')).toBe(true)
    expect(hasText(page, 'Accepted')).toBe(true)

    const todayQuery = mocks.bookingFindMany.mock.calls[1]?.[0]
    expect(todayQuery.where.status).toEqual({
      not: BookingStatus.CANCELLED,
    })
  })
})