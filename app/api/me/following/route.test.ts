// app/api/me/following/route.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Role, VerificationStatus } from '@prisma/client'

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

  const requireClient = vi.fn()
  const buildMyFollowingListResponse = vi.fn(
    ({
      clientId,
      items,
      pagination,
    }: {
      clientId: string
      items: Array<{
        followedAt: string
        professional: {
          id: string
          businessName: string | null
          handle: string | null
          avatarUrl: string | null
          professionType: null
          location: string
          verificationStatus: VerificationStatus
          isPremium: boolean
        }
      }>
      pagination: {
        take: number
        skip: number
        hasMore: boolean
      }
    }) => ({
      clientId,
      items,
      pagination,
    }),
  )
  const getFollowErrorMeta = vi.fn()
  const listFollowingPage = vi.fn()

  return {
    jsonOk,
    jsonFail,
    prisma,
    requireClient,
    buildMyFollowingListResponse,
    getFollowErrorMeta,
    listFollowingPage,
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
  requireClient: mocks.requireClient,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: mocks.prisma,
}))

vi.mock('@/lib/follows', () => ({
  buildMyFollowingListResponse: mocks.buildMyFollowingListResponse,
  getFollowErrorMeta: mocks.getFollowErrorMeta,
  listFollowingPage: mocks.listFollowingPage,
}))

import { GET } from './route'

async function readJson(res: Response): Promise<unknown> {
  return res.json()
}

function makeAuth(
  overrides?: Partial<{
    id: string
    role: Role
    clientId: string
    professionalProfile: { id: string } | null
  }>,
) {
  return {
    ok: true as const,
    clientId: 'client_1',
    user: {
      id: 'user_client_1',
      role: Role.CLIENT,
      clientProfile: { id: 'client_1' },
      professionalProfile: null,
      ...overrides,
    },
  }
}

function makeFollowingPage(
  overrides?: Partial<{
    items: Array<{
      followedAt: string
      professional: {
        id: string
        businessName: string | null
        handle: string | null
        avatarUrl: string | null
        professionType: null
        location: string
        verificationStatus: VerificationStatus
        isPremium: boolean
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
    items: [
      {
        followedAt: '2026-04-18T12:00:00.000Z',
        professional: {
          id: 'pro_1',
          businessName: 'TOVIS Studio',
          handle: 'tovisstudio',
          avatarUrl: null,
          professionType: null,
          location: 'San Diego, CA',
          verificationStatus: VerificationStatus.APPROVED,
          isPremium: true,
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

describe('app/api/me/following/route.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mocks.requireClient.mockResolvedValue(makeAuth())
    mocks.listFollowingPage.mockResolvedValue(makeFollowingPage())
    mocks.getFollowErrorMeta.mockReturnValue(null)
  })

  it('returns the current viewer following list', async () => {
    const res = await GET(
      new Request('http://localhost/api/me/following'),
    )
    const body = await readJson(res)

    expect(res.status).toBe(200)

    expect(mocks.listFollowingPage).toHaveBeenCalledWith(mocks.prisma, {
      clientId: 'client_1',
      viewerClientId: 'client_1',
      take: undefined,
      skip: undefined,
    })

    expect(mocks.buildMyFollowingListResponse).toHaveBeenCalledWith({
      clientId: 'client_1',
      items: [
        {
          followedAt: '2026-04-18T12:00:00.000Z',
          professional: {
            id: 'pro_1',
            businessName: 'TOVIS Studio',
            handle: 'tovisstudio',
            avatarUrl: null,
            professionType: null,
            location: 'San Diego, CA',
            verificationStatus: VerificationStatus.APPROVED,
            isPremium: true,
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
      clientId: 'client_1',
      items: [
        {
          followedAt: '2026-04-18T12:00:00.000Z',
          professional: {
            id: 'pro_1',
            businessName: 'TOVIS Studio',
            handle: 'tovisstudio',
            avatarUrl: null,
            professionType: null,
            location: 'San Diego, CA',
            verificationStatus: VerificationStatus.APPROVED,
            isPremium: true,
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
    mocks.listFollowingPage.mockResolvedValueOnce(
      makeFollowingPage({
        pagination: {
          take: 2,
          skip: 6,
          hasMore: true,
        },
      }),
    )

    const res = await GET(
      new Request('http://localhost/api/me/following?take=2&skip=6'),
    )

    expect(res.status).toBe(200)

    expect(mocks.listFollowingPage).toHaveBeenCalledWith(mocks.prisma, {
      clientId: 'client_1',
      viewerClientId: 'client_1',
      take: 2,
      skip: 6,
    })
  })

  it('passes through auth failure responses from requireClient', async () => {
    mocks.requireClient.mockResolvedValueOnce({
      ok: false,
      res: new Response(
        JSON.stringify({
          ok: false,
          error: 'Unauthorized',
        }),
        {
          status: 401,
          headers: { 'content-type': 'application/json' },
        },
      ),
    })

    const res = await GET(
      new Request('http://localhost/api/me/following'),
    )
    const body = await readJson(res)

    expect(res.status).toBe(401)
    expect(body).toEqual({
      ok: false,
      error: 'Unauthorized',
    })

    expect(mocks.listFollowingPage).not.toHaveBeenCalled()
    expect(mocks.buildMyFollowingListResponse).not.toHaveBeenCalled()
  })

  it('maps shared follow errors into route responses', async () => {
    mocks.listFollowingPage.mockRejectedValueOnce(new Error('forbidden'))
    mocks.getFollowErrorMeta.mockReturnValueOnce({
      status: 403,
      message: 'Not allowed to view this following list.',
      code: 'FOLLOWING_FORBIDDEN',
    })

    const res = await GET(
      new Request('http://localhost/api/me/following'),
    )
    const body = await readJson(res)

    expect(res.status).toBe(403)
    expect(body).toEqual({
      ok: false,
      error: 'Not allowed to view this following list.',
      code: 'FOLLOWING_FORBIDDEN',
    })
  })

  it('returns 500 on unexpected errors', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    mocks.listFollowingPage.mockRejectedValueOnce(new Error('db blew up'))

    const res = await GET(
      new Request('http://localhost/api/me/following'),
    )
    const body = await readJson(res)

    expect(res.status).toBe(500)
    expect(body).toEqual({
      ok: false,
      error: 'Couldn’t load following. Try again.',
      code: 'INTERNAL',
    })

    consoleError.mockRestore()
  })
})