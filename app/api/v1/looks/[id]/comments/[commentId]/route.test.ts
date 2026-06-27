// app/api/v1/looks/[id]/comments/[commentId]/route.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  LookPostStatus,
  LookPostVisibility,
  ModerationStatus,
  Role,
  VerificationStatus,
} from '@prisma/client'

type TxMock = {
  lookComment: {
    update: ReturnType<typeof vi.fn>
    updateMany: ReturnType<typeof vi.fn>
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
    lookComment: {
      update: vi.fn(),
      updateMany: vi.fn(),
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
    recomputeLookCommentReplyCount: vi.fn(),
    recomputeLookPostCommentCount: vi.fn(),
    enqueueRecomputeLookCounts: vi.fn(),
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
}))

vi.mock('@/lib/looks/counters', () => ({
  recomputeLookCommentReplyCount: mocks.recomputeLookCommentReplyCount,
  recomputeLookPostCommentCount: mocks.recomputeLookPostCommentCount,
}))

vi.mock('@/lib/jobs/looksSocial/enqueue', () => ({
  enqueueRecomputeLookCounts: mocks.enqueueRecomputeLookCounts,
}))

import { DELETE } from './route'

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

function asClient(id = 'user_1') {
  return {
    ok: true as const,
    user: {
      id,
      role: Role.CLIENT,
      clientProfile: { id: 'client_1' },
      professionalProfile: null,
    },
  }
}

function req() {
  return new Request('http://localhost/api/v1/looks/look_1/comments/comment_1', {
    method: 'DELETE',
  })
}

describe('app/api/v1/looks/[id]/comments/[commentId]/route.ts DELETE', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireUser.mockResolvedValue(asClient())
    mocks.loadLookAccess.mockResolvedValue(makeAccess())
    mocks.canViewLookPost.mockReturnValue(true)
    mocks.recomputeLookPostCommentCount.mockResolvedValue(0)
    mocks.enqueueRecomputeLookCounts.mockResolvedValue(undefined)
    mocks.prisma.lookComment.findFirst.mockResolvedValue({
      id: 'comment_1',
      userId: 'user_1',
      parentCommentId: null,
    })
  })

  it('soft-removes an author’s top-level comment AND its replies, then recomputes', async () => {
    mocks.recomputeLookPostCommentCount.mockResolvedValue(2)

    const res = await DELETE(req(), makeCtx('look_1', 'comment_1'))
    const body = await res.json()

    expect(res.status).toBe(200)

    // The comment itself is soft-removed.
    expect(mocks.tx.lookComment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'comment_1' },
        data: expect.objectContaining({
          moderationStatus: ModerationStatus.REMOVED,
        }),
      }),
    )

    // Its approved replies are swept with it.
    expect(mocks.tx.lookComment.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          parentCommentId: 'comment_1',
          moderationStatus: ModerationStatus.APPROVED,
        },
        data: expect.objectContaining({
          moderationStatus: ModerationStatus.REMOVED,
        }),
      }),
    )

    // Top-level delete does NOT recompute a parent reply count.
    expect(mocks.recomputeLookCommentReplyCount).not.toHaveBeenCalled()
    expect(mocks.recomputeLookPostCommentCount).toHaveBeenCalledWith(
      mocks.tx,
      'look_1',
    )
    expect(mocks.enqueueRecomputeLookCounts).toHaveBeenCalledWith(mocks.tx, {
      lookPostId: 'look_1',
    })
    expect(body).toEqual({
      lookPostId: 'look_1',
      commentId: 'comment_1',
      deleted: true,
      commentsCount: 2,
    })
  })

  it('deleting a reply recomputes the parent reply count and skips the cascade', async () => {
    mocks.prisma.lookComment.findFirst.mockResolvedValue({
      id: 'reply_1',
      userId: 'user_1',
      parentCommentId: 'comment_1',
    })

    const res = await DELETE(req(), makeCtx('look_1', 'reply_1'))

    expect(res.status).toBe(200)
    expect(mocks.tx.lookComment.updateMany).not.toHaveBeenCalled()
    expect(mocks.recomputeLookCommentReplyCount).toHaveBeenCalledWith(
      mocks.tx,
      'comment_1',
    )
  })

  it('lets an admin delete someone else’s comment', async () => {
    mocks.requireUser.mockResolvedValue({
      ok: true as const,
      user: {
        id: 'admin_1',
        role: Role.ADMIN,
        clientProfile: null,
        professionalProfile: null,
      },
    })
    mocks.prisma.lookComment.findFirst.mockResolvedValue({
      id: 'comment_1',
      userId: 'someone_else',
      parentCommentId: null,
    })

    const res = await DELETE(req(), makeCtx('look_1', 'comment_1'))

    expect(res.status).toBe(200)
    expect(mocks.tx.lookComment.update).toHaveBeenCalled()
  })

  it('returns 403 when a non-author non-admin tries to delete', async () => {
    mocks.prisma.lookComment.findFirst.mockResolvedValue({
      id: 'comment_1',
      userId: 'someone_else',
      parentCommentId: null,
    })

    const res = await DELETE(req(), makeCtx('look_1', 'comment_1'))
    const body = await res.json()

    expect(res.status).toBe(403)
    expect(body).toMatchObject({ code: 'COMMENT_DELETE_FORBIDDEN' })
    expect(mocks.tx.lookComment.update).not.toHaveBeenCalled()
  })

  it('returns 404 when the comment is not an approved row on this look', async () => {
    mocks.prisma.lookComment.findFirst.mockResolvedValue(null)

    const res = await DELETE(req(), makeCtx('look_1', 'comment_1'))
    const body = await res.json()

    expect(res.status).toBe(404)
    expect(body).toMatchObject({ code: 'COMMENT_NOT_FOUND' })
  })
})
