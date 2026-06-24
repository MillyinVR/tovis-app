import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  BookingStatus,
  ConsultationApprovalStatus,
  MediaPhase,
  SessionStep,
} from '@prisma/client'

const mocks = vi.hoisted(() => ({
  bookingFindUnique: vi.fn(),
  mediaAssetFindMany: vi.fn(),
  renderMediaUrls: vi.fn(),
  getCurrentUser: vi.fn(),
  transitionSessionStep: vi.fn(),

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
      findMany: mocks.mediaAssetFindMany,
    },
  },
}))

vi.mock('@/lib/media/renderUrls', () => ({
  renderMediaUrls: mocks.renderMediaUrls,
}))

vi.mock('@/lib/booking/writeBoundary', () => ({
  transitionSessionStep: mocks.transitionSessionStep,
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

import ProBeforePhotosPage from './page'

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
    },
  }
}

function makeBooking(overrides?: {
  professionalId?: string
  status?: BookingStatus
  startedAt?: Date | null
  finishedAt?: Date | null
  sessionStep?: SessionStep | null
  approvalStatus?: ConsultationApprovalStatus | null
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
        : SessionStep.BEFORE_PHOTOS,

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

    consultationApproval:
      overrides && 'approvalStatus' in overrides
        ? overrides.approvalStatus
          ? { status: overrides.approvalStatus }
          : null
        : { status: ConsultationApprovalStatus.APPROVED },
  }
}

function makeMediaRow(overrides?: { id?: string }) {
  return {
    id: overrides?.id ?? 'media_before_1',
    mediaType: 'IMAGE' as const,
    visibility: 'PRO_CLIENT',
    phase: MediaPhase.BEFORE,
    caption: 'Before photo',
    createdAt: new Date('2026-04-12T18:30:00.000Z'),
    reviewId: null,
    isEligibleForLooks: false,
    isFeaturedInPortfolio: false,
    storageBucket: 'media-private',
    storagePath: 'bookings/booking_1/before/main.jpg',
    thumbBucket: null,
    thumbPath: null,
    url: null,
    thumbUrl: null,
  }
}

async function renderPage(args?: {
  booking?: ReturnType<typeof makeBooking> | null
  mediaRows?: Array<ReturnType<typeof makeMediaRow>>
}) {
  // The page loads the booking once for its own guards and the shared
  // listProBookingMedia path re-checks ownership, so both reads see the
  // same row.
  mocks.bookingFindUnique.mockResolvedValue(
    args && 'booking' in args ? args.booking : makeBooking(),
  )

  mocks.mediaAssetFindMany.mockResolvedValue(args?.mediaRows ?? [])

  return ProBeforePhotosPage({
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

describe('app/pro/bookings/[id]/session/before-photos/page.tsx', () => {
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
      renderUrl: '/signed/before.jpg',
      renderThumbUrl: null,
    })
  })

  it('redirects to login when no pro user is available', async () => {
    mocks.getCurrentUser.mockResolvedValueOnce(null)

    await expect(
      ProBeforePhotosPage({
        params: Promise.resolve({ id: 'booking_1' }),
      }),
    ).rejects.toMatchObject({
      href: '/login?from=%2Fpro%2Fbookings%2Fbooking_1%2Fsession%2Fbefore-photos',
    })

    expect(mocks.bookingFindUnique).not.toHaveBeenCalled()
  })

  it('renders the upload UI with media from the shared listing path when the consultation is approved', async () => {
    const page = await renderPage({
      booking: makeBooking({
        sessionStep: SessionStep.BEFORE_PHOTOS,
        approvalStatus: ConsultationApprovalStatus.APPROVED,
      }),
      mediaRows: [makeMediaRow()],
    })

    expect(hasText(page, 'Before photos')).toBe(true)
    expect(hasText(page, 'CONSULTATION APPROVED')).toBe(true)
    expect(hasText(page, 'Before photos saved')).toBe(true)
    expect(hasText(page, 'Continue to service')).toBe(true)
    expect(hasText(page, 'Take or upload before photos')).toBe(true)
    expect(hasText(page, 'MediaUploader:BEFORE')).toBe(true)
    expect(hasText(page, 'for you and')).toBe(true)

    const uploaders = findElementsByTestId(page, 'media-uploader')
    expect(uploaders).toHaveLength(1)
    expect(uploaders[0]?.props['data-booking-id']).toBe('booking_1')
    expect(uploaders[0]?.props['data-phase']).toBe('BEFORE')

    expect(mocks.mediaAssetFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          bookingId: 'booking_1',
          phase: MediaPhase.BEFORE,
        },
      }),
    )

    const grids = findElementsByTestId(page, 'media-preview-grid')
    expect(grids).toHaveLength(1)
    expect(grids[0]?.props['data-count']).toBe('1')
  })

  it('keeps the service locked while the consultation is pending', async () => {
    const page = await renderPage({
      booking: makeBooking({
        sessionStep: SessionStep.BEFORE_PHOTOS,
        approvalStatus: ConsultationApprovalStatus.PENDING,
      }),
      mediaRows: [makeMediaRow()],
    })

    expect(hasText(page, 'WAITING ON APPROVAL')).toBe(true)
    expect(hasText(page, 'Before photos saved')).toBe(true)
    expect(
      hasText(page, 'Client still needs to approve the consultation'),
    ).toBe(true)
    expect(hasText(page, 'Continue to service')).toBe(false)
  })

  it('redirects to the session hub when session step is past before photos', async () => {
    await expect(
      renderPage({
        booking: makeBooking({
          sessionStep: SessionStep.SERVICE_IN_PROGRESS,
        }),
      }),
    ).rejects.toMatchObject({
      href: '/pro/bookings/booking_1/session',
    })

    expect(mocks.mediaAssetFindMany).not.toHaveBeenCalled()
  })

  it('redirects to the session hub when booking has not started', async () => {
    await expect(
      renderPage({
        booking: makeBooking({
          startedAt: null,
        }),
      }),
    ).rejects.toMatchObject({
      href: '/pro/bookings/booking_1/session',
    })

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

    expect(mocks.mediaAssetFindMany).not.toHaveBeenCalled()
  })
})
