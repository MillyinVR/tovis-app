import React from 'react'
import { screen } from '@testing-library/react'
import { renderWithBrand as render } from '@/test/renderWithBrand'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  BookingStatus,
  MediaType,
  MediaVisibility,
  ProfessionType,
  Role,
  VerificationStatus,
} from '@prisma/client'

import { proOwnPublicLooksWhere } from '@/lib/looks/selects'

// PublicProfileView holds the full public-profile render + data loading. It is
// rendered by both `/professionals/[id]` and the `/p/[handle]` vanity route, so
// these tests exercise the shared surface directly (the route pages just resolve
// an id and delegate — see their own thin tests).

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
    professionalSubscription: {
      findUnique: vi.fn(),
    },
    booking: {
      count: vi.fn(),
      groupBy: vi.fn(),
      // Reviews now load on EVERY profile view (one payload), so the reviewer
      // link-visibility read runs for a PRO viewer too.
      findMany: vi.fn(),
    },
    professionalAvailabilityStat: {
      findUnique: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
    },
    proFollow: {
      count: vi.fn(),
    },
    lookPost: {
      count: vi.fn(),
      findFirst: vi.fn(),
    },
    professionalServiceOffering: {
      findMany: vi.fn(),
    },
    professionalPaymentSettings: {
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

type LinkMockProps = React.AnchorHTMLAttributes<HTMLAnchorElement> & {
  href: string
  children: React.ReactNode
}

type IdentityRailMockProps = {
  header: {
    id: string
    displayName: string
    displayHandle: string | null
  }
  isClientViewer: boolean
  isFavoritedByMe: boolean
  messageHref: string
  signals: { chips: Array<{ kind: string; label: string }> }
}

type PortfolioFeedMockProps = {
  tiles: Array<{ id: string }>
  emptyMessage: string
}

type SignatureCardMockProps = {
  signature: { tile: { lookId: string | null }; priceLine: string | null }
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

// The identity rail pulls in the follow/favorite/share client components and
// the maps helper; the surface under test here is the page's composition, so it
// is mocked down to the props that composition decides.
vi.mock('./ProfileIdentityRail', () => ({
  default: ({
    header,
    isClientViewer,
    isFavoritedByMe,
    messageHref,
    signals,
  }: IdentityRailMockProps) => (
    <section data-testid="identity-rail">
      <div>{header.displayName}</div>
      {header.displayHandle ? <div>{header.displayHandle}</div> : null}
      <div>client-viewer:{String(isClientViewer)}</div>
      <div>favorited:{String(isFavoritedByMe)}</div>
      <div>chips:{signals.chips.map((chip) => chip.label).join('|') || 'none'}</div>
      <a href={messageHref}>Message</a>
    </section>
  ),
}))

vi.mock('./PortfolioFeed', () => ({
  default: ({ tiles, emptyMessage }: PortfolioFeedMockProps) => (
    <section data-testid="portfolio-grid">
      <div>portfolio-count:{tiles.length}</div>
      {tiles.length === 0 ? <div>{emptyMessage}</div> : null}
    </section>
  ),
}))

vi.mock('./SignatureCard', () => ({
  default: ({ signature }: SignatureCardMockProps) => (
    <section data-testid="signature-card">
      <div>signature-look:{signature.tile.lookId ?? 'none'}</div>
      <div>signature-price:{signature.priceLine ?? 'none'}</div>
    </section>
  ),
}))

vi.mock('../ServicesPanel', () => ({
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

vi.mock('../ReviewsSummary', () => ({
  default: ({ reviews, emptyMessage }: ReviewsSummaryMockProps) => (
    <section data-testid="reviews-summary">
      <div>reviews-count:{reviews.length}</div>
      {reviews.length === 0 ? <div>{emptyMessage}</div> : null}
    </section>
  ),
}))

vi.mock('@/lib/tenant/layoutContext', () => ({
  resolveTenantContextForLayout: vi.fn(async () => ({
    kind: 'ROOT',
    tenantId: 'tenant_root',
  })),
}))

vi.mock('@/lib/media/renderUrls', () => ({
  renderMediaUrls: vi.fn(async () => ({
    renderUrl: null,
    renderThumbUrl: null,
  })),
}))

import PublicProfileView from './PublicProfileView'

function makePro(args?: {
  id?: string
  verificationStatus?: VerificationStatus
  // §19c — the portfolio grid now reads the pro's LookPosts through the owner
  // relation (`professionalProfile.lookPosts`), so the profile mock carries them.
  lookPosts?: unknown[]
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
    lookPosts: args?.lookPosts ?? [],
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
    services: [{ serviceId: 'service_1', service: { name: 'Balayage' } }],
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

async function renderView(args?: {
  id?: string
  searchParams?: Record<string, string | string[] | undefined>
}) {
  const ui = await PublicProfileView({
    id: args?.id ?? 'pro_1',
    searchParams: args?.searchParams,
  })

  return render(ui)
}

/** Which tab the real (unmocked) ProfileBody has selected. */
function activeTabName(): string | null {
  const selected = document.querySelector('[role="tab"][aria-selected="true"]')
  return selected?.id.replace('pp-tab-', '') ?? null
}

/** Whether a panel is present-but-hidden (the in-place switch) vs rendered. */
function panelHidden(tab: string): boolean {
  const panel = document.getElementById(`pp-panel-${tab}`)
  if (!panel) throw new Error(`panel ${tab} not rendered`)
  return panel.hasAttribute('hidden')
}

describe('app/professionals/[id] PublicProfileView', () => {
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
    mocks.prisma.professionalSubscription.findUnique.mockResolvedValue(null)
    mocks.prisma.booking.count.mockResolvedValue(0)
    mocks.prisma.proFollow.count.mockResolvedValue(0)
    mocks.prisma.lookPost.count.mockResolvedValue(0)
    mocks.prisma.professionalServiceOffering.findMany.mockResolvedValue([])
    mocks.prisma.professionalPaymentSettings.findUnique.mockResolvedValue(null)
    mocks.prisma.mediaAsset.findMany.mockResolvedValue([])
    mocks.prisma.review.findMany.mockResolvedValue([])
    mocks.prisma.reviewHelpful.findMany.mockResolvedValue([])
    mocks.prisma.lookPost.findFirst.mockResolvedValue(null)
    mocks.prisma.booking.groupBy.mockResolvedValue([])
    mocks.prisma.booking.findMany.mockResolvedValue([])
    // No availability row = the pro is booked out over the scan horizon, and an
    // account created long ago = not new. Both signals off by default.
    mocks.prisma.professionalAvailabilityStat.findUnique.mockResolvedValue(null)
    mocks.prisma.user.findUnique.mockResolvedValue({
      createdAt: new Date('2020-01-01T00:00:00.000Z'),
    })
  })

  it('shows the pending verification surface to non-owners when the pro is not approved', async () => {
    mocks.prisma.professionalProfile.findUnique.mockResolvedValue(
      makePro({ verificationStatus: VerificationStatus.PENDING }),
    )

    await renderView()

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
    // §19c — a non-viewable pro loads no tab content (portfolio/reviews) at all.
    expect(mocks.prisma.review.findMany).not.toHaveBeenCalled()
  })

  it('allows the owner to preview their own pending profile', async () => {
    mockGetCurrentUser.mockResolvedValue(
      makeOwnerViewer({ professionalProfileId: 'pro_1' }),
    )

    mocks.prisma.professionalProfile.findUnique.mockResolvedValue(
      makePro({ id: 'pro_1', verificationStatus: VerificationStatus.PENDING }),
    )

    await renderView()

    expect(
      screen.queryByText('This profile is pending verification'),
    ).not.toBeInTheDocument()

    expect(screen.getByTestId('identity-rail')).toHaveTextContent('TOVIS Studio')
    expect(screen.getAllByText('@tovisstudio').length).toBeGreaterThan(0)
    expect(activeTabName()).toBe('portfolio')
    expect(screen.getByTestId('portfolio-grid')).toHaveTextContent(
      'portfolio-count:0',
    )
    expect(screen.getByText('No portfolio posts yet.')).toBeInTheDocument()

    expect(mocks.prisma.review.aggregate).toHaveBeenCalledWith({
      where: { professionalId: 'pro_1', hiddenAt: null },
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
    await renderView()

    expect(
      screen.queryByText('This profile is pending verification'),
    ).not.toBeInTheDocument()

    expect(screen.getByTestId('identity-rail')).toHaveTextContent('TOVIS Studio')
    expect(screen.getByRole('link', { name: 'Message' })).toHaveAttribute(
      'href',
      '/login?from=%2Fprofessionals%2Fpro_1',
    )

    // 🔴 The hero "Book now" is GONE. Booking lives in exactly two quiet
    // places, and the top of the identity rail is not one of them.
    expect(screen.queryByRole('link', { name: 'Book now' })).toBeNull()

    // A signed-out viewer keeps the time-slot promise on the bar.
    expect(
      screen.getByText('You can pick a time before signing in'),
    ).toBeInTheDocument()
  })

  it('renders all three panels in ONE payload and shows only the active one', async () => {
    mocks.prisma.professionalServiceOffering.findMany.mockResolvedValue([
      makeOffering(),
    ])

    await renderView()

    // Every panel is in the tree — the tabs switch in place, they do not fetch.
    expect(screen.getByTestId('portfolio-grid')).toBeInTheDocument()
    expect(screen.getByTestId('services-panel')).toBeInTheDocument()
    expect(screen.getByTestId('reviews-summary')).toBeInTheDocument()

    expect(panelHidden('portfolio')).toBe(false)
    expect(panelHidden('services')).toBe(true)
    expect(panelHidden('reviews')).toBe(true)

    // ...and the reviews read happened up front rather than on a tab visit.
    expect(mocks.prisma.review.findMany).toHaveBeenCalled()
  })

  it('renders no Signature block when the pro has not chosen one', async () => {
    await renderView()

    expect(screen.queryByTestId('signature-card')).toBeNull()
    expect(mocks.prisma.lookPost.findFirst).not.toHaveBeenCalled()
  })

  it('shows the brand-new-pro chips ONLY for a pro new to the platform', async () => {
    // Established pro (default fixture): no chips at all, by design.
    await renderView()
    expect(screen.getByTestId('identity-rail')).toHaveTextContent('chips:none')
  })

  it('checks whether a client viewer has favorited the professional', async () => {
    mockGetCurrentUser.mockResolvedValue(makeClientViewer())

    mocks.prisma.professionalFavorite.findUnique.mockResolvedValue({
      id: 'favorite_1',
    })

    await renderView()

    expect(mocks.prisma.professionalFavorite.findUnique).toHaveBeenCalledWith({
      where: {
        professionalId_userId: {
          professionalId: 'pro_1',
          userId: 'client_user_1',
        },
      },
      select: { id: true },
    })

    expect(screen.getByTestId('identity-rail')).toHaveTextContent(
      'client-viewer:true',
    )
    expect(screen.getByTestId('identity-rail')).toHaveTextContent(
      'favorited:true',
    )
  })

  it("loads the pro's LookPosts (owner relation) for the portfolio tab", async () => {
    // §19c — the grid tile still renders from the look's primaryMediaAsset.
    mocks.prisma.professionalProfile.findUnique.mockResolvedValue(
      makePro({
        verificationStatus: VerificationStatus.APPROVED,
        lookPosts: [
          {
            id: 'look_1',
            publishedAt: new Date('2026-04-08T10:00:00.000Z'),
            primaryMediaAsset: makePortfolioMedia(),
          },
        ],
      }),
    )

    await renderView()

    // Owner-relation read gated to APPROVED, pro-authored, public looks.
    expect(mocks.prisma.professionalProfile.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'pro_1' },
        select: expect.objectContaining({
          lookPosts: expect.objectContaining({
            where: proOwnPublicLooksWhere,
            orderBy: { publishedAt: 'desc' },
          }),
        }),
      }),
    )

    expect(screen.getByTestId('portfolio-grid')).toHaveTextContent(
      'portfolio-count:1',
    )
    // The other panels are rendered too (one payload) — just not shown.
    expect(panelHidden('services')).toBe(true)
    expect(panelHidden('reviews')).toBe(true)
  })

  it('renders services tab with active offerings and does not load portfolio media', async () => {
    mocks.prisma.professionalServiceOffering.findMany.mockResolvedValue([
      makeOffering(),
    ])

    await renderView({
      searchParams: { tab: 'services' },
    })

    // `?tab=` still picks the INITIAL tab, so every existing shared link lands
    // where it always did — it just no longer decides what gets fetched.
    expect(activeTabName()).toBe('services')
    expect(screen.getByTestId('services-panel')).toHaveTextContent(
      'services-count:1',
    )
    expect(screen.getByText('Signature Cut')).toBeInTheDocument()
    expect(panelHidden('portfolio')).toBe(true)
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

    await renderView({
      searchParams: { tab: 'reviews' },
    })

    expect(activeTabName()).toBe('reviews')
    expect(mocks.prisma.review.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { professionalId: 'pro_1', hiddenAt: null },
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

    await expect(renderView()).rejects.toThrow('NEXT_NOT_FOUND')
    expect(mockNotFound).toHaveBeenCalled()
  })
})
