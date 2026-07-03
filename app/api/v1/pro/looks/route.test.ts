// app/api/v1/pro/looks/route.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { LookPostStatus, LookPostVisibility } from '@prisma/client'

import { encodeProLooksCursor } from '@/lib/looks/proLooksList'

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
  const lookPostFindMany = vi.fn()
  const mapLooksFeedMediaToDto = vi.fn()

  const prisma = {
    __brand: 'prisma-test-double',
    lookPost: {
      findMany: lookPostFindMany,
    },
  }

  return {
    jsonOk,
    jsonFail,
    requirePro,
    createOrUpdateProLookFromMediaAsset,
    lookPostFindMany,
    mapLooksFeedMediaToDto,
    prisma,
  }
})

vi.mock('@/app/api/_utils', () => ({
  jsonOk: mocks.jsonOk,
  jsonFail: mocks.jsonFail,
  requirePro: mocks.requirePro,
  pickString: (v: unknown) =>
    typeof v === 'string' && v.trim() ? v.trim() : null,
  pickInt: (v: unknown) => {
    const n =
      typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN
    return Number.isFinite(n) ? Math.trunc(n) : null
  },
}))

vi.mock('@/lib/looks/mappers', () => ({
  mapLooksFeedMediaToDto: mocks.mapLooksFeedMediaToDto,
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
  return new Request('http://localhost/api/v1/pro/looks', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  })
}

function makeTextRequest(body = 'x'): Request {
  return new Request('http://localhost/api/v1/pro/looks', {
    method: 'POST',
    headers: {
      'content-type': 'text/plain',
    },
    body,
  })
}

function makeGetRequest(query = ''): Request {
  return new Request(`http://localhost/api/v1/pro/looks${query}`, {
    method: 'GET',
  })
}

function makeOwnedLookRow(id: string, createdAt: Date) {
  return {
    id,
    createdAt,
    status: LookPostStatus.PUBLISHED,
    visibility: LookPostVisibility.PUBLIC,
  }
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

describe('app/api/v1/pro/looks/route.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => {})

    mocks.requirePro.mockResolvedValue(makeProAuth())
    mocks.createOrUpdateProLookFromMediaAsset.mockResolvedValue(
      makeLookPublicationResult(),
    )
    mocks.mapLooksFeedMediaToDto.mockImplementation(
      ({ item }: { item: { id: string } }) =>
        Promise.resolve({ id: item.id, url: `https://cdn.test/${item.id}` }),
    )
  })

  it('GET propagates the failed pro auth response unchanged', async () => {
    const authRes = Response.json(
      { ok: false, error: 'Unauthorized' },
      { status: 401 },
    )
    mocks.requirePro.mockResolvedValue({ ok: false as const, res: authRes })

    const res = await GET(makeGetRequest())

    expect(res).toBe(authRes)
    expect(mocks.lookPostFindMany).not.toHaveBeenCalled()
  })

  it('GET lists the pro’s own looks with owner status/visibility fields', async () => {
    const createdAt = new Date('2026-07-01T00:00:00.000Z')
    mocks.lookPostFindMany.mockResolvedValue([
      makeOwnedLookRow('look_1', createdAt),
    ])

    const res = await GET(makeGetRequest())
    const body = (await readJson(res)) as {
      ok: boolean
      items: Array<Record<string, unknown>>
      nextCursor: string | null
    }

    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.items).toHaveLength(1)
    expect(body.items[0]).toMatchObject({
      id: 'look_1',
      status: LookPostStatus.PUBLISHED,
      visibility: LookPostVisibility.PUBLIC,
    })
    expect(body.nextCursor).toBeNull()

    const args = mocks.lookPostFindMany.mock.calls[0]?.[0] as {
      where: Record<string, unknown>
      take: number
    }
    expect(args.where).toMatchObject({
      professionalId: 'pro_1',
      clientAuthorId: null,
      removedAt: null,
    })
    expect(args.take).toBe(25)
  })

  it('GET rejects an invalid status filter', async () => {
    const res = await GET(makeGetRequest('?status=REMOVED'))

    expect(res.status).toBe(400)
    expect(mocks.lookPostFindMany).not.toHaveBeenCalled()
  })

  it('GET rejects an invalid cursor', async () => {
    const res = await GET(makeGetRequest('?cursor=garbage'))

    expect(res.status).toBe(400)
    expect(mocks.lookPostFindMany).not.toHaveBeenCalled()
  })

  it('GET returns a nextCursor when more rows exist and honors it on page 2', async () => {
    const first = new Date('2026-07-02T00:00:00.000Z')
    const second = new Date('2026-07-01T00:00:00.000Z')
    mocks.lookPostFindMany.mockResolvedValue([
      makeOwnedLookRow('look_2', first),
      makeOwnedLookRow('look_1', second),
    ])

    const res = await GET(makeGetRequest('?limit=1'))
    const body = (await readJson(res)) as {
      items: Array<{ id: string }>
      nextCursor: string | null
    }

    expect(body.items).toHaveLength(1)
    expect(body.items[0]?.id).toBe('look_2')
    expect(body.nextCursor).toBe(
      encodeProLooksCursor({ createdAt: first, id: 'look_2' }),
    )

    mocks.lookPostFindMany.mockResolvedValue([
      makeOwnedLookRow('look_1', second),
    ])
    const page2 = await GET(
      makeGetRequest(`?limit=1&cursor=${body.nextCursor}`),
    )
    const page2Body = (await readJson(page2)) as {
      items: Array<{ id: string }>
      nextCursor: string | null
    }

    expect(page2Body.items[0]?.id).toBe('look_1')
    expect(page2Body.nextCursor).toBeNull()

    const page2Args = mocks.lookPostFindMany.mock.calls[1]?.[0] as {
      where: { AND?: unknown[] }
    }
    expect(Array.isArray(page2Args.where.AND)).toBe(true)
  })

  it('GET drops rows the mapper rejects (e.g. unrenderable media)', async () => {
    const createdAt = new Date('2026-07-01T00:00:00.000Z')
    mocks.lookPostFindMany.mockResolvedValue([
      makeOwnedLookRow('look_1', createdAt),
    ])
    mocks.mapLooksFeedMediaToDto.mockResolvedValue(null)

    const res = await GET(makeGetRequest())
    const body = (await readJson(res)) as { items: unknown[] }

    expect(res.status).toBe(200)
    expect(body.items).toHaveLength(0)
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