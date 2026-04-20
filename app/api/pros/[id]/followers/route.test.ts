// app/api/pros/[id]/followers/route.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Role } from '@prisma/client'

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

  const prisma = {}

  const requirePro = vi.fn()
  const assertCanViewFollowersList = vi.fn()
  const buildProFollowersListResponse = vi.fn(
    ({
      professionalId,
      followerCount,
      items,
      pagination,
    }: {
      professionalId: string
      followerCount: number
      items: Array<{
        followedAt: string
        client: {
          id: string
          firstName: string
          lastName: string
          avatarUrl: string | null
        }
      }>
      pagination: {
        take: number
        skip: number
        hasMore: boolean
      }
    }) => ({
      professionalId,
      followerCount,
      items,
      pagination,
    }),
  )
  const getFollowErrorMeta = vi.fn()
  const listFollowersPage = vi.fn()
  const requireFollowProfessionalTarget = vi.fn()

  return {
    jsonOk,
    jsonFail,
    prisma,
    requirePro,
    assertCanViewFollowersList,
    buildProFollowersListResponse,
    getFollowErrorMeta,
    listFollowersPage,
    requireFollowProfessionalTarget,
  }
})

vi.mock('@/app/api/_utils', () => ({
  jsonOk: mocks.jsonOk,
  jsonFail: mocks.jsonFail,
  pickInt: (value: string | null) => {
    if (typeof value !== 'string') return null
    const trimmed = value.trim()
    if (!trimmed) return null
    const parsed = Number(trimmed)
    return Number.isFinite(parsed) ? Math.trunc(parsed) : null
  },
  pickString: (value: string | null) => {
    if (typeof value !== 'string') return null
    const trimmed = value.trim()
    return trimmed.length > 0 ? trimmed : null
  },
  requirePro: mocks.requirePro,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: mocks.prisma,
}))

vi.mock('@/lib/follows', () => ({
  assertCanViewFollowersList: mocks.assertCanViewFollowersList,
  buildProFollowersListResponse: mocks.buildProFollowersListResponse,
  getFollowErrorMeta: mocks.getFollowErrorMeta,
  listFollowersPage: mocks.listFollowersPage,
  requireFollowProfessionalTarget: mocks.requireFollowProfessionalTarget,
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

function makeAuth(
  overrides?: Partial<{
    id: string
    role: Role
    professionalId: string
    proId: string
  }>,
) {
  return {
    ok: true as const,
    userId: 'user_pro_1',
    professionalId: 'pro_1',
    proId: 'pro_1',
    user: {
      id: 'user_pro_1',
      role: Role.PRO,
      professionalProfile: { id: 'pro_1' },
      ...overrides,
    },
    ...overrides,
  }
}

function makeTarget(
  overrides?: Partial<{
    id: string
    userId: string
  }>,
) {
  return {
    id: 'pro_1',
    userId: 'user_pro_1',
    ...overrides,
  }
}

function makeFollowersPage(
  overrides?: Partial<{
    followerCount: number
    items: Array<{
      followedAt: string
      client: {
        id: string
        firstName: string
        lastName: string
        avatarUrl: string | null
      }
    }>
    pagination: {
      take: number
      skip: number
      hasMore: boolean
    }
  }>,
) {
  return {
    followerCount: 12,
    items: [
      {
        followedAt: '2026-04-18T12:00:00.000Z',
        client: {
          id: 'client_1',
          firstName: 'Tori',
          lastName: 'Morales',
          avatarUrl: null,
        },
      },
    ],
    pagination: {
      take: 24,
      skip: 0,
      hasMore: false,
    },
    ...overrides,
  }
}

describe('app/api/pros/[id]/followers/route.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mocks.requirePro.mockResolvedValue(makeAuth())
    mocks.assertCanViewFollowersList.mockImplementation(() => {})
    mocks.requireFollowProfessionalTarget.mockResolvedValue(makeTarget())
    mocks.listFollowersPage.mockResolvedValue(makeFollowersPage())
    mocks.getFollowErrorMeta.mockReturnValue(null)
  })

  it('returns the followers list by canonical professionalId', async () => {
    const res = await GET(
      new Request('http://localhost/api/pros/pro_1/followers'),
      makeCtx('pro_1'),
    )
    const body = await readJson(res)

    expect(res.status).toBe(200)

    expect(mocks.assertCanViewFollowersList).toHaveBeenCalledWith({
      viewerProfessionalId: 'pro_1',
      ownerProfessionalId: 'pro_1',
    })

    expect(mocks.requireFollowProfessionalTarget).toHaveBeenCalledWith(
      mocks.prisma,
      'pro_1',
    )

    expect(mocks.listFollowersPage).toHaveBeenCalledWith(mocks.prisma, {
      professionalId: 'pro_1',
      viewerProfessionalId: 'pro_1',
      take: undefined,
      skip: undefined,
    })

    expect(mocks.buildProFollowersListResponse).toHaveBeenCalledWith({
      professionalId: 'pro_1',
      followerCount: 12,
      items: [
        {
          followedAt: '2026-04-18T12:00:00.000Z',
          client: {
            id: 'client_1',
            firstName: 'Tori',
            lastName: 'Morales',
            avatarUrl: null,
          },
        },
      ],
      pagination: {
        take: 24,
        skip: 0,
        hasMore: false,
      },
    })

    expect(body).toEqual({
      professionalId: 'pro_1',
      followerCount: 12,
      items: [
        {
          followedAt: '2026-04-18T12:00:00.000Z',
          client: {
            id: 'client_1',
            firstName: 'Tori',
            lastName: 'Morales',
            avatarUrl: null,
          },
        },
      ],
      pagination: {
        take: 24,
        skip: 0,
        hasMore: false,
      },
    })
  })

  it('passes parsed take and skip values into the shared list helper', async () => {
    mocks.listFollowersPage.mockResolvedValueOnce(
      makeFollowersPage({
        pagination: {
          take: 2,
          skip: 6,
          hasMore: true,
        },
      }),
    )

    const res = await GET(
      new Request('http://localhost/api/pros/pro_1/followers?take=2&skip=6'),
      makeCtx('pro_1'),
    )

    expect(res.status).toBe(200)

    expect(mocks.listFollowersPage).toHaveBeenCalledWith(mocks.prisma, {
      professionalId: 'pro_1',
      viewerProfessionalId: 'pro_1',
      take: 2,
      skip: 6,
    })
  })

  it('returns 400 when the route param is blank', async () => {
    const res = await GET(
      new Request('http://localhost/api/pros/%20%20/followers'),
      makeCtx('   '),
    )
    const body = await readJson(res)

    expect(res.status).toBe(400)
    expect(body).toEqual({
      ok: false,
      error: 'Missing pro id.',
      code: 'MISSING_PRO_ID',
    })

    expect(mocks.assertCanViewFollowersList).not.toHaveBeenCalled()
    expect(mocks.requireFollowProfessionalTarget).not.toHaveBeenCalled()
    expect(mocks.listFollowersPage).not.toHaveBeenCalled()
  })

  it('returns 403 when the viewer cannot view the followers list', async () => {
    mocks.assertCanViewFollowersList.mockImplementationOnce(() => {
      throw new Error('Not allowed to view this followers list.')
    })
    mocks.getFollowErrorMeta.mockReturnValueOnce({
      status: 403,
      message: 'Not allowed to view this followers list.',
      code: 'FOLLOWERS_FORBIDDEN',
    })

    const res = await GET(
      new Request('http://localhost/api/pros/pro_1/followers'),
      makeCtx('pro_1'),
    )
    const body = await readJson(res)

    expect(res.status).toBe(403)
    expect(body).toEqual({
      ok: false,
      error: 'Not allowed to view this followers list.',
      code: 'FOLLOWERS_FORBIDDEN',
    })

    expect(mocks.requireFollowProfessionalTarget).not.toHaveBeenCalled()
    expect(mocks.listFollowersPage).not.toHaveBeenCalled()
  })

  it('returns 404 when the canonical professionalId cannot be resolved', async () => {
    mocks.requireFollowProfessionalTarget.mockRejectedValueOnce(
      new Error('Professional not found.'),
    )
    mocks.getFollowErrorMeta.mockReturnValueOnce({
      status: 404,
      message: 'Professional not found.',
      code: 'PRO_NOT_FOUND',
    })

    const res = await GET(
      new Request('http://localhost/api/pros/pro_missing/followers'),
      makeCtx('pro_missing'),
    )
    const body = await readJson(res)

    expect(res.status).toBe(404)
    expect(body).toEqual({
      ok: false,
      error: 'Professional not found.',
      code: 'PRO_NOT_FOUND',
    })

    expect(mocks.listFollowersPage).not.toHaveBeenCalled()
  })

  it('does not treat other ids as fallback professional ids', async () => {
    mocks.requireFollowProfessionalTarget.mockRejectedValueOnce(
      new Error('Professional not found.'),
    )
    mocks.getFollowErrorMeta.mockReturnValueOnce({
      status: 404,
      message: 'Professional not found.',
      code: 'PRO_NOT_FOUND',
    })

    const res = await GET(
      new Request('http://localhost/api/pros/user_legacy_1/followers'),
      makeCtx('user_legacy_1'),
    )
    const body = await readJson(res)

    expect(res.status).toBe(404)
    expect(body).toEqual({
      ok: false,
      error: 'Professional not found.',
      code: 'PRO_NOT_FOUND',
    })

    expect(mocks.requireFollowProfessionalTarget).toHaveBeenCalledWith(
      mocks.prisma,
      'user_legacy_1',
    )
    expect(mocks.listFollowersPage).not.toHaveBeenCalled()
  })

  it('maps shared follow errors into route responses', async () => {
    mocks.listFollowersPage.mockRejectedValueOnce(new Error('forbidden'))
    mocks.getFollowErrorMeta.mockReturnValueOnce({
      status: 403,
      message: 'Not allowed to view this followers list.',
      code: 'FOLLOWERS_FORBIDDEN',
    })

    const res = await GET(
      new Request('http://localhost/api/pros/pro_1/followers'),
      makeCtx('pro_1'),
    )
    const body = await readJson(res)

    expect(res.status).toBe(403)
    expect(body).toEqual({
      ok: false,
      error: 'Not allowed to view this followers list.',
      code: 'FOLLOWERS_FORBIDDEN',
    })
  })

  it('returns 500 on unexpected errors', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    mocks.listFollowersPage.mockRejectedValueOnce(new Error('db blew up'))

    const res = await GET(
      new Request('http://localhost/api/pros/pro_1/followers'),
      makeCtx('pro_1'),
    )
    const body = await readJson(res)

    expect(res.status).toBe(500)
    expect(body).toEqual({
      ok: false,
      error: 'Couldn’t load followers. Try again.',
      code: 'INTERNAL',
    })

    consoleError.mockRestore()
  })
})