// app/(main)/looks/[id]/page.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { isValidElement } from 'react'

const mocks = vi.hoisted(() => ({
  headers: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND')
  }),
  parseLooksDetailResponse: vi.fn(),
  LookDetailClient: vi.fn(() => null),
}))

vi.mock('next/headers', () => ({
  headers: mocks.headers,
}))

vi.mock('next/navigation', () => ({
  notFound: mocks.notFound,
}))

vi.mock('@/lib/looks/parsers', () => ({
  parseLooksDetailResponse: mocks.parseLooksDetailResponse,
}))

vi.mock('./LookDetailClient', () => ({
  default: mocks.LookDetailClient,
}))

import LookDetailPage from './page'

describe('app/(main)/looks/[id]/page.tsx', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mocks.headers.mockResolvedValue(
      new Headers({
        host: 'app.test',
        'x-forwarded-proto': 'https',
      }),
    )

    mocks.parseLooksDetailResponse.mockReturnValue({
      id: 'look_1',
      caption: 'Look caption',
      status: 'PUBLISHED',
      visibility: 'PUBLIC',
      moderationStatus: 'APPROVED',
      publishedAt: null,
      createdAt: '2026-04-20T00:00:00.000Z',
      updatedAt: '2026-04-20T00:00:00.000Z',
      professional: {
        id: 'pro_1',
        businessName: 'TOVIS Studio',
        handle: 'tovisstudio',
        avatarUrl: null,
        professionType: 'BARBER',
        location: 'San Diego, CA',
        verificationStatus: 'APPROVED',
        isPremium: false,
      },
      service: null,
      primaryMedia: {
        id: 'media_1',
        url: 'https://cdn.example.com/look.jpg',
        thumbUrl: null,
        mediaType: 'IMAGE',
        caption: null,
        createdAt: '2026-04-20T00:00:00.000Z',
        review: null,
      },
      assets: [],
      _count: {
        likes: 1,
        comments: 2,
        saves: 3,
        shares: 4,
      },
      viewerContext: {
        isAuthenticated: false,
        viewerLiked: false,
        canComment: true,
        canSave: true,
        isOwner: false,
      },
    })
  })

  it('fetches canonical post detail from /api/looks/[id]', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ item: { id: 'look_1' } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    )

    const result = await LookDetailPage({
      params: Promise.resolve({ id: 'look_1' }),
    })

    expect(fetch).toHaveBeenCalledWith(
      'https://app.test/api/looks/look_1',
      expect.objectContaining({
        cache: 'no-store',
        headers: { Accept: 'application/json' },
      }),
    )

    expect(isValidElement(result)).toBe(true)
    expect(result.props.initialItem).toEqual(
      expect.objectContaining({ id: 'look_1' }),
    )
  })

  it('calls notFound on 404', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(null, { status: 404 }),
      ),
    )

    await expect(
      LookDetailPage({
        params: Promise.resolve({ id: 'look_missing' }),
      }),
    ).rejects.toThrow('NEXT_NOT_FOUND')

    expect(mocks.notFound).toHaveBeenCalled()
  })
})