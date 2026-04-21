// app/api/pro/looks/route.test.ts
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
  const createOrUpdateProLookFromMediaAsset = vi.fn()

  const prisma = {
    __brand: 'prisma-test-double',
  }

  return {
    jsonOk,
    jsonFail,
    requirePro,
    createOrUpdateProLookFromMediaAsset,
    prisma,
  }
})

vi.mock('@/app/api/_utils', () => ({
  jsonOk: mocks.jsonOk,
  jsonFail: mocks.jsonFail,
  requirePro: mocks.requirePro,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: mocks.prisma,
}))

vi.mock('@/lib/looks/publication/service', () => ({
  createOrUpdateProLookFromMediaAsset:
    mocks.createOrUpdateProLookFromMediaAsset,
}))

import { GET, POST } from './route'

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

function makeJsonRequest(body: unknown): Request {
  return new Request('http://localhost/api/pro/looks', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  })
}

function makeTextRequest(body = 'x'): Request {
  return new Request('http://localhost/api/pro/looks', {
    method: 'POST',
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
    action: 'publish',
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

describe('app/api/pro/looks/route.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => {})

    mocks.requirePro.mockResolvedValue(makeProAuth())
    mocks.createOrUpdateProLookFromMediaAsset.mockResolvedValue(
      makeLookPublicationResult(),
    )
  })

  it('returns 501 for GET because listing looks is not implemented yet', async () => {
    const res = await GET()
    const body = await readJson(res)

    expect(res.status).toBe(501)
    expect(body).toEqual({
      ok: false,
      error: 'GET /api/pro/looks is not implemented yet.',
    })
  })

  it('passes through failed pro auth responses unchanged', async () => {
    const authRes = Response.json(
      { ok: false, error: 'Unauthorized' },
      { status: 401 },
    )

    mocks.requirePro.mockResolvedValue({
      ok: false as const,
      res: authRes,
    })

    const req = makeJsonRequest({
      mediaAssetId: 'media_1',
      primaryServiceId: 'service_1',
      publish: true,
    })

    const res = await POST(req)

    expect(res).toBe(authRes)
    expect(
      mocks.createOrUpdateProLookFromMediaAsset,
    ).not.toHaveBeenCalled()
  })

  it('returns 415 when content type is not application/json', async () => {
    const res = await POST(makeTextRequest())
    const body = await readJson(res)

    expect(res.status).toBe(415)
    expect(body).toEqual({
      ok: false,
      error: 'Content-Type must be application/json.',
    })
  })

  it('returns 400 when mediaAssetId is missing', async () => {
    const res = await POST(
      makeJsonRequest({
        primaryServiceId: 'service_1',
        publish: true,
      }),
    )
    const body = await readJson(res)

    expect(res.status).toBe(400)
    expect(body).toEqual({
      ok: false,
      error: 'mediaAssetId is required.',
    })

    expect(
      mocks.createOrUpdateProLookFromMediaAsset,
    ).not.toHaveBeenCalled()
  })

  it('returns 400 when visibility is invalid', async () => {
    const res = await POST(
      makeJsonRequest({
        mediaAssetId: 'media_1',
        primaryServiceId: 'service_1',
        visibility: 'PRIVATE',
      }),
    )
    const body = await readJson(res)

    expect(res.status).toBe(400)
    expect(body).toEqual({
      ok: false,
      error: 'visibility is invalid.',
    })

    expect(
      mocks.createOrUpdateProLookFromMediaAsset,
    ).not.toHaveBeenCalled()
  })

  it('delegates POST to the publication service and returns 201 on success', async () => {
    const result = makeLookPublicationResult({
      target: {
        kind: 'LOOK_POST',
        id: 'look_looks_1',
        professionalId: 'pro_1',
        primaryMediaAssetId: 'media_looks_1',
      },
      result: {
        ...makeLookPublicationResult().result,
        id: 'look_looks_1',
        primaryMediaAssetId: 'media_looks_1',
        serviceId: 'service_2',
        visibility: LookPostVisibility.FOLLOWERS_ONLY,
      },
    })

    mocks.createOrUpdateProLookFromMediaAsset.mockResolvedValue(result)

    const req = makeJsonRequest({
      mediaAssetId: 'media_looks_1',
      serviceId: 'service_2',
      caption: 'Fresh set',
      priceStartingAt: '85.00',
      visibility: LookPostVisibility.FOLLOWERS_ONLY,
      publish: true,
    })

    const res = await POST(req)
    const body = await readJson(res)

    expect(mocks.createOrUpdateProLookFromMediaAsset).toHaveBeenCalledWith(
      mocks.prisma,
      {
        professionalId: 'pro_1',
        request: {
          mediaAssetId: 'media_looks_1',
          primaryServiceId: 'service_2',
          caption: 'Fresh set',
          priceStartingAt: '85.00',
          visibility: LookPostVisibility.FOLLOWERS_ONLY,
          publish: true,
        },
      },
    )

    expect(res.status).toBe(201)
    expect(body).toEqual({
      ok: true,
      ...result,
    })
  })

  it('returns 404 when the media asset does not exist', async () => {
    mocks.createOrUpdateProLookFromMediaAsset.mockRejectedValue(
      new Error('Media asset not found.'),
    )

    const res = await POST(
      makeJsonRequest({
        mediaAssetId: 'media_missing',
        primaryServiceId: 'service_1',
        publish: true,
      }),
    )
    const body = await readJson(res)

    expect(res.status).toBe(404)
    expect(body).toEqual({
      ok: false,
      error: 'Media asset not found.',
    })
  })

  it('returns 403 when the professional does not own the media asset', async () => {
    mocks.createOrUpdateProLookFromMediaAsset.mockRejectedValue(
      new Error('Not allowed to publish this media asset.'),
    )

    const res = await POST(
      makeJsonRequest({
        mediaAssetId: 'media_1',
        primaryServiceId: 'service_1',
        publish: true,
      }),
    )
    const body = await readJson(res)

    expect(res.status).toBe(403)
    expect(body).toEqual({
      ok: false,
      error: 'Not allowed to publish this media asset.',
    })
  })
})