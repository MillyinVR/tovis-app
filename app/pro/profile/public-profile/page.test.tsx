// app/pro/profile/public-profile/page.test.tsx
import React from 'react'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MediaType, MediaVisibility, VerificationStatus } from '@prisma/client'

const mockRedirect = vi.hoisted(() =>
  vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`)
  }),
)

const mockGetCurrentUser = vi.hoisted(() => vi.fn())
const mockRenderMediaUrls = vi.hoisted(() => vi.fn())

const mocks = vi.hoisted(() => ({
  prisma: {
    professionalProfile: {
      findUnique: vi.fn(),
    },
    mediaAsset: {
      findMany: vi.fn(),
    },
    professionalFavorite: {
      count: vi.fn(),
    },
    service: {
      findMany: vi.fn(),
    },
  },
}))

vi.mock('next/navigation', () => ({
  redirect: mockRedirect,
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

vi.mock('@/lib/media/renderUrls', () => ({
  renderMediaUrls: mockRenderMediaUrls,
}))

vi.mock('../ReviewsPanel', () => ({
  default: () => <div data-testid="reviews-panel">ReviewsPanel</div>,
}))

vi.mock('../_sections/ServicesManagerSection', () => ({
  default: () => (
    <div data-testid="services-manager-section">ServicesManagerSection</div>
  ),
}))

vi.mock('./EditProfileButton', () => ({
  default: ({
    canEditHandle,
    initial,
  }: {
    canEditHandle: boolean
    initial: Record<string, unknown>
  }) => (
    <div
      data-testid="edit-profile-button"
      data-can-edit-handle={String(canEditHandle)}
      data-handle={String(initial.handle ?? '')}
    >
      EditProfileButton
    </div>
  ),
}))

vi.mock('./EditPaymentSettingsButton', () => ({
  default: () => (
    <div data-testid="edit-payment-settings-button">
      EditPaymentSettingsButton
    </div>
  ),
}))

vi.mock('./ShareButton', () => ({
  default: ({ url }: { url: string }) => (
    <div data-testid="share-button" data-url={url}>
      ShareButton
    </div>
  ),
}))

vi.mock('@/app/_components/media/OwnerMediaMenu', () => ({
  default: ({
    mediaId,
    initial,
  }: {
    mediaId: string
    initial: {
      visibility: MediaVisibility
      isEligibleForLooks: boolean
      isFeaturedInPortfolio: boolean
      serviceIds: string[]
    }
  }) => (
    <div
      data-testid="owner-media-menu"
      data-media-id={mediaId}
      data-visibility={initial.visibility}
      data-service-ids={initial.serviceIds.join(',')}
      data-eligible={String(initial.isEligibleForLooks)}
      data-featured={String(initial.isFeaturedInPortfolio)}
    >
      OwnerMediaMenu
    </div>
  ),
}))

vi.mock('./ProAccountMenu', () => ({
  default: ({
    publicUrl,
    looksHref,
    proServicesHref,
    uploadHref,
    messagesHref,
  }: {
    publicUrl?: string | null
    looksHref: string
    proServicesHref: string
    uploadHref: string
    messagesHref: string
  }) => (
    <div
      data-testid="pro-account-menu"
      data-public-url={publicUrl ?? ''}
      data-looks-href={looksHref}
      data-pro-services-href={proServicesHref}
      data-upload-href={uploadHref}
      data-messages-href={messagesHref}
    >
      ProAccountMenu
    </div>
  ),
}))

import ProPublicProfilePage from './page'

type TestSearchParams = Record<string, string | string[] | undefined>

function makeUser() {
  return {
    id: 'user_1',
    email: 'pro@example.com',
    phone: '+15551234567',
    role: 'PRO' as const,
    sessionKind: 'ACTIVE' as const,
    phoneVerifiedAt: new Date('2026-04-08T10:00:00.000Z'),
    emailVerifiedAt: new Date('2026-04-08T10:05:00.000Z'),
    isPhoneVerified: true,
    isEmailVerified: true,
    isFullyVerified: true,
    clientProfile: null,
    professionalProfile: {
      id: 'pro_1',
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

function makePro(args?: {
  verificationStatus?: VerificationStatus
}) {
  return {
    id: 'pro_1',
    handle: 'tovisstudio',
    verificationStatus: args?.verificationStatus ?? VerificationStatus.APPROVED,
    isPremium: true,
    businessName: 'TOVIS Studio',
    bio: 'Trusted beauty pro.',
    location: 'San Diego, CA',
    avatarUrl: null,
    professionType: 'BARBER',
    paymentSettings: null,
    reviews: [],
  }
}

function makePortfolioMedia() {
  return [
    {
      id: 'media_1',
      caption: 'Fresh cut',
      mediaType: MediaType.IMAGE,
      visibility: MediaVisibility.PUBLIC,
      isEligibleForLooks: true,
      isFeaturedInPortfolio: true,
      storageBucket: 'media-bucket',
      storagePath: 'pros/pro_1/media_1.jpg',
      thumbBucket: 'thumb-bucket',
      thumbPath: 'pros/pro_1/media_1-thumb.jpg',
      url: null,
      thumbUrl: null,
      services: [{ serviceId: 'svc_1' }],
    },
  ]
}

async function renderPage(args?: {
  searchParams?: TestSearchParams
}) {
  const ui = await ProPublicProfilePage({
    searchParams: Promise.resolve(args?.searchParams ?? {}),
  })

  return render(ui)
}

describe('app/pro/profile/public-profile/page', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mockGetCurrentUser.mockResolvedValue(makeUser())

    mocks.prisma.professionalProfile.findUnique.mockResolvedValue(
      makePro({ verificationStatus: VerificationStatus.APPROVED }),
    )

    mocks.prisma.mediaAsset.findMany.mockResolvedValue(makePortfolioMedia())
    mocks.prisma.professionalFavorite.count.mockResolvedValue(7)
    mocks.prisma.service.findMany.mockResolvedValue([
      { id: 'svc_1', name: 'Fade' },
    ])

    mockRenderMediaUrls.mockResolvedValue({
      renderUrl: 'https://cdn.example.com/media_1.jpg',
      renderThumbUrl: 'https://cdn.example.com/media_1-thumb.jpg',
    })
  })

  it('shows pending-review setup mode for non-approved pros', async () => {
    mocks.prisma.professionalProfile.findUnique.mockResolvedValue(
      makePro({ verificationStatus: VerificationStatus.PENDING }),
    )

    await renderPage()

    expect(
      screen.getByText('Your profile is under review'),
    ).toBeInTheDocument()

    expect(
      screen.getByText(
        /not searchable, not publicly bookable, and clients cannot view your public profile yet/i,
      ),
    ).toBeInTheDocument()

    expect(
      screen.queryByTestId('share-button'),
    ).not.toBeInTheDocument()

    expect(
      screen.queryByRole('link', { name: /view as client/i }),
    ).not.toBeInTheDocument()

    expect(screen.getByTestId('pro-account-menu')).toHaveAttribute(
      'data-public-url',
      '',
    )

    expect(screen.getByTestId('edit-profile-button')).toHaveAttribute(
      'data-can-edit-handle',
      'false',
    )

    expect(
      screen.getByRole('link', { name: /add services/i }),
    ).toHaveAttribute('href', '/pro/profile/public-profile?tab=services&add=1')

    expect(
      screen.getByRole('link', { name: /messages/i }),
    ).toHaveAttribute('href', '/messages')
  })

  it('shows live/public affordances for approved pros', async () => {
    mocks.prisma.professionalProfile.findUnique.mockResolvedValue(
      makePro({ verificationStatus: VerificationStatus.APPROVED }),
    )

    await renderPage()

    expect(
      screen.queryByText('Your profile is under review'),
    ).not.toBeInTheDocument()

    expect(screen.getByTestId('share-button')).toHaveAttribute(
      'data-url',
      '/professionals/pro_1',
    )

    expect(screen.getByRole('link', { name: /view as client/i })).toHaveAttribute(
      'href',
      '/professionals/pro_1',
    )

    expect(screen.getByTestId('pro-account-menu')).toHaveAttribute(
      'data-public-url',
      '/professionals/pro_1',
    )

    expect(screen.getByTestId('edit-profile-button')).toHaveAttribute(
      'data-can-edit-handle',
      'true',
    )
  })

  it('renders the services tab', async () => {
    await renderPage({
      searchParams: { tab: 'services' },
    })

    expect(
      screen.getByTestId('services-manager-section'),
    ).toBeInTheDocument()
  })

  it('redirects to login when the viewer is not an authenticated pro', async () => {
    mockGetCurrentUser.mockResolvedValue(null)

    await expect(renderPage()).rejects.toThrow(
      'NEXT_REDIRECT:/login?from=%2Fpro%2Fprofile%2Fpublic-profile',
    )

    expect(mockRedirect).toHaveBeenCalledWith(
      '/login?from=%2Fpro%2Fprofile%2Fpublic-profile',
    )
  })

  it('redirects to pro home when the profile record is missing', async () => {
    mocks.prisma.professionalProfile.findUnique.mockResolvedValue(null)

    await expect(renderPage()).rejects.toThrow(
      'NEXT_REDIRECT:/pro/dashboard',
    )

    expect(mockRedirect).toHaveBeenCalledWith('/pro/dashboard')
  })
})