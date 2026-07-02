import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  BookingStatus,
  MediaPhase,
  Role,
  SessionStep,
} from '@prisma/client'

const mocks = vi.hoisted(() => ({
  bookingFindUnique: vi.fn(),
  mediaAssetCount: vi.fn(),
  mediaAssetFindMany: vi.fn(),
  renderMediaUrls: vi.fn(),
  getCurrentUser: vi.fn(),

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
  }: {
    href: string
    children: React.ReactNode
    className?: string
  }) =>
    React.createElement('a', { href, className }, children),
}))

vi.mock('@/lib/currentUser', () => ({
  getCurrentUser: mocks.getCurrentUser,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    booking: {
      findUnique: mocks.bookingFindUnique,
    },
    mediaAsset: {
      count: mocks.mediaAssetCount,
      findMany: mocks.mediaAssetFindMany,
    },
  },
}))

vi.mock('@/lib/media/renderUrls', () => ({
  renderMediaUrls: mocks.renderMediaUrls,
}))

vi.mock('../_components/SessionPhotoGrid', () => ({
  default: ({
    items,
    label,
  }: {
    items: Array<{ id: string }>
    label: string
  }) =>
    React.createElement(
      'div',
      {
        'data-testid': 'session-photo-grid',
        'data-label': label,
        'data-count': String(items.length),
      },
      label,
    ),
}))

vi.mock('../MediaUploader', () => ({
  default: ({
    bookingId,
    phase,
  }: {
    bookingId: string
    phase: 'BEFORE' | 'AFTER'
  }) =>
    React.createElement(
      'div',
      {
        'data-testid': 'media-uploader',
        'data-booking-id': bookingId,
        'data-phase': phase,
      },
      `MediaUploader:${phase}`,
    ),
}))

import ProAfterPhotosPage from './page'

type PageNode = React.ReactNode

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
}) {
  return {
    id: 'booking_1',
    professionalId: overrides?.professionalId ?? 'pro_1',
    status:
        overrides && 'status' in overrides
            ? overrides.status
            : BookingStatus.IN_PROGRESS,
    startedAt:
    overrides && 'startedAt' in overrides
        ? overrides.startedAt
        : new Date('2026-04-12T18:00:00.000Z'),
    finishedAt:
    overrides && 'finishedAt' in overrides
        ? overrides.finishedAt
        : null,
    sessionStep:
    overrides && 'sessionStep' in overrides
        ? overrides.sessionStep
        : SessionStep.AFTER_PHOTOS,

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
  }
}

function makeMediaRow(overrides?: { id?: string; caption?: string | null }) {
  return {
    id: overrides?.id ?? 'media_after_1',
    mediaType: 'IMAGE' as const,
    visibility: 'PRO_CLIENT',
    phase: MediaPhase.AFTER,
    caption: overrides && 'caption' in overrides ? overrides.caption : 'After photo',
    createdAt: new Date('2026-04-12T19:00:00.000Z'),
    reviewId: null,
    isEligibleForLooks: false,
    isFeaturedInPortfolio: false,
    storageBucket: 'media-private',
    storagePath: 'bookings/booking_1/after/main.jpg',
    thumbBucket: null,
    thumbPath: null,
    url: null,
    thumbUrl: null,
  }
}

async function renderPage(args?: {
  booking?: ReturnType<typeof makeBooking> | null
  afterCount?: number
  mediaRows?: Array<ReturnType<typeof makeMediaRow>>
}) {
  // The page loads the booking once for its own guards and the shared
  // listProBookingMedia path re-checks ownership, so both reads see the
  // same row.
  mocks.bookingFindUnique.mockResolvedValue(
    args && 'booking' in args ? args.booking : makeBooking(),
  )

  mocks.mediaAssetCount.mockResolvedValueOnce(args?.afterCount ?? 0)
  mocks.mediaAssetFindMany.mockResolvedValue(args?.mediaRows ?? [])

  return ProAfterPhotosPage({
    params: Promise.resolve({ id: 'booking_1' }),
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

type TestElementProps = {
  children?: React.ReactNode
  'data-testid'?: string
  'data-booking-id'?: string
  'data-phase'?: string
  'data-count'?: string
}

function findElementsByTestId(
  node: PageNode,
  testId: string,
): Array<React.ReactElement<TestElementProps>> {
  if (node == null || typeof node === 'boolean') return []

  if (typeof node === 'string' || typeof node === 'number') return []

  if (Array.isArray(node)) {
    return node.flatMap((child) => findElementsByTestId(child, testId))
  }

  if (React.isValidElement<TestElementProps>(node)) {
    const element = node

    if (typeof element.type === 'function' && isFunctionComponent(element.type)) {
      const rendered = element.type(element.props)
      return findElementsByTestId(rendered, testId)
    }

    const matches =
      element.props['data-testid'] === testId ? [element] : []

    return [
      ...matches,
      ...findElementsByTestId(element.props.children, testId),
    ]
  }

  return []
}

describe('app/pro/bookings/[id]/session/after-photos/page.tsx', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mocks.redirect.mockImplementation((href: string) => {
      throw makeRedirectError(href)
    })

    mocks.notFound.mockImplementation(() => {
      throw makeNotFoundError()
    })

    mocks.getCurrentUser.mockResolvedValue(makeCurrentUser())

    mocks.renderMediaUrls.mockResolvedValue({
      renderUrl: '/signed/after.jpg',
      renderThumbUrl: null,
    })
  })

  it('redirects to login when no pro user is available', async () => {
    mocks.getCurrentUser.mockResolvedValueOnce(null)

    await expect(
      ProAfterPhotosPage({
        params: Promise.resolve({ id: 'booking_1' }),
      }),
    ).rejects.toMatchObject({
      href: '/login?from=%2Fpro%2Fbookings%2Fbooking_1%2Fsession%2Fafter-photos',
    })

    expect(mocks.bookingFindUnique).not.toHaveBeenCalled()
  })

  it('renders after-photo upload UI only when session step is AFTER_PHOTOS', async () => {
    const page = await renderPage({
      booking: makeBooking({
        sessionStep: SessionStep.AFTER_PHOTOS,
      }),
      afterCount: 1,
      mediaRows: [makeMediaRow()],
    })

    expect(hasText(page, 'After photos')).toBe(true)
    expect(hasText(page, 'WRAP-UP · AFTER PHOTOS')).toBe(true)
    expect(hasText(page, 'After photos saved')).toBe(true)
    expect(hasText(page, 'Continue to aftercare')).toBe(true)
    expect(hasText(page, 'Take or upload after photos')).toBe(true)
    expect(hasText(page, 'MediaUploader:AFTER')).toBe(true)
    expect(hasText(page, 'for you and')).toBe(true)

    const uploaders = findElementsByTestId(page, 'media-uploader')
    expect(uploaders).toHaveLength(1)
    expect(uploaders[0]?.props['data-booking-id']).toBe('booking_1')
    expect(uploaders[0]?.props['data-phase']).toBe('AFTER')

    expect(mocks.mediaAssetCount).toHaveBeenCalledWith({
      where: {
        bookingId: 'booking_1',
        phase: MediaPhase.AFTER,
        uploadedByRole: Role.PRO,
      },
    })

    expect(mocks.mediaAssetFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          bookingId: 'booking_1',
          phase: MediaPhase.AFTER,
        },
      }),
    )

    const grids = findElementsByTestId(page, 'session-photo-grid')
    expect(grids).toHaveLength(1)
    expect(grids[0]?.props['data-count']).toBe('1')
  })

  it('renders the after-photo upload UI when session step is FINISH_REVIEW (transient pass-through)', async () => {
    const page = await renderPage({
      booking: makeBooking({
        sessionStep: SessionStep.FINISH_REVIEW,
      }),
      afterCount: 0,
      mediaRows: [],
    })

    expect(hasText(page, 'Take or upload after photos')).toBe(true)
    expect(hasText(page, 'MediaUploader:AFTER')).toBe(true)
    expect(mocks.redirect).not.toHaveBeenCalled()

    expect(mocks.mediaAssetCount).toHaveBeenCalledWith({
      where: {
        bookingId: 'booking_1',
        phase: MediaPhase.AFTER,
        uploadedByRole: Role.PRO,
      },
    })
  })

  it('redirects to the session hub when session step is SERVICE_IN_PROGRESS', async () => {
    await expect(
      renderPage({
        booking: makeBooking({
          sessionStep: SessionStep.SERVICE_IN_PROGRESS,
        }),
      }),
    ).rejects.toMatchObject({
      href: '/pro/bookings/booking_1/session',
    })

    expect(mocks.mediaAssetCount).not.toHaveBeenCalled()
    expect(mocks.mediaAssetFindMany).not.toHaveBeenCalled()
  })

  it('redirects to aftercare when session step is DONE', async () => {
    await expect(
      renderPage({
        booking: makeBooking({
          status: BookingStatus.COMPLETED,
          sessionStep: SessionStep.DONE,
          finishedAt: new Date('2026-04-12T20:00:00.000Z'),
        }),
      }),
    ).rejects.toMatchObject({
      href: '/pro/bookings/booking_1/session',
    })

    expect(mocks.mediaAssetCount).not.toHaveBeenCalled()
    expect(mocks.mediaAssetFindMany).not.toHaveBeenCalled()
  })

  it('redirects to the session hub when booking has not started', async () => {
    await expect(
      renderPage({
        booking: makeBooking({
          startedAt: null,
          sessionStep: SessionStep.AFTER_PHOTOS,
        }),
      }),
    ).rejects.toMatchObject({
      href: '/pro/bookings/booking_1/session',
    })

    expect(mocks.mediaAssetCount).not.toHaveBeenCalled()
    expect(mocks.mediaAssetFindMany).not.toHaveBeenCalled()
  })

  it('returns not found when booking does not exist', async () => {
    await expect(
      renderPage({
        booking: null,
      }),
    ).rejects.toMatchObject({
      digest: 'NEXT_NOT_FOUND',
    })

    expect(mocks.mediaAssetCount).not.toHaveBeenCalled()
    expect(mocks.mediaAssetFindMany).not.toHaveBeenCalled()
  })

  it('redirects away when booking belongs to another professional', async () => {
    await expect(
      renderPage({
        booking: makeBooking({
          professionalId: 'other_pro',
        }),
      }),
    ).rejects.toMatchObject({
      href: '/pro',
    })

    expect(mocks.mediaAssetCount).not.toHaveBeenCalled()
    expect(mocks.mediaAssetFindMany).not.toHaveBeenCalled()
  })
})