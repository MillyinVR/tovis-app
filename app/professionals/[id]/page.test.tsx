import React from 'react'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  BookingStatus,
  MediaType,
  MediaVisibility,
  ProfessionType,
  Role,
  VerificationStatus,
} from '@prisma/client'

const mockNotFound = vi.hoisted(() =>
  vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND')
  }),
)

const mockGetCurrentUser = vi.hoisted(() => vi.fn())
const mockMessageStartHref = vi.hoisted(() => vi.fn(() => '/messages/start'))

const mocks = vi.hoisted(() => ({
  prisma: {
    professionalProfile: {
      findUnique: vi.fn(),
    },
    review: {
      aggregate: vi.fn(),
      findMany: vi.fn(),
    },
    professionalFavorite: {
      count: vi.fn(),
      findUnique: vi.fn(),
    },
    booking: {
      count: vi.fn(),
    },
    professionalServiceOffering: {
      findMany: vi.fn(),
    },
    mediaAsset: {
      findMany: vi.fn(),
    },
    reviewHelpful: {
      findMany: vi.fn(),
    },
  },
}))

type LinkMockProps = React.AnchorHTMLAttributes<HTMLAnchorElement> & {
  href: string
  children: React.ReactNode
}

type ProfileHeroMockProps = {
  header: {
    id: string
    displayName: string
    displayHandle: string | null
  }
  stats: {
    averageRatingLabel: string | null
    priceFromLabel: string | null
  }
  isClientViewer: boolean
  isFavoritedByMe: boolean
  messageHref: string
  servicesHref: string
}

type ProfileTabsMockProps = {
  tabs: Array<{
    id: string
    label: string
    href: string
  }>
  activeTab: string
}

type PortfolioGridMockProps = {
  tiles: Array<{ id: string }>
  emptyMessage: string
}

type ServicesPanelMockProps = {
  professionalId: string
  offerings: Array<{ id: string; name: string }>
  emptyMessage: string
}

type ReviewsSummaryMockProps = {
  reviews: Array<{ id: string }>
  emptyMessage: string
}

vi.mock('next/navigation', () => ({
  notFound: mockNotFound,
}))

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: LinkMockProps) => (
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

vi.mock('@/lib/messages', () => ({
  messageStartHref: mockMessageStartHref,
}))

vi.mock('@/lib/timeZone', () => ({
  isValidIanaTimeZone: vi.fn(() => true),
}))

vi.mock('./ProfileHero', () => ({
  default: ({
    header,
    stats,
    isClientViewer,
    isFavoritedByMe,
    messageHref,
    servicesHref,
  }: ProfileHeroMockProps) => (
    <section data-testid="profile-hero">
      <div>{header.displayName}</div>
      {header.displayHandle ? <div>{header.displayHandle}</div> : null}
      <div>rating:{stats.averageRatingLabel ?? 'none'}</div>
      <div>from:{stats.priceFromLabel ?? 'none'}</div>
      <div>client-viewer:{String(isClientViewer)}</div>
      <div>favorited:{String(isFavoritedByMe)}</div>
      <a href={messageHref}>Message</a>
      <a href={servicesHref}>Book now</a>
    </section>
  ),
}))

vi.mock('./ProfileTabs', () => ({
  default: ({ tabs, activeTab }: ProfileTabsMockProps) => (
    <nav data-testid="profile-tabs">
      <div>active-tab:{activeTab}</div>
      {tabs.map((tab) => (
        <a key={tab.id} href={tab.href}>
          {tab.label}
        </a>
      ))}
    </nav>
  ),
}))

vi.mock('./PortfolioGrid', () => ({
  default: ({ tiles, emptyMessage }: PortfolioGridMockProps) => (
    <section data-testid="portfolio-grid">
      <div>portfolio-count:{tiles.length}</div>
      {tiles.length === 0 ? <div>{emptyMessage}</div> : null}
    </section>
  ),
}))

vi.mock('./ServicesPanel', () => ({
  default: ({
    professionalId,
    offerings,
    emptyMessage,
  }: ServicesPanelMockProps) => (
    <section data-testid="services-panel">
      <div>professional-id:{professionalId}</div>
      <div>services-count:{offerings.length}</div>
      {offerings.length === 0 ? <div>{emptyMessage}</div> : null}
      {offerings.map((offering) => (
        <div key={offering.id}>{offering.name}</div>
      ))}
    </section>
  ),
}))

vi.mock('./ReviewsSummary', () => ({
  default: ({ reviews, emptyMessage }: ReviewsSummaryMockProps) => (
    <section data-testid="reviews-summary">
      <div>reviews-count:{reviews.length}</div>
      {reviews.length === 0 ? <div>{emptyMessage}</div> : null}
    </section>
  ),
}))

vi.mock('@/lib/media/renderUrls', () => ({
  renderMediaUrls: vi.fn(async () => ({
    renderUrl: null,
    renderThumbUrl: null,
  })),
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
    handle: 'tovisstudio',
    isPremium: true,
    businessName: 'TOVIS Studio',
    bio: 'Trusted beauty pro.',
    avatarUrl: null,
    professionType: ProfessionType.BARBER,
    location: 'San Diego, CA',
    timeZone: 'America/Los_Angeles',
  }
}

function makeOwnerViewer(args?: { professionalProfileId?: string }) {
  return {
    id: 'viewer_pro_1',
    email: 'pro@example.com',
    phone: '+15551234567',
    role: Role.PRO,
    sessionKind: 'ACTIVE',
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

function makeClientViewer() {
  return {
    id: 'client_user_1',
    email: 'client@example.com',
    phone: '+15550001111',
    role: Role.CLIENT,
    sessionKind: 'ACTIVE',
    phoneVerifiedAt: new Date('2026-04-08T10:00:00.000Z'),
    emailVerifiedAt: new Date('2026-04-08T10:05:00.000Z'),
    isPhoneVerified: true,
    isEmailVerified: true,
    isFullyVerified: true,
    professionalProfile: null,
    clientProfile: {
      id: 'client_profile_1',
      firstName: 'Client',
      lastName: 'Person',
      avatarUrl: null,
    },
  }
}

function makeOffering() {
  return {
    id: 'offering_1',
    professionalId: 'pro_1',
    serviceId: 'service_1',
    title: 'Signature Cut',
    description: 'Clean cut and style.',
    customImageUrl: null,
    salonPriceStartingAt: '80.00',
    salonDurationMinutes: 60,
    mobilePriceStartingAt: null,
    mobileDurationMinutes: null,
    offersInSalon: true,
    offersMobile: false,
    isActive: true,
    service: {
      id: 'service_1',
      name: 'Haircut',
      defaultImageUrl: null,
    },
  }
}

function makePortfolioMedia() {
  return {
    id: 'media_1',
    professionalId: 'pro_1',
    caption: 'Fresh fade',
    mediaType: MediaType.IMAGE,
    visibility: MediaVisibility.PUBLIC,
    isEligibleForLooks: true,
    isFeaturedInPortfolio: true,
    storageBucket: null,
    storagePath: null,
    thumbBucket: null,
    thumbPath: null,
    url: '/portfolio/fresh-fade.jpg',
    thumbUrl: null,
    services: [{ serviceId: 'service_1' }],
  }
}

function makeReview() {
  return {
    id: 'review_1',
    rating: 5,
    headline: 'Amazing',
    body: 'Loved it.',
    createdAt: new Date('2026-04-08T10:00:00.000Z'),
    helpfulCount: 2,
    client: {
      firstName: 'Jane',
      lastName: 'Client',
      user: {
        email: 'jane@example.com',
      },
    },
    mediaAssets: [],
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
    mockMessageStartHref.mockReturnValue('/messages/start')

    mocks.prisma.professionalProfile.findUnique.mockResolvedValue(
      makePro({ verificationStatus: VerificationStatus.APPROVED }),
    )

    mocks.prisma.review.aggregate.mockResolvedValue({
      _count: { _all: 0 },
      _avg: { rating: null },
    })

    mocks.prisma.professionalFavorite.count.mockResolvedValue(0)
    mocks.prisma.professionalFavorite.findUnique.mockResolvedValue(null)
    mocks.prisma.booking.count.mockResolvedValue(0)
    mocks.prisma.professionalServiceOffering.findMany.mockResolvedValue([])
    mocks.prisma.mediaAsset.findMany.mockResolvedValue([])
    mocks.prisma.review.findMany.mockResolvedValue([])
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
    expect(mocks.prisma.booking.count).not.toHaveBeenCalled()
    expect(
      mocks.prisma.professionalServiceOffering.findMany,
    ).not.toHaveBeenCalled()
    expect(mocks.prisma.mediaAsset.findMany).not.toHaveBeenCalled()
    expect(mocks.prisma.review.findMany).not.toHaveBeenCalled()
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

    expect(screen.getByTestId('profile-hero')).toHaveTextContent('TOVIS Studio')
    expect(screen.getByText('@tovisstudio')).toBeInTheDocument()
    expect(screen.getByTestId('profile-tabs')).toHaveTextContent(
      'active-tab:portfolio',
    )
    expect(screen.getByTestId('portfolio-grid')).toHaveTextContent(
      'portfolio-count:0',
    )
    expect(screen.getByText('No portfolio posts yet.')).toBeInTheDocument()

    expect(mocks.prisma.review.aggregate).toHaveBeenCalledWith({
      where: { professionalId: 'pro_1' },
      _count: { _all: true },
      _avg: { rating: true },
    })

    expect(mocks.prisma.professionalFavorite.count).toHaveBeenCalledWith({
      where: { professionalId: 'pro_1' },
    })

    expect(mocks.prisma.booking.count).toHaveBeenCalledWith({
      where: {
        professionalId: 'pro_1',
        status: BookingStatus.COMPLETED,
      },
    })

    expect(mocks.prisma.professionalFavorite.findUnique).not.toHaveBeenCalled()
  })

  it('allows guests to view an approved public profile and sends messages through login', async () => {
    await renderPage()

    expect(
      screen.queryByText('This profile is pending verification'),
    ).not.toBeInTheDocument()

    expect(screen.getByTestId('profile-hero')).toHaveTextContent('TOVIS Studio')
    expect(screen.getByRole('link', { name: 'Message' })).toHaveAttribute(
      'href',
      '/login?from=%2Fprofessionals%2Fpro_1',
    )
    expect(screen.getByRole('link', { name: 'Book now' })).toHaveAttribute(
      'href',
      '/professionals/pro_1?tab=services',
    )
  })

  it('checks whether a client viewer has favorited the professional', async () => {
    mockGetCurrentUser.mockResolvedValue(makeClientViewer())

    mocks.prisma.professionalFavorite.findUnique.mockResolvedValue({
      id: 'favorite_1',
    })

    await renderPage()

    expect(mocks.prisma.professionalFavorite.findUnique).toHaveBeenCalledWith({
      where: {
        professionalId_userId: {
          professionalId: 'pro_1',
          userId: 'client_user_1',
        },
      },
      select: { id: true },
    })

    expect(screen.getByTestId('profile-hero')).toHaveTextContent(
      'client-viewer:true',
    )
    expect(screen.getByTestId('profile-hero')).toHaveTextContent(
      'favorited:true',
    )
  })

  it('loads portfolio rows only for the portfolio tab', async () => {
    mocks.prisma.mediaAsset.findMany.mockResolvedValue([makePortfolioMedia()])

    await renderPage()

    expect(mocks.prisma.mediaAsset.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          professionalId: 'pro_1',
          visibility: MediaVisibility.PUBLIC,
          isFeaturedInPortfolio: true,
        },
        orderBy: { createdAt: 'desc' },
      }),
    )

    expect(screen.getByTestId('portfolio-grid')).toHaveTextContent(
      'portfolio-count:1',
    )
    expect(screen.queryByTestId('services-panel')).not.toBeInTheDocument()
    expect(screen.queryByTestId('reviews-summary')).not.toBeInTheDocument()
  })

  it('renders services tab with active offerings and does not load portfolio media', async () => {
    mocks.prisma.professionalServiceOffering.findMany.mockResolvedValue([
      makeOffering(),
    ])

    await renderPage({
      searchParams: { tab: 'services' },
    })

    expect(screen.getByTestId('profile-tabs')).toHaveTextContent(
      'active-tab:services',
    )
    expect(screen.getByTestId('services-panel')).toHaveTextContent(
      'services-count:1',
    )
    expect(screen.getByText('Signature Cut')).toBeInTheDocument()

    expect(mocks.prisma.mediaAsset.findMany).not.toHaveBeenCalled()
    expect(mocks.prisma.review.findMany).not.toHaveBeenCalled()
  })

  it('renders reviews tab and loads helpful state for client viewers', async () => {
    mockGetCurrentUser.mockResolvedValue(makeClientViewer())

    mocks.prisma.review.aggregate.mockResolvedValue({
      _count: { _all: 1 },
      _avg: { rating: 5 },
    })
    mocks.prisma.review.findMany.mockResolvedValue([makeReview()])
    mocks.prisma.reviewHelpful.findMany.mockResolvedValue([
      { reviewId: 'review_1' },
    ])

    await renderPage({
      searchParams: { tab: 'reviews' },
    })

    expect(screen.getByTestId('profile-tabs')).toHaveTextContent(
      'active-tab:reviews',
    )
    expect(mocks.prisma.review.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { professionalId: 'pro_1' },
        orderBy: { createdAt: 'desc' },
      }),
    )
    expect(mocks.prisma.reviewHelpful.findMany).toHaveBeenCalledWith({
      where: {
        userId: 'client_user_1',
        reviewId: {
          in: ['review_1'],
        },
      },
      select: { reviewId: true },
    })
    expect(screen.getByTestId('reviews-summary')).toHaveTextContent(
      'reviews-count:1',
    )

    expect(mocks.prisma.mediaAsset.findMany).not.toHaveBeenCalled()
  })

  it('calls notFound when the professional profile does not exist', async () => {
    mocks.prisma.professionalProfile.findUnique.mockResolvedValue(null)

    await expect(renderPage()).rejects.toThrow('NEXT_NOT_FOUND')
    expect(mockNotFound).toHaveBeenCalled()
  })
})