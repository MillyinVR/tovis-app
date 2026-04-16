// app/media/[id]/page.test.tsx 

import React from 'react'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MediaType, MediaVisibility, Role, VerificationStatus } from '@prisma/client'

const mockNotFound = vi.hoisted(() =>
  vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND')
  }),
)

const mockGetCurrentUser = vi.hoisted(() => vi.fn())
const mockRenderMediaUrls = vi.hoisted(() => vi.fn())

const mocks = vi.hoisted(() => ({
  prisma: {
    mediaAsset: {
      findUnique: vi.fn(),
    },
    service: {
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

vi.mock('@/lib/media/renderUrls', () => ({
  renderMediaUrls: mockRenderMediaUrls,
}))

vi.mock('@/app/_components/media/MediaFullscreenViewer', () => ({
  default: ({
    src,
    mediaType,
    alt,
    topLeft,
    topRight,
    bottom,
  }: {
    src: string
    mediaType: 'IMAGE' | 'VIDEO'
    alt: string
    topLeft?: React.ReactNode
    topRight?: React.ReactNode
    bottom?: React.ReactNode
  }) => (
    <div
      data-testid="media-fullscreen-viewer"
      data-src={src}
      data-media-type={mediaType}
      data-alt={alt}
    >
      <div data-testid="viewer-top-left">{topLeft}</div>
      <div data-testid="viewer-top-right">{topRight}</div>
      <div data-testid="viewer-bottom">{bottom}</div>
    </div>
  ),
}))

vi.mock('@/app/_components/media/OwnerMediaMenu', () => ({
  default: ({
    mediaId,
    serviceOptions,
    initial,
  }: {
    mediaId: string
    serviceOptions: Array<{ id: string; name: string }>
    initial: {
      caption: string | null
      visibility: MediaVisibility
      isEligibleForLooks: boolean
      isFeaturedInPortfolio: boolean
      serviceIds: string[]
    }
  }) => (
    <div
      data-testid="owner-media-menu"
      data-media-id={mediaId}
      data-service-option-count={String(serviceOptions.length)}
      data-caption={initial.caption ?? ''}
      data-visibility={initial.visibility}
      data-eligible={String(initial.isEligibleForLooks)}
      data-featured={String(initial.isFeaturedInPortfolio)}
      data-service-ids={initial.serviceIds.join(',')}
    >
      OwnerMediaMenu
    </div>
  ),
}))

vi.mock('@/app/(main)/ui/layoutConstants', () => ({
  UI_SIZES: {
    footerHeight: 64,
  },
}))

import PublicMediaDetailPage from './page'

function makeMedia(args?: {
  id?: string
  visibility?: MediaVisibility
  professionalId?: string
  professionalVerificationStatus?: VerificationStatus
  mediaType?: MediaType
}) {
  return {
    id: args?.id ?? 'media_1',
    caption: 'Fresh cut',
    mediaType: args?.mediaType ?? MediaType.IMAGE,
    visibility: args?.visibility ?? MediaVisibility.PUBLIC,
    professionalId: args?.professionalId ?? 'pro_1',
    isEligibleForLooks: true,
    isFeaturedInPortfolio: true,
    storageBucket: 'media-bucket',
    storagePath: 'pros/pro_1/media_1.jpg',
    thumbBucket: 'thumb-bucket',
    thumbPath: 'pros/pro_1/media_1-thumb.jpg',
    url: null,
    thumbUrl: null,
    professional: {
      verificationStatus:
        args?.professionalVerificationStatus ?? VerificationStatus.APPROVED,
    },
    services: [
      {
        serviceId: 'svc_1',
        service: { name: 'Fade' },
      },
      {
        serviceId: 'svc_2',
        service: { name: 'Beard Trim' },
      },
    ],
    _count: {
      likes: 3,
      comments: 1,
    },
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

async function renderPage(args?: { id?: string }) {
  const ui = await PublicMediaDetailPage({
    params: Promise.resolve({ id: args?.id ?? 'media_1' }),
  })

  return render(ui)
}

describe('app/media/[id]/page', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mockGetCurrentUser.mockResolvedValue(null)

    mocks.prisma.mediaAsset.findUnique.mockResolvedValue(
      makeMedia({
        visibility: MediaVisibility.PUBLIC,
        professionalVerificationStatus: VerificationStatus.APPROVED,
      }),
    )

    mocks.prisma.service.findMany.mockResolvedValue([])

    mockRenderMediaUrls.mockResolvedValue({
      renderUrl: 'https://cdn.example.com/media_1.jpg',
      renderThumbUrl: 'https://cdn.example.com/media_1-thumb.jpg',
    })
  })

  it('allows non-owners to view approved public media', async () => {
    await renderPage()

    expect(screen.getByTestId('media-fullscreen-viewer')).toHaveAttribute(
      'data-src',
      'https://cdn.example.com/media_1.jpg',
    )
    expect(screen.getByTestId('media-fullscreen-viewer')).toHaveAttribute(
      'data-media-type',
      'IMAGE',
    )
    expect(screen.getByRole('link', { name: /back to profile/i })).toHaveAttribute(
      'href',
      '/professionals/pro_1',
    )
    expect(screen.getByText('3 likes • 1 comments')).toBeInTheDocument()
    expect(screen.getByText('Fresh cut')).toBeInTheDocument()
    expect(screen.getByText('Fade')).toBeInTheDocument()
    expect(screen.getByText('Beard Trim')).toBeInTheDocument()

    expect(screen.queryByTestId('owner-media-menu')).not.toBeInTheDocument()
    expect(mocks.prisma.service.findMany).not.toHaveBeenCalled()
  })

  it('allows the owner to preview their own pending public media', async () => {
    mockGetCurrentUser.mockResolvedValue(
      makeOwnerViewer({ professionalProfileId: 'pro_1' }),
    )

    mocks.prisma.mediaAsset.findUnique.mockResolvedValue(
      makeMedia({
        professionalId: 'pro_1',
        visibility: MediaVisibility.PUBLIC,
        professionalVerificationStatus: VerificationStatus.PENDING,
      }),
    )

    mocks.prisma.service.findMany.mockResolvedValue([
      { id: 'svc_1', name: 'Fade' },
      { id: 'svc_2', name: 'Beard Trim' },
    ])

    await renderPage()

    expect(screen.getByTestId('media-fullscreen-viewer')).toBeInTheDocument()
    expect(screen.getByTestId('owner-media-menu')).toBeInTheDocument()
    expect(screen.getByTestId('owner-media-menu')).toHaveAttribute(
      'data-media-id',
      'media_1',
    )
    expect(screen.getByTestId('owner-media-menu')).toHaveAttribute(
      'data-service-option-count',
      '2',
    )
    expect(screen.getByTestId('owner-media-menu')).toHaveAttribute(
      'data-service-ids',
      'svc_1,svc_2',
    )

    expect(mocks.prisma.service.findMany).toHaveBeenCalledWith({
      where: { isActive: true },
      orderBy: { name: 'asc' },
      take: 500,
      select: { id: true, name: true },
    })
  })

  it('blocks non-owners from viewing pending public media', async () => {
    mocks.prisma.mediaAsset.findUnique.mockResolvedValue(
      makeMedia({
        visibility: MediaVisibility.PUBLIC,
        professionalVerificationStatus: VerificationStatus.PENDING,
      }),
    )

    await expect(renderPage()).rejects.toThrow('NEXT_NOT_FOUND')
    expect(mockNotFound).toHaveBeenCalled()
    expect(mockRenderMediaUrls).not.toHaveBeenCalled()
    expect(mocks.prisma.service.findMany).not.toHaveBeenCalled()
  })

  it('calls notFound when the media is missing', async () => {
    mocks.prisma.mediaAsset.findUnique.mockResolvedValue(null)

    await expect(renderPage()).rejects.toThrow('NEXT_NOT_FOUND')
    expect(mockNotFound).toHaveBeenCalled()
    expect(mockRenderMediaUrls).not.toHaveBeenCalled()
  })

  it('calls notFound when the media is not public', async () => {
    mocks.prisma.mediaAsset.findUnique.mockResolvedValue(
      makeMedia({
        visibility: MediaVisibility.PRO_CLIENT,
      }),
    )

    await expect(renderPage()).rejects.toThrow('NEXT_NOT_FOUND')
    expect(mockNotFound).toHaveBeenCalled()
    expect(mockRenderMediaUrls).not.toHaveBeenCalled()
  })

  it('calls notFound when no renderable media URL can be produced', async () => {
    mockRenderMediaUrls.mockResolvedValue({
      renderUrl: null,
      renderThumbUrl: null,
    })

    await expect(renderPage()).rejects.toThrow('NEXT_NOT_FOUND')
    expect(mockNotFound).toHaveBeenCalled()
  })
})