// app/api/looks/[id]/comments/[commentId]/report/route.test.ts
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
        typeof details === 'object' &&
        details !== null &&
        !Array.isArray(details)
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

  const prisma = {}

  const requireUser = vi.fn()
  const loadLookAccess = vi.fn()
  const canViewLookPost = vi.fn()
  const findReportableLookComment = vi.fn()
  const createLookCommentReport = vi.fn()

  return {
    jsonOk,
    jsonFail,
    prisma,
    requireUser,
    loadLookAccess,
    canViewLookPost,
    findReportableLookComment,
    createLookCommentReport,
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

vi.mock('@/lib/prisma', () => ({
  prisma: mocks.prisma,
}))

vi.mock('@/lib/looks/access', () => ({
  loadLookAccess: mocks.loadLookAccess,
}))

vi.mock('@/lib/looks/guards', () => ({
  canViewLookPost: mocks.canViewLookPost,
}))

vi.mock('@/lib/looks/reporting', () => ({
  findReportableLookComment: mocks.findReportableLookComment,
  createLookCommentReport: mocks.createLookCommentReport,
}))

import { POST } from './route'

type Params = {
  id: string
  commentId: string
}

type Ctx = { params: Params | Promise<Params> }

function makeCtx(id: string, commentId: string): Ctx {
  return {
    params: { id, commentId },
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

function makeComment(
  overrides?: Partial<{
    id: string
    lookPostId: string
    moderationStatus: ModerationStatus
  }>,
) {
  return {
    id: 'comment_1',
    lookPostId: 'look_1',
    moderationStatus: ModerationStatus.APPROVED,
    ...overrides,
  }
}

describe('app/api/looks/[id]/comments/[commentId]/report/route.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mocks.requireUser.mockResolvedValue(makeAuth())
    mocks.loadLookAccess.mockResolvedValue(makeAccess())
    mocks.canViewLookPost.mockReturnValue(true)
    mocks.findReportableLookComment.mockResolvedValue(makeComment())
    mocks.createLookCommentReport.mockResolvedValue({
      status: 'accepted',
    })
  })

  it('POST reports a comment by canonical lookPostId + commentId and returns accepted on first submit', async () => {
    const res = await POST(
      new Request('http://localhost/api/looks/look_1/comments/comment_1/report', {
        method: 'POST',
      }),
      makeCtx('look_1', 'comment_1'),
    )
    const body = await readJson(res)

    expect(res.status).toBe(201)

    expect(mocks.loadLookAccess).toHaveBeenCalledWith(mocks.prisma, {
      lookPostId: 'look_1',
      viewerClientId: 'client_1',
      viewerProfessionalId: null,
    })

    expect(mocks.canViewLookPost).toHaveBeenCalledWith({
      isOwner: false,
      viewerRole: Role.CLIENT,
      status: LookPostStatus.PUBLISHED,
      visibility: LookPostVisibility.PUBLIC,
      moderationStatus: ModerationStatus.APPROVED,
      proVerificationStatus: VerificationStatus.APPROVED,
      viewerFollowsProfessional: false,
    })

    expect(mocks.findReportableLookComment).toHaveBeenCalledWith(mocks.prisma, {
      lookPostId: 'look_1',
      commentId: 'comment_1',
    })

    expect(mocks.createLookCommentReport).toHaveBeenCalledWith(mocks.prisma, {
      lookCommentId: 'comment_1',
      userId: 'user_1',
    })

    expect(body).toEqual({
      lookPostId: 'look_1',
      commentId: 'comment_1',
      status: 'accepted',
    })
  })

  it('POST returns already_reported on duplicate/idempotent submit', async () => {
    mocks.createLookCommentReport.mockResolvedValue({
      status: 'already_reported',
    })

    const res = await POST(
      new Request('http://localhost/api/looks/look_1/comments/comment_1/report', {
        method: 'POST',
      }),
      makeCtx('look_1', 'comment_1'),
    )
    const body = await readJson(res)

    expect(res.status).toBe(200)

    expect(mocks.createLookCommentReport).toHaveBeenCalledWith(mocks.prisma, {
      lookCommentId: 'comment_1',
      userId: 'user_1',
    })

    expect(body).toEqual({
      lookPostId: 'look_1',
      commentId: 'comment_1',
      status: 'already_reported',
    })
  })

  it('returns 400 when the look route param is blank', async () => {
    const res = await POST(
      new Request('http://localhost/api/looks/%20%20/comments/comment_1/report', {
        method: 'POST',
      }),
      makeCtx('   ', 'comment_1'),
    )
    const body = await readJson(res)

    expect(res.status).toBe(400)
    expect(body).toEqual({
      ok: false,
      error: 'Missing look id.',
      code: 'MISSING_LOOK_ID',
    })

    expect(mocks.loadLookAccess).not.toHaveBeenCalled()
    expect(mocks.findReportableLookComment).not.toHaveBeenCalled()
    expect(mocks.createLookCommentReport).not.toHaveBeenCalled()
  })

  it('returns 400 when the comment route param is blank', async () => {
    const res = await POST(
      new Request('http://localhost/api/looks/look_1/comments/%20%20/report', {
        method: 'POST',
      }),
      makeCtx('look_1', '   '),
    )
    const body = await readJson(res)

    expect(res.status).toBe(400)
    expect(body).toEqual({
      ok: false,
      error: 'Missing comment id.',
      code: 'MISSING_COMMENT_ID',
    })

    expect(mocks.loadLookAccess).not.toHaveBeenCalled()
    expect(mocks.findReportableLookComment).not.toHaveBeenCalled()
    expect(mocks.createLookCommentReport).not.toHaveBeenCalled()
  })

  it('returns 404 when the canonical lookPostId cannot be resolved', async () => {
    mocks.loadLookAccess.mockResolvedValue(null)

    const res = await POST(
      new Request(
        'http://localhost/api/looks/look_missing/comments/comment_1/report',
        {
          method: 'POST',
        },
      ),
      makeCtx('look_missing', 'comment_1'),
    )
    const body = await readJson(res)

    expect(res.status).toBe(404)
    expect(body).toEqual({
      ok: false,
      error: 'Not found.',
      code: 'LOOK_NOT_FOUND',
    })

    expect(mocks.findReportableLookComment).not.toHaveBeenCalled()
    expect(mocks.createLookCommentReport).not.toHaveBeenCalled()
  })

  it('returns 404 when the viewer cannot view the look', async () => {
    mocks.canViewLookPost.mockReturnValue(false)

    const res = await POST(
      new Request('http://localhost/api/looks/look_1/comments/comment_1/report', {
        method: 'POST',
      }),
      makeCtx('look_1', 'comment_1'),
    )
    const body = await readJson(res)

    expect(res.status).toBe(404)
    expect(body).toEqual({
      ok: false,
      error: 'Not found.',
      code: 'LOOK_NOT_FOUND',
    })

    expect(mocks.findReportableLookComment).not.toHaveBeenCalled()
    expect(mocks.createLookCommentReport).not.toHaveBeenCalled()
  })

  it('returns 404 when the comment cannot be resolved under the canonical lookPostId', async () => {
    mocks.findReportableLookComment.mockResolvedValue(null)

    const res = await POST(
      new Request(
        'http://localhost/api/looks/look_1/comments/comment_missing/report',
        {
          method: 'POST',
        },
      ),
      makeCtx('look_1', 'comment_missing'),
    )
    const body = await readJson(res)

    expect(res.status).toBe(404)
    expect(body).toEqual({
      ok: false,
      error: 'Not found.',
      code: 'COMMENT_NOT_FOUND',
    })

    expect(mocks.createLookCommentReport).not.toHaveBeenCalled()
  })

  it('does not treat legacy media ids as fallback identifiers', async () => {
    mocks.loadLookAccess.mockResolvedValue(null)

    const res = await POST(
      new Request(
        'http://localhost/api/looks/media_legacy_1/comments/comment_1/report',
        {
          method: 'POST',
        },
      ),
      makeCtx('media_legacy_1', 'comment_1'),
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
      viewerClientId: 'client_1',
      viewerProfessionalId: null,
    })

    expect(mocks.findReportableLookComment).not.toHaveBeenCalled()
    expect(mocks.createLookCommentReport).not.toHaveBeenCalled()
  })

  it('returns the auth response immediately when requireUser fails', async () => {
    const authResponse = new Response(
      JSON.stringify({
        ok: false,
        error: 'Unauthorized',
      }),
      {
        status: 401,
        headers: { 'content-type': 'application/json' },
      },
    )

    mocks.requireUser.mockResolvedValue({
      ok: false as const,
      res: authResponse,
    })

    const res = await POST(
      new Request('http://localhost/api/looks/look_1/comments/comment_1/report', {
        method: 'POST',
      }),
      makeCtx('look_1', 'comment_1'),
    )
    const body = await readJson(res)

    expect(res.status).toBe(401)
    expect(body).toEqual({
      ok: false,
      error: 'Unauthorized',
    })

    expect(mocks.loadLookAccess).not.toHaveBeenCalled()
    expect(mocks.findReportableLookComment).not.toHaveBeenCalled()
    expect(mocks.createLookCommentReport).not.toHaveBeenCalled()
  })

  it('returns 500 when report creation fails', async () => {
    mocks.createLookCommentReport.mockRejectedValue(
      new Error('report helper exploded'),
    )

    const res = await POST(
      new Request('http://localhost/api/looks/look_1/comments/comment_1/report', {
        method: 'POST',
      }),
      makeCtx('look_1', 'comment_1'),
    )
    const body = await readJson(res)

    expect(res.status).toBe(500)
    expect(body).toEqual({
      ok: false,
      error: 'Couldn’t submit that report. Try again.',
      code: 'INTERNAL',
    })
  })
})