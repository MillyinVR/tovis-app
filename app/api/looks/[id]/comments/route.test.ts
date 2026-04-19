// app/api/looks/[id]/comments/route.test.ts
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

type CommentsTxMock = {
  lookComment: {
    create: ReturnType<typeof vi.fn>
  }
}

type CommentsTransactionCallback = (
  tx: CommentsTxMock,
) => Promise<unknown> | unknown

const tx: CommentsTxMock = {
  lookComment: {
    create: vi.fn(),
  },
}

const prisma = {
  $transaction: vi.fn(async (callback: CommentsTransactionCallback) => {
    return await callback(tx)
  }),
  lookComment: {
    findMany: vi.fn(),
    count: vi.fn(),
  },
}

  const requireUser = vi.fn()
  const getCurrentUser = vi.fn()
  const loadLookAccess = vi.fn()
  const canViewLookPost = vi.fn()
  const canCommentOnLookPost = vi.fn()
  const recomputeLookPostCommentCount = vi.fn()
  const mapLooksCommentToDto = vi.fn()

  return {
    jsonOk,
    jsonFail,
    tx,
    prisma,
    requireUser,
    getCurrentUser,
    loadLookAccess,
    canViewLookPost,
    canCommentOnLookPost,
    recomputeLookPostCommentCount,
    mapLooksCommentToDto,
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
    return trimmed.length > 0 ? trimmed : null
  },
  requireUser: mocks.requireUser,
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
}))

vi.mock('@/lib/looks/counters', () => ({
  recomputeLookPostCommentCount: mocks.recomputeLookPostCommentCount,
}))

vi.mock('@/lib/looks/mappers', () => ({
  mapLooksCommentToDto: mocks.mapLooksCommentToDto,
}))

import { GET, POST } from './route'

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

function makeAuth(
  overrides?: Partial<{
    id: string
    role: Role
    clientProfile: { id: string } | null
    professionalProfile: { id: string } | null
  }>,
) {
  return {
    ok: true as const,
    user: {
      id: 'user_1',
      role: Role.CLIENT,
      clientProfile: { id: 'client_1' },
      professionalProfile: null,
      ...overrides,
    },
  }
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

function makeCommentRow(id = 'comment_1', body = 'Nice work') {
  return {
    id,
    body,
    createdAt: new Date('2026-04-18T12:00:00.000Z'),
    user: {
      id: 'user_2',
      clientProfile: {
        firstName: 'Tori',
        lastName: 'Morales',
        avatarUrl: null,
      },
      professionalProfile: null,
    },
  }
}

function makeCommentDto(id = 'comment_1', body = 'Nice work') {
  return {
    id,
    body,
    createdAt: '2026-04-18T12:00:00.000Z',
    user: {
      id: 'user_2',
      displayName: 'Tori Morales',
      avatarUrl: null,
    },
  }
}

describe('app/api/looks/[id]/comments/route.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mocks.requireUser.mockResolvedValue(makeAuth())
    mocks.getCurrentUser.mockResolvedValue(null)
    mocks.loadLookAccess.mockResolvedValue(makeAccess())
    mocks.canViewLookPost.mockReturnValue(true)
    mocks.canCommentOnLookPost.mockReturnValue(true)
    mocks.tx.lookComment.create.mockResolvedValue(makeCommentRow())
    mocks.recomputeLookPostCommentCount.mockResolvedValue(1)
    mocks.prisma.lookComment.findMany.mockResolvedValue([])
    mocks.prisma.lookComment.count.mockResolvedValue(0)
    mocks.mapLooksCommentToDto.mockImplementation((row: { id: string; body: string }) =>
      makeCommentDto(row.id, row.body),
    )
  })

  it('GET lists approved comments by canonical lookPostId and returns the canonical id in the contract', async () => {
    const row1 = makeCommentRow('comment_1', 'First')
    const row2 = makeCommentRow('comment_2', 'Second')
    const dto1 = makeCommentDto('comment_1', 'First')
    const dto2 = makeCommentDto('comment_2', 'Second')

    mocks.prisma.lookComment.findMany.mockResolvedValue([row1, row2])
    mocks.prisma.lookComment.count.mockResolvedValue(2)
    mocks.prisma.$transaction.mockResolvedValueOnce([[row1, row2], 2])
    mocks.mapLooksCommentToDto
      .mockReturnValueOnce(dto1)
      .mockReturnValueOnce(dto2)

    const res = await GET(
      new Request('http://localhost/api/looks/look_1/comments?limit=5'),
      makeCtx('look_1'),
    )
    const body = await readJson(res)

    expect(res.status).toBe(200)

    expect(mocks.loadLookAccess).toHaveBeenCalledWith(mocks.prisma, {
      lookPostId: 'look_1',
      viewerClientId: null,
      viewerProfessionalId: null,
    })

    expect(mocks.prisma.lookComment.findMany).toHaveBeenCalledWith({
      where: {
        lookPostId: 'look_1',
        moderationStatus: ModerationStatus.APPROVED,
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 5,
      select: expect.objectContaining({
        id: true,
        body: true,
        createdAt: true,
      }),
    })

    expect(mocks.prisma.lookComment.count).toHaveBeenCalledWith({
      where: {
        lookPostId: 'look_1',
        moderationStatus: ModerationStatus.APPROVED,
      },
    })

    expect(body).toEqual({
      lookPostId: 'look_1',
      comments: [dto1, dto2],
      commentsCount: 2,
    })
  })

  it('POST creates a comment by canonical lookPostId and returns the canonical id in the contract', async () => {
    const created = makeCommentRow('comment_9', 'Sharp work')
    const mapped = makeCommentDto('comment_9', 'Sharp work')

    mocks.tx.lookComment.create.mockResolvedValue(created)
    mocks.recomputeLookPostCommentCount.mockResolvedValue(4)
    mocks.mapLooksCommentToDto.mockReturnValue(mapped)

    const res = await POST(
      new Request('http://localhost/api/looks/look_1/comments', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ body: 'Sharp work' }),
      }),
      makeCtx('look_1'),
    )
    const body = await readJson(res)

    expect(res.status).toBe(201)

    expect(mocks.loadLookAccess).toHaveBeenCalledWith(mocks.prisma, {
      lookPostId: 'look_1',
      viewerClientId: 'client_1',
      viewerProfessionalId: null,
    })

    expect(mocks.canCommentOnLookPost).toHaveBeenCalledWith({
      isOwner: false,
      viewerRole: Role.CLIENT,
      status: LookPostStatus.PUBLISHED,
      visibility: LookPostVisibility.PUBLIC,
      moderationStatus: ModerationStatus.APPROVED,
      proVerificationStatus: VerificationStatus.APPROVED,
      viewerFollowsProfessional: false,
    })

    expect(mocks.tx.lookComment.create).toHaveBeenCalledWith({
      data: {
        lookPostId: 'look_1',
        userId: 'user_1',
        body: 'Sharp work',
      },
      select: expect.objectContaining({
        id: true,
        body: true,
        createdAt: true,
      }),
    })

    expect(mocks.recomputeLookPostCommentCount).toHaveBeenCalledWith(
      mocks.tx,
      'look_1',
    )

    expect(body).toEqual({
      lookPostId: 'look_1',
      comment: mapped,
      commentsCount: 4,
    })
  })

  it('returns 403 when the shared interaction policy forbids comments', async () => {
    mocks.canCommentOnLookPost.mockReturnValue(false)

    const res = await POST(
      new Request('http://localhost/api/looks/look_1/comments', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ body: 'Nope' }),
      }),
      makeCtx('look_1'),
    )
    const body = await readJson(res)

    expect(res.status).toBe(403)
    expect(body).toEqual({
      ok: false,
      error: 'You can’t comment on this look.',
      code: 'COMMENTS_FORBIDDEN',
    })

    expect(mocks.tx.lookComment.create).not.toHaveBeenCalled()
  })

  it('returns 400 when the comment body is empty', async () => {
    const res = await POST(
      new Request('http://localhost/api/looks/look_1/comments', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ body: '   ' }),
      }),
      makeCtx('look_1'),
    )
    const body = await readJson(res)

    expect(res.status).toBe(400)
    expect(body).toEqual({
      ok: false,
      error: 'Comment cannot be empty.',
      code: 'EMPTY_COMMENT',
    })

    expect(mocks.tx.lookComment.create).not.toHaveBeenCalled()
  })

  it('returns 400 when the comment body is too long', async () => {
    const res = await POST(
      new Request('http://localhost/api/looks/look_1/comments', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ body: 'x'.repeat(501) }),
      }),
      makeCtx('look_1'),
    )
    const body = await readJson(res)

    expect(res.status).toBe(400)
    expect(body).toEqual({
      ok: false,
      error: 'Comment too long (max 500).',
      code: 'COMMENT_TOO_LONG',
    })

    expect(mocks.tx.lookComment.create).not.toHaveBeenCalled()
  })

  it('returns 404 when the canonical lookPostId cannot be resolved', async () => {
    mocks.loadLookAccess.mockResolvedValue(null)

    const res = await GET(
      new Request('http://localhost/api/looks/look_missing/comments'),
      makeCtx('look_missing'),
    )
    const body = await readJson(res)

    expect(res.status).toBe(404)
    expect(body).toEqual({
      ok: false,
      error: 'Not found.',
      code: 'LOOK_NOT_FOUND',
    })

    expect(mocks.prisma.lookComment.findMany).not.toHaveBeenCalled()
  })

  it('returns 404 when the viewer cannot view the look', async () => {
    mocks.canViewLookPost.mockReturnValue(false)

    const res = await GET(
      new Request('http://localhost/api/looks/look_1/comments'),
      makeCtx('look_1'),
    )
    const body = await readJson(res)

    expect(res.status).toBe(404)
    expect(body).toEqual({
      ok: false,
      error: 'Not found.',
      code: 'LOOK_NOT_FOUND',
    })

    expect(mocks.prisma.lookComment.findMany).not.toHaveBeenCalled()
  })

  it('does not treat legacy media ids as fallback identifiers', async () => {
    mocks.loadLookAccess.mockResolvedValue(null)

    const res = await GET(
      new Request('http://localhost/api/looks/media_legacy_1/comments'),
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

    expect(mocks.prisma.lookComment.findMany).not.toHaveBeenCalled()
  })
})