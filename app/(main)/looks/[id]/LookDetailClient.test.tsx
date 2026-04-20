// app/(main)/looks/[id]/LookDetailClient.test.tsx
import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { LooksCommentDto, LooksDetailItemDto } from '@/lib/looks/types'

const mockPush = vi.hoisted(() => vi.fn())
const mockWriteText = vi.hoisted(() => vi.fn())

type MockViewerLocation = {
  lat: number
  lng: number
  radiusMiles: number
  placeId: string | null
  locationLabel: string | null
}

const mockViewerLocation: MockViewerLocation = {
  lat: 32.7157,
  lng: -117.1611,
  radiusMiles: 15,
  placeId: 'place_sandiego',
  locationLabel: 'San Diego, CA',
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
  }),
}))

vi.mock('@/lib/brand/BrandProvider', () => ({
  useBrand: () => ({
    brand: {
      id: 'tovis',
      displayName: 'TOVIS',
    },
  }),
}))

vi.mock('@/lib/http', () => ({
  safeJson: async (res: Response) => {
    try {
      return await res.json()
    } catch {
      return null
    }
  },
}))

vi.mock('@/lib/looks/mappers', () => ({
  parseLooksCommentsResponse: (raw: unknown) => {
    if (!isRecord(raw) || !Array.isArray(raw.comments)) return []
    return raw.comments.filter((comment): comment is LooksCommentDto => {
      return (
        isRecord(comment) &&
        typeof comment.id === 'string' &&
        typeof comment.body === 'string' &&
        typeof comment.createdAt === 'string' &&
        isRecord(comment.user) &&
        typeof comment.user.id === 'string' &&
        typeof comment.user.displayName === 'string'
      )
    })
  },
}))

vi.mock('@/lib/viewerLocation', () => ({
  loadViewerLocation: () => mockViewerLocation,
  subscribeViewerLocation: () => () => {},
  viewerLocationToDrawerContextFields: (
    viewerLoc: MockViewerLocation | null,
  ) => ({
    viewerLat: viewerLoc?.lat ?? null,
    viewerLng: viewerLoc?.lng ?? null,
    viewerRadiusMiles: viewerLoc?.radiusMiles ?? null,
    viewerPlaceId: viewerLoc?.placeId ?? null,
    viewerLocationLabel: viewerLoc?.locationLabel ?? null,
  }),
}))

vi.mock('../../booking/AvailabilityDrawer', () => ({
  default: ({
    open,
    onClose,
    context,
  }: {
    open: boolean
    onClose: () => void
    context: {
      professionalId: string
      mediaId?: string | null
      serviceId?: string | null
      source?: string
      viewerLat?: number | null
      viewerLng?: number | null
      viewerRadiusMiles?: number | null
      viewerPlaceId?: string | null
      viewerLocationLabel?: string | null
    }
  }) =>
    open ? (
      <div
        data-testid="availability-drawer"
        data-professional-id={context.professionalId}
        data-media-id={context.mediaId ?? ''}
        data-service-id={context.serviceId ?? ''}
        data-source={context.source ?? ''}
        data-viewer-lat={String(context.viewerLat ?? '')}
        data-viewer-lng={String(context.viewerLng ?? '')}
        data-viewer-radius={String(context.viewerRadiusMiles ?? '')}
        data-viewer-place-id={context.viewerPlaceId ?? ''}
        data-viewer-location-label={context.viewerLocationLabel ?? ''}
      >
        <button type="button" onClick={onClose}>
          Close availability
        </button>
      </div>
    ) : null,
}))

vi.mock('../_components/CommentsDrawer', () => ({
  default: ({
    open,
    onClose,
    loading,
    error,
    comments,
    commentText,
    setCommentText,
    posting,
    onPost,
  }: {
    open: boolean
    onClose: () => void
    loading: boolean
    error: string | null
    comments: LooksCommentDto[]
    commentText: string
    setCommentText: (value: string) => void
    posting: boolean
    onPost: () => void
  }) =>
    open ? (
      <div data-testid="comments-drawer">
        <button type="button" onClick={onClose}>
          Close comments
        </button>

        {loading ? <div>Loading comments…</div> : null}
        {error ? <div>{error}</div> : null}

        {comments.map((comment) => (
          <div key={comment.id}>
            {comment.user.displayName}: {comment.body}
          </div>
        ))}

        <input
          aria-label="Comment text"
          value={commentText}
          onChange={(event) => setCommentText(event.target.value)}
        />

        <button type="button" disabled={posting} onClick={onPost}>
          Post comment
        </button>
      </div>
    ) : null,
}))

vi.mock('../_components/RightActionRail', () => ({
  default: ({
    viewerLiked,
    likeCount,
    commentCount,
    onOpenAvailability,
    onToggleLike,
    onOpenComments,
    onShare,
  }: {
    viewerLiked: boolean
    likeCount: number
    commentCount: number
    onOpenAvailability: () => void
    onToggleLike: () => void
    onOpenComments: () => void
    onShare: () => void
  }) => (
    <div data-testid="right-rail">
      <div data-testid="viewer-liked">{viewerLiked ? 'true' : 'false'}</div>
      <div data-testid="like-count">{String(likeCount)}</div>
      <div data-testid="comment-count">{String(commentCount)}</div>

      <button type="button" onClick={onOpenAvailability}>
        Open availability
      </button>
      <button type="button" onClick={onToggleLike}>
        Toggle like
      </button>
      <button type="button" onClick={onOpenComments}>
        Open comments
      </button>
      <button type="button" onClick={onShare}>
        Share
      </button>
    </div>
  ),
}))

import LookDetailClient from './LookDetailClient'

function makeComment(overrides?: Partial<LooksCommentDto>): LooksCommentDto {
  return {
    id: 'comment_1',
    body: 'Looks amazing',
    createdAt: '2026-04-20T18:00:00.000Z',
    user: {
      id: 'user_1',
      displayName: 'Tori Morales',
      avatarUrl: null,
    },
    ...overrides,
  }
}

function makeDetailItem(): LooksDetailItemDto {
  return {
    id: 'look_1',
    caption: 'Fresh fade',
    status: 'PUBLISHED',
    visibility: 'PUBLIC',
    moderationStatus: 'APPROVED',
    publishedAt: '2026-04-20T18:00:00.000Z',
    createdAt: '2026-04-20T17:00:00.000Z',
    updatedAt: '2026-04-20T18:30:00.000Z',
    professional: {
      id: 'pro_1',
      businessName: 'TOVIS Studio',
      handle: 'tovisstudio',
      avatarUrl: null,
      professionType: 'BARBER',
      location: 'San Diego, CA',
      verificationStatus: 'APPROVED',
      isPremium: true,
    },
    service: {
      id: 'service_1',
      name: 'Fade',
      category: {
        name: 'Hair',
        slug: 'hair',
      },
    },
    primaryMedia: {
      id: 'media_1',
      url: 'https://cdn.example.com/look_1.jpg',
      thumbUrl: 'https://cdn.example.com/look_1-thumb.jpg',
      mediaType: 'IMAGE',
      caption: 'Primary detail caption',
      createdAt: '2026-04-20T17:00:00.000Z',
      review: {
        id: 'review_1',
        rating: 5,
        headline: 'Love it',
        helpfulCount: 8,
      },
    },
    assets: [
      {
        id: 'asset_1',
        sortOrder: 0,
        mediaAssetId: 'media_1',
        media: {
          id: 'media_1',
          url: 'https://cdn.example.com/look_1.jpg',
          thumbUrl: 'https://cdn.example.com/look_1-thumb.jpg',
          mediaType: 'IMAGE',
          caption: 'Primary detail caption',
          createdAt: '2026-04-20T17:00:00.000Z',
          review: {
            id: 'review_1',
            rating: 5,
            headline: 'Love it',
            helpfulCount: 8,
          },
        },
      },
      {
        id: 'asset_2',
        sortOrder: 1,
        mediaAssetId: 'media_2',
        media: {
          id: 'media_2',
          url: 'https://cdn.example.com/look_2.jpg',
          thumbUrl: 'https://cdn.example.com/look_2-thumb.jpg',
          mediaType: 'IMAGE',
          caption: 'Secondary detail caption',
          createdAt: '2026-04-20T17:05:00.000Z',
          review: null,
        },
      },
    ],
    _count: {
      likes: 4,
      comments: 1,
      saves: 2,
      shares: 3,
    },
    viewerContext: {
      isAuthenticated: true,
      viewerLiked: false,
      canComment: true,
      canSave: true,
      isOwner: false,
    },
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
    },
  })
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function installFetchMock(args?: {
  commentsByLookId?: Record<string, LooksCommentDto[]>
  initialLiked?: boolean
  initialLikeCount?: number
}) {
  const commentsByLookId: Record<string, LooksCommentDto[]> = {
    look_1: [makeComment()],
    ...(args?.commentsByLookId ?? {}),
  }

  let liked = args?.initialLiked ?? false
  let likeCount = args?.initialLikeCount ?? 4

  const fetchMock = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url

      const method = init?.method ?? 'GET'

      if (url === '/api/looks/look_1/like') {
        if (method === 'POST') {
          liked = true
          likeCount += 1
          return jsonResponse({
            lookPostId: 'look_1',
            liked,
            likeCount,
          })
        }

        if (method === 'DELETE') {
          liked = false
          likeCount = Math.max(0, likeCount - 1)
          return jsonResponse({
            lookPostId: 'look_1',
            liked,
            likeCount,
          })
        }
      }

      if (url === '/api/looks/look_1/comments') {
        if (method === 'GET') {
          const comments = commentsByLookId.look_1 ?? []
          return jsonResponse({
            lookPostId: 'look_1',
            comments: clone(comments),
            commentsCount: comments.length,
          })
        }

        if (method === 'POST') {
          const rawBody =
            typeof init?.body === 'string'
              ? (JSON.parse(init.body) as { body?: unknown })
              : null

          const body =
            typeof rawBody?.body === 'string' ? rawBody.body.trim() : ''

          const nextComment = makeComment({
            id: `comment_${(commentsByLookId.look_1?.length ?? 0) + 1}`,
            body,
          })

          commentsByLookId.look_1 = [
            nextComment,
            ...(commentsByLookId.look_1 ?? []),
          ]

          return jsonResponse(
            {
              lookPostId: 'look_1',
              comment: clone(nextComment),
              commentsCount: commentsByLookId.look_1.length,
            },
            201,
          )
        }
      }

      return jsonResponse(
        {
          ok: false,
          error: `Unhandled request: ${method} ${url}`,
        },
        500,
      )
    },
  )

  vi.stubGlobal('fetch', fetchMock)

  return { fetchMock }
}

describe('app/(main)/looks/[id]/LookDetailClient', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: mockWriteText,
      },
    })

    mockPush.mockReset()
    mockWriteText.mockReset()
  })

  it('passes canonical lookPostId into the like route and updates local like state', async () => {
    const { fetchMock } = installFetchMock({
      initialLiked: false,
      initialLikeCount: 4,
    })

    render(<LookDetailClient initialItem={makeDetailItem()} />)

    expect(screen.getByTestId('like-count')).toHaveTextContent('4')
    expect(screen.getByTestId('viewer-liked')).toHaveTextContent('false')

    fireEvent.click(screen.getByRole('button', { name: 'Toggle like' }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/looks/look_1/like', {
        method: 'POST',
      })
    })

    await waitFor(() => {
      expect(screen.getByTestId('like-count')).toHaveTextContent('5')
      expect(screen.getByTestId('viewer-liked')).toHaveTextContent('true')
    })
  })

  it('opens comments and posts comments using the canonical lookPostId', async () => {
    const { fetchMock } = installFetchMock({
      commentsByLookId: {
        look_1: [
          makeComment({
            id: 'comment_existing',
            body: 'Existing comment',
          }),
        ],
      },
    })

    render(<LookDetailClient initialItem={makeDetailItem()} />)

    fireEvent.click(screen.getByRole('button', { name: 'Open comments' }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/looks/look_1/comments',
        expect.objectContaining({
          cache: 'no-store',
          headers: { Accept: 'application/json' },
        }),
      )
    })

    expect(await screen.findByTestId('comments-drawer')).toBeInTheDocument()
    expect(await screen.findByText(/Existing comment/)).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Comment text'), {
      target: { value: 'Love this look' },
    })

    fireEvent.click(screen.getByRole('button', { name: 'Post comment' }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/looks/look_1/comments',
        expect.objectContaining({
          method: 'POST',
        }),
      )
    })

    await waitFor(() => {
      expect(screen.getByTestId('comment-count')).toHaveTextContent('2')
    })

    expect(await screen.findByText(/Love this look/)).toBeInTheDocument()
  })

  it('opens availability with post-derived context and leaves legacy mediaId empty', async () => {
    installFetchMock()

    render(<LookDetailClient initialItem={makeDetailItem()} />)

    fireEvent.click(
      screen.getByRole('button', { name: 'Open availability' }),
    )

    const drawer = await screen.findByTestId('availability-drawer')

    expect(drawer).toHaveAttribute('data-professional-id', 'pro_1')
    expect(drawer).toHaveAttribute('data-service-id', 'service_1')
    expect(drawer).toHaveAttribute('data-source', 'DISCOVERY')
    expect(drawer).toHaveAttribute('data-media-id', '')
    expect(drawer).toHaveAttribute('data-viewer-lat', '32.7157')
    expect(drawer).toHaveAttribute('data-viewer-lng', '-117.1611')
    expect(drawer).toHaveAttribute('data-viewer-radius', '15')
    expect(drawer).toHaveAttribute('data-viewer-place-id', 'place_sandiego')
    expect(drawer).toHaveAttribute(
      'data-viewer-location-label',
      'San Diego, CA',
    )
  })

  it('shares the canonical post detail URL', async () => {
    installFetchMock()
    mockWriteText.mockResolvedValue(undefined)

    render(<LookDetailClient initialItem={makeDetailItem()} />)

    fireEvent.click(screen.getByRole('button', { name: 'Share' }))

    await waitFor(() => {
      expect(mockWriteText).toHaveBeenCalledTimes(1)
    })

    expect(mockWriteText).toHaveBeenCalledWith(
      `${window.location.origin}/looks/look_1`,
    )
  })

  it('does not render public raw review body when admin detail is absent', () => {
    installFetchMock()

    render(<LookDetailClient initialItem={makeDetailItem()} />)

    expect(screen.queryByText(/Review body:/)).not.toBeInTheDocument()
    expect(screen.getByText(/Helpful: 8/)).toBeInTheDocument()
  })

  it('renders admin-only review body when admin detail is present', () => {
    installFetchMock()

    const itemWithAdmin: LooksDetailItemDto = {
      ...makeDetailItem(),
      admin: {
        canModerate: true,
        archivedAt: null,
        removedAt: null,
        primaryMediaAssetId: 'media_1',
        primaryMedia: {
          visibility: 'PUBLIC',
          isEligibleForLooks: true,
          isFeaturedInPortfolio: false,
          reviewBody: 'Private moderation-only review body',
        },
      },
    }

    render(<LookDetailClient initialItem={itemWithAdmin} />)

    expect(screen.getByText(/Admin detail/)).toBeInTheDocument()
    expect(
      screen.getByText(/Private moderation-only review body/),
    ).toBeInTheDocument()
  })
})