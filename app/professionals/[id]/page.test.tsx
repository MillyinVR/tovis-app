import React from 'react'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Role, VerificationStatus } from '@prisma/client'

const mockNotFound = vi.hoisted(() => vi.fn(() => {
  throw new Error('NEXT_NOT_FOUND')
}))

const mockGetCurrentUser = vi.hoisted(() => vi.fn())

const mocks = vi.hoisted(() => ({
  prisma: {
    professionalProfile: {
      findUnique: vi.fn(),
    },
    review: {
      aggregate: vi.fn(),
    },
    professionalFavorite: {
      count: vi.fn(),
      findUnique: vi.fn(),
    },
    mediaAsset: {
      findMany: vi.fn(),
    },
    reviewHelpful: {
      findMany: vi.fn(),
    },
  },
}))

vi.mock('next/navigation', () => ({
  notFound: mockNotFound,
}))

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    ...rest
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & {
    href: string
    children: React.ReactNode
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: mocks.prisma,
}))

vi.mock('@/lib/currentUser', () => ({
  getCurrentUser: mockGetCurrentUser,
}))

vi.mock('@/app/pro/profile/ReviewsPanel', () => ({
  default: () => <div data-testid="reviews-panel">ReviewsPanel</div>,
}))

vi.mock('./FavoriteButton', () => ({
  default: () => <div data-testid="favorite-button">FavoriteButton</div>,
}))

vi.mock('./ShareButton', () => ({
  default: ({ url }: { url: string }) => <div data-testid="share-button">{url}</div>,
}))

vi.mock('./ServicesBookingOverlay', () => ({
  default: () => <div data-testid="services-booking-overlay">ServicesBookingOverlay</div>,
}))

vi.mock('@/lib/media/renderUrls', () => ({
  renderMediaUrls: vi.fn(async () => ({
    renderUrl: null,
    renderThumbUrl: null,
  })),
}))

vi.mock('@/lib/messages', () => ({
  messageStartHref: vi.fn(() => '/messages/start'),
}))

vi.mock('@/lib/timeZone', () => ({
  isValidIanaTimeZone: vi.fn(() => true),
}))

import PublicProfessionalProfilePage from './page'

function makePro(args?: {
  id?: string
  verificationStatus?: VerificationStatus
}) {
  return {
    id: args?.id ?? 'pro_1',
    userId: 'user_pro_1',
    verificationStatus: args?.verificationStatus ?? VerificationStatus.APPROVED,
    businessName: 'TOVIS Studio',
    bio: 'Trusted beauty pro.',
    avatarUrl: null,
    professionType: 'BARBER',
    location: 'San Diego, CA',
    timeZone: 'America/Los_Angeles',
    offerings: [],
    reviews: [],
  }
}

function makeOwnerViewer(args?: { professionalProfileId?: string }) {
  return {
    id: 'viewer_1',
    email: 'pro@example.com',
    phone: '+15551234567',
    role: Role.PRO,
    sessionKind: 'ACTIVE' as const,
    phoneVerifiedAt: new Date('2026-04-08T10:00:00.000Z'),
    emailVerifiedAt: new Date('2026-04-08T10:05:00.000Z'),
    isPhoneVerified: true,
    isEmailVerified: true,
    isFullyVerified: true,
    clientProfile: null,
    professionalProfile: {
      id: args?.professionalProfileId ?? 'pro_1',
      businessName: 'TOVIS Studio',
      handle: 'tovisstudio',
      avatarUrl: null,
      timeZone: 'America/Los_Angeles',
      location: 'San Diego, CA',
      phoneVerifiedAt: new Date('2026-04-08T10:00:00.000Z'),
      verificationStatus: VerificationStatus.PENDING,
    },
  }
}

async function renderPage(args?: {
  id?: string
  searchParams?: Record<string, string | string[] | undefined>
}) {
  const ui = await PublicProfessionalProfilePage({
    params: Promise.resolve({ id: args?.id ?? 'pro_1' }),
    ...(args?.searchParams
      ? { searchParams: Promise.resolve(args.searchParams) }
      : {}),
  })

  return render(ui)
}

describe('app/professionals/[id]/page', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mockGetCurrentUser.mockResolvedValue(null)

    mocks.prisma.professionalProfile.findUnique.mockResolvedValue(
      makePro({ verificationStatus: VerificationStatus.APPROVED }),
    )

    mocks.prisma.review.aggregate.mockResolvedValue({
      _count: { _all: 0 },
      _avg: { rating: null },
    })

    mocks.prisma.professionalFavorite.count.mockResolvedValue(0)
    mocks.prisma.professionalFavorite.findUnique.mockResolvedValue(null)
    mocks.prisma.mediaAsset.findMany.mockResolvedValue([])
    mocks.prisma.reviewHelpful.findMany.mockResolvedValue([])
  })

  it('shows the pending verification surface to non-owners when the pro is not approved', async () => {
    mocks.prisma.professionalProfile.findUnique.mockResolvedValue(
      makePro({ verificationStatus: VerificationStatus.PENDING }),
    )

    await renderPage()

    expect(
      screen.getByText('This profile is pending verification'),
    ).toBeInTheDocument()

    expect(
      screen.getByText(
        'We’re verifying the professional’s license and details. Check back soon.',
      ),
    ).toBeInTheDocument()

    expect(screen.getByRole('link', { name: /back to looks/i })).toHaveAttribute(
      'href',
      '/looks',
    )

    expect(mocks.prisma.review.aggregate).not.toHaveBeenCalled()
    expect(mocks.prisma.professionalFavorite.count).not.toHaveBeenCalled()
    expect(mocks.prisma.mediaAsset.findMany).not.toHaveBeenCalled()
  })

  it('allows the owner to preview their own pending profile', async () => {
    mockGetCurrentUser.mockResolvedValue(
      makeOwnerViewer({ professionalProfileId: 'pro_1' }),
    )

    mocks.prisma.professionalProfile.findUnique.mockResolvedValue(
      makePro({ id: 'pro_1', verificationStatus: VerificationStatus.PENDING }),
    )

    await renderPage()

    expect(
      screen.queryByText('This profile is pending verification'),
    ).not.toBeInTheDocument()

    expect(screen.getByText('TOVIS Studio')).toBeInTheDocument()
    expect(screen.getByText('No portfolio posts yet.')).toBeInTheDocument()

    expect(mocks.prisma.review.aggregate).toHaveBeenCalledWith({
      where: { professionalId: 'pro_1' },
      _count: { _all: true },
      _avg: { rating: true },
    })

    expect(mocks.prisma.professionalFavorite.count).toHaveBeenCalledWith({
      where: { professionalId: 'pro_1' },
    })
  })

  it('allows non-owners to view an approved public profile', async () => {
    mocks.prisma.professionalProfile.findUnique.mockResolvedValue(
      makePro({ verificationStatus: VerificationStatus.APPROVED }),
    )

    await renderPage()

    expect(
      screen.queryByText('This profile is pending verification'),
    ).not.toBeInTheDocument()

    expect(screen.getByText('TOVIS Studio')).toBeInTheDocument()
    expect(screen.getByTestId('share-button')).toHaveTextContent(
      '/professionals/pro_1',
    )
  })

  it('calls notFound when the professional profile does not exist', async () => {
    mocks.prisma.professionalProfile.findUnique.mockResolvedValue(null)

    await expect(renderPage()).rejects.toThrow('NEXT_NOT_FOUND')
    expect(mockNotFound).toHaveBeenCalled()
  })
})