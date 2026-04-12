import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AftercareRebookMode, BookingStatus } from '@prisma/client'

const TOKEN = 'token_1'

const mocks = vi.hoisted(() => ({
  bookingFindFirst: vi.fn(),
  professionalServiceOfferingFindFirst: vi.fn(),

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
  }) =>
    React.createElement('a', { href, className }, children),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    booking: {
      findFirst: mocks.bookingFindFirst,
    },
    professionalServiceOffering: {
      findFirst: mocks.professionalServiceOfferingFindFirst,
    },
  },
}))

vi.mock('@/lib/timeZone', () => ({
  sanitizeTimeZone: mocks.sanitizeTimeZone,
}))

vi.mock('@/lib/formatInTimeZone', () => ({
  formatAppointmentWhen: mocks.formatAppointmentWhen,
  formatRangeInTimeZone: mocks.formatRangeInTimeZone,
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
  accessSource?: 'clientActionToken' | 'legacyPublicToken'
  offeringId?: string | null
  rebookMode?: AftercareRebookMode
  rebookedFor?: Date | null
  rebookWindowStart?: Date | null
  rebookWindowEnd?: Date | null
  notes?: string | null
}) {
  return {
    accessSource: overrides?.accessSource ?? 'clientActionToken',
    token: {
      id: 'token_row_1',
      expiresAt: new Date('2026-04-20T18:00:00.000Z'),
      firstUsedAt: null,
      lastUsedAt: null,
      useCount: 0,
      singleUse: false,
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
        overrides?.rebookWindowEnd ?? new Date('2026-04-30T18:00:00.000Z'),
      publicToken: 'legacy_public_token',
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
      locationType: 'SALON',
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
  searchParams?: Record<string, string | string[] | undefined>
}) {
  mocks.resolveAftercareAccessByToken.mockResolvedValueOnce(
    args?.resolved ?? makeResolvedAftercareAccess(),
  )
  mocks.bookingFindFirst.mockResolvedValueOnce(args?.nextBooking ?? null)
  mocks.professionalServiceOfferingFindFirst.mockResolvedValueOnce(
    args?.fallbackOffering ?? null,
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
      code: 'FORBIDDEN',
      message: 'That aftercare link is invalid or expired.',
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

  it('renders the token-based aftercare page without account-only dead ends', async () => {
    const page = await renderPage({
      resolved: makeResolvedAftercareAccess({
        accessSource: 'legacyPublicToken',
        offeringId: 'offering_1',
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
      'No account required to view aftercare and rebook from this link.',
    )
    expect(markup).toContain('Your next appointment is already booked')
    expect(markup).toContain('Legacy public token')
    expect(markup).toContain('href="/professionals/pro_1"')
    expect(markup).not.toContain('/client/bookings/')
  })

  it('builds a booking link from a fallback offering and computed recommended window', async () => {
    const page = await renderPage({
      resolved: makeResolvedAftercareAccess({
        accessSource: 'clientActionToken',
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
    expect(markup).toContain('href="/offerings/offering_fallback_1?')
    expect(markup).toContain('source=AFTERCARE')
    expect(markup).toContain('token=token_1')
    expect(markup).toContain('rebookOfBookingId=booking_1')
    expect(markup).toContain('windowStart=2026-04-20T18%3A00%3A00.000Z')
    expect(markup).toContain('windowEnd=2026-04-30T18%3A00%3A00.000Z')
  })

  it('preserves explicit URL recommendation params instead of overwriting them', async () => {
    const page = await renderPage({
      resolved: makeResolvedAftercareAccess({
        offeringId: 'offering_1',
        rebookMode: AftercareRebookMode.RECOMMENDED_WINDOW,
        rebookWindowStart: new Date('2026-04-20T18:00:00.000Z'),
        rebookWindowEnd: new Date('2026-04-30T18:00:00.000Z'),
      }),
      nextBooking: null,
      searchParams: {
        recommendedAt: '2026-05-05T19:00:00.000Z',
        windowStart: '2026-05-01T19:00:00.000Z',
        windowEnd: '2026-05-10T19:00:00.000Z',
      },
    })

    const markup = renderMarkup(page)

    expect(markup).toContain('href="/offerings/offering_1?')
    expect(markup).toContain('recommendedAt=2026-05-05T19%3A00%3A00.000Z')
    expect(markup).toContain('windowStart=2026-05-01T19%3A00%3A00.000Z')
    expect(markup).toContain('windowEnd=2026-05-10T19%3A00%3A00.000Z')
    expect(markup).not.toContain('windowStart=2026-04-20T18%3A00%3A00.000Z')
    expect(markup).not.toContain('windowEnd=2026-04-30T18%3A00%3A00.000Z')
  })

  it('shows the unavailable state when no active offering can be found', async () => {
    const page = await renderPage({
    resolved: makeResolvedAftercareAccess({
        offeringId: null,
        rebookMode: AftercareRebookMode.NONE,
        rebookedFor: new Date('2026-05-01T18:00:00.000Z'),
    }),
      nextBooking: null,
      fallbackOffering: null,
    })

    const markup = renderMarkup(page)

    expect(markup).toContain('Rebooking is not available right now')
    expect(markup).toContain(
      'We could not find an active offering for this service.',
    )
    expect(markup).not.toContain('Book your next appointment')
  })
})