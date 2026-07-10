import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BookingStatus, SessionStep } from '@prisma/client'

const mocks = vi.hoisted(() => ({
  bookingFindUnique: vi.fn(),

  getCurrentUser: vi.fn(),
  resolveApptTimeZone: vi.fn(),

  renderMediaUrlsBatch: vi.fn(),

  redirect: vi.fn(),
  notFound: vi.fn(),
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
  },
}))

vi.mock('@/lib/currentUser', () => ({
  getCurrentUser: mocks.getCurrentUser,
}))

vi.mock('@/lib/booking/timeZoneTruth', () => ({
  resolveApptTimeZone: mocks.resolveApptTimeZone,
}))

vi.mock('@/lib/media/renderUrls', () => ({
  renderMediaUrlsBatch: mocks.renderMediaUrlsBatch,
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
    existingFeaturedBeforeAssetId,
    existingFeaturedAfterAssetId,
    existingRecommendedProducts,
    existingDraftSavedAt,
    existingSentToClientAt,
    existingLastEditedAt,
    existingVersion,
    existingIsFinalized,
    readOnly,
  }: {
    bookingId: string
    timeZone: string
    existingNotes: string
    existingRebookMode: string | null
    existingRebookedFor: string | null
    existingRebookWindowStart: string | null
    existingRebookWindowEnd: string | null
    existingMedia: Array<unknown>
    existingFeaturedBeforeAssetId: string | null
    existingFeaturedAfterAssetId: string | null
    existingRecommendedProducts: Array<unknown>
    existingDraftSavedAt: string | null
    existingSentToClientAt: string | null
    existingLastEditedAt: string | null
    existingVersion: number | null
    existingIsFinalized: boolean
    readOnly?: boolean
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
        'data-existing-featured-before': existingFeaturedBeforeAssetId ?? '',
        'data-existing-featured-after': existingFeaturedAfterAssetId ?? '',
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
        'data-read-only': readOnly ? 'true' : 'false',
      },
      'AftercareForm',
    ),
}))

vi.mock('./ClientProfilePanel', () => ({
  default: ({
    clientId,
    allergies,
    notes,
  }: {
    clientId: string
    allergies: Array<unknown>
    notes: Array<unknown>
  }) =>
    React.createElement('div', {
      'data-testid': 'client-profile-panel',
      'data-client-id': clientId,
      'data-allergy-count': String(allergies.length),
      'data-note-count': String(notes.length),
    }),
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
      timeZone: 'America/Los_Angeles',
    },
  }
}

function makeBooking(overrides?: {
  professionalId?: string
  status?: BookingStatus
  startedAt?: Date | null
  finishedAt?: Date | null
  sessionStep?: SessionStep | null
  offeringRebookIntervalDays?: number | null
  aftercareSummary?: Record<string, unknown> | null
  mediaAssets?: Array<Record<string, unknown>>
  serviceSubtotalSnapshot?: number | string | null
  discountAmount?: number | string | null
  taxAmount?: number | string | null
  tipAmount?: number | string | null
  totalAmount?: number | string | null
  serviceItems?: Array<Record<string, unknown>>
  allergies?: Array<Record<string, unknown>>
  clientNotes?: Array<Record<string, unknown>>
}) {
  return {
    id: 'booking_1',
    professionalId: overrides?.professionalId ?? 'pro_1',
    status: overrides?.status ?? BookingStatus.ACCEPTED,
    scheduledFor: new Date('2026-04-12T17:00:00.000Z'),
    startedAt:
      overrides && 'startedAt' in overrides
        ? overrides.startedAt
        : new Date('2026-04-12T18:00:00.000Z'),
    finishedAt:
      overrides && 'finishedAt' in overrides ? overrides.finishedAt : null,
    sessionStep:
      overrides && 'sessionStep' in overrides
        ? overrides.sessionStep
        : SessionStep.AFTER_PHOTOS,
    locationTimeZone: 'America/Los_Angeles',

    clientId: 'client_1',

    serviceSubtotalSnapshot: overrides?.serviceSubtotalSnapshot ?? null,
    discountAmount: overrides?.discountAmount ?? null,
    taxAmount: overrides?.taxAmount ?? null,
    tipAmount: overrides?.tipAmount ?? null,
    totalAmount: overrides?.totalAmount ?? null,

    service: {
      name: 'Haircut',
    },

    offering: {
      rebookIntervalDays: overrides?.offeringRebookIntervalDays ?? null,
    },

    serviceItems: overrides?.serviceItems ?? [],

    client: {
      firstName: 'Tori',
      lastName: 'Morales',
      user: {
        email: 'tori@example.com',
      },
      allergies: overrides?.allergies ?? [],
      notes: overrides?.clientNotes ?? [],
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
  searchParams?: Record<string, string | string[] | undefined>
}) {
  mocks.bookingFindUnique.mockResolvedValueOnce(args?.booking ?? makeBooking())

  return ProAftercarePage({
    params: Promise.resolve({ id: 'booking_1' }),
    searchParams: Promise.resolve(args?.searchParams ?? {}),
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

    // The page delegates signing to renderMediaUrlsBatch (unit-tested in
    // lib/media/renderUrls.test.ts); here we just resolve each asset to a
    // render URL pair so the media pass-through can be asserted.
    mocks.renderMediaUrlsBatch.mockImplementation(
      async (items: Array<unknown>) =>
        items.map(() => ({
          renderUrl: 'https://signed.example.com/file.jpg',
          renderThumbUrl: 'https://signed.example.com/thumb.jpg',
        })),
    )
  })

  it('redirects to login when pro user is missing', async () => {
    mocks.getCurrentUser.mockResolvedValueOnce(null)

    await expect(
      ProAftercarePage({
        params: Promise.resolve({ id: 'booking_1' }),
        searchParams: Promise.resolve({}),
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
        searchParams: Promise.resolve({}),
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

  it('redirects back to session hub when booking is cancelled or not started', async () => {
    await expect(
      renderPage({
        booking: makeBooking({
          status: BookingStatus.CANCELLED,
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

  it('renders completed bookings as a locked, read-only aftercare summary', async () => {
    const page = await renderPage({
      booking: makeBooking({
        status: BookingStatus.COMPLETED,
        sessionStep: SessionStep.DONE,
        finishedAt: new Date('2026-04-12T21:00:00.000Z'),
      }),
    })

    const markup = renderMarkup(page)

    // Does not redirect — it serves the finished aftercare instead.
    expect(mocks.redirect).not.toHaveBeenCalled()
    expect(markup).toContain('This booking is completed.')
    expect(markup).toContain('data-read-only="true"')
    // Next-step links on the read-only banner.
    expect(markup).toContain('/pro/calendar')
    expect(markup).toContain('/pro/bookings')
    expect(markup).toContain('/pro/aftercare')
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

  it('renders draft aftercare state with locked client access and normalized form props', async () => {
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

    expect(markup).toContain('Aftercare')
    expect(markup).toContain('Tori Morales · Haircut')
    expect(markup).toContain('Aftercare status')
    expect(markup).toContain('Draft saved')
    expect(markup).toContain('Client access')
    expect(markup).toContain('Draft only')
    expect(markup).toContain('DRAFT SAVED')
    expect(markup).toContain('CLIENT ACCESS LOCKED')
    expect(markup).toContain(
      'Do either first. Once after photos, finalized aftercare, payment, checkout, and consultation are all complete, closeout will finalize the booking.',
    )
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

  it('carries a valid ?fb=/?fa= featured pre-selection into the aftercare form', async () => {
    const page = await renderPage({
      booking: makeBooking({
        mediaAssets: [
          {
            id: 'media_b',
            url: null,
            thumbUrl: null,
            mediaType: 'IMAGE',
            visibility: 'PRIVATE',
            uploadedByRole: 'PRO',
            reviewId: null,
            createdAt: new Date('2026-04-12T19:00:00.000Z'),
            phase: 'BEFORE',
            storageBucket: 'booking-media',
            storagePath: 'before/media_b.jpg',
            thumbBucket: 'booking-media-thumbs',
            thumbPath: 'before/thumb_media_b.jpg',
          },
          {
            id: 'media_a',
            url: null,
            thumbUrl: null,
            mediaType: 'IMAGE',
            visibility: 'PRIVATE',
            uploadedByRole: 'PRO',
            reviewId: null,
            createdAt: new Date('2026-04-12T20:00:00.000Z'),
            phase: 'AFTER',
            storageBucket: 'booking-media',
            storagePath: 'after/media_a.jpg',
            thumbBucket: 'booking-media-thumbs',
            thumbPath: 'after/thumb_media_a.jpg',
          },
        ],
      }),
      searchParams: { fb: 'media_b', fa: 'media_a' },
    })

    const markup = renderMarkup(page)
    expect(markup).toContain('data-existing-featured-before="media_b"')
    expect(markup).toContain('data-existing-featured-after="media_a"')
  })

  it('drops a carried featured id that is not a matching-phase image on the booking', async () => {
    // The default booking has one AFTER image (media_1) and no before image.
    // fb references that AFTER image (wrong phase) → dropped; fa is valid.
    const page = await renderPage({
      booking: makeBooking(),
      searchParams: { fb: 'media_1', fa: 'media_1' },
    })

    const markup = renderMarkup(page)
    expect(markup).toContain('data-existing-featured-before=""')
    expect(markup).toContain('data-existing-featured-after="media_1"')
  })

  it('renders finalized aftercare state with live client access and resolves media URLs via renderMediaUrlsBatch', async () => {
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

    // The whole booking's media is handed to the batched signer in one call.
    expect(mocks.renderMediaUrlsBatch).toHaveBeenCalledTimes(1)
    const signedItems = mocks.renderMediaUrlsBatch.mock.calls[0]?.[0] as Array<{
      storageBucket: string
      storagePath: string
      thumbBucket: string
      thumbPath: string
    }>
    expect(signedItems).toHaveLength(1)
    expect(signedItems[0]).toMatchObject({
      storageBucket: 'booking-media',
      storagePath: 'after/media_1.jpg',
      thumbBucket: 'booking-media-thumbs',
      thumbPath: 'after/thumb_media_1.jpg',
    })

    expect(markup).toContain('Finalized + sent')
    expect(markup).toContain('Secure client access ready')
    expect(markup).toContain(
      'Client-facing aftercare access is available through the secure aftercare link flow.',
    )
    expect(markup).toContain('FINALIZED')
    expect(markup).toContain('CLIENT ACCESS LIVE')
    expect(markup).toContain('SENT')
    expect(markup).toContain('VERSION')
    expect(markup).toContain(
      'data-existing-rebook-mode="BOOKED_NEXT_APPOINTMENT"',
    )
    expect(markup).toContain(
      'data-existing-rebooked-for="2026-05-01T18:00:00.000Z"',
    )
    expect(markup).toContain('data-existing-media-count="1"')
    expect(markup).toContain('data-existing-is-finalized="true"')
  })

  it('renders not-started access state with locked client access when aftercare does not exist yet', async () => {
    const page = await renderPage({
      booking: makeBooking({
        aftercareSummary: null,
        mediaAssets: [],
      }),
    })

    const markup = renderMarkup(page)

    expect(markup).toContain('Not started')
    expect(markup).toContain('Client access')
    expect(markup).toContain('Not ready')
    expect(markup).toContain('NOT STARTED')
    expect(markup).toContain('CLIENT ACCESS LOCKED')
    expect(markup).toContain(
      'Do either first. Once after photos, finalized aftercare, payment, checkout, and consultation are all complete, closeout will finalize the booking.',
    )
    expect(markup).toContain(
      'No client-facing aftercare access exists yet.',
    )
    expect(markup).toContain('data-existing-notes=""')
    expect(markup).toContain('data-existing-media-count="0"')
    expect(markup).toContain('data-existing-products-count="0"')
    expect(markup).toContain('data-existing-is-finalized="false"')
  })

  it('renders the services-received summary and the client private profile panel', async () => {
    const page = await renderPage({
      booking: makeBooking({
        serviceItems: [
          {
            id: 'si_1',
            itemType: 'BASE',
            priceSnapshot: 80,
            durationMinutesSnapshot: 60,
            service: { name: 'Balayage' },
          },
          {
            id: 'si_2',
            itemType: 'ADD_ON',
            priceSnapshot: 20,
            durationMinutesSnapshot: 15,
            service: { name: 'Gloss' },
          },
        ],
        serviceSubtotalSnapshot: 100,
        tipAmount: 15,
        totalAmount: 115,
        allergies: [
          {
            id: 'a1',
            label: 'PPD',
            severity: 'HIGH',
            description: null,
            createdAt: new Date('2026-04-12T18:00:00.000Z'),
            recordedBy: null,
          },
        ],
        clientNotes: [
          {
            id: 'n1',
            title: null,
            body: 'Prefers cool tones',
            createdAt: new Date('2026-04-12T18:00:00.000Z'),
          },
        ],
      }),
    })

    const markup = renderMarkup(page)

    // Services + prices summary (real component)
    expect(markup).toContain('Services received')
    expect(markup).toContain('Balayage')
    expect(markup).toContain('Gloss')
    expect(markup).toContain('ADD-ON')
    expect(markup).toContain('$115.00')

    // Private client profile panel (mocked) receives the booking's client +
    // the allergies/notes loaded for this pro.
    expect(markup).toContain('data-client-id="client_1"')
    expect(markup).toContain('data-allergy-count="1"')
    expect(markup).toContain('data-note-count="1"')

    // Safety allergy alert is surfaced prominently at the top (pros only),
    // with the allergy label + capitalized severity.
    expect(markup).toContain('Allergy on file')
    expect(markup).toContain('Private to pros only')
    expect(markup).toContain('PPD')
    expect(markup).toContain('High')
  })

  it('omits the allergy alert when the client has no allergies on file', async () => {
    const page = await renderPage({
      booking: makeBooking({ allergies: [] }),
    })

    const markup = renderMarkup(page)

    expect(markup).not.toContain('Allergy on file')
    expect(markup).toContain('data-allergy-count="0"')
  })
})