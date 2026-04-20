// app/client/page.test.tsx
import type { ReactNode } from 'react'
import { render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  redirect: vi.fn((href: string) => {
    throw new Error(`NEXT_REDIRECT:${href}`)
  }),

  getCurrentUser: vi.fn(),
  getBrandConfig: vi.fn(),

  prisma: {
    professionalFavorite: {
      findMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    serviceFavorite: {
      findMany: vi.fn(),
    },
    review: {
      findMany: vi.fn(),
    },
  },

  savedServicesProps: [] as Array<
    Array<{
      id: string
      name: string
      description: string | null
      defaultImageUrl: string | null
      categoryName: string | null
      categorySlug: string | null
    }>
  >,
}))

vi.mock('next/navigation', () => ({
  redirect: mocks.redirect,
}))

vi.mock('next/link', () => ({
  default: function MockLink({
    href,
    children,
    ...rest
  }: {
    href: string
    children: ReactNode
  }) {
    return (
      <a href={href} {...rest}>
        {children}
      </a>
    )
  },
}))

vi.mock('@/lib/currentUser', () => ({
  getCurrentUser: mocks.getCurrentUser,
}))

vi.mock('@/lib/brand', () => ({
  getBrandConfig: mocks.getBrandConfig,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: mocks.prisma,
}))

vi.mock('@/lib/viralRequests', () => {
  throw new Error(
    'app/client/page.tsx should not import @/lib/viralRequests directly',
  )
})

vi.mock('@/lib/viralRequests/status', () => {
  throw new Error(
    'app/client/page.tsx should not import @/lib/viralRequests/status directly',
  )
})

vi.mock('./components/ClientViralRequestsPanel', () => ({
  default: function MockClientViralRequestsPanel() {
    return (
      <div data-testid="client-viral-requests-panel">
        ClientViralRequestsPanel
      </div>
    )
  },
}))

vi.mock('./components/LogoutButton', () => ({
  default: function MockLogoutButton() {
    return <div data-testid="logout-button">LogoutButton</div>
  },
}))

vi.mock('./components/LastMinuteOpenings', () => ({
  default: function MockLastMinuteOpenings() {
    return <div data-testid="last-minute-openings">LastMinuteOpenings</div>
  },
}))

vi.mock('./components/PendingConsultApprovalBanner', () => ({
  default: function MockPendingConsultApprovalBanner() {
    return (
      <div data-testid="pending-consult-approval-banner">
        PendingConsultApprovalBanner
      </div>
    )
  },
}))

vi.mock('./components/SavedServicesWithProviders', () => ({
  default: function MockSavedServicesWithProviders({
    services,
  }: {
    services: Array<{
      id: string
      name: string
      description: string | null
      defaultImageUrl: string | null
      categoryName: string | null
      categorySlug: string | null
    }>
  }) {
    mocks.savedServicesProps.push(services)

    return (
      <div data-testid="saved-services-with-providers">
        SavedServicesWithProviders
      </div>
    )
  },
}))

import ClientHomePage from './page'

function requireSection(label: string): HTMLElement {
  const labelNode = screen.getByText(label)
  const section = labelNode.closest('section')

  if (!section) {
    throw new Error(`Expected "${label}" to be inside a section.`)
  }

  return section
}

describe('app/client/page.tsx', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.savedServicesProps.length = 0

    mocks.getBrandConfig.mockReturnValue({
      assets: {
        wordmark: {
          text: 'TOVIS',
        },
      },
    })

    mocks.getCurrentUser.mockResolvedValue({
      id: 'user_1',
      role: 'CLIENT',
      email: 'tori@example.com',
      clientProfile: {
        id: 'client_1',
        firstName: 'Tori',
      },
    })

    mocks.prisma.professionalFavorite.findMany.mockResolvedValue([])
    mocks.prisma.serviceFavorite.findMany.mockResolvedValue([])
    mocks.prisma.review.findMany.mockResolvedValue([])
  })

  it('renders the client dashboard with route-backed viral panel and existing dashboard surfaces', async () => {
    mocks.prisma.professionalFavorite.findMany.mockResolvedValue([
      {
        professional: {
          id: 'pro_1',
          businessName: 'Glow Studio',
          handle: 'glowstudio',
          avatarUrl: 'https://example.com/pro-1.jpg',
          professionType: 'Stylist',
          location: 'San Diego, CA',
        },
      },
    ])

    mocks.prisma.serviceFavorite.findMany.mockResolvedValue([
      {
        service: {
          id: 'service_1',
          name: 'Wolf Cut',
          description: 'Layered cut with texture',
          defaultImageUrl: 'https://example.com/service-1.jpg',
          category: {
            name: 'Hair',
            slug: 'hair',
          },
        },
      },
    ])

    mocks.prisma.review.findMany.mockResolvedValue([
      {
        id: 'review_1',
        rating: 5,
        headline: 'So good',
        createdAt: new Date('2026-04-01T12:00:00.000Z'),
        professional: {
          id: 'pro_1',
          businessName: 'Glow Studio',
          handle: 'glowstudio',
          avatarUrl: 'https://example.com/pro-1.jpg',
        },
      },
    ])

    render(await ClientHomePage())

    expect(screen.getByText('TOVIS')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Tori' })).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: 'Settings' }),
    ).toHaveAttribute('href', '/client/settings')

    expect(
      screen.getByTestId('pending-consult-approval-banner'),
    ).toBeInTheDocument()
    expect(
      screen.getByTestId('client-viral-requests-panel'),
    ).toBeInTheDocument()
    expect(screen.getByTestId('last-minute-openings')).toBeInTheDocument()
    expect(
      screen.getByTestId('saved-services-with-providers'),
    ).toBeInTheDocument()
    expect(screen.getByTestId('logout-button')).toBeInTheDocument()

    const savedProsSection = requireSection('Saved pros')
    expect(within(savedProsSection).getByText('1 saved')).toBeInTheDocument()
    expect(
      within(savedProsSection).getByRole('link', { name: /Glow Studio/i }),
    ).toHaveAttribute('href', '/professionals/pro_1')
    expect(
      within(savedProsSection).getByRole('button', { name: 'Remove' }),
    ).toBeInTheDocument()

    const savedServicesSection = requireSection('Saved services')
    expect(
      within(savedServicesSection).getByTestId('saved-services-with-providers'),
    ).toBeInTheDocument()
    expect(mocks.savedServicesProps).toHaveLength(1)
    expect(mocks.savedServicesProps[0]).toEqual([
      {
        id: 'service_1',
        name: 'Wolf Cut',
        description: 'Layered cut with texture',
        defaultImageUrl: 'https://example.com/service-1.jpg',
        categoryName: 'Hair',
        categorySlug: 'hair',
      },
    ])

    const viralRequestsSection = requireSection('Viral requests')
    expect(
      within(viralRequestsSection).getByTestId('client-viral-requests-panel'),
    ).toBeInTheDocument()

    const reviewsSection = requireSection('Your reviews')
    expect(within(reviewsSection).getByText('1 recent')).toBeInTheDocument()
    expect(
      within(reviewsSection).getByRole('link', { name: /Glow Studio/i }),
    ).toHaveAttribute('href', '/professionals/pro_1?tab=reviews')
    expect(within(reviewsSection).getByText('"So good"')).toBeInTheDocument()
    expect(within(reviewsSection).getByText('★ 5')).toBeInTheDocument()

    const openNowSection = requireSection('Open now')
    expect(
      within(openNowSection).getByTestId('last-minute-openings'),
    ).toBeInTheDocument()

    expect(mocks.prisma.professionalFavorite.findMany).toHaveBeenCalledWith({
      where: { userId: 'user_1' },
      orderBy: { createdAt: 'desc' },
      take: 24,
      select: {
        professional: {
          select: {
            id: true,
            businessName: true,
            handle: true,
            avatarUrl: true,
            professionType: true,
            location: true,
          },
        },
      },
    })

    expect(mocks.prisma.serviceFavorite.findMany).toHaveBeenCalledWith({
      where: { userId: 'user_1' },
      orderBy: { createdAt: 'desc' },
      take: 24,
      select: {
        service: {
          select: {
            id: true,
            name: true,
            description: true,
            defaultImageUrl: true,
            category: {
              select: {
                name: true,
                slug: true,
              },
            },
          },
        },
      },
    })

    expect(mocks.prisma.review.findMany).toHaveBeenCalledWith({
      where: { clientId: 'client_1' },
      orderBy: { createdAt: 'desc' },
      take: 12,
      select: {
        id: true,
        rating: true,
        headline: true,
        createdAt: true,
        professional: {
          select: {
            id: true,
            businessName: true,
            handle: true,
            avatarUrl: true,
          },
        },
      },
    })
  })

  it('renders empty-state dashboard copy when there are no saved pros or reviews', async () => {
    render(await ClientHomePage())

    const savedProsSection = requireSection('Saved pros')
    expect(
      within(savedProsSection).getByText(/No saved pros yet\. Browse/i),
    ).toBeInTheDocument()
    expect(
      within(savedProsSection).getByRole('link', { name: 'Looks' }),
    ).toHaveAttribute('href', '/looks')

    const reviewsSection = requireSection('Your reviews')
    expect(
      within(reviewsSection).getByText('Reviews you leave will appear here.'),
    ).toBeInTheDocument()

    expect(mocks.savedServicesProps).toHaveLength(1)
    expect(mocks.savedServicesProps[0]).toEqual([])

    expect(
      screen.getByTestId('client-viral-requests-panel'),
    ).toBeInTheDocument()
    expect(screen.getByTestId('last-minute-openings')).toBeInTheDocument()
  })

  it('redirects non-client users to login', async () => {
    mocks.getCurrentUser.mockResolvedValue({
      id: 'user_2',
      role: 'PRO',
      email: 'pro@example.com',
      clientProfile: null,
    })

    await expect(ClientHomePage()).rejects.toThrow(
      'NEXT_REDIRECT:/login?from=/client',
    )

    expect(mocks.redirect).toHaveBeenCalledWith('/login?from=/client')
  })
})