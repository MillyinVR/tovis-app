// app/api/v1/looks/[id]/comments/[commentId]/replies/route.test.ts
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

  const prisma = {
    $transaction: vi.fn(async (arg: unknown[]) => Promise.all(arg)),
    lookComment: {
      findMany: vi.fn(),
      count: vi.fn(),
    },
  }

  return {
    jsonOk,
    jsonFail,
    prisma,
    getOptionalUser: vi.fn(),
    loadLookAccess: vi.fn(),
    canViewLookPost: vi.fn(),
    mapLooksCommentToDto: vi.fn(),
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
}))

vi.mock('@/app/api/_utils/auth/getOptionalUser', () => ({
  getOptionalUser: mocks.getOptionalUser,
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

vi.mock('@/lib/looks/mappers', () => ({
  mapLooksCommentToDto: mocks.mapLooksCommentToDto,
}))

import { GET } from './route'

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

function req() {
  return new Request(
    'http://localhost/api/v1/looks/look_1/comments/comment_1/replies',
  )
}

describe('app/api/v1/looks/[id]/comments/[commentId]/replies/route.ts GET', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getOptionalUser.mockResolvedValue(null)
    mocks.loadLookAccess.mockResolvedValue(makeAccess())
    mocks.canViewLookPost.mockReturnValue(true)
    mocks.prisma.lookComment.findMany.mockResolvedValue([])
    mocks.prisma.lookComment.count.mockResolvedValue(0)
    mocks.mapLooksCommentToDto.mockImplementation((row: { id: string }) => ({
      id: row.id,
    }))
  })

  it('lists approved replies of the parent oldest-first and returns the count', async () => {
    mocks.prisma.lookComment.findMany.mockResolvedValue([
      { id: 'reply_1' },
      { id: 'reply_2' },
    ])
    mocks.prisma.lookComment.count.mockResolvedValue(2)
    mocks.mapLooksCommentToDto
      .mockReturnValueOnce({ id: 'reply_1' })
      .mockReturnValueOnce({ id: 'reply_2' })

    const res = await GET(req(), makeCtx('look_1', 'comment_1'))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(mocks.prisma.lookComment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          lookPostId: 'look_1',
          parentCommentId: 'comment_1',
          moderationStatus: ModerationStatus.APPROVED,
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      }),
    )
    expect(body).toEqual({
      lookPostId: 'look_1',
      parentCommentId: 'comment_1',
      replies: [{ id: 'reply_1' }, { id: 'reply_2' }],
      replyCount: 2,
    })
  })

  it('returns 404 when the viewer cannot view the look', async () => {
    mocks.canViewLookPost.mockReturnValue(false)

    const res = await GET(req(), makeCtx('look_1', 'comment_1'))
    const body = await res.json()

    expect(res.status).toBe(404)
    expect(body).toMatchObject({ code: 'LOOK_NOT_FOUND' })
    expect(mocks.prisma.lookComment.findMany).not.toHaveBeenCalled()
  })

  it('returns 404 when the look cannot be resolved', async () => {
    mocks.loadLookAccess.mockResolvedValue(null)

    const res = await GET(req(), makeCtx('look_missing', 'comment_1'))
    const body = await res.json()

    expect(res.status).toBe(404)
    expect(body).toMatchObject({ code: 'LOOK_NOT_FOUND' })
  })
})
