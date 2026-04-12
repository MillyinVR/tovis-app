import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BookingStatus, SessionStep } from '@prisma/client'

const mocks = vi.hoisted(() => ({
  bookingFindUnique: vi.fn(),
  professionalProfileFindUnique: vi.fn(),

  getCurrentUser: vi.fn(),
  resolveApptTimeZone: vi.fn(),

  storageFrom: vi.fn(),
  storageCreateSignedUrl: vi.fn(),

  redirect: vi.fn(),
  notFound: vi.fn(),

  pickString: vi.fn(),
  isRecord: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  redirect: mocks.redirect,
  notFound: mocks.notFound,
}))

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    className,
    prefetch,
  }: {
    href: string
    children: React.ReactNode
    className?: string
    prefetch?: boolean
  }) =>
    React.createElement(
      'a',
      { href, className, 'data-prefetch': prefetch ? 'true' : undefined },
      children,
    ),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    booking: {
      findUnique: mocks.bookingFindUnique,
    },
    professionalProfile: {
      findUnique: mocks.professionalProfileFindUnique,
    },
  },
}))

vi.mock('@/lib/currentUser', () => ({
  getCurrentUser: mocks.getCurrentUser,
}))

vi.mock('@/lib/booking/timeZoneTruth', () => ({
  resolveApptTimeZone: mocks.resolveApptTimeZone,
}))

vi.mock('@/lib/supabaseAdmin', () => ({
  supabaseAdmin: {
    storage: {
      from: mocks.storageFrom,
    },
  },
}))

vi.mock('@/lib/guards', () => ({
  isRecord: mocks.isRecord,
}))

vi.mock('@/lib/pick', () => ({
  pickString: mocks.pickString,
}))

vi.mock('./AftercareForm', () => ({
  default: ({
    bookingId,
    timeZone,
    existingNotes,
    existingRebookMode,
    existingRebookedFor,
    existingRebookWindowStart,
    existingRebookWindowEnd,
    existingMedia,
    existingRecommendedProducts,
    existingDraftSavedAt,
    existingSentToClientAt,
    existingLastEditedAt,
    existingVersion,
    existingIsFinalized,
  }: {
    bookingId: string
    timeZone: string
    existingNotes: string
    existingRebookMode: string | null
    existingRebookedFor: string | null
    existingRebookWindowStart: string | null
    existingRebookWindowEnd: string | null
    existingMedia: Array<unknown>
    existingRecommendedProducts: Array<unknown>
    existingDraftSavedAt: string | null
    existingSentToClientAt: string | null
    existingLastEditedAt: string | null
    existingVersion: number | null
    existingIsFinalized: boolean
  }) =>
    React.createElement(
      'div',
      {
        'data-testid': 'aftercare-form',
        'data-booking-id': bookingId,
        'data-time-zone': timeZone,
        'data-existing-notes': existingNotes,
        'data-existing-rebook-mode': existingRebookMode ?? '',
        'data-existing-rebooked-for': existingRebookedFor ?? '',
        'data-existing-rebook-window-start': existingRebookWindowStart ?? '',
        'data-existing-rebook-window-end': existingRebookWindowEnd ?? '',
        'data-existing-media-count': String(existingMedia.length),
        'data-existing-products-count': String(
          existingRecommendedProducts.length,
        ),
        'data-existing-draft-saved-at': existingDraftSavedAt ?? '',
        'data-existing-sent-to-client-at': existingSentToClientAt ?? '',
        'data-existing-last-edited-at': existingLastEditedAt ?? '',
        'data-existing-version':
          existingVersion == null ? '' : String(existingVersion),
        'data-existing-is-finalized': existingIsFinalized ? 'true' : 'false',
      },
      'AftercareForm',
    ),
}))

import ProAftercarePage from './page'

function makeRedirectError(href: string) {
  return Object.assign(new Error(`redirect:${href}`), {
    href,
    digest: 'NEXT_REDIRECT',
  })
}

function makeNotFoundError() {
  return Object.assign(new Error('notFound'), {
    digest: 'NEXT_NOT_FOUND',
  })
}

function renderMarkup(node: React.ReactNode): string {
  return renderToStaticMarkup(<>{node}</>)
}

function makeCurrentUser() {
  return {
    id: 'user_1',
    role: 'PRO',
    professionalProfile: {
      id: 'pro_1',
    },
  }
}

function makeBooking(overrides?: {
  professionalId?: string
  status?: BookingStatus
  startedAt?: Date | null
  finishedAt?: Date | null
  sessionStep?: SessionStep | null
  aftercareSummary?: Record<string, unknown> | null
  mediaAssets?: Array<Record<string, unknown>>
}) {
  return {
    id: 'booking_1',
    professionalId: overrides?.professionalId ?? 'pro_1',
    status: overrides?.status ?? BookingStatus.ACCEPTED,
    startedAt:
        overrides && 'startedAt' in overrides
            ? (overrides.startedAt ?? null)
            : new Date('2026-04-12T18:00:00.000Z'),
    finishedAt: overrides?.finishedAt ?? null,
    sessionStep: overrides?.sessionStep ?? SessionStep.AFTER_PHOTOS,
    locationTimeZone: 'America/Los_Angeles',

    service: {
      name: 'Haircut',
    },

    client: {
      firstName: 'Tori',
      lastName: 'Morales',
      user: {
        email: 'tori@example.com',
      },
    },

    aftercareSummary:
      overrides && 'aftercareSummary' in overrides
        ? overrides.aftercareSummary
        : {
            id: 'aftercare_1',
            notes: 'Use cool water.',
            rebookedFor: null,
            rebookMode: 'RECOMMENDED_WINDOW',
            rebookWindowStart: new Date('2026-05-01T18:00:00.000Z'),
            rebookWindowEnd: new Date('2026-05-15T18:00:00.000Z'),
            draftSavedAt: new Date('2026-04-12T20:05:00.000Z'),
            sentToClientAt: null,
            lastEditedAt: new Date('2026-04-12T20:08:00.000Z'),
            version: 3,
            recommendedProducts: [
              {
                id: 'rp_1',
                note: 'Use nightly',
                product: {
                  name: 'Repair Mask',
                },
                externalName: null,
                externalUrl: null,
              },
              {
                id: 'rp_2',
                note: 'Use weekly',
                product: null,
                externalName: 'Silk Pillowcase',
                externalUrl: 'https://example.com/pillow',
              },
            ],
          },

    mediaAssets:
      overrides?.mediaAssets ??
      [
        {
          id: 'media_1',
          url: null,
          thumbUrl: null,
          mediaType: 'IMAGE',
          visibility: 'PRIVATE',
          uploadedByRole: 'PRO',
          reviewId: null,
          createdAt: new Date('2026-04-12T20:01:00.000Z'),
          phase: 'AFTER',
          storageBucket: 'booking-media',
          storagePath: 'after/media_1.jpg',
          thumbBucket: 'booking-media-thumbs',
          thumbPath: 'after/thumb_media_1.jpg',
        },
      ],
  }
}

async function renderPage(args?: {
  booking?: ReturnType<typeof makeBooking>
  professionalTimeZone?: string | null
}) {
  mocks.bookingFindUnique.mockResolvedValueOnce(args?.booking ?? makeBooking())
  mocks.professionalProfileFindUnique.mockResolvedValueOnce({
    timeZone: args?.professionalTimeZone ?? 'America/Los_Angeles',
  })

  return ProAftercarePage({
    params: Promise.resolve({ id: 'booking_1' }),
  })
}

describe('app/pro/bookings/[id]/aftercare/page.tsx', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mocks.redirect.mockImplementation((href: string) => {
      throw makeRedirectError(href)
    })

    mocks.notFound.mockImplementation(() => {
      throw makeNotFoundError()
    })

    mocks.getCurrentUser.mockResolvedValue(makeCurrentUser())

    mocks.resolveApptTimeZone.mockResolvedValue({
      ok: true,
      timeZone: 'America/Los_Angeles',
    })

    mocks.storageCreateSignedUrl.mockResolvedValue({
      data: { signedUrl: 'https://signed.example.com/file.jpg' },
      error: null,
    })

    mocks.storageFrom.mockReturnValue({
      createSignedUrl: mocks.storageCreateSignedUrl,
    })

    mocks.pickString.mockImplementation((value: unknown) => {
      if (typeof value !== 'string') return null
      const trimmed = value.trim()
      return trimmed.length > 0 ? trimmed : null
    })

    mocks.isRecord.mockImplementation(
      (value: unknown) =>
        typeof value === 'object' && value !== null && !Array.isArray(value),
    )
  })

  it('redirects to login when pro user is missing', async () => {
    mocks.getCurrentUser.mockResolvedValueOnce(null)

    await expect(
      ProAftercarePage({
        params: Promise.resolve({ id: 'booking_1' }),
      }),
    ).rejects.toMatchObject({
      href: '/login?from=%2Fpro%2Fbookings%2Fbooking_1%2Faftercare',
    })

    expect(mocks.bookingFindUnique).not.toHaveBeenCalled()
  })

  it('calls notFound when booking id is missing', async () => {
    await expect(
      ProAftercarePage({
        params: Promise.resolve({ id: '   ' }),
      }),
    ).rejects.toMatchObject({
      digest: 'NEXT_NOT_FOUND',
    })

    expect(mocks.bookingFindUnique).not.toHaveBeenCalled()
  })

  it('redirects to /pro when booking belongs to another professional', async () => {
    await expect(
      renderPage({
        booking: makeBooking({
          professionalId: 'pro_other',
        }),
      }),
    ).rejects.toMatchObject({
      href: '/pro',
    })
  })

  it('redirects back to session hub when booking is terminal or not started', async () => {
    await expect(
      renderPage({
        booking: makeBooking({
          finishedAt: new Date('2026-04-12T21:00:00.000Z'),
        }),
      }),
    ).rejects.toMatchObject({
      href: '/pro/bookings/booking_1/session',
    })

    await expect(
      renderPage({
        booking: makeBooking({
          startedAt: null,
        }),
      }),
    ).rejects.toMatchObject({
      href: '/pro/bookings/booking_1/session',
    })
  })

  it('redirects back to session hub when session step is not allowed here', async () => {
    await expect(
      renderPage({
        booking: makeBooking({
          sessionStep: SessionStep.SERVICE_IN_PROGRESS,
        }),
      }),
    ).rejects.toMatchObject({
      href: '/pro/bookings/booking_1/session',
    })
  })

  it('renders draft aftercare state with client access summary and normalized form props', async () => {
    const page = await renderPage({
      booking: makeBooking({
        aftercareSummary: {
          id: 'aftercare_1',
          notes: 'Use cool water.',
          rebookedFor: null,
          rebookMode: 'RECOMMENDED_WINDOW',
          rebookWindowStart: new Date('2026-05-01T18:00:00.000Z'),
          rebookWindowEnd: new Date('2026-05-15T18:00:00.000Z'),
          draftSavedAt: new Date('2026-04-12T20:05:00.000Z'),
          sentToClientAt: null,
          lastEditedAt: new Date('2026-04-12T20:08:00.000Z'),
          version: 3,
          recommendedProducts: [
            {
              id: 'rp_1',
              note: 'Use nightly',
              product: {
                name: 'Repair Mask',
              },
              externalName: null,
              externalUrl: null,
            },
            {
              id: 'rp_2',
              note: 'Use weekly',
              product: null,
              externalName: 'Silk Pillowcase',
              externalUrl: 'https://example.com/pillow',
            },
          ],
        },
      }),
    })

    const markup = renderMarkup(page)

    expect(markup).toContain('Aftercare: Haircut')
    expect(markup).toContain('Client: Tori Morales')
    expect(markup).toContain('Aftercare status:')
    expect(markup).toContain('📝 draft saved')
    expect(markup).toContain('Client access:')
    expect(markup).toContain('📝 draft only')
    expect(markup).toContain(
      'The aftercare draft exists, but client access is not live until you send/finalize it.',
    )
    expect(markup).toContain('data-testid="aftercare-form"')
    expect(markup).toContain('data-booking-id="booking_1"')
    expect(markup).toContain('data-time-zone="America/Los_Angeles"')
    expect(markup).toContain('data-existing-notes="Use cool water."')
    expect(markup).toContain(
      'data-existing-rebook-mode="RECOMMENDED_WINDOW"',
    )
    expect(markup).toContain(
      'data-existing-rebook-window-start="2026-05-01T18:00:00.000Z"',
    )
    expect(markup).toContain(
      'data-existing-rebook-window-end="2026-05-15T18:00:00.000Z"',
    )
    expect(markup).toContain('data-existing-products-count="2"')
    expect(markup).toContain('data-existing-is-finalized="false"')
    expect(markup).not.toContain('public_')
  })

  it('renders finalized aftercare state and signs fallback media URLs', async () => {
    const page = await renderPage({
      booking: makeBooking({
        aftercareSummary: {
          id: 'aftercare_1',
          notes: 'Finalized aftercare.',
          rebookedFor: new Date('2026-05-01T18:00:00.000Z'),
          rebookMode: 'BOOKED_NEXT_APPOINTMENT',
          rebookWindowStart: null,
          rebookWindowEnd: null,
          draftSavedAt: new Date('2026-04-12T20:05:00.000Z'),
          sentToClientAt: new Date('2026-04-12T20:10:00.000Z'),
          lastEditedAt: new Date('2026-04-12T20:08:00.000Z'),
          version: 4,
          recommendedProducts: [],
        },
      }),
    })

    const markup = renderMarkup(page)

    expect(mocks.storageFrom).toHaveBeenCalledWith('booking-media')
    expect(mocks.storageFrom).toHaveBeenCalledWith('booking-media-thumbs')
    expect(mocks.storageCreateSignedUrl).toHaveBeenCalledWith(
      'after/media_1.jpg',
      600,
    )
    expect(mocks.storageCreateSignedUrl).toHaveBeenCalledWith(
      'after/thumb_media_1.jpg',
      600,
    )

    expect(markup).toContain('✅ finalized + sent')
    expect(markup).toContain('✅ secure client access ready')
    expect(markup).toContain(
      'Client-facing aftercare access is available through the secure aftercare link flow.',
    )
    expect(markup).toContain('Sent to client:')
    expect(markup).toContain('Version:')
    expect(markup).toContain('data-existing-rebook-mode="BOOKED_NEXT_APPOINTMENT"')
    expect(markup).toContain(
      'data-existing-rebooked-for="2026-05-01T18:00:00.000Z"',
    )
    expect(markup).toContain('data-existing-media-count="1"')
    expect(markup).toContain('data-existing-is-finalized="true"')
  })

  it('renders not-started access state when aftercare does not exist yet', async () => {
    const page = await renderPage({
      booking: makeBooking({
        aftercareSummary: null,
        mediaAssets: [],
      }),
    })

    const markup = renderMarkup(page)

    expect(markup).toContain('❌ not started')
    expect(markup).toContain('Client access:')
    expect(markup).toContain('❌ not ready')
    expect(markup).toContain(
      'No client-facing aftercare access exists yet.',
    )
    expect(markup).toContain('data-existing-notes=""')
    expect(markup).toContain('data-existing-media-count="0"')
    expect(markup).toContain('data-existing-products-count="0"')
    expect(markup).toContain('data-existing-is-finalized="false"')
  })
})