// app/(main)/looks/_components/LooksFeed.test.tsx
import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'

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

vi.mock('../../ui/layoutConstants', () => ({
  UI_SIZES: {
    footerHeight: 64,
    rightRailBottomOffset: 24,
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

vi.mock('./LooksTopBar', () => ({
  default: ({
    categories,
    activeCategory,
    onSelectCategory,
    query,
    setQuery,
  }: {
    categories: string[]
    activeCategory: string
    onSelectCategory: (categoryName: string) => void
    query: string
    setQuery: (value: string) => void
  }) => (
    <div data-testid="looks-top-bar">
      <div data-testid="active-category">{activeCategory}</div>

      {categories.map((category) => (
        <button
          key={category}
          type="button"
          onClick={() => onSelectCategory(category)}
        >
          {category}
        </button>
      ))}

      <input
        aria-label="Search looks"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
    </div>
  ),
}))

vi.mock('./RightActionRail', () => ({
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

vi.mock('./LookSlide', () => ({
  default: ({
    item,
    index,
    rightRail,
    onDoubleClickLike,
    onTouchEndLike,
    onToggleLike,
    onOpenComments,
    onOpenAvailability,
  }: {
    item: {
      id: string
      caption: string | null
    }
    index: number
    rightRail?: React.ReactNode
    onDoubleClickLike: () => void
    onTouchEndLike: () => void
    onToggleLike: () => void
    onOpenComments: () => void
    onOpenAvailability: () => void
  }) => (
    <article data-testid={`look-slide-${item.id}`} data-index={String(index)}>
      <div>{item.id}</div>
      <div>{item.caption ?? ''}</div>

      <button type="button" onClick={onDoubleClickLike}>
        Double like
      </button>
      <button type="button" onClick={onTouchEndLike}>
        Touch like
      </button>
      <button type="button" onClick={onToggleLike}>
        Slide toggle like
      </button>
      <button type="button" onClick={onOpenComments}>
        Slide open comments
      </button>
      <button type="button" onClick={onOpenAvailability}>
        Slide open availability
      </button>

      {rightRail}
    </article>
  ),
}))

vi.mock('./CommentsDrawer', () => ({
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
    comments: Array<{
      id: string
      body: string
      user: { displayName: string }
    }>
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

import LooksFeed from './LooksFeed'
import type { FeedItem, UiComment } from './lookTypes'

function makeFeedItem(
  overrides: Partial<FeedItem> = {},
): FeedItem {
  return {
    id: 'look_1',
    url: 'https://cdn.example.com/look_1.jpg',
    thumbUrl: 'https://cdn.example.com/look_1-thumb.jpg',
    mediaType: 'IMAGE',
    caption: 'Fresh cut',
    createdAt: '2026-04-20T18:00:00.000Z',
    professional: {
      id: 'pro_1',
      businessName: 'TOVIS Studio',
      handle: 'tovisstudio',
      professionType: 'BARBER',
      avatarUrl: null,
      location: 'San Diego, CA',
    },
    _count: {
      likes: 3,
      comments: 1,
    },
    viewerLiked: false,
    serviceId: 'service_1',
    serviceName: 'Fade',
    category: 'Hair',
    serviceIds: ['service_1'],
    uploadedByRole: null,
    reviewId: null,
    reviewHelpfulCount: null,
    reviewRating: null,
    reviewHeadline: null,
    ...overrides,
  }
}

function makeComment(
  overrides?: Partial<UiComment>,
): UiComment {
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
  feedByCategory?: Record<string, FeedItem[]>
  commentsByLookId?: Record<string, UiComment[]>
  categories?: Array<{ name: string; slug: string }>
}) {
  const categories = args?.categories ?? [{ name: 'Hair', slug: 'hair' }]

  const feedByCategory: Record<string, FeedItem[]> = {
    all: [makeFeedItem()],
    ...(args?.feedByCategory ?? {}),
  }

  const commentsByLookId: Record<string, UiComment[]> = {
    look_1: [makeComment()],
    ...(args?.commentsByLookId ?? {}),
  }

  const likeState = new Map<string, { liked: boolean; likeCount: number }>()
  for (const items of Object.values(feedByCategory)) {
    for (const item of items) {
      likeState.set(item.id, {
        liked: item.viewerLiked,
        likeCount: item._count.likes,
      })
    }
  }

  const fetchMock = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url

      const method = init?.method ?? 'GET'

      if (url === '/api/looks/categories') {
        return jsonResponse({
          categories,
        })
      }

      if (url.startsWith('/api/looks?')) {
        const parsed = new URL(url, 'http://localhost')
        const category = parsed.searchParams.get('category') ?? 'all'
        const items = feedByCategory[category] ?? []
        return jsonResponse({
          items: clone(items),
          nextCursor: null,
        })
      }

      const likeMatch = url.match(/^\/api\/looks\/([^/]+)\/like$/)
      if (likeMatch) {
        const lookPostId = decodeURIComponent(likeMatch[1] ?? '')
        const current = likeState.get(lookPostId) ?? {
          liked: false,
          likeCount: 0,
        }

        if (method === 'POST') {
          const next = {
            liked: true,
            likeCount: current.likeCount + 1,
          }
          likeState.set(lookPostId, next)

          return jsonResponse({
            lookPostId,
            liked: true,
            likeCount: next.likeCount,
          })
        }

        if (method === 'DELETE') {
          const next = {
            liked: false,
            likeCount: Math.max(0, current.likeCount - 1),
          }
          likeState.set(lookPostId, next)

          return jsonResponse({
            lookPostId,
            liked: false,
            likeCount: next.likeCount,
          })
        }
      }

      const commentsMatch = url.match(/^\/api\/looks\/([^/]+)\/comments$/)
      if (commentsMatch) {
        const lookPostId = decodeURIComponent(commentsMatch[1] ?? '')

        if (method === 'GET') {
          const comments = commentsByLookId[lookPostId] ?? []
          return jsonResponse({
            lookPostId,
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

          const nextComment: UiComment = makeComment({
            id: `comment_${(commentsByLookId[lookPostId]?.length ?? 0) + 1}`,
            body,
          })

          commentsByLookId[lookPostId] = [
            nextComment,
            ...(commentsByLookId[lookPostId] ?? []),
          ]

          return jsonResponse(
            {
              lookPostId,
              comment: clone(nextComment),
              commentsCount: commentsByLookId[lookPostId].length,
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

  return {
    fetchMock,
  }
}

describe('app/(main)/looks/_components/LooksFeed', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    vi.stubGlobal(
      'IntersectionObserver',
      class {
        observe() {}
        disconnect() {}
        unobserve() {}
      },
    )

    Object.defineProperty(HTMLElement.prototype, 'scrollTo', {
      configurable: true,
      value: vi.fn(),
    })

    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: mockWriteText,
      },
    })

    mockWriteText.mockReset()
    mockPush.mockReset()
  })

  it('passes canonical lookPostId into the like route and updates local like state', async () => {
    const { fetchMock } = installFetchMock({
      feedByCategory: {
        all: [makeFeedItem({ id: 'look_like_1', viewerLiked: false, _count: { likes: 3, comments: 1 } })],
      },
    })

    render(<LooksFeed />)

    const slide = await screen.findByTestId('look-slide-look_like_1')
    expect(within(slide).getByTestId('like-count')).toHaveTextContent('3')
    expect(within(slide).getByTestId('viewer-liked')).toHaveTextContent('false')

    fireEvent.click(
      within(slide).getByRole('button', { name: 'Toggle like' }),
    )

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/looks/look_like_1/like', {
        method: 'POST',
      })
    })

    await waitFor(() => {
      expect(within(slide).getByTestId('like-count')).toHaveTextContent('4')
      expect(within(slide).getByTestId('viewer-liked')).toHaveTextContent('true')
    })
  })

  it('opens comments and posts comments using the canonical lookPostId', async () => {
    const { fetchMock } = installFetchMock({
      feedByCategory: {
        all: [
          makeFeedItem({
            id: 'look_comment_1',
            _count: { likes: 2, comments: 1 },
          }),
        ],
      },
      commentsByLookId: {
        look_comment_1: [
          makeComment({
            id: 'comment_existing',
            body: 'Existing comment',
          }),
        ],
      },
    })

    render(<LooksFeed />)

    const slide = await screen.findByTestId('look-slide-look_comment_1')

    fireEvent.click(
      within(slide).getByRole('button', { name: 'Open comments' }),
    )

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/looks/look_comment_1/comments',
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

    fireEvent.click(
      screen.getByRole('button', { name: 'Post comment' }),
    )

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/looks/look_comment_1/comments',
        expect.objectContaining({
          method: 'POST',
        }),
      )
    })

    await waitFor(() => {
      expect(within(slide).getByTestId('comment-count')).toHaveTextContent('2')
    })

    expect(await screen.findByText(/Love this look/)).toBeInTheDocument()
  })

  it('keeps category selection working and refetches with the selected category slug', async () => {
    const { fetchMock } = installFetchMock({
      categories: [{ name: 'Hair', slug: 'hair' }],
      feedByCategory: {
        all: [makeFeedItem({ id: 'look_all_1', category: 'All' })],
        hair: [makeFeedItem({ id: 'look_hair_1', category: 'Hair' })],
      },
    })

    render(<LooksFeed />)

    expect(await screen.findByTestId('look-slide-look_all_1')).toBeInTheDocument()

    const scrollToMock = HTMLElement.prototype.scrollTo as ReturnType<typeof vi.fn>
    scrollToMock.mockClear()

    fireEvent.click(screen.getByRole('button', { name: 'Hair' }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/looks?limit=24&category=hair',
        expect.objectContaining({
          cache: 'no-store',
          headers: { Accept: 'application/json' },
        }),
      )
    })

    expect(await screen.findByTestId('look-slide-look_hair_1')).toBeInTheDocument()
    expect(screen.getByTestId('active-category')).toHaveTextContent('Hair')
    expect(scrollToMock).toHaveBeenCalled()
  })

  it('opens availability with discovery context keyed off the post item and leaves legacy mediaId empty', async () => {
    installFetchMock({
      feedByCategory: {
        all: [
          makeFeedItem({
            id: 'look_book_1',
            professional: {
              id: 'pro_book_1',
              businessName: 'Book Me',
              handle: 'bookme',
              professionType: 'BARBER',
              avatarUrl: null,
              location: 'San Diego, CA',
            },
            serviceId: 'service_book_1',
          }),
        ],
      },
    })

    render(<LooksFeed />)

    const slide = await screen.findByTestId('look-slide-look_book_1')

    fireEvent.click(
      within(slide).getByRole('button', { name: 'Open availability' }),
    )

    const drawer = await screen.findByTestId('availability-drawer')

    expect(drawer).toHaveAttribute('data-professional-id', 'pro_book_1')
    expect(drawer).toHaveAttribute('data-service-id', 'service_book_1')
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

  it('shares the canonical post id in the looks URL', async () => {
    mockWriteText.mockResolvedValue(undefined)

    installFetchMock({
      feedByCategory: {
        all: [makeFeedItem({ id: 'look_share_1' })],
      },
    })

    render(<LooksFeed />)

    const slide = await screen.findByTestId('look-slide-look_share_1')

    fireEvent.click(
      within(slide).getByRole('button', { name: 'Share' }),
    )

    await waitFor(() => {
      expect(mockWriteText).toHaveBeenCalledTimes(1)
    })

    const sharedUrl = mockWriteText.mock.calls[0]?.[0]
    expect(sharedUrl).toBe(`${window.location.origin}/looks?m=look_share_1`)
  })
})