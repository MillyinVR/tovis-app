// app/api/looks/[id]/comments/[commentId]/like/route.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  LookPostStatus,
  LookPostVisibility,
  ModerationStatus,
  Prisma,
  Role,
  VerificationStatus,
} from '@prisma/client'

type TxMock = {
  lookCommentLike: {
    create: ReturnType<typeof vi.fn>
    deleteMany: ReturnType<typeof vi.fn>
  }
}

const mocks = vi.hoisted(() => {
  const jsonOk = vi.fn((data: unknown, status = 200) => {
    return new Response(JSON.stringify(data), {
      status,
      headers: { 'content-type': 'application/json' },
    })
  })

  const jsonFail = vi.fn(
    (status: number, message: string, details?: Record<string, unknown> | null) => {
      const safe =
        typeof details === 'object' && details !== null && !Array.isArray(details)
          ? details
          : {}
      return new Response(JSON.stringify({ ok: false, error: message, ...safe }), {
        status,
        headers: { 'content-type': 'application/json' },
      })
    },
  )

  const tx: TxMock = {
    lookCommentLike: {
      create: vi.fn(),
      deleteMany: vi.fn(),
    },
  }

  const prisma = {
    $transaction: vi.fn(async (arg: ((tx: TxMock) => unknown) | unknown[]) => {
      if (typeof arg === 'function') return arg(tx)
      return Promise.all(arg as unknown[])
    }),
    lookComment: {
      findFirst: vi.fn(),
    },
  }

  return {
    jsonOk,
    jsonFail,
    tx,
    prisma,
    requireUser: vi.fn(),
    loadLookAccess: vi.fn(),
    canViewLookPost: vi.fn(),
    canCommentOnLookPost: vi.fn(),
    recomputeLookCommentLikeCount: vi.fn(),
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
  requireUser: mocks.requireUser,
}))

vi.mock('@/lib/prisma', () => ({ prisma: mocks.prisma }))

vi.mock('@/lib/looks/access', () => ({
  loadLookAccess: mocks.loadLookAccess,
  buildLookPolicyInput: (
    access: {
      isOwner: boolean
      viewerFollowsProfessional: boolean
      look: {
        status: LookPostStatus
        visibility: LookPostVisibility
        moderationStatus: ModerationStatus
        professional: { verificationStatus: VerificationStatus }
      }
    },
    viewerRole: Role | null,
  ) => ({
    isOwner: access.isOwner,
    viewerRole,
    status: access.look.status,
    visibility: access.look.visibility,
    moderationStatus: access.look.moderationStatus,
    proVerificationStatus: access.look.professional.verificationStatus,
    viewerFollowsProfessional: access.viewerFollowsProfessional,
  }),
}))

vi.mock('@/lib/looks/guards', () => ({
  canViewLookPost: mocks.canViewLookPost,
  canCommentOnLookPost: mocks.canCommentOnLookPost,
}))

vi.mock('@/lib/looks/counters', () => ({
  recomputeLookCommentLikeCount: mocks.recomputeLookCommentLikeCount,
}))

import { POST, DELETE } from './route'

type Params = { id: string; commentId: string }
function makeCtx(id: string, commentId: string): { params: Params } {
  return { params: { id, commentId } }
}

function makeAccess() {
  return {
    look: {
      id: 'look_1',
      professionalId: 'pro_1',
      status: LookPostStatus.PUBLISHED,
      visibility: LookPostVisibility.PUBLIC,
      moderationStatus: ModerationStatus.APPROVED,
      professional: { id: 'pro_1', verificationStatus: VerificationStatus.APPROVED },
    },
    isOwner: false,
    viewerFollowsProfessional: false,
  }
}

function req(method: string) {
  return new Request('http://localhost/api/looks/look_1/comments/comment_1/like', {
    method,
  })
}

describe('app/api/looks/[id]/comments/[commentId]/like/route.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireUser.mockResolvedValue({
      ok: true as const,
      user: {
        id: 'user_1',
        role: Role.CLIENT,
        clientProfile: { id: 'client_1' },
        professionalProfile: null,
      },
    })
    mocks.loadLookAccess.mockResolvedValue(makeAccess())
    mocks.canViewLookPost.mockReturnValue(true)
    mocks.canCommentOnLookPost.mockReturnValue(true)
    mocks.prisma.lookComment.findFirst.mockResolvedValue({ id: 'comment_1' })
    mocks.recomputeLookCommentLikeCount.mockResolvedValue(1)
  })

  it('POST creates a like, recomputes the count, and returns liked: true', async () => {
    mocks.recomputeLookCommentLikeCount.mockResolvedValue(4)

    const res = await POST(req('POST'), makeCtx('look_1', 'comment_1'))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(mocks.tx.lookCommentLike.create).toHaveBeenCalledWith({
      data: { lookCommentId: 'comment_1', userId: 'user_1' },
    })
    expect(mocks.recomputeLookCommentLikeCount).toHaveBeenCalledWith(
      mocks.tx,
      'comment_1',
    )
    expect(body).toEqual({
      lookPostId: 'look_1',
      commentId: 'comment_1',
      liked: true,
      likeCount: 4,
    })
  })

  it('POST swallows a duplicate-like P2002 and still returns the count', async () => {
    mocks.tx.lookCommentLike.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('dup', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    )
    mocks.recomputeLookCommentLikeCount.mockResolvedValue(1)

    const res = await POST(req('POST'), makeCtx('look_1', 'comment_1'))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toMatchObject({ liked: true, likeCount: 1 })
  })

  it('DELETE removes the like, recomputes, and returns liked: false', async () => {
    mocks.recomputeLookCommentLikeCount.mockResolvedValue(0)

    const res = await DELETE(req('DELETE'), makeCtx('look_1', 'comment_1'))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(mocks.tx.lookCommentLike.deleteMany).toHaveBeenCalledWith({
      where: { lookCommentId: 'comment_1', userId: 'user_1' },
    })
    expect(body).toEqual({
      lookPostId: 'look_1',
      commentId: 'comment_1',
      liked: false,
      likeCount: 0,
    })
  })

  it('returns 404 when the comment is not an approved row on this look', async () => {
    mocks.prisma.lookComment.findFirst.mockResolvedValue(null)

    const res = await POST(req('POST'), makeCtx('look_1', 'comment_1'))
    const body = await res.json()

    expect(res.status).toBe(404)
    expect(body).toMatchObject({ code: 'COMMENT_NOT_FOUND' })
    expect(mocks.tx.lookCommentLike.create).not.toHaveBeenCalled()
  })

  it('returns 403 when the interaction policy forbids commenting', async () => {
    mocks.canCommentOnLookPost.mockReturnValue(false)

    const res = await POST(req('POST'), makeCtx('look_1', 'comment_1'))
    const body = await res.json()

    expect(res.status).toBe(403)
    expect(body).toMatchObject({ code: 'COMMENTS_FORBIDDEN' })
    expect(mocks.prisma.lookComment.findFirst).not.toHaveBeenCalled()
  })

  it('returns the auth response when requireUser fails', async () => {
    const authResponse = new Response(JSON.stringify({ ok: false }), {
      status: 401,
    })
    mocks.requireUser.mockResolvedValue({ ok: false as const, res: authResponse })

    const res = await POST(req('POST'), makeCtx('look_1', 'comment_1'))

    expect(res.status).toBe(401)
    expect(mocks.loadLookAccess).not.toHaveBeenCalled()
  })
})
