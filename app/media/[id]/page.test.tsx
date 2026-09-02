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
    // §18d — the owner path reads the pro's cover id to flag the cover tile.
    professionalProfile: {
      findUnique: vi.fn(),
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
    reframe,
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
    reframe?: {
      src: string
      crop: { x: number; y: number; w: number; h: number } | null
      bound: { x: number; y: number; w: number; h: number }
      undoNotice?: string | null
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
      data-reframe={reframe ? 'yes' : 'no'}
      data-reframe-bound={
        reframe
          ? `${reframe.bound.x},${reframe.bound.y},${reframe.bound.w},${reframe.bound.h}`
          : ''
      }
      data-reframe-undo={reframe?.undoNotice ? 'open' : 'shut'}
    >
      OwnerMediaMenu
    </div>
  ),
}))

vi.mock('@/app/_components/media/ClientMediaExportButton', () => ({
  default: ({
    professionalId,
    media,
  }: {
    professionalId: string
    media: { kind: 'single'; url: string } | { kind: 'pair'; beforeUrl: string; afterUrl: string }
  }) => (
    <div
      data-testid="client-media-export-button"
      data-professional-id={professionalId}
      data-media-kind={media.kind}
    >
      ClientMediaExportButton
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
    // Re-framing (item 4). Present because the page SELECTS them: the page
    // reduces the two look relations to a view total, and leaving them off the
    // fixture would only prove the fixture is stale. Defaults are "never
    // re-framed, no undo window, no views" — the state of every legacy row.
    cropX: null,
    cropY: null,
    cropW: null,
    cropH: null,
    cropUndoBoundX: null,
    cropUndoBoundY: null,
    cropUndoBoundW: null,
    cropUndoBoundH: null,
    cropUndoExpiresAt: null,
    cropUndoViewBaseline: null,
    focalX: null,
    focalY: null,
    lookPostPrimaryFor: [],
    lookPostAssets: [],
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

  it('treats [id] as a raw media asset id', async () => {
    await renderPage({ id: 'media_asset_42' })

    expect(mocks.prisma.mediaAsset.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'media_asset_42' },
      }),
    )
  })

    it('renders approved public media as a raw media detail view for non-owners', async () => {
    await renderPage()

    expect(screen.getByTestId('media-fullscreen-viewer')).toHaveAttribute(
      'data-src',
      'https://cdn.example.com/media_1.jpg',
    )
    expect(screen.getByTestId('media-fullscreen-viewer')).toHaveAttribute(
      'data-media-type',
      'IMAGE',
    )
    expect(
      screen.getByRole('link', { name: /back to profile/i }),
    ).toHaveAttribute('href', '/professionals/pro_1')

    expect(screen.getByText('Image asset')).toBeInTheDocument()
    expect(screen.getByText('Fresh cut')).toBeInTheDocument()
    expect(screen.getByText('Services')).toBeInTheDocument()
    expect(screen.getByText('Fade')).toBeInTheDocument()
    expect(screen.getByText('Beard Trim')).toBeInTheDocument()

    expect(
      screen.queryByText('3 likes • 1 comments'),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByText('Owner media view'),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByTestId('owner-media-menu'),
    ).not.toBeInTheDocument()

    expect(mocks.prisma.service.findMany).not.toHaveBeenCalled()
  })

  // ── Re-framing (item 4) ────────────────────────────────────────────────────

  it('offers the owner a re-frame bounded by the whole photo when nothing is cropped', async () => {
    mockGetCurrentUser.mockResolvedValue(
      makeOwnerViewer({ professionalProfileId: 'pro_1' }),
    )
    mocks.prisma.mediaAsset.findUnique.mockResolvedValue(
      makeMedia({ professionalId: 'pro_1' }),
    )
    mocks.prisma.service.findMany.mockResolvedValue([])

    await renderPage()

    const menu = screen.getByTestId('owner-media-menu')
    expect(menu).toHaveAttribute('data-reframe', 'yes')
    // A row that has never been re-framed is bounded by the frame the client
    // already consented to — the whole photo.
    expect(menu).toHaveAttribute('data-reframe-bound', '0,0,1,1')
    expect(menu).toHaveAttribute('data-reframe-undo', 'shut')
  })

  it('bounds the re-frame by the STORED rect once the undo window has shut', async () => {
    mockGetCurrentUser.mockResolvedValue(
      makeOwnerViewer({ professionalProfileId: 'pro_1' }),
    )
    mocks.prisma.mediaAsset.findUnique.mockResolvedValue({
      ...makeMedia({ professionalId: 'pro_1' }),
      cropX: 0.2,
      cropY: 0.2,
      cropW: 0.6,
      cropH: 0.6,
      cropUndoBoundX: 0,
      cropUndoBoundY: 0,
      cropUndoBoundW: 1,
      cropUndoBoundH: 1,
      cropUndoExpiresAt: new Date(Date.now() - 1000),
      cropUndoViewBaseline: 0,
    })
    mocks.prisma.service.findMany.mockResolvedValue([])

    await renderPage()

    const menu = screen.getByTestId('owner-media-menu')
    expect(menu).toHaveAttribute('data-reframe-bound', '0.2,0.2,0.6,0.6')
    expect(menu).toHaveAttribute('data-reframe-undo', 'shut')
  })

  it('widens the bound back while the undo window is open, and says so', async () => {
    mockGetCurrentUser.mockResolvedValue(
      makeOwnerViewer({ professionalProfileId: 'pro_1' }),
    )
    mocks.prisma.mediaAsset.findUnique.mockResolvedValue({
      ...makeMedia({ professionalId: 'pro_1' }),
      cropX: 0.4,
      cropY: 0.4,
      cropW: 0.2,
      cropH: 0.2,
      cropUndoBoundX: 0.1,
      cropUndoBoundY: 0.1,
      cropUndoBoundW: 0.8,
      cropUndoBoundH: 0.8,
      cropUndoExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
      cropUndoViewBaseline: 0,
    })
    mocks.prisma.service.findMany.mockResolvedValue([])

    await renderPage()

    const menu = screen.getByTestId('owner-media-menu')
    expect(menu).toHaveAttribute('data-reframe-bound', '0.1,0.1,0.8,0.8')
    expect(menu).toHaveAttribute('data-reframe-undo', 'open')
  })

  it('shuts the window when a look the asset merely appears in has been viewed', async () => {
    // The view total sums BOTH relations — the asset's own looks and the ones it
    // is only a member of. A page that reduced just one would leave the window
    // open after the photo had been seen.
    mockGetCurrentUser.mockResolvedValue(
      makeOwnerViewer({ professionalProfileId: 'pro_1' }),
    )
    mocks.prisma.mediaAsset.findUnique.mockResolvedValue({
      ...makeMedia({ professionalId: 'pro_1' }),
      cropX: 0.4,
      cropY: 0.4,
      cropW: 0.2,
      cropH: 0.2,
      cropUndoBoundX: 0.1,
      cropUndoBoundY: 0.1,
      cropUndoBoundW: 0.8,
      cropUndoBoundH: 0.8,
      cropUndoExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
      cropUndoViewBaseline: 2,
      lookPostPrimaryFor: [{ viewCount: 2 }],
      lookPostAssets: [{ lookPost: { viewCount: 1 } }],
    })
    mocks.prisma.service.findMany.mockResolvedValue([])

    await renderPage()

    const menu = screen.getByTestId('owner-media-menu')
    expect(menu).toHaveAttribute('data-reframe-bound', '0.4,0.4,0.2,0.2')
    expect(menu).toHaveAttribute('data-reframe-undo', 'shut')
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

    expect(screen.getByText('Owner media view')).toBeInTheDocument()
    expect(screen.getByText('Public media')).toBeInTheDocument()
    expect(screen.getByText('Looks enabled')).toBeInTheDocument()
    expect(screen.getByText('Portfolio featured')).toBeInTheDocument()
    expect(
      screen.queryByText('3 likes • 1 comments'),
    ).not.toBeInTheDocument()

    expect(mocks.prisma.service.findMany).toHaveBeenCalledWith({
      where: { isActive: true },
      orderBy: { name: 'asc' },
      take: 500,
      select: { id: true, name: true },
    })
  })

  it('blocks non-owners from viewing a REFUSED pro\u2019s public media', async () => {
    // PENDING no longer hides media — the licence is a badge, not a gate
    // (lib/proTrustState.ts). An admin's refusal still does.
    mocks.prisma.mediaAsset.findUnique.mockResolvedValue(
      makeMedia({
        visibility: MediaVisibility.PUBLIC,
        professionalVerificationStatus: VerificationStatus.REJECTED,
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