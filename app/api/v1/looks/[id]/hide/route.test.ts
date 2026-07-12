// app/api/v1/looks/[id]/hide/route.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  LookPostStatus,
  LookPostVisibility,
  ModerationStatus,
  Prisma,
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
        JSON.stringify({ ok: false, error: message, ...safeDetails }),
        { status, headers: { 'content-type': 'application/json' } },
      )
    },
  )

  const prisma = {
    lookHide: {
      create: vi.fn(),
      deleteMany: vi.fn(),
    },
  }

  const requireUser = vi.fn()
  const loadLookAccess = vi.fn()
  const canViewLookPost = vi.fn()

  return { jsonOk, jsonFail, prisma, requireUser, loadLookAccess, canViewLookPost }
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
vi.mock('@/lib/looks/access', () => ({ loadLookAccess: mocks.loadLookAccess }))
vi.mock('@/lib/looks/guards', () => ({ canViewLookPost: mocks.canViewLookPost }))

import { DELETE, POST } from './route'

type Params = { id: string }
type Ctx = { params: Params | Promise<Params> }

function makeCtx(id: string): Ctx {
  return { params: { id } }
}

function makeRequest(method: 'POST' | 'DELETE', id = 'look_1'): Request {
  return new Request(`http://localhost/api/v1/looks/${id}/hide`, { method })
}

function makeAuth() {
  return {
    ok: true as const,
    user: {
      id: 'user_1',
      role: Role.CLIENT,
      clientProfile: { id: 'client_1' },
      professionalProfile: null,
    },
  }
}

function makeAccess() {
  return {
    look: {
      id: 'look_1',
      professionalId: 'pro_1',
      clientAuthorId: null,
      status: LookPostStatus.PUBLISHED,
      visibility: LookPostVisibility.PUBLIC,
      moderationStatus: ModerationStatus.APPROVED,
      professional: { id: 'pro_1', verificationStatus: VerificationStatus.APPROVED },
    },
    isOwner: false,
    viewerFollowsProfessional: false,
  }
}

describe('app/api/v1/looks/[id]/hide/route.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireUser.mockResolvedValue(makeAuth())
    mocks.loadLookAccess.mockResolvedValue(makeAccess())
    mocks.canViewLookPost.mockReturnValue(true)
    mocks.prisma.lookHide.create.mockResolvedValue({ id: 'hide_1' })
    mocks.prisma.lookHide.deleteMany.mockResolvedValue({ count: 1 })
  })

  describe('POST', () => {
    it('hides a viewable look and reports hidden: true', async () => {
      const res = await POST(makeRequest('POST'), makeCtx('look_1'))
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ lookPostId: 'look_1', hidden: true })

      expect(mocks.loadLookAccess).toHaveBeenCalledWith(mocks.prisma, {
        lookPostId: 'look_1',
        viewerClientId: 'client_1',
        viewerProfessionalId: null,
      })
      expect(mocks.prisma.lookHide.create).toHaveBeenCalledWith({
        data: { lookPostId: 'look_1', userId: 'user_1' },
      })
    })

    it('is idempotent — a duplicate (P2002) still reports hidden: true', async () => {
      mocks.prisma.lookHide.create.mockRejectedValueOnce(
        new Prisma.PrismaClientKnownRequestError('dup', {
          code: 'P2002',
          clientVersion: 'test',
        }),
      )

      const res = await POST(makeRequest('POST'), makeCtx('look_1'))
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ lookPostId: 'look_1', hidden: true })
    })

    it('rethrows a non-P2002 create error as a 500', async () => {
      mocks.prisma.lookHide.create.mockRejectedValueOnce(
        new Prisma.PrismaClientKnownRequestError('boom', {
          code: 'P2003',
          clientVersion: 'test',
        }),
      )

      const res = await POST(makeRequest('POST'), makeCtx('look_1'))
      expect(res.status).toBe(500)
    })

    it('404s when the look is not visible to the viewer', async () => {
      mocks.canViewLookPost.mockReturnValue(false)

      const res = await POST(makeRequest('POST'), makeCtx('look_1'))
      expect(res.status).toBe(404)
      expect(mocks.prisma.lookHide.create).not.toHaveBeenCalled()
    })

    it('404s when the look does not exist', async () => {
      mocks.loadLookAccess.mockResolvedValue(null)

      const res = await POST(makeRequest('POST'), makeCtx('look_1'))
      expect(res.status).toBe(404)
      expect(mocks.prisma.lookHide.create).not.toHaveBeenCalled()
    })

    it('400s on a missing look id', async () => {
      const res = await POST(makeRequest('POST', ' '), makeCtx('   '))
      expect(res.status).toBe(400)
    })

    it('bubbles the auth failure for a guest', async () => {
      mocks.requireUser.mockResolvedValue({
        ok: false as const,
        res: new Response(null, { status: 401 }),
      })

      const res = await POST(makeRequest('POST'), makeCtx('look_1'))
      expect(res.status).toBe(401)
      expect(mocks.loadLookAccess).not.toHaveBeenCalled()
    })
  })

  describe('DELETE', () => {
    it('un-hides without re-checking visibility and reports hidden: false', async () => {
      const res = await DELETE(makeRequest('DELETE'), makeCtx('look_1'))
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ lookPostId: 'look_1', hidden: false })

      // Un-hiding is always safe — no access lookup, just delete the viewer's row.
      expect(mocks.loadLookAccess).not.toHaveBeenCalled()
      expect(mocks.prisma.lookHide.deleteMany).toHaveBeenCalledWith({
        where: { lookPostId: 'look_1', userId: 'user_1' },
      })
    })

    it('bubbles the auth failure for a guest', async () => {
      mocks.requireUser.mockResolvedValue({
        ok: false as const,
        res: new Response(null, { status: 401 }),
      })

      const res = await DELETE(makeRequest('DELETE'), makeCtx('look_1'))
      expect(res.status).toBe(401)
      expect(mocks.prisma.lookHide.deleteMany).not.toHaveBeenCalled()
    })
  })
})
