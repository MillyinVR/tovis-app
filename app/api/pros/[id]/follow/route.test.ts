// app/api/pros/[id]/follow/route.test.ts
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

  const requireClient = vi.fn()

  const buildProFollowStateResponse = vi.fn(
    ({
      professionalId,
      following,
      followerCount,
    }: {
      professionalId: string
      following: boolean
      followerCount: number
    }) => ({
      professionalId,
      following,
      followerCount,
    }),
  )
  const getFollowErrorMeta = vi.fn()
  const getProfessionalFollowState = vi.fn()
  const requireFollowProfessionalTarget = vi.fn()
  const toggleProFollow = vi.fn()

  return {
    jsonOk,
    jsonFail,
    prisma,
    requireClient,
    buildProFollowStateResponse,
    getFollowErrorMeta,
    getProfessionalFollowState,
    requireFollowProfessionalTarget,
    toggleProFollow,
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
  requireClient: mocks.requireClient,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: mocks.prisma,
}))

vi.mock('@/lib/follows', () => ({
  buildProFollowStateResponse: mocks.buildProFollowStateResponse,
  getFollowErrorMeta: mocks.getFollowErrorMeta,
  getProfessionalFollowState: mocks.getProfessionalFollowState,
  requireFollowProfessionalTarget: mocks.requireFollowProfessionalTarget,
  toggleProFollow: mocks.toggleProFollow,
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

function makeFollowState(
  overrides?: Partial<{
    following: boolean
    followerCount: number
  }>,
) {
  return {
    following: true,
    followerCount: 7,
    ...overrides,
  }
}

describe('app/api/pros/[id]/follow/route.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mocks.requireClient.mockResolvedValue(makeAuth())
    mocks.requireFollowProfessionalTarget.mockResolvedValue(makeTarget())
    mocks.getProfessionalFollowState.mockResolvedValue(makeFollowState())
    mocks.toggleProFollow.mockResolvedValue(
      makeFollowState({ following: true, followerCount: 8 }),
    )
    mocks.getFollowErrorMeta.mockReturnValue(null)
  })

  it('GET returns stable follow state by canonical professionalId', async () => {
    const res = await GET(
      new Request('http://localhost/api/pros/pro_1/follow'),
      makeCtx('pro_1'),
    )
    const body = await readJson(res)

    expect(res.status).toBe(200)

    expect(mocks.requireFollowProfessionalTarget).toHaveBeenCalledWith(
      mocks.prisma,
      'pro_1',
    )

    expect(mocks.getProfessionalFollowState).toHaveBeenCalledWith(
      mocks.prisma,
      {
        viewerClientId: 'client_1',
        professionalId: 'pro_1',
      },
    )

    expect(mocks.buildProFollowStateResponse).toHaveBeenCalledWith({
      professionalId: 'pro_1',
      following: true,
      followerCount: 7,
    })

    expect(body).toEqual({
      professionalId: 'pro_1',
      following: true,
      followerCount: 7,
    })
  })

  it('POST toggles follow state and returns the stable follow contract', async () => {
    const res = await POST(
      new Request('http://localhost/api/pros/pro_1/follow', {
        method: 'POST',
      }),
      makeCtx('pro_1'),
    )
    const body = await readJson(res)

    expect(res.status).toBe(200)

    expect(mocks.requireFollowProfessionalTarget).toHaveBeenCalledWith(
      mocks.prisma,
      'pro_1',
    )

    expect(mocks.toggleProFollow).toHaveBeenCalledWith(mocks.prisma, {
      clientId: 'client_1',
      professionalId: 'pro_1',
    })

    expect(mocks.buildProFollowStateResponse).toHaveBeenCalledWith({
      professionalId: 'pro_1',
      following: true,
      followerCount: 8,
    })

    expect(body).toEqual({
      professionalId: 'pro_1',
      following: true,
      followerCount: 8,
    })
  })

  it('POST returns unfollowed state when toggle removes an existing follow', async () => {
    mocks.toggleProFollow.mockResolvedValueOnce(
      makeFollowState({
        following: false,
        followerCount: 4,
      }),
    )

    const res = await POST(
      new Request('http://localhost/api/pros/pro_1/follow', {
        method: 'POST',
      }),
      makeCtx('pro_1'),
    )
    const body = await readJson(res)

    expect(res.status).toBe(200)
    expect(body).toEqual({
      professionalId: 'pro_1',
      following: false,
      followerCount: 4,
    })
  })

  it('returns 400 when the route param is blank', async () => {
    const res = await GET(
      new Request('http://localhost/api/pros/%20%20/follow'),
      makeCtx('   '),
    )
    const body = await readJson(res)

    expect(res.status).toBe(400)
    expect(body).toEqual({
      ok: false,
      error: 'Missing pro id.',
      code: 'MISSING_PRO_ID',
    })

    expect(mocks.requireFollowProfessionalTarget).not.toHaveBeenCalled()
    expect(mocks.getProfessionalFollowState).not.toHaveBeenCalled()
    expect(mocks.toggleProFollow).not.toHaveBeenCalled()
  })

  it('GET returns 404 when the canonical professionalId cannot be resolved', async () => {
    mocks.requireFollowProfessionalTarget.mockRejectedValueOnce(
      new Error('Professional not found.'),
    )
    mocks.getFollowErrorMeta.mockReturnValueOnce({
      status: 404,
      message: 'Professional not found.',
      code: 'PRO_NOT_FOUND',
    })

    const res = await GET(
      new Request('http://localhost/api/pros/pro_missing/follow'),
      makeCtx('pro_missing'),
    )
    const body = await readJson(res)

    expect(res.status).toBe(404)
    expect(body).toEqual({
      ok: false,
      error: 'Professional not found.',
      code: 'PRO_NOT_FOUND',
    })

    expect(mocks.getProfessionalFollowState).not.toHaveBeenCalled()
  })

  it('POST returns 404 when the canonical professionalId cannot be resolved', async () => {
    mocks.requireFollowProfessionalTarget.mockRejectedValueOnce(
      new Error('Professional not found.'),
    )
    mocks.getFollowErrorMeta.mockReturnValueOnce({
      status: 404,
      message: 'Professional not found.',
      code: 'PRO_NOT_FOUND',
    })

    const res = await POST(
      new Request('http://localhost/api/pros/pro_missing/follow', {
        method: 'POST',
      }),
      makeCtx('pro_missing'),
    )
    const body = await readJson(res)

    expect(res.status).toBe(404)
    expect(body).toEqual({
      ok: false,
      error: 'Professional not found.',
      code: 'PRO_NOT_FOUND',
    })

    expect(mocks.toggleProFollow).not.toHaveBeenCalled()
  })

  it('POST returns 403 when the viewer user id matches the target professional user id', async () => {
    mocks.requireClient.mockResolvedValueOnce(
      makeAuth({
        id: 'user_pro_1',
      }),
    )

    const res = await POST(
      new Request('http://localhost/api/pros/pro_1/follow', {
        method: 'POST',
      }),
      makeCtx('pro_1'),
    )
    const body = await readJson(res)

    expect(res.status).toBe(403)
    expect(body).toEqual({
      ok: false,
      error: 'You can’t follow yourself.',
      code: 'SELF_FOLLOW_FORBIDDEN',
    })

    expect(mocks.toggleProFollow).not.toHaveBeenCalled()
  })

  it('POST returns 403 when the viewer professional profile id matches the target professional id', async () => {
    mocks.requireClient.mockResolvedValueOnce(
      makeAuth({
        professionalProfile: { id: 'pro_1' },
      }),
    )

    const res = await POST(
      new Request('http://localhost/api/pros/pro_1/follow', {
        method: 'POST',
      }),
      makeCtx('pro_1'),
    )
    const body = await readJson(res)

    expect(res.status).toBe(403)
    expect(body).toEqual({
      ok: false,
      error: 'You can’t follow yourself.',
      code: 'SELF_FOLLOW_FORBIDDEN',
    })

    expect(mocks.toggleProFollow).not.toHaveBeenCalled()
  })

  it('does not treat other identifiers as fallback professional ids', async () => {
    mocks.requireFollowProfessionalTarget.mockRejectedValueOnce(
      new Error('Professional not found.'),
    )
    mocks.getFollowErrorMeta.mockReturnValueOnce({
      status: 404,
      message: 'Professional not found.',
      code: 'PRO_NOT_FOUND',
    })

    const res = await GET(
      new Request('http://localhost/api/pros/user_legacy_1/follow'),
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
    expect(mocks.getProfessionalFollowState).not.toHaveBeenCalled()
  })

  it('maps shared follow errors into GET route responses', async () => {
    mocks.getProfessionalFollowState.mockRejectedValueOnce(new Error('forbidden'))
    mocks.getFollowErrorMeta.mockReturnValueOnce({
      status: 404,
      message: 'Professional not found.',
      code: 'PRO_NOT_FOUND',
    })

    const res = await GET(
      new Request('http://localhost/api/pros/pro_1/follow'),
      makeCtx('pro_1'),
    )
    const body = await readJson(res)

    expect(res.status).toBe(404)
    expect(body).toEqual({
      ok: false,
      error: 'Professional not found.',
      code: 'PRO_NOT_FOUND',
    })
  })

  it('maps shared follow errors into POST route responses', async () => {
    mocks.toggleProFollow.mockRejectedValueOnce(new Error('forbidden'))
    mocks.getFollowErrorMeta.mockReturnValueOnce({
      status: 404,
      message: 'Professional not found.',
      code: 'PRO_NOT_FOUND',
    })

    const res = await POST(
      new Request('http://localhost/api/pros/pro_1/follow', {
        method: 'POST',
      }),
      makeCtx('pro_1'),
    )
    const body = await readJson(res)

    expect(res.status).toBe(404)
    expect(body).toEqual({
      ok: false,
      error: 'Professional not found.',
      code: 'PRO_NOT_FOUND',
    })
  })

  it('returns 500 on unexpected GET errors', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    mocks.getProfessionalFollowState.mockRejectedValueOnce(new Error('db blew up'))

    const res = await GET(
      new Request('http://localhost/api/pros/pro_1/follow'),
      makeCtx('pro_1'),
    )
    const body = await readJson(res)

    expect(res.status).toBe(500)
    expect(body).toEqual({
      ok: false,
      error: 'Couldn’t load follow state. Try again.',
      code: 'INTERNAL',
    })

    consoleError.mockRestore()
  })

  it('returns 500 on unexpected POST errors', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    mocks.toggleProFollow.mockRejectedValueOnce(new Error('db blew up'))

    const res = await POST(
      new Request('http://localhost/api/pros/pro_1/follow', {
        method: 'POST',
      }),
      makeCtx('pro_1'),
    )
    const body = await readJson(res)

    expect(res.status).toBe(500)
    expect(body).toEqual({
      ok: false,
      error: 'Couldn’t update follow state. Try again.',
      code: 'INTERNAL',
    })

    consoleError.mockRestore()
  })
})