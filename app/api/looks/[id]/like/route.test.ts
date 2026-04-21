// app/api/looks/[id]/like/route.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  LookPostStatus,
  LookPostVisibility,
  ModerationStatus,
  Prisma,
  Role,
  VerificationStatus,
} from '@prisma/client'

type LikeTxMock = {
  lookLike: {
    create: ReturnType<typeof vi.fn>
    deleteMany: ReturnType<typeof vi.fn>
  }
}

type LikeTransactionCallback = (tx: LikeTxMock) => Promise<unknown> | unknown

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

  const tx: LikeTxMock = {
    lookLike: {
      create: vi.fn(),
      deleteMany: vi.fn(),
    },
  }

  const prisma = {
    $transaction: vi.fn(async (callback: LikeTransactionCallback) => {
      return await callback(tx)
    }),
  }

  const requireUser = vi.fn()
  const loadLookAccess = vi.fn()
  const canViewLookPost = vi.fn()
  const canSaveLookPost = vi.fn()
  const recomputeLookPostLikeCount = vi.fn()
  const enqueueRecomputeLookCounts = vi.fn()

  return {
    jsonOk,
    jsonFail,
    tx,
    prisma,
    requireUser,
    loadLookAccess,
    canViewLookPost,
    canSaveLookPost,
    recomputeLookPostLikeCount,
    enqueueRecomputeLookCounts,
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
  canSaveLookPost: mocks.canSaveLookPost,
}))

vi.mock('@/lib/looks/counters', () => ({
  recomputeLookPostLikeCount: mocks.recomputeLookPostLikeCount,
}))

vi.mock('@/lib/jobs/looksSocial/enqueue', () => ({
  enqueueRecomputeLookCounts: mocks.enqueueRecomputeLookCounts,
}))

import { DELETE, POST } from './route'

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

describe('app/api/looks/[id]/like/route.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mocks.requireUser.mockResolvedValue(makeAuth())
    mocks.loadLookAccess.mockResolvedValue(makeAccess())
    mocks.canViewLookPost.mockReturnValue(true)
    mocks.canSaveLookPost.mockReturnValue(true)
    mocks.tx.lookLike.create.mockResolvedValue({ id: 'like_1' })
    mocks.tx.lookLike.deleteMany.mockResolvedValue({ count: 1 })
    mocks.recomputeLookPostLikeCount.mockResolvedValue(7)
    mocks.enqueueRecomputeLookCounts.mockResolvedValue({
      id: 'job_1',
      type: 'RECOMPUTE_LOOK_COUNTS',
      dedupeKey: 'look:look_1:recompute-counts',
      status: 'PENDING',
      runAt: new Date('2026-04-20T12:00:00.000Z'),
      attemptCount: 0,
      maxAttempts: 5,
    })
  })

  it('POST likes by canonical lookPostId, recomputes immediately, enqueues reconciliation, and returns the canonical id in the contract', async () => {
    const res = await POST(
      new Request('http://localhost/api/looks/look_1/like', {
        method: 'POST',
      }),
      makeCtx('look_1'),
    )
    const body = await readJson(res)

    expect(res.status).toBe(200)

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

    expect(mocks.canSaveLookPost).toHaveBeenCalledWith({
      isOwner: false,
      viewerRole: Role.CLIENT,
      status: LookPostStatus.PUBLISHED,
      visibility: LookPostVisibility.PUBLIC,
      moderationStatus: ModerationStatus.APPROVED,
      proVerificationStatus: VerificationStatus.APPROVED,
      viewerFollowsProfessional: false,
    })

    expect(mocks.tx.lookLike.create).toHaveBeenCalledWith({
      data: {
        lookPostId: 'look_1',
        userId: 'user_1',
      },
    })

    expect(mocks.recomputeLookPostLikeCount).toHaveBeenCalledWith(
      mocks.tx,
      'look_1',
    )

    expect(mocks.enqueueRecomputeLookCounts).toHaveBeenCalledWith(mocks.tx, {
      lookPostId: 'look_1',
    })

    expect(body).toEqual({
      lookPostId: 'look_1',
      liked: true,
      likeCount: 7,
    })
  })

  it('POST swallows duplicate like writes, still recomputes, and still enqueues reconciliation', async () => {
  mocks.tx.lookLike.create.mockRejectedValue(
    new Prisma.PrismaClientKnownRequestError('duplicate like', {
      code: 'P2002',
      clientVersion: 'test',
    }),
  )

  const res = await POST(
    new Request('http://localhost/api/looks/look_1/like', {
      method: 'POST',
    }),
    makeCtx('look_1'),
  )
  const body = await readJson(res)

  expect(res.status).toBe(200)

  expect(mocks.recomputeLookPostLikeCount).toHaveBeenCalledWith(
    mocks.tx,
    'look_1',
  )

  expect(mocks.enqueueRecomputeLookCounts).toHaveBeenCalledWith(mocks.tx, {
    lookPostId: 'look_1',
  })

  expect(body).toEqual({
    lookPostId: 'look_1',
    liked: true,
    likeCount: 7,
  })
})

  it('DELETE unlikes by canonical lookPostId, recomputes immediately, enqueues reconciliation, and returns the canonical id in the contract', async () => {
    mocks.recomputeLookPostLikeCount.mockResolvedValue(3)

    const res = await DELETE(
      new Request('http://localhost/api/looks/look_1/like', {
        method: 'DELETE',
      }),
      makeCtx('look_1'),
    )
    const body = await readJson(res)

    expect(res.status).toBe(200)

    expect(mocks.tx.lookLike.deleteMany).toHaveBeenCalledWith({
      where: {
        lookPostId: 'look_1',
        userId: 'user_1',
      },
    })

    expect(mocks.recomputeLookPostLikeCount).toHaveBeenCalledWith(
      mocks.tx,
      'look_1',
    )

    expect(mocks.enqueueRecomputeLookCounts).toHaveBeenCalledWith(mocks.tx, {
      lookPostId: 'look_1',
    })

    expect(body).toEqual({
      lookPostId: 'look_1',
      liked: false,
      likeCount: 3,
    })
  })

  it('returns 400 when the route param is blank', async () => {
    const res = await POST(
      new Request('http://localhost/api/looks/%20%20/like', {
        method: 'POST',
      }),
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
    expect(mocks.tx.lookLike.create).not.toHaveBeenCalled()
    expect(mocks.recomputeLookPostLikeCount).not.toHaveBeenCalled()
    expect(mocks.enqueueRecomputeLookCounts).not.toHaveBeenCalled()
  })

  it('returns 404 when the canonical lookPostId cannot be resolved', async () => {
    mocks.loadLookAccess.mockResolvedValue(null)

    const res = await POST(
      new Request('http://localhost/api/looks/look_missing/like', {
        method: 'POST',
      }),
      makeCtx('look_missing'),
    )
    const body = await readJson(res)

    expect(res.status).toBe(404)
    expect(body).toEqual({
      ok: false,
      error: 'Not found.',
      code: 'LOOK_NOT_FOUND',
    })

    expect(mocks.tx.lookLike.create).not.toHaveBeenCalled()
    expect(mocks.recomputeLookPostLikeCount).not.toHaveBeenCalled()
    expect(mocks.enqueueRecomputeLookCounts).not.toHaveBeenCalled()
  })

  it('returns 404 when the viewer cannot view the look', async () => {
    mocks.canViewLookPost.mockReturnValue(false)

    const res = await POST(
      new Request('http://localhost/api/looks/look_1/like', {
        method: 'POST',
      }),
      makeCtx('look_1'),
    )
    const body = await readJson(res)

    expect(res.status).toBe(404)
    expect(body).toEqual({
      ok: false,
      error: 'Not found.',
      code: 'LOOK_NOT_FOUND',
    })

    expect(mocks.canSaveLookPost).not.toHaveBeenCalled()
    expect(mocks.tx.lookLike.create).not.toHaveBeenCalled()
    expect(mocks.recomputeLookPostLikeCount).not.toHaveBeenCalled()
    expect(mocks.enqueueRecomputeLookCounts).not.toHaveBeenCalled()
  })

  it('returns 403 when the shared interaction policy forbids likes', async () => {
    mocks.canSaveLookPost.mockReturnValue(false)

    const res = await POST(
      new Request('http://localhost/api/looks/look_1/like', {
        method: 'POST',
      }),
      makeCtx('look_1'),
    )
    const body = await readJson(res)

    expect(res.status).toBe(403)
    expect(body).toEqual({
      ok: false,
      error: 'You can’t like this look.',
      code: 'LIKE_FORBIDDEN',
    })

    expect(mocks.tx.lookLike.create).not.toHaveBeenCalled()
    expect(mocks.recomputeLookPostLikeCount).not.toHaveBeenCalled()
    expect(mocks.enqueueRecomputeLookCounts).not.toHaveBeenCalled()
  })

  it('does not treat legacy media ids as fallback identifiers', async () => {
    mocks.loadLookAccess.mockResolvedValue(null)

    const res = await POST(
      new Request('http://localhost/api/looks/media_legacy_1/like', {
        method: 'POST',
      }),
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
      viewerClientId: 'client_1',
      viewerProfessionalId: null,
    })

    expect(mocks.tx.lookLike.create).not.toHaveBeenCalled()
    expect(mocks.recomputeLookPostLikeCount).not.toHaveBeenCalled()
    expect(mocks.enqueueRecomputeLookCounts).not.toHaveBeenCalled()
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
      new Request('http://localhost/api/looks/look_1/like', {
        method: 'POST',
      }),
      makeCtx('look_1'),
    )
    const body = await readJson(res)

    expect(res.status).toBe(401)
    expect(body).toEqual({
      ok: false,
      error: 'Unauthorized',
    })

    expect(mocks.loadLookAccess).not.toHaveBeenCalled()
    expect(mocks.tx.lookLike.create).not.toHaveBeenCalled()
    expect(mocks.recomputeLookPostLikeCount).not.toHaveBeenCalled()
    expect(mocks.enqueueRecomputeLookCounts).not.toHaveBeenCalled()
  })

  it('returns 500 when recompute fails', async () => {
    mocks.recomputeLookPostLikeCount.mockRejectedValue(
      new Error('recompute exploded'),
    )

    const res = await POST(
      new Request('http://localhost/api/looks/look_1/like', {
        method: 'POST',
      }),
      makeCtx('look_1'),
    )
    const body = await readJson(res)

    expect(res.status).toBe(500)
    expect(body).toEqual({
      ok: false,
      error: 'Couldn’t update your like. Try again.',
      code: 'INTERNAL',
    })

    expect(mocks.enqueueRecomputeLookCounts).not.toHaveBeenCalled()
  })

  it('returns 500 when enqueue fails after the immediate recompute', async () => {
    mocks.enqueueRecomputeLookCounts.mockRejectedValue(
      new Error('enqueue exploded'),
    )

    const res = await POST(
      new Request('http://localhost/api/looks/look_1/like', {
        method: 'POST',
      }),
      makeCtx('look_1'),
    )
    const body = await readJson(res)

    expect(res.status).toBe(500)
    expect(body).toEqual({
      ok: false,
      error: 'Couldn’t update your like. Try again.',
      code: 'INTERNAL',
    })

    expect(mocks.recomputeLookPostLikeCount).toHaveBeenCalledWith(
      mocks.tx,
      'look_1',
    )
    expect(mocks.enqueueRecomputeLookCounts).toHaveBeenCalledWith(mocks.tx, {
      lookPostId: 'look_1',
    })
  })
})