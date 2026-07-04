import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  BookingStatus,
  PaymentMethod,
  PaymentProvider,
  Prisma,
  ServiceLocationType,
  SessionStep,
  StripePaymentStatus,
} from '@prisma/client'
import { paymentMethodLabel } from '@/lib/payments/acceptedMethods'

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  redirect: vi.fn(),
  bookingFindFirst: vi.fn(),
  professionalLocationFindMany: vi.fn(),
  getProClientVisibility: vi.fn(),
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
      findFirst: mocks.bookingFindFirst,
    },
    professionalLocation: {
      findMany: mocks.professionalLocationFindMany,
    },
  },
}))

vi.mock('@/lib/clientVisibility', () => ({
  getProClientVisibility: mocks.getProClientVisibility,
}))

vi.mock('../BookingActions', () => ({
  default: ({ status }: { status: BookingStatus }) =>
    React.createElement('div', { 'data-testid': 'booking-actions' }, status),
}))

vi.mock('@/app/_components/booking/MoneyTrailInspector', () => ({
  default: ({ bookingId }: { bookingId: string }) =>
    React.createElement(
      'div',
      { 'data-testid': 'money-trail-inspector', 'data-booking-id': bookingId },
      'Money trail',
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

vi.mock('@/app/_components/ui', () => ({
  Avatar: () => null,
}))

import ProBookingDetailPage from './page'

type PageNode = React.ReactNode

function makeCurrentUser() {
  return {
    id: 'user_1',
    role: 'PRO',
    professionalProfile: {
      id: 'pro_1',
      timeZone: 'America/Chicago',
    },
  }
}

function makeBooking(overrides?: Record<string, unknown>) {
  return {
    id: 'booking_detail_1',
    professionalId: 'pro_1',
    clientId: 'client_1',
    status: BookingStatus.COMPLETED,
    sessionStep: SessionStep.DONE,
    scheduledFor: new Date('2026-04-12T18:00:00.000Z'),
    startedAt: new Date('2026-04-12T18:02:00.000Z'),
    finishedAt: new Date('2026-04-12T19:35:00.000Z'),
    locationTimeZone: 'America/Chicago',

    totalDurationMinutes: 95,
    subtotalSnapshot: new Prisma.Decimal(165),
    serviceSubtotalSnapshot: new Prisma.Decimal(165),
    totalAmount: new Prisma.Decimal(185),
    discountAmount: null,
    taxAmount: null,
    tipAmount: new Prisma.Decimal(20),

    paymentProvider: PaymentProvider.STRIPE,
    stripePaymentStatus: StripePaymentStatus.SUCCEEDED,
    stripePaidAt: new Date('2026-04-12T19:36:00.000Z'),
    stripeAmountTotal: 18500,
    stripeCurrency: 'usd',
    paymentCollectedAt: new Date('2026-04-12T19:36:00.000Z'),
    selectedPaymentMethod: PaymentMethod.STRIPE_CARD,

    locationType: ServiceLocationType.SALON,
    locationAddressSnapshot: {
      formattedAddress: 'Studio 9 — 1423 W Lake St, Chicago IL',
    },
    locationLatSnapshot: null,
    locationLngSnapshot: null,
    clientAddressSnapshot: null,
    clientAddressLatSnapshot: null,
    clientAddressLngSnapshot: null,

    service: { name: 'Cut & Tonal Gloss', category: null },
    client: {
      firstName: 'Priya',
      lastName: 'Anand',
      phone: '(312) 555-0142',
      user: { email: 'priya@email.com' },
    },
    aftercareSummary: {
      notes: 'Wash after 48 hours with sulfate-free shampoo.',
      sentToClientAt: new Date('2026-04-12T19:40:00.000Z'),
      draftSavedAt: new Date('2026-04-12T19:38:00.000Z'),
      version: 3,
    },

    ...overrides,
  }
}

async function renderPage(booking?: Record<string, unknown>) {
  mocks.professionalLocationFindMany.mockResolvedValue([
    { timeZone: 'America/Chicago' },
  ])
  mocks.bookingFindFirst.mockResolvedValueOnce(booking ?? makeBooking())
  mocks.getProClientVisibility.mockResolvedValue({ canViewClient: true })

  return ProBookingDetailPage({
    params: Promise.resolve({ id: 'booking_detail_1' }),
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
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(extractText).join(' ')

  if (React.isValidElement<{ children?: React.ReactNode }>(node)) {
    const element = node
    if (typeof element.type === 'function' && isFunctionComponent(element.type)) {
      return extractText(element.type(element.props))
    }
    return extractText(element.props.children)
  }
  return ''
}

function hasText(node: PageNode, text: string): boolean {
  return extractText(node).includes(text)
}

type AnchorProps = { href?: string; children?: React.ReactNode }

function findAnchors(node: PageNode): Array<React.ReactElement<AnchorProps>> {
  if (node == null || typeof node === 'boolean') return []
  if (typeof node === 'string' || typeof node === 'number') return []
  if (Array.isArray(node)) return node.flatMap(findAnchors)

  if (React.isValidElement<AnchorProps>(node)) {
    const element = node
    if (typeof element.type === 'function' && isFunctionComponent(element.type)) {
      return findAnchors(element.type(element.props))
    }
    const matches = element.type === 'a' ? [element] : []
    return [...matches, ...findAnchors(element.props.children)]
  }
  return []
}

describe('app/pro/bookings/[id]/page.tsx', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.redirect.mockImplementation((href: string) => {
      throw Object.assign(new Error(`redirect:${href}`), {
        href,
        digest: 'NEXT_REDIRECT',
      })
    })
    mocks.getCurrentUser.mockResolvedValue(makeCurrentUser())
  })

  it('redirects to login when the current user is not a pro', async () => {
    mocks.getCurrentUser.mockResolvedValueOnce(null)
    await expect(
      ProBookingDetailPage({ params: Promise.resolve({ id: 'booking_detail_1' }) }),
    ).rejects.toMatchObject({ href: '/login?from=/pro/bookings' })
  })

  it('renders service, client, total and a tap-for-directions maps link for a SALON booking', async () => {
    const page = await renderPage()

    expect(hasText(page, 'Cut & Tonal Gloss')).toBe(true)
    expect(hasText(page, 'Priya Anand')).toBe(true)
    expect(hasText(page, '$185')).toBe(true)
    expect(hasText(page, 'tap for directions')).toBe(true)
    expect(hasText(page, 'Studio 9 — 1423 W Lake St, Chicago IL')).toBe(true)

    const anchors = findAnchors(page)
    expect(
      anchors.some((a) => (a.props.href ?? '').includes('google.com/maps')),
    ).toBe(true)
    // Open session + View full aftercare links survive the rewire.
    expect(
      anchors.some(
        (a) => a.props.href === '/pro/bookings/booking_detail_1/session',
      ),
    ).toBe(true)
    expect(
      anchors.some(
        (a) => a.props.href === '/pro/bookings/booking_detail_1/aftercare',
      ),
    ).toBe(true)
  })

  it('marks a MOBILE booking with the Mobile tag', async () => {
    const page = await renderPage(
      makeBooking({
        locationType: ServiceLocationType.MOBILE,
        locationAddressSnapshot: null,
        clientAddressSnapshot: {
          formattedAddress: '2120 N Hoyne Ave, Chicago IL',
        },
      }),
    )

    expect(hasText(page, '2120 N Hoyne Ave, Chicago IL')).toBe(true)
    expect(hasText(page, 'Mobile')).toBe(true)
  })

  it('renders the paid payment block with method and tip breakdown', async () => {
    const page = await renderPage()

    expect(hasText(page, 'Paid')).toBe(true)
    expect(hasText(page, paymentMethodLabel(PaymentMethod.STRIPE_CARD))).toBe(true)
    // Breakdown rows render (Services subtotal + Tip + Total). Amounts are
    // formatted by moneyToString, which is covered by its own suite.
    expect(hasText(page, 'Services')).toBe(true)
    expect(hasText(page, 'Tip')).toBe(true)
    expect(hasText(page, 'Total')).toBe(true)
  })

  it('shows Awaiting payment when nothing has been collected', async () => {
    const page = await renderPage(
      makeBooking({
        paymentProvider: PaymentProvider.MANUAL,
        stripePaymentStatus: null,
        stripePaidAt: null,
        paymentCollectedAt: null,
        selectedPaymentMethod: null,
      }),
    )

    expect(hasText(page, 'Awaiting payment')).toBe(true)
    expect(hasText(page, 'Paid · ')).toBe(false)
  })

  it('shows the Sent aftercare badge with version', async () => {
    const page = await renderPage()
    expect(hasText(page, 'Sent')).toBe(true)
    expect(hasText(page, 'v3')).toBe(true)
  })

  it('always mounts the money-trail inspector (refund/waive actions gate server-side)', async () => {
    // The inspector renders for every booking and resolves capabilities from its
    // own /money-trail fetch, so the page no longer computes refundability. It
    // mounts even for a MANUAL booking with no captured Stripe payment.
    const page = await renderPage(
      makeBooking({
        paymentProvider: PaymentProvider.MANUAL,
        stripePaymentStatus: null,
      }),
    )
    expect(hasText(page, 'Money trail')).toBe(true)
  })
})
