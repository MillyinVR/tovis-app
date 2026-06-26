import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AftercareRebookMode, BookingStatus } from '@prisma/client'

const TOKEN = 'token_1'

const mocks = vi.hoisted(() => ({
  bookingFindFirst: vi.fn(),
  bookingFindUnique: vi.fn(),
  professionalServiceOfferingFindFirst: vi.fn(),
  professionalServiceOfferingFindUnique: vi.fn(),
  mediaAssetFindMany: vi.fn(),
  clientProfileFindUnique: vi.fn(),
  getPublicCheckoutAvailability: vi.fn(),

  sanitizeTimeZone: vi.fn(),
  formatAppointmentWhen: vi.fn(),
  formatRangeInTimeZone: vi.fn(),

  pickString: vi.fn(),
  cn: vi.fn(),

  resolveAftercareAccessByToken: vi.fn(),

  isBookingError: vi.fn(),

  notFound: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  notFound: mocks.notFound,
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

vi.mock('@/lib/prisma', () => ({
  prisma: {
    booking: {
      findFirst: mocks.bookingFindFirst,
      findUnique: mocks.bookingFindUnique,
    },
    professionalServiceOffering: {
      findFirst: mocks.professionalServiceOfferingFindFirst,
      findUnique: mocks.professionalServiceOfferingFindUnique,
    },
    mediaAsset: {
      findMany: mocks.mediaAssetFindMany,
    },
    clientProfile: {
      findUnique: mocks.clientProfileFindUnique,
    },
  },
}))

vi.mock('@/lib/booking/publicCheckoutAvailability', () => ({
  getPublicCheckoutAvailability: mocks.getPublicCheckoutAvailability,
}))

vi.mock('@/lib/timeZone', () => ({
  sanitizeTimeZone: mocks.sanitizeTimeZone,
  friendlyTimeZoneLabel: (tz: string | null | undefined) => tz ?? null,
}))

vi.mock('@/lib/formatInTimeZone', () => ({
  formatAppointmentWhen: mocks.formatAppointmentWhen,
  formatRangeInTimeZone: mocks.formatRangeInTimeZone,
  // RebookCard formats slot labels via formatInTimeZone (through the @/lib/time
  // barrel, which re-exports this module). Provide a faithful, self-contained
  // impl so the rendered slot times/ymd are real without pulling in the mocked
  // @/lib/timeZone internals.
  formatInTimeZone: (
    date: Date | string | number,
    timeZone: string,
    options: Intl.DateTimeFormatOptions,
    locale?: string,
  ) =>
    new Intl.DateTimeFormat(locale, { ...options, timeZone }).format(
      date instanceof Date ? date : new Date(date),
    ),
}))

vi.mock('@/lib/pick', () => ({
  pickString: mocks.pickString,
}))

vi.mock('@/lib/utils', () => ({
  cn: mocks.cn,
}))

vi.mock('@/lib/aftercare/unclaimedAftercareAccess', () => ({
  resolveAftercareAccessByToken: mocks.resolveAftercareAccessByToken,
}))

vi.mock('@/lib/booking/errors', () => ({
  isBookingError: mocks.isBookingError,
}))

import ClientRebookFromAftercarePage from './page'

function makeNotFoundError() {
  return Object.assign(new Error('notFound'), {
    digest: 'NEXT_NOT_FOUND',
  })
}

function renderMarkup(node: React.ReactNode): string {
  return renderToStaticMarkup(<>{node}</>)
}

function makeResolvedAftercareAccess(overrides?: {
  offeringId?: string | null
  rebookMode?: AftercareRebookMode
  rebookedFor?: Date | null
  rebookWindowStart?: Date | null
  rebookWindowEnd?: Date | null
  notes?: string | null
  locationType?: 'SALON' | 'MOBILE'
  token?: Partial<{
    id: string
    expiresAt: Date
    firstUsedAt: Date | null
    lastUsedAt: Date | null
    useCount: number
    singleUse: boolean
  }>
}) {
  return {
    accessSource: 'clientActionToken' as const,
    token: {
      id: overrides?.token?.id ?? 'token_row_1',
      expiresAt:
        overrides?.token?.expiresAt ??
        new Date('2026-04-20T18:00:00.000Z'),
      firstUsedAt:
        overrides?.token?.firstUsedAt === undefined
          ? null
          : overrides.token.firstUsedAt,
      lastUsedAt:
        overrides?.token?.lastUsedAt === undefined
          ? null
          : overrides.token.lastUsedAt,
      useCount: overrides?.token?.useCount ?? 0,
      singleUse: overrides?.token?.singleUse ?? false,
    },
    aftercare: {
      id: 'aftercare_1',
      bookingId: 'booking_1',
      notes: overrides?.notes ?? 'Use a sulfate-free shampoo.',
      rebookMode:
        overrides?.rebookMode ?? AftercareRebookMode.BOOKED_NEXT_APPOINTMENT,
      rebookedFor:
        overrides?.rebookedFor ?? new Date('2026-05-01T18:00:00.000Z'),
      rebookWindowStart:
        overrides?.rebookWindowStart ??
        new Date('2026-04-20T18:00:00.000Z'),
      rebookWindowEnd:
        overrides?.rebookWindowEnd ??
        new Date('2026-04-30T18:00:00.000Z'),
      publicToken: 'legacy_public_token_should_not_drive_ui',
      draftSavedAt: new Date('2026-04-12T17:00:00.000Z'),
      sentToClientAt: new Date('2026-04-12T17:30:00.000Z'),
      lastEditedAt: new Date('2026-04-12T17:15:00.000Z'),
      version: 2,
    },
    booking: {
      id: 'booking_1',
      clientId: 'client_1',
      professionalId: 'pro_1',
      serviceId: 'service_1',
      offeringId:
        overrides && 'offeringId' in overrides
          ? (overrides.offeringId ?? null)
          : 'offering_1',
      status: BookingStatus.COMPLETED,
      scheduledFor: new Date('2026-04-10T18:00:00.000Z'),
      locationType: overrides?.locationType ?? 'SALON',
      locationId: 'location_1',
      totalDurationMinutes: 75,
      subtotalSnapshot: '125.00',
      service: {
        id: 'service_1',
        name: 'Haircut',
      },
      professional: {
        id: 'pro_1',
        businessName: 'TOVIS Studio',
        timeZone: 'America/Los_Angeles',
        location: '123 Main St, Los Angeles, CA',
      },
    },
  }
}

async function renderPage(args?: {
  resolved?: ReturnType<typeof makeResolvedAftercareAccess>
  nextBooking?: {
    id: string
    scheduledFor: Date
    status: BookingStatus
  } | null
  fallbackOffering?: { id: string } | null
  offeringCaps?: { offersInSalon: boolean; offersMobile: boolean } | null
  searchParams?: Record<string, string | string[] | undefined>
}) {
  mocks.resolveAftercareAccessByToken.mockResolvedValueOnce(
    args?.resolved ?? makeResolvedAftercareAccess(),
  )
  mocks.bookingFindFirst.mockResolvedValueOnce(args?.nextBooking ?? null)
  mocks.professionalServiceOfferingFindFirst.mockResolvedValueOnce(
    args?.fallbackOffering ?? null,
  )
  mocks.professionalServiceOfferingFindUnique.mockResolvedValueOnce(
    args?.offeringCaps ?? { offersInSalon: true, offersMobile: false },
  )

  return ClientRebookFromAftercarePage({
    params: Promise.resolve({ token: TOKEN }),
    searchParams: Promise.resolve(args?.searchParams),
  })
}

describe('app/client/rebook/[token]/page.tsx', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mocks.notFound.mockImplementation(() => {
      throw makeNotFoundError()
    })

    mocks.pickString.mockImplementation((value: unknown) => {
      if (typeof value !== 'string') return null
      const trimmed = value.trim()
      return trimmed.length > 0 ? trimmed : null
    })

    mocks.sanitizeTimeZone.mockImplementation(
      (value: string | null | undefined, fallback: string) =>
        typeof value === 'string' && value.trim() ? value.trim() : fallback,
    )

    mocks.formatAppointmentWhen.mockImplementation(
      (date: Date, timeZone: string) =>
        `appt:${date.toISOString()}:${timeZone}`,
    )

    mocks.formatRangeInTimeZone.mockImplementation(
      (start: Date, end: Date, timeZone: string) =>
        `range:${start.toISOString()}..${end.toISOString()}:${timeZone}`,
    )

    mocks.cn.mockImplementation(
      (...parts: Array<string | false | null | undefined>) =>
        parts.filter(Boolean).join(' '),
    )

    mocks.isBookingError.mockReturnValue(false)
    mocks.mediaAssetFindMany.mockResolvedValue([])
    mocks.bookingFindUnique.mockResolvedValue({ clientAddressId: null })
    mocks.clientProfileFindUnique.mockResolvedValue({
      claimStatus: 'CLAIMED',
      userId: 'user_1',
    })
    mocks.getPublicCheckoutAvailability.mockResolvedValue({
      status: 'NOT_AVAILABLE',
    })
  })

  it('calls notFound when token is missing', async () => {
    await expect(
      ClientRebookFromAftercarePage({
        params: Promise.resolve({ token: '   ' }),
      }),
    ).rejects.toMatchObject({
      digest: 'NEXT_NOT_FOUND',
    })

    expect(mocks.resolveAftercareAccessByToken).not.toHaveBeenCalled()
  })

  it('calls notFound when token resolution fails with a BookingError', async () => {
    mocks.resolveAftercareAccessByToken.mockRejectedValueOnce({
      code: 'AFTERCARE_TOKEN_INVALID',
      message: 'Aftercare access token was not found.',
      userMessage: 'That aftercare link is invalid or expired.',
    })
    mocks.isBookingError.mockReturnValueOnce(true)

    await expect(
      ClientRebookFromAftercarePage({
        params: Promise.resolve({ token: TOKEN }),
      }),
    ).rejects.toMatchObject({
      digest: 'NEXT_NOT_FOUND',
    })

    expect(mocks.resolveAftercareAccessByToken).toHaveBeenCalledWith({
      rawToken: TOKEN,
    })
  })

  it('renders the token-based aftercare page without legacy access-source UI', async () => {
    const page = await renderPage({
      resolved: makeResolvedAftercareAccess({
        offeringId: 'offering_1',
        token: {
          useCount: 2,
          singleUse: true,
        },
      }),
      nextBooking: {
        id: 'booking_2',
        scheduledFor: new Date('2026-04-25T18:00:00.000Z'),
        status: BookingStatus.PENDING,
      },
    })

    const markup = renderMarkup(page)

    expect(markup).toContain('Secure aftercare link')
    expect(markup).toContain('Aftercare for Haircut')
    expect(markup).toContain(
      'No account required to view aftercare and rebook from this secure link.',
    )
    expect(markup).toContain('Your next booking is already confirmed')
    expect(markup).toContain('Access type:')
    expect(markup).toContain('Client action token')
    expect(markup).toContain('Single use:')
    expect(markup).toContain('Yes')
    expect(markup).toContain('Access count:')
    expect(markup).toContain('2')
    expect(markup).toContain(`href="/professionals/pro_1"`)
    expect(markup).toContain(`/client/rebook/${TOKEN}`)
    expect(markup).not.toContain('Legacy public token')
    expect(markup).not.toContain('/client/bookings/')
  })

  it('renders the create-account invite for an UNCLAIMED client', async () => {
    mocks.clientProfileFindUnique.mockResolvedValueOnce({
      claimStatus: 'UNCLAIMED',
      userId: null,
    })

    const page = await renderPage({
      resolved: makeResolvedAftercareAccess({ offeringId: 'offering_1' }),
    })

    const markup = renderMarkup(page)

    expect(markup).toContain('Want to keep your summaries?')
    expect(markup).toContain('Create your account')
  })

  it('hides the create-account invite for a CLAIMED client', async () => {
    mocks.clientProfileFindUnique.mockResolvedValueOnce({
      claimStatus: 'CLAIMED',
      userId: 'user_1',
    })

    const page = await renderPage({
      resolved: makeResolvedAftercareAccess({ offeringId: 'offering_1' }),
    })

    const markup = renderMarkup(page)

    expect(markup).not.toContain('Create your account')
  })

  it('renders the complete-payment card when checkout is PAYABLE', async () => {
    mocks.getPublicCheckoutAvailability.mockResolvedValueOnce({
      status: 'PAYABLE',
      amountCents: 4500,
      currency: 'usd',
    })

    const page = await renderPage({
      resolved: makeResolvedAftercareAccess({ offeringId: 'offering_1' }),
    })

    const markup = renderMarkup(page)

    expect(markup).toContain('Complete your payment')
    expect(markup).toContain('$45.00')
  })

  it('shows a payment-received notice when returning with checkout=success', async () => {
    mocks.getPublicCheckoutAvailability.mockResolvedValueOnce({
      status: 'PAYABLE',
      amountCents: 4500,
      currency: 'usd',
    })

    const page = await renderPage({
      resolved: makeResolvedAftercareAccess({ offeringId: 'offering_1' }),
      searchParams: { checkout: 'success' },
    })

    const markup = renderMarkup(page)

    expect(markup).toContain('Payment received')
    expect(markup).not.toContain('Complete your payment')
  })

  it('hides the complete-payment card when checkout is NOT_AVAILABLE', async () => {
    mocks.getPublicCheckoutAvailability.mockResolvedValueOnce({
      status: 'NOT_AVAILABLE',
    })

    const page = await renderPage({
      resolved: makeResolvedAftercareAccess({ offeringId: 'offering_1' }),
    })

    const markup = renderMarkup(page)

    expect(markup).not.toContain('Complete your payment')
  })

  it('renders the in-page rebook picker for a fallback offering within the recommended window', async () => {
    const page = await renderPage({
      resolved: makeResolvedAftercareAccess({
        offeringId: null,
        rebookMode: AftercareRebookMode.RECOMMENDED_WINDOW,
        rebookWindowStart: new Date('2026-04-20T18:00:00.000Z'),
        rebookWindowEnd: new Date('2026-04-30T18:00:00.000Z'),
      }),
      nextBooking: null,
      fallbackOffering: { id: 'offering_fallback_1' },
    })

    const markup = renderMarkup(page)

    expect(mocks.professionalServiceOfferingFindFirst).toHaveBeenCalledWith({
      where: {
        professionalId: 'pro_1',
        serviceId: 'service_1',
        isActive: true,
      },
      select: { id: true },
    })

    expect(markup).toContain(
      'Recommended rebook window: range:2026-04-20T18:00:00.000Z..2026-04-30T18:00:00.000Z:America/Los_Angeles',
    )
    // The broken /offerings/[id] link is gone; the in-page slot picker renders.
    expect(markup).not.toContain('/offerings/')
    expect(markup).toContain('Pick a day')
    expect(markup).toContain('Times shown in America/Los_Angeles')
  })

  it('renders the rebook picker (no window) when rebook mode is NONE but an offering exists', async () => {
    const page = await renderPage({
      resolved: makeResolvedAftercareAccess({
        offeringId: 'offering_1',
        rebookMode: AftercareRebookMode.NONE,
        rebookedFor: null,
      }),
      nextBooking: null,
    })

    const markup = renderMarkup(page)

    expect(markup).toContain('No rebook recommendation yet.')
    expect(markup).toContain('Pick a day')
    expect(markup).not.toContain('/offerings/')
  })

  it('offers an in-salon/mobile toggle when a mobile-origin booking can also be booked in-salon', async () => {
    mocks.bookingFindUnique.mockResolvedValueOnce({
      clientAddressId: 'client_address_1',
    })

    const page = await renderPage({
      resolved: makeResolvedAftercareAccess({
        offeringId: 'offering_1',
        locationType: 'MOBILE',
        rebookMode: AftercareRebookMode.NONE,
        rebookedFor: null,
      }),
      nextBooking: null,
      offeringCaps: { offersInSalon: true, offersMobile: true },
    })

    const markup = renderMarkup(page)

    expect(markup).toContain('In-salon')
    expect(markup).toContain('Mobile')
  })

  it('shows no location toggle for a salon-origin booking with no client address', async () => {
    const page = await renderPage({
      resolved: makeResolvedAftercareAccess({
        offeringId: 'offering_1',
        locationType: 'SALON',
        rebookMode: AftercareRebookMode.NONE,
        rebookedFor: null,
      }),
      nextBooking: null,
      offeringCaps: { offersInSalon: true, offersMobile: true },
    })

    const markup = renderMarkup(page)

    // Mobile needs the client's address, which a salon-origin booking lacks, so
    // the toggle collapses to a single mode (no "Where" switcher).
    expect(markup).not.toContain('>Mobile<')
  })

  it('shows the unavailable state when no active offering can be found', async () => {
    const page = await renderPage({
      resolved: makeResolvedAftercareAccess({
        offeringId: null,
        rebookMode: AftercareRebookMode.NONE,
        rebookedFor: null,
      }),
      nextBooking: null,
      fallbackOffering: null,
    })

    const markup = renderMarkup(page)

    expect(markup).toContain('Rebooking is not available right now')
    expect(markup).toContain(
      'We could not find an active offering for this service.',
    )
    expect(markup).not.toContain('Pick a day')
  })
})