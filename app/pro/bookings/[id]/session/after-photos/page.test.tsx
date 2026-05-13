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
  getCurrentUser: vi.fn(),
  headers: vi.fn(),
  fetch: vi.fn(),

  redirect: vi.fn(),
  notFound: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  redirect: mocks.redirect,
  notFound: mocks.notFound,
}))

vi.mock('next/headers', () => ({
  headers: mocks.headers,
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
    },
  },
}))

vi.mock('@/lib/serverOrigin', () => ({
  getServerOrigin: vi.fn().mockResolvedValue('http://localhost:3000'),
}))

vi.mock('../_components/MediaPreviewGrid', () => ({
  default: ({
    items,
    title,
  }: {
    items: Array<{ id: string }>
    title: string
  }) =>
    React.createElement(
      'div',
      {
        'data-testid': 'media-preview-grid',
        'data-title': title,
        'data-count': String(items.length),
      },
      title,
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

async function renderPage(args?: {
  booking?: ReturnType<typeof makeBooking> | null
  afterCount?: number
  mediaItems?: Array<{
    id: string
    mediaType: 'IMAGE' | 'VIDEO'
    caption: string | null
    createdAt: string
    renderUrl: string | null
    renderThumbUrl: string | null
    reviewId: string | null
  }>
}) {
  mocks.bookingFindUnique.mockResolvedValueOnce(
    args && 'booking' in args ? args.booking : makeBooking(),
  )

  mocks.mediaAssetCount.mockResolvedValueOnce(args?.afterCount ?? 0)

  mocks.fetch.mockResolvedValueOnce({
    ok: true,
    json: async () => ({
      items: args?.mediaItems ?? [],
    }),
  })

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

    mocks.headers.mockResolvedValue({
      get: (name: string) => {
        return name.toLowerCase() === 'cookie'
          ? 'session=test-session'
          : null
      },
    })

    global.fetch = mocks.fetch
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
      mediaItems: [
        {
          id: 'media_after_1',
          mediaType: 'IMAGE',
          caption: 'After photo',
          createdAt: '2026-04-12T19:00:00.000Z',
          renderUrl: '/signed/after.jpg',
          renderThumbUrl: null,
          reviewId: null,
        },
      ],
    })

    expect(hasText(page, 'After photos')).toBe(true)
    expect(hasText(page, 'WRAP-UP · AFTER PHOTOS')).toBe(true)
    expect(hasText(page, 'After photos saved')).toBe(true)
    expect(hasText(page, 'Continue to aftercare')).toBe(true)
    expect(hasText(page, 'Upload after photos')).toBe(true)
    expect(hasText(page, 'MediaUploader:AFTER')).toBe(true)

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
  })

  it('redirects to the session hub when session step is FINISH_REVIEW', async () => {
    await expect(
      renderPage({
        booking: makeBooking({
          sessionStep: SessionStep.FINISH_REVIEW,
        }),
      }),
    ).rejects.toMatchObject({
      href: '/pro/bookings/booking_1/session',
    })

    expect(mocks.mediaAssetCount).not.toHaveBeenCalled()
    expect(mocks.fetch).not.toHaveBeenCalled()
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
    expect(mocks.fetch).not.toHaveBeenCalled()
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
    expect(mocks.fetch).not.toHaveBeenCalled()
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
    expect(mocks.fetch).not.toHaveBeenCalled()
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
    expect(mocks.fetch).not.toHaveBeenCalled()
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
    expect(mocks.fetch).not.toHaveBeenCalled()
  })
})