// app/api/looks/[id]/route.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  LookPostStatus,
  LookPostVisibility,
  ModerationStatus,
  Role,
  VerificationStatus,
} from '@prisma/client'

const mocks = vi.hoisted(() => {
  const jsonOk = vi.fn((data: unknown, status = 200) => {
    return new Response(JSON.stringify(data), {
      status,
      headers: { 'content-type': 'application/json' },
    })
  })

  const jsonFail = vi.fn(
    (
      status: number,
      message: string,
      details?: Record<string, unknown> | null,
    ) => {
      const safeDetails =
        typeof details === 'object' && details !== null && !Array.isArray(details)
          ? details
          : {}

      return new Response(
        JSON.stringify({
          ok: false,
          error: message,
          ...safeDetails,
        }),
        {
          status,
          headers: { 'content-type': 'application/json' },
        },
      )
    },
  )

  const prisma = {
    lookPost: {
      findUnique: vi.fn(),
    },
    lookLike: {
      findUnique: vi.fn(),
    },
  }

  const getCurrentUser = vi.fn()
  const loadLookAccess = vi.fn()
  const canViewLookPost = vi.fn()
  const canCommentOnLookPost = vi.fn()
  const canSaveLookPost = vi.fn()
  const canModerateLookPost = vi.fn()
  const mapLooksDetailMediaToRenderable = vi.fn()
  const mapLooksDetailToDto = vi.fn()

  const looksDetailSelect = {
    __testSelect: 'looks-detail-select',
  }

  return {
    jsonOk,
    jsonFail,
    prisma,
    getCurrentUser,
    loadLookAccess,
    canViewLookPost,
    canCommentOnLookPost,
    canSaveLookPost,
    canModerateLookPost,
    mapLooksDetailMediaToRenderable,
    mapLooksDetailToDto,
    looksDetailSelect,
  }
})

vi.mock('@/app/api/_utils', () => ({
  jsonOk: mocks.jsonOk,
  jsonFail: mocks.jsonFail,
  pickString: (value: string | null) => {
    if (typeof value !== 'string') return null
    const trimmed = value.trim()
    return trimmed.length > 0 ? trimmed : null
  },
}))

vi.mock('@/lib/prisma', () => ({
  prisma: mocks.prisma,
}))

vi.mock('@/lib/currentUser', () => ({
  getCurrentUser: mocks.getCurrentUser,
}))

vi.mock('@/lib/looks/access', () => ({
  loadLookAccess: mocks.loadLookAccess,
}))

vi.mock('@/lib/looks/guards', () => ({
  canViewLookPost: mocks.canViewLookPost,
  canCommentOnLookPost: mocks.canCommentOnLookPost,
  canSaveLookPost: mocks.canSaveLookPost,
  canModerateLookPost: mocks.canModerateLookPost,
}))

vi.mock('@/lib/looks/mappers', () => ({
  mapLooksDetailMediaToRenderable: mocks.mapLooksDetailMediaToRenderable,
  mapLooksDetailToDto: mocks.mapLooksDetailToDto,
}))

vi.mock('@/lib/looks/selects', () => ({
  looksDetailSelect: mocks.looksDetailSelect,
}))

import { GET } from './route'

type Params = { id: string }
type Ctx = { params: Params | Promise<Params> }

function makeCtx(id: string): Ctx {
  return {
    params: { id },
  }
}

async function readJson(res: Response): Promise<unknown> {
  return res.json()
}

function makeAccess(
  overrides?: Partial<{
    look: {
      id: string
      professionalId: string
      status: LookPostStatus
      visibility: LookPostVisibility
      moderationStatus: ModerationStatus
      professional: {
        id: string
        verificationStatus: VerificationStatus
      }
    }
    isOwner: boolean
    viewerFollowsProfessional: boolean
  }>,
) {
  return {
    look: {
      id: 'look_1',
      professionalId: 'pro_1',
      status: LookPostStatus.PUBLISHED,
      visibility: LookPostVisibility.PUBLIC,
      moderationStatus: ModerationStatus.APPROVED,
      professional: {
        id: 'pro_1',
        verificationStatus: VerificationStatus.APPROVED,
      },
    },
    isOwner: false,
    viewerFollowsProfessional: false,
    ...overrides,
  }
}

function makeDetailRow(
  overrides?: Partial<{
    id: string
    primaryMediaAssetId: string
  }>,
) {
  return {
    id: 'look_1',
    primaryMediaAssetId: 'media_1',
    ...overrides,
  }
}

function makeRenderableDetailRow(
  overrides?: Partial<{
    id: string
    primaryMediaAssetId: string
    archivedAt: Date | null
    removedAt: Date | null
  }>,
) {
  return {
    id: 'look_1',
    primaryMediaAssetId: 'media_1',
    archivedAt: null,
    removedAt: null,
    ...overrides,
  }
}

function makeMappedDetailDto(
  overrides?: Partial<{
    id: string
    caption: string | null
    status: LookPostStatus
    visibility: LookPostVisibility
    moderationStatus: ModerationStatus
    publishedAt: string | null
    createdAt: string
    updatedAt: string
    professional: {
      id: string
      businessName: string | null
      handle: string | null
      avatarUrl: string | null
      professionType: string | null
      location: string | null
      verificationStatus: VerificationStatus
      isPremium: boolean
    }
    service: {
      id: string
      name: string
      category: {
        name: string
        slug: string
      } | null
    } | null
    primaryMedia: {
      id: string
      url: string
      thumbUrl: string | null
      mediaType: string
      caption: string | null
      createdAt: string
      review: {
        id: string
        rating: number
        headline: string | null
        helpfulCount: number
      } | null
    }
    assets: Array<{
      id: string
      sortOrder: number
      mediaAssetId: string
      media: {
        id: string
        url: string
        thumbUrl: string | null
        mediaType: string
        caption: string | null
        createdAt: string
        review: {
          id: string
          rating: number
          headline: string | null
          helpfulCount: number
        } | null
      }
    }>
    _count: {
      likes: number
      comments: number
      saves: number
      shares: number
    }
    viewerContext: {
      isAuthenticated: boolean
      viewerLiked: boolean
      canComment: boolean
      canSave: boolean
      isOwner: boolean
    }
    admin?: {
      canModerate: true
      archivedAt: string | null
      removedAt: string | null
      primaryMediaAssetId: string
      primaryMedia: {
        visibility: string
        isEligibleForLooks: boolean
        isFeaturedInPortfolio: boolean
        reviewBody: string | null
      }
    }
  }>,
) {
  return {
    id: 'look_1',
    caption: 'Detailed caption',
    status: LookPostStatus.PUBLISHED,
    visibility: LookPostVisibility.PUBLIC,
    moderationStatus: ModerationStatus.APPROVED,
    publishedAt: '2026-04-18T12:00:00.000Z',
    createdAt: '2026-04-18T11:00:00.000Z',
    updatedAt: '2026-04-18T12:30:00.000Z',
    professional: {
      id: 'pro_1',
      businessName: 'TOVIS Studio',
      handle: 'tovisstudio',
      avatarUrl: 'https://cdn.example.com/pro-avatar.jpg',
      professionType: 'BARBER',
      location: 'San Diego, CA',
      verificationStatus: VerificationStatus.APPROVED,
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
      url: 'https://cdn.example.com/detail.jpg',
      thumbUrl: 'https://cdn.example.com/detail-thumb.jpg',
      mediaType: 'IMAGE',
      caption: 'Primary detail caption',
      createdAt: '2026-04-18T10:30:00.000Z',
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
          url: 'https://cdn.example.com/detail.jpg',
          thumbUrl: 'https://cdn.example.com/detail-thumb.jpg',
          mediaType: 'IMAGE',
          caption: 'Primary detail caption',
          createdAt: '2026-04-18T10:30:00.000Z',
          review: {
            id: 'review_1',
            rating: 5,
            headline: 'Love it',
            helpfulCount: 8,
          },
        },
      },
    ],
    _count: {
      likes: 4,
      comments: 2,
      saves: 1,
      shares: 0,
    },
    viewerContext: {
      isAuthenticated: false,
      viewerLiked: false,
      canComment: true,
      canSave: true,
      isOwner: false,
    },
    ...overrides,
  }
}

describe('app/api/looks/[id]/route.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mocks.getCurrentUser.mockResolvedValue(null)
    mocks.loadLookAccess.mockResolvedValue(makeAccess())
    mocks.canViewLookPost.mockReturnValue(true)
    mocks.canCommentOnLookPost.mockReturnValue(true)
    mocks.canSaveLookPost.mockReturnValue(true)
    mocks.canModerateLookPost.mockReturnValue(false)

    mocks.prisma.lookPost.findUnique.mockResolvedValue(makeDetailRow())
    mocks.prisma.lookLike.findUnique.mockResolvedValue(null)

    mocks.mapLooksDetailMediaToRenderable.mockResolvedValue(
      makeRenderableDetailRow(),
    )
    mocks.mapLooksDetailToDto.mockReturnValue(makeMappedDetailDto())
  })

  it('fetches detail by canonical lookPost.id for a public viewer', async () => {
    const dbRow = makeDetailRow()
    const renderableRow = makeRenderableDetailRow()
    const dto = makeMappedDetailDto()

    mocks.prisma.lookPost.findUnique.mockResolvedValue(dbRow)
    mocks.mapLooksDetailMediaToRenderable.mockResolvedValue(renderableRow)
    mocks.mapLooksDetailToDto.mockReturnValue(dto)

    const res = await GET(
      new Request('http://localhost/api/looks/look_1'),
      makeCtx('look_1'),
    )
    const body = await readJson(res)

    expect(res.status).toBe(200)

    expect(mocks.loadLookAccess).toHaveBeenCalledWith(mocks.prisma, {
      lookPostId: 'look_1',
      viewerClientId: null,
      viewerProfessionalId: null,
    })

    expect(mocks.canViewLookPost).toHaveBeenCalledWith({
      isOwner: false,
      viewerRole: null,
      status: LookPostStatus.PUBLISHED,
      visibility: LookPostVisibility.PUBLIC,
      moderationStatus: ModerationStatus.APPROVED,
      proVerificationStatus: VerificationStatus.APPROVED,
      viewerFollowsProfessional: false,
    })

    expect(mocks.prisma.lookPost.findUnique).toHaveBeenCalledWith({
      where: { id: 'look_1' },
      select: mocks.looksDetailSelect,
    })

    expect(mocks.prisma.lookLike.findUnique).not.toHaveBeenCalled()
    expect(mocks.mapLooksDetailMediaToRenderable).toHaveBeenCalledWith(dbRow)

    expect(mocks.mapLooksDetailToDto).toHaveBeenCalledWith({
      item: renderableRow,
      viewerContext: {
        isAuthenticated: false,
        viewerLiked: false,
        canComment: true,
        canSave: true,
        isOwner: false,
        canModerate: false,
      },
    })

    expect(body).toEqual({
      item: dto,
    })
  })

  it('hydrates viewerLiked for a signed-in viewer', async () => {
    const dto = makeMappedDetailDto({
      viewerContext: {
        isAuthenticated: true,
        viewerLiked: true,
        canComment: true,
        canSave: true,
        isOwner: false,
      },
    })

    mocks.getCurrentUser.mockResolvedValue({
      id: 'user_1',
      role: Role.CLIENT,
      clientProfile: { id: 'client_1' },
      professionalProfile: null,
    })
    mocks.prisma.lookLike.findUnique.mockResolvedValue({
      lookPostId: 'look_1',
    })
    mocks.mapLooksDetailToDto.mockReturnValue(dto)

    const res = await GET(
      new Request('http://localhost/api/looks/look_1'),
      makeCtx('look_1'),
    )
    const body = await readJson(res)

    expect(res.status).toBe(200)

    expect(mocks.loadLookAccess).toHaveBeenCalledWith(mocks.prisma, {
      lookPostId: 'look_1',
      viewerClientId: 'client_1',
      viewerProfessionalId: null,
    })

    expect(mocks.prisma.lookLike.findUnique).toHaveBeenCalledWith({
      where: {
        lookPostId_userId: {
          lookPostId: 'look_1',
          userId: 'user_1',
        },
      },
      select: {
        lookPostId: true,
      },
    })

    expect(mocks.mapLooksDetailToDto).toHaveBeenCalledWith({
      item: makeRenderableDetailRow(),
      viewerContext: {
        isAuthenticated: true,
        viewerLiked: true,
        canComment: true,
        canSave: true,
        isOwner: false,
        canModerate: false,
      },
    })

    expect(body).toEqual({
      item: dto,
    })
  })

  it('passes isOwner=true through viewer context for the author', async () => {
    const dto = makeMappedDetailDto({
      viewerContext: {
        isAuthenticated: true,
        viewerLiked: false,
        canComment: true,
        canSave: true,
        isOwner: true,
      },
    })

    mocks.getCurrentUser.mockResolvedValue({
      id: 'user_pro_1',
      role: Role.PRO,
      clientProfile: null,
      professionalProfile: { id: 'pro_1' },
    })
    mocks.loadLookAccess.mockResolvedValue(
      makeAccess({
        isOwner: true,
      }),
    )
    mocks.mapLooksDetailToDto.mockReturnValue(dto)

    const res = await GET(
      new Request('http://localhost/api/looks/look_1'),
      makeCtx('look_1'),
    )
    const body = await readJson(res)

    expect(res.status).toBe(200)

    expect(mocks.loadLookAccess).toHaveBeenCalledWith(mocks.prisma, {
      lookPostId: 'look_1',
      viewerClientId: null,
      viewerProfessionalId: 'pro_1',
    })

    expect(mocks.mapLooksDetailToDto).toHaveBeenCalledWith({
      item: makeRenderableDetailRow(),
      viewerContext: {
        isAuthenticated: true,
        viewerLiked: false,
        canComment: true,
        canSave: true,
        isOwner: true,
        canModerate: false,
      },
    })

    expect(body).toEqual({
      item: dto,
    })
  })

  it('passes canModerate=true through viewer context for admins', async () => {
    const dto = makeMappedDetailDto({
      viewerContext: {
        isAuthenticated: true,
        viewerLiked: false,
        canComment: false,
        canSave: false,
        isOwner: false,
      },
      admin: {
        canModerate: true,
        archivedAt: null,
        removedAt: null,
        primaryMediaAssetId: 'media_1',
        primaryMedia: {
          visibility: 'PUBLIC',
          isEligibleForLooks: true,
          isFeaturedInPortfolio: false,
          reviewBody: 'Looks amazing',
        },
      },
    })

    mocks.getCurrentUser.mockResolvedValue({
      id: 'admin_1',
      role: Role.ADMIN,
      clientProfile: null,
      professionalProfile: null,
    })
    mocks.canCommentOnLookPost.mockReturnValue(false)
    mocks.canSaveLookPost.mockReturnValue(false)
    mocks.canModerateLookPost.mockReturnValue(true)
    mocks.mapLooksDetailToDto.mockReturnValue(dto)

    const res = await GET(
      new Request('http://localhost/api/looks/look_1'),
      makeCtx('look_1'),
    )
    const body = await readJson(res)

    expect(res.status).toBe(200)

    expect(mocks.canModerateLookPost).toHaveBeenCalledWith({
      viewerRole: Role.ADMIN,
    })

    expect(mocks.mapLooksDetailToDto).toHaveBeenCalledWith({
      item: makeRenderableDetailRow(),
      viewerContext: {
        isAuthenticated: true,
        viewerLiked: false,
        canComment: false,
        canSave: false,
        isOwner: false,
        canModerate: true,
      },
    })

    expect(body).toEqual({
      item: dto,
    })
  })

  it('returns 404 when the look is not found', async () => {
    mocks.loadLookAccess.mockResolvedValue(null)

    const res = await GET(
      new Request('http://localhost/api/looks/look_missing'),
      makeCtx('look_missing'),
    )
    const body = await readJson(res)

    expect(res.status).toBe(404)
    expect(body).toEqual({
      ok: false,
      error: 'Not found.',
      code: 'LOOK_NOT_FOUND',
    })

    expect(mocks.prisma.lookPost.findUnique).not.toHaveBeenCalled()
    expect(mocks.prisma.lookLike.findUnique).not.toHaveBeenCalled()
    expect(mocks.mapLooksDetailMediaToRenderable).not.toHaveBeenCalled()
    expect(mocks.mapLooksDetailToDto).not.toHaveBeenCalled()
  })

  it('returns 404 when the viewer cannot see the look', async () => {
    mocks.canViewLookPost.mockReturnValue(false)

    const res = await GET(
      new Request('http://localhost/api/looks/look_1'),
      makeCtx('look_1'),
    )
    const body = await readJson(res)

    expect(res.status).toBe(404)
    expect(body).toEqual({
      ok: false,
      error: 'Not found.',
      code: 'LOOK_NOT_FOUND',
    })

    expect(mocks.prisma.lookPost.findUnique).not.toHaveBeenCalled()
    expect(mocks.prisma.lookLike.findUnique).not.toHaveBeenCalled()
    expect(mocks.mapLooksDetailMediaToRenderable).not.toHaveBeenCalled()
    expect(mocks.mapLooksDetailToDto).not.toHaveBeenCalled()
  })

  it('does not support legacy media ids as a fallback lookup', async () => {
    mocks.loadLookAccess.mockResolvedValue(null)

    const res = await GET(
      new Request('http://localhost/api/looks/media_legacy_1'),
      makeCtx('media_legacy_1'),
    )
    const body = await readJson(res)

    expect(res.status).toBe(404)
    expect(body).toEqual({
      ok: false,
      error: 'Not found.',
      code: 'LOOK_NOT_FOUND',
    })

    expect(mocks.loadLookAccess).toHaveBeenCalledWith(mocks.prisma, {
      lookPostId: 'media_legacy_1',
      viewerClientId: null,
      viewerProfessionalId: null,
    })

    expect(mocks.prisma.lookPost.findUnique).not.toHaveBeenCalled()
    expect(mocks.prisma.lookLike.findUnique).not.toHaveBeenCalled()
  })

  it('returns 400 when the route param is blank', async () => {
    const res = await GET(
      new Request('http://localhost/api/looks/%20%20'),
      makeCtx('   '),
    )
    const body = await readJson(res)

    expect(res.status).toBe(400)
    expect(body).toEqual({
      ok: false,
      error: 'Missing look id.',
      code: 'MISSING_LOOK_ID',
    })

    expect(mocks.loadLookAccess).not.toHaveBeenCalled()
    expect(mocks.prisma.lookPost.findUnique).not.toHaveBeenCalled()
  })

  it('returns 500 when rendered detail media cannot be produced', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    mocks.mapLooksDetailMediaToRenderable.mockResolvedValue(null)

    const res = await GET(
      new Request('http://localhost/api/looks/look_1'),
      makeCtx('look_1'),
    )
    const body = await readJson(res)

    expect(res.status).toBe(500)
    expect(body).toEqual({
      ok: false,
      error: 'Couldn’t load that look. Try again.',
      code: 'INTERNAL',
    })

    consoleError.mockRestore()
  })

  it('returns 500 when loading detail throws', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    mocks.prisma.lookPost.findUnique.mockRejectedValue(new Error('db blew up'))

    const res = await GET(
      new Request('http://localhost/api/looks/look_1'),
      makeCtx('look_1'),
    )
    const body = await readJson(res)

    expect(res.status).toBe(500)
    expect(body).toEqual({
      ok: false,
      error: 'Couldn’t load that look. Try again.',
      code: 'INTERNAL',
    })

    consoleError.mockRestore()
  })
})