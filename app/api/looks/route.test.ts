import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  MediaType,
  MediaVisibility,
  Prisma,
  ProfessionType,
  Role,
} from '@prisma/client'

import { PUBLICLY_APPROVED_PRO_STATUSES } from '@/lib/proTrustState'

const mocks = vi.hoisted(() => {
  const jsonOk = vi.fn((data: unknown, status = 200) => {
    return new Response(JSON.stringify(data), {
      status,
      headers: { 'content-type': 'application/json' },
    })
  })

  const jsonFail = vi.fn((status: number, message: string) => {
    return new Response(JSON.stringify({ ok: false, error: message }), {
      status,
      headers: { 'content-type': 'application/json' },
    })
  })

  const prisma = {
    mediaAsset: {
      findMany: vi.fn(),
    },
    mediaLike: {
      findMany: vi.fn(),
    },
  }

  const getCurrentUser = vi.fn()
  const renderMediaUrls = vi.fn()

  return {
    jsonOk,
    jsonFail,
    prisma,
    getCurrentUser,
    renderMediaUrls,
  }
})

vi.mock('@/app/api/_utils', () => ({
  jsonOk: mocks.jsonOk,
  jsonFail: mocks.jsonFail,
  pickInt: (value: string | null) => {
    if (!value) return null
    const parsed = Number.parseInt(value, 10)
    return Number.isFinite(parsed) ? parsed : null
  },
  pickString: (value: string | null) => {
    if (typeof value !== 'string') return null
    const trimmed = value.trim()
    return trimmed.length ? trimmed : null
  },
}))

vi.mock('@/lib/prisma', () => ({
  prisma: mocks.prisma,
}))

vi.mock('@/lib/currentUser', () => ({
  getCurrentUser: mocks.getCurrentUser,
}))

vi.mock('@/lib/media/renderUrls', () => ({
  renderMediaUrls: mocks.renderMediaUrls,
}))

import { GET } from './route'

function makeRequest(path: string) {
  return new Request(`http://localhost${path}`)
}

async function readJson<T>(res: Response): Promise<T> {
  return (await res.json()) as T
}

function makeApprovedMediaRow() {
  return {
    id: 'media_1',
    url: 'https://cdn.example.com/full.jpg',
    thumbUrl: 'https://cdn.example.com/thumb.jpg',
    storageBucket: null,
    storagePath: null,
    thumbBucket: null,
    thumbPath: null,
    mediaType: MediaType.IMAGE,
    caption: 'Fresh cut',
    createdAt: new Date('2026-04-01T12:00:00.000Z'),
    uploadedByRole: Role.PRO,
    uploadedByUserId: 'user_pro_1',
    reviewId: null,
    review: null,
    professional: {
      id: 'pro_1',
      businessName: 'TOVIS Studio',
      handle: 'tovisstudio',
      avatarUrl: null,
      professionType: ProfessionType.BARBER,
      location: 'San Diego, CA',
    },
    services: [
      {
        service: {
          id: 'svc_1',
          name: 'Fade',
          category: {
            name: 'Hair',
            slug: 'hair',
          },
        },
      },
    ],
    _count: {
      likes: 3,
      comments: 1,
    },
  }
}

describe('app/api/looks/route.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mocks.getCurrentUser.mockResolvedValue(null)
    mocks.prisma.mediaAsset.findMany.mockResolvedValue([])
    mocks.prisma.mediaLike.findMany.mockResolvedValue([])
    mocks.renderMediaUrls.mockResolvedValue({
      renderUrl: 'https://cdn.example.com/rendered.jpg',
      renderThumbUrl: 'https://cdn.example.com/rendered-thumb.jpg',
    })
  })

  it('queries the public looks feed with an approved-pro trust gate', async () => {
    const res = await GET(makeRequest('/api/looks'))

    expect(res.status).toBe(200)

    expect(mocks.prisma.mediaAsset.findMany).toHaveBeenCalledWith({
      where: {
        visibility: MediaVisibility.PUBLIC,
        professional: {
          is: {
            verificationStatus: { in: [...PUBLICLY_APPROVED_PRO_STATUSES] },
          },
        },
        AND: [
          {
            OR: [{ isEligibleForLooks: true }, { isFeaturedInPortfolio: true }],
          },
        ],
      },
      orderBy: { createdAt: 'desc' },
      take: 12,
      select: {
        id: true,
        url: true,
        thumbUrl: true,
        storageBucket: true,
        storagePath: true,
        thumbBucket: true,
        thumbPath: true,
        mediaType: true,
        caption: true,
        createdAt: true,
        uploadedByRole: true,
        uploadedByUserId: true,
        reviewId: true,
        review: {
          select: {
            helpfulCount: true,
            rating: true,
            headline: true,
          },
        },
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
        services: {
          select: {
            service: {
              select: {
                id: true,
                name: true,
                category: { select: { name: true, slug: true } },
              },
            },
          },
        },
        _count: { select: { likes: true, comments: true } },
      },
    })

    expect(mocks.prisma.mediaLike.findMany).not.toHaveBeenCalled()
  })

  it('returns mapped payload for approved public media', async () => {
    mocks.prisma.mediaAsset.findMany.mockResolvedValue([makeApprovedMediaRow()])

    const res = await GET(makeRequest('/api/looks?limit=20'))
    const body = await readJson<{
      ok: true
      items: Array<{
        id: string
        url: string
        thumbUrl: string | null
        mediaType: MediaType
        caption: string | null
        createdAt: string
        professional: {
          id: string
          businessName: string | null
          handle: string | null
          avatarUrl: string | null
          professionType: ProfessionType | null
          location: string | null
        } | null
        serviceId: string | null
        serviceName: string | null
        category: string | null
        serviceIds: string[]
        _count: {
          likes: number
          comments: number
        }
        viewerLiked: boolean
        uploadedByRole: Role | null
        reviewId: string | null
        reviewHelpfulCount: number | null
        reviewRating: number | null
        reviewHeadline: string | null
      }>
    }>(res)

    expect(res.status).toBe(200)
    expect(body).toEqual({
      ok: true,
      items: [
        {
          id: 'media_1',
          url: 'https://cdn.example.com/full.jpg',
          thumbUrl: 'https://cdn.example.com/thumb.jpg',
          mediaType: MediaType.IMAGE,
          caption: 'Fresh cut',
          createdAt: '2026-04-01T12:00:00.000Z',
          professional: {
            id: 'pro_1',
            businessName: 'TOVIS Studio',
            handle: 'tovisstudio',
            avatarUrl: null,
            professionType: ProfessionType.BARBER,
            location: 'San Diego, CA',
          },
          serviceId: 'svc_1',
          serviceName: 'Fade',
          category: 'Hair',
          serviceIds: ['svc_1'],
          _count: {
            likes: 3,
            comments: 1,
          },
          viewerLiked: false,
          uploadedByRole: Role.PRO,
          reviewId: null,
          reviewHelpfulCount: null,
          reviewRating: null,
          reviewHeadline: null,
        },
      ],
    })

    expect(mocks.renderMediaUrls).not.toHaveBeenCalled()
    expect(mocks.prisma.mediaLike.findMany).not.toHaveBeenCalled()
  })

  it('keeps the approved-pro trust gate on spotlight queries', async () => {
    const res = await GET(makeRequest('/api/looks?category=spotlight'))

    expect(res.status).toBe(200)

    expect(mocks.prisma.mediaAsset.findMany).toHaveBeenCalledWith({
      where: {
        visibility: MediaVisibility.PUBLIC,
        professional: {
          is: {
            verificationStatus: { in: [...PUBLICLY_APPROVED_PRO_STATUSES] },
          },
        },
        AND: [
          { reviewId: { not: null } },
          { uploadedByRole: Role.CLIENT },
          {
            review: {
              is: { helpfulCount: { gte: 25 } },
            },
          },
        ],
      },
      orderBy: [{ review: { helpfulCount: 'desc' } }, { createdAt: 'desc' }],
      take: 12,
      select: {
        id: true,
        url: true,
        thumbUrl: true,
        storageBucket: true,
        storagePath: true,
        thumbBucket: true,
        thumbPath: true,
        mediaType: true,
        caption: true,
        createdAt: true,
        uploadedByRole: true,
        uploadedByUserId: true,
        reviewId: true,
        review: {
          select: {
            helpfulCount: true,
            rating: true,
            headline: true,
          },
        },
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
        services: {
          select: {
            service: {
              select: {
                id: true,
                name: true,
                category: { select: { name: true, slug: true } },
              },
            },
          },
        },
        _count: { select: { likes: true, comments: true } },
      },
    })
  })

  it('returns 500 when loading the looks feed fails', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    mocks.prisma.mediaAsset.findMany.mockRejectedValue(new Error('db blew up'))

    const res = await GET(makeRequest('/api/looks'))
    const body = await readJson<{ ok: false; error: string }>(res)

    expect(res.status).toBe(500)
    expect(body).toEqual({
      ok: false,
      error: 'Failed to load looks.',
    })

    consoleError.mockRestore()
  })
})