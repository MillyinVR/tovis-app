// app/api/pro/looks/[id]/route.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { LookPostVisibility } from '@prisma/client'

const mocks = vi.hoisted(() => {
  const jsonOk = vi.fn(
    (data?: Record<string, unknown>, init?: number | ResponseInit) => {
      const status = typeof init === 'number' ? init : init?.status

      return Response.json(
        { ok: true, ...(data ?? {}) },
        { status: status ?? 200 },
      )
    },
  )

  const jsonFail = vi.fn(
    (
      status: number,
      error: string,
      extra?: Record<string, unknown>,
    ) => {
      return Response.json(
        { ok: false, error, ...(extra ?? {}) },
        { status },
      )
    },
  )

  const requirePro = vi.fn()
  const getProLookPublicationById = vi.fn()
  const updateProLookPublication = vi.fn()

  const prisma = {
    __brand: 'prisma-test-double',
  }

  return {
    jsonOk,
    jsonFail,
    requirePro,
    getProLookPublicationById,
    updateProLookPublication,
    prisma,
  }
})

vi.mock('@/app/api/_utils', () => ({
  jsonOk: mocks.jsonOk,
  jsonFail: mocks.jsonFail,
  requirePro: mocks.requirePro,
  pickString: (value: unknown) => {
    if (typeof value !== 'string') return null
    const trimmed = value.trim()
    return trimmed.length > 0 ? trimmed : null
  },
}))

vi.mock('@/lib/prisma', () => ({
  prisma: mocks.prisma,
}))

vi.mock('@/lib/looks/publication/service', () => ({
  getProLookPublicationById: mocks.getProLookPublicationById,
  updateProLookPublication: mocks.updateProLookPublication,
}))

import { GET, PATCH } from './route'

type ProLookPublicationResultTestDto = {
  target: {
    kind: 'LOOK_POST'
    id: string
    professionalId: string
    primaryMediaAssetId: string
  }
  action: 'create_draft' | 'publish' | 'update' | 'archive' | 'unpublish'
  result: {
    id: string
    professionalId: string
    primaryMediaAssetId: string
    serviceId: string | null
    caption: string | null
    priceStartingAt: string | null
    status: string
    visibility: LookPostVisibility
    moderationStatus: string
    publishedAt: string | null
    archivedAt: string | null
    removedAt: string | null
    reviewedAt: string | null
    reviewedByUserId: string | null
    adminNotes: string | null
    reportCount: number
    likeCount: number
    commentCount: number
    saveCount: number
    shareCount: number
    spotlightScore: number
    rankScore: number
    createdAt: string
    updatedAt: string
  }
  asyncEffects: {
    plannedJobs: unknown[]
    enqueuedJobs: unknown[]
    gatedJobs: unknown[]
  }
}

type RouteParams = { id: string }
type RouteCtx = { params: RouteParams | Promise<RouteParams> }

function makeProAuth(
  overrides?: Partial<{
    professionalId: string
    proId: string
    userId: string
  }>,
) {
  return {
    ok: true as const,
    professionalId: overrides?.professionalId ?? 'pro_1',
    proId: overrides?.proId ?? 'pro_1',
    userId: overrides?.userId ?? 'user_1',
    user: {
      id: overrides?.userId ?? 'user_1',
    },
  }
}

function makeCtx(id: string): RouteCtx {
  return {
    params: { id },
  }
}

function makePromiseCtx(id: string): RouteCtx {
  return {
    params: Promise.resolve({ id }),
  }
}

function makePatchRequest(body: unknown): Request {
  return new Request('http://localhost/api/pro/looks/look_1', {
    method: 'PATCH',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  })
}

function makeTextPatchRequest(body = 'x'): Request {
  return new Request('http://localhost/api/pro/looks/look_1', {
    method: 'PATCH',
    headers: {
      'content-type': 'text/plain',
    },
    body,
  })
}

async function readJson(res: Response): Promise<unknown> {
  return await res.json()
}

function makeLookPublicationResult(
  overrides?: Partial<ProLookPublicationResultTestDto>,
): ProLookPublicationResultTestDto {
  return {
    target: {
      kind: 'LOOK_POST',
      id: 'look_1',
      professionalId: 'pro_1',
      primaryMediaAssetId: 'media_1',
    },
    action: 'update',
    result: {
      id: 'look_1',
      professionalId: 'pro_1',
      primaryMediaAssetId: 'media_1',
      serviceId: 'service_1',
      caption: 'Fresh set',
      priceStartingAt: '85.00',
      status: 'PUBLISHED',
      visibility: LookPostVisibility.PUBLIC,
      moderationStatus: 'APPROVED',
      publishedAt: '2026-04-21T00:00:00.000Z',
      archivedAt: null,
      removedAt: null,
      reviewedAt: null,
      reviewedByUserId: null,
      adminNotes: null,
      reportCount: 0,
      likeCount: 0,
      commentCount: 0,
      saveCount: 0,
      shareCount: 0,
      spotlightScore: 0,
      rankScore: 0,
      createdAt: '2026-04-21T00:00:00.000Z',
      updatedAt: '2026-04-21T00:00:00.000Z',
    },
    asyncEffects: {
      plannedJobs: [],
      enqueuedJobs: [],
      gatedJobs: [],
    },
    ...overrides,
  }
}

describe('app/api/pro/looks/[id]/route.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => {})

    mocks.requirePro.mockResolvedValue(makeProAuth())
    mocks.getProLookPublicationById.mockResolvedValue(
      makeLookPublicationResult(),
    )
    mocks.updateProLookPublication.mockResolvedValue(
      makeLookPublicationResult(),
    )
  })

  it('passes through failed pro auth responses unchanged for GET', async () => {
    const authRes = Response.json(
      { ok: false, error: 'Unauthorized' },
      { status: 401 },
    )

    mocks.requirePro.mockResolvedValue({
      ok: false as const,
      res: authRes,
    })

    const res = await GET(
      new Request('http://localhost/api/pro/looks/look_1'),
      makeCtx('look_1'),
    )

    expect(res).toBe(authRes)
    expect(mocks.getProLookPublicationById).not.toHaveBeenCalled()
  })

  it('returns 400 for GET when route id is missing', async () => {
    const res = await GET(
      new Request('http://localhost/api/pro/looks/%20'),
      makeCtx('   '),
    )
    const body = await readJson(res)

    expect(res.status).toBe(400)
    expect(body).toEqual({
      ok: false,
      error: 'Missing look id.',
    })

    expect(mocks.getProLookPublicationById).not.toHaveBeenCalled()
  })

  it('delegates GET to the publication service and awaits promised params', async () => {
    const result = makeLookPublicationResult({
      target: {
        kind: 'LOOK_POST',
        id: 'look_2',
        professionalId: 'pro_1',
        primaryMediaAssetId: 'media_2',
      },
      result: {
        ...makeLookPublicationResult().result,
        id: 'look_2',
        primaryMediaAssetId: 'media_2',
      },
    })

    mocks.getProLookPublicationById.mockResolvedValue(result)

    const req = new Request('http://localhost/api/pro/looks/look_2')
    const res = await GET(req, makePromiseCtx('look_2'))
    const body = await readJson(res)

    expect(mocks.getProLookPublicationById).toHaveBeenCalledWith(
      mocks.prisma,
      {
        professionalId: 'pro_1',
        lookPostId: 'look_2',
      },
    )

    expect(res.status).toBe(200)
    expect(body).toEqual({
      ok: true,
      ...result,
    })
  })

  it('returns 415 for PATCH when content type is not application/json', async () => {
    const res = await PATCH(makeTextPatchRequest(), makeCtx('look_1'))
    const body = await readJson(res)

    expect(res.status).toBe(415)
    expect(body).toEqual({
      ok: false,
      error: 'Content-Type must be application/json.',
    })
  })

  it('returns 400 for PATCH when nothing is provided to update', async () => {
    const res = await PATCH(makePatchRequest({}), makeCtx('look_1'))
    const body = await readJson(res)

    expect(res.status).toBe(400)
    expect(body).toEqual({
      ok: false,
      error: 'Nothing to update.',
    })

    expect(mocks.updateProLookPublication).not.toHaveBeenCalled()
  })

  it('returns 400 for PATCH when visibility is invalid', async () => {
    const res = await PATCH(
      makePatchRequest({
        visibility: 'PRIVATE',
      }),
      makeCtx('look_1'),
    )
    const body = await readJson(res)

    expect(res.status).toBe(400)
    expect(body).toEqual({
      ok: false,
      error: 'visibility is invalid.',
    })

    expect(mocks.updateProLookPublication).not.toHaveBeenCalled()
  })

  it('returns 400 for PATCH when stateAction is invalid', async () => {
    const res = await PATCH(
      makePatchRequest({
        stateAction: 'delete',
      }),
      makeCtx('look_1'),
    )
    const body = await readJson(res)

    expect(res.status).toBe(400)
    expect(body).toEqual({
      ok: false,
      error: 'stateAction is invalid.',
    })

    expect(mocks.updateProLookPublication).not.toHaveBeenCalled()
  })

  it('delegates PATCH to the publication service and returns the updated look', async () => {
    const result = makeLookPublicationResult({
      action: 'archive',
      result: {
        ...makeLookPublicationResult().result,
        archivedAt: '2026-04-22T00:00:00.000Z',
        visibility: LookPostVisibility.FOLLOWERS_ONLY,
      },
    })

    mocks.updateProLookPublication.mockResolvedValue(result)

    const req = makePatchRequest({
      caption: 'Updated caption',
      primaryServiceId: 'service_2',
      priceStartingAt: '95.00',
      visibility: LookPostVisibility.FOLLOWERS_ONLY,
      stateAction: 'archive',
    })

    const res = await PATCH(req, makeCtx('look_1'))
    const body = await readJson(res)

    expect(mocks.updateProLookPublication).toHaveBeenCalledWith(
      mocks.prisma,
      {
        professionalId: 'pro_1',
        lookPostId: 'look_1',
        request: {
          caption: 'Updated caption',
          primaryServiceId: 'service_2',
          priceStartingAt: '95.00',
          visibility: LookPostVisibility.FOLLOWERS_ONLY,
          stateAction: 'archive',
        },
      },
    )

    expect(res.status).toBe(200)
    expect(body).toEqual({
      ok: true,
      ...result,
    })
  })

  it('returns 404 for GET when the look post is not found', async () => {
    mocks.getProLookPublicationById.mockRejectedValue(
      new Error('Look post not found.'),
    )

    const res = await GET(
      new Request('http://localhost/api/pro/looks/look_missing'),
      makeCtx('look_missing'),
    )
    const body = await readJson(res)

    expect(res.status).toBe(404)
    expect(body).toEqual({
      ok: false,
      error: 'Look post not found.',
    })
  })

  it('returns 403 for PATCH when the look does not belong to the professional', async () => {
    mocks.updateProLookPublication.mockRejectedValue(
      new Error('Not allowed to manage this look post.'),
    )

    const res = await PATCH(
      makePatchRequest({
        caption: 'Updated caption',
      }),
      makeCtx('look_1'),
    )
    const body = await readJson(res)

    expect(res.status).toBe(403)
    expect(body).toEqual({
      ok: false,
      error: 'Not allowed to manage this look post.',
    })
  })
})