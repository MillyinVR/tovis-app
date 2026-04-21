// app/api/pro/media/route.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  LookPostVisibility,
  MediaType,
  MediaVisibility,
} from '@prisma/client'

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

  const serviceFindMany = vi.fn()
  const mediaAssetCreate = vi.fn()

  const tx = {
    mediaAsset: {
      create: mediaAssetCreate,
    },
  }

  const prisma = {
    service: {
      findMany: serviceFindMany,
    },
    $transaction: vi.fn(
      async (callback: (db: typeof tx) => Promise<unknown>) => {
        return await callback(tx)
      },
    ),
  }

  const createOrUpdateProLookFromMediaAsset = vi.fn()

  return {
    jsonOk,
    jsonFail,
    requirePro,
    prisma,
    tx,
    serviceFindMany,
    mediaAssetCreate,
    createOrUpdateProLookFromMediaAsset,
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
  upper: (value: unknown) =>
    typeof value === 'string' ? value.trim().toUpperCase() : '',
}))

vi.mock('@/lib/prisma', () => ({
  prisma: mocks.prisma,
}))

vi.mock('@/lib/looks/publication/service', () => ({
  createOrUpdateProLookFromMediaAsset:
    mocks.createOrUpdateProLookFromMediaAsset,
}))

import { POST } from './route'
import { BUCKETS } from '@/lib/storageBuckets'

type CreatedMediaServiceTestDto = {
  serviceId: string
  service: {
    id: string
    name: string
  }
}

type CreatedMediaTestDto = {
  id: string
  professionalId: string
  caption: string | null
  mediaType: MediaType
  visibility: MediaVisibility
  isFeaturedInPortfolio: boolean
  isEligibleForLooks: boolean
  url: string | null
  thumbUrl: string | null
  storageBucket: string
  storagePath: string
  thumbBucket: string | null
  thumbPath: string | null
  services: CreatedMediaServiceTestDto[]
}

type LookPublicationResultStateTestDto = {
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

type LookPublicationResultTestDto = {
  target: {
    kind: 'LOOK_POST'
    id: string
    professionalId: string
    primaryMediaAssetId: string
  }
  action: 'create_draft' | 'publish' | 'update' | 'archive' | 'unpublish'
  result: LookPublicationResultStateTestDto
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
  return new Request('http://localhost/api/pro/media', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  })
}

async function readJson(res: Response): Promise<unknown> {
  return await res.json()
}

function makeCreatedMedia(
  overrides?: Partial<CreatedMediaTestDto>,
): CreatedMediaTestDto {
  return {
    id: 'media_1',
    professionalId: 'pro_1',
    caption: 'Fresh set',
    mediaType: MediaType.IMAGE,
    visibility: MediaVisibility.PUBLIC,
    isFeaturedInPortfolio: false,
    isEligibleForLooks: false,
    url: 'https://cdn.example.com/media_1.jpg',
    thumbUrl: null,
    storageBucket: BUCKETS.mediaPublic,
    storagePath: 'pros/pro_1/media_1.jpg',
    thumbBucket: null,
    thumbPath: null,
    services: [
      {
        serviceId: 'service_1',
        service: {
          id: 'service_1',
          name: 'Gel X',
        },
      },
    ],
    ...overrides,
  }
}

function makeLookPublicationResult(
  overrides?: Partial<LookPublicationResultTestDto>,
): LookPublicationResultTestDto {
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
      serviceId: 'service_2',
      caption: 'Fresh set',
      priceStartingAt: '85.00',
      status: 'PUBLISHED',
      visibility: LookPostVisibility.FOLLOWERS_ONLY,
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

describe('app/api/pro/media/route.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mocks.requirePro.mockResolvedValue(makeProAuth())

    mocks.serviceFindMany.mockResolvedValue([{ id: 'service_1' }])

    mocks.mediaAssetCreate.mockResolvedValue(makeCreatedMedia())

    mocks.createOrUpdateProLookFromMediaAsset.mockResolvedValue(
      makeLookPublicationResult(),
    )
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
      storageBucket: BUCKETS.mediaPublic,
      storagePath: 'pros/pro_1/media_1.jpg',
      publicUrl: 'https://cdn.example.com/media_1.jpg',
      serviceIds: ['service_1'],
    })

    const res = await POST(req)

    expect(res).toBe(authRes)
    expect(mocks.serviceFindMany).not.toHaveBeenCalled()
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled()
  })

  it('returns 400 when upload bucket/path is missing', async () => {
    const res = await POST(
      makeJsonRequest({
        serviceIds: ['service_1'],
      }),
    )
    const body = await readJson(res)

    expect(res.status).toBe(400)
    expect(body).toEqual({
      ok: false,
      error: 'Missing upload bucket/path.',
    })

    expect(mocks.serviceFindMany).not.toHaveBeenCalled()
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled()
  })

  it('creates media only and does not publish a look when Looks is not enabled', async () => {
    mocks.serviceFindMany.mockResolvedValue([{ id: 'service_1' }])

    const createdMedia = makeCreatedMedia({
      isFeaturedInPortfolio: true,
      isEligibleForLooks: false,
    })

    mocks.mediaAssetCreate.mockResolvedValue(createdMedia)

    const req = makeJsonRequest({
      storageBucket: BUCKETS.mediaPublic,
      storagePath: 'pros/pro_1/media_1.jpg',
      publicUrl: 'https://cdn.example.com/media_1.jpg',
      caption: 'Portfolio upload',
      mediaType: 'image',
      isFeaturedInPortfolio: true,
      isEligibleForLooks: false,
      serviceIds: ['service_1'],
    })

    const res = await POST(req)
    const body = await readJson(res)

    expect(mocks.serviceFindMany).toHaveBeenCalledWith({
      where: {
        id: { in: ['service_1'] },
        isActive: true,
      },
      select: {
        id: true,
      },
    })

    expect(mocks.mediaAssetCreate).toHaveBeenCalledWith({
      data: {
        professionalId: 'pro_1',
        url: 'https://cdn.example.com/media_1.jpg',
        thumbUrl: null,
        caption: 'Portfolio upload',
        mediaType: MediaType.IMAGE,
        visibility: MediaVisibility.PUBLIC,
        isFeaturedInPortfolio: true,
        isEligibleForLooks: false,
        storageBucket: BUCKETS.mediaPublic,
        storagePath: 'pros/pro_1/media_1.jpg',
        thumbBucket: null,
        thumbPath: null,
        services: {
          createMany: {
            data: [{ serviceId: 'service_1' }],
            skipDuplicates: true,
          },
        },
      },
      include: {
        services: {
          include: {
            service: true,
          },
        },
      },
    })

    expect(
      mocks.createOrUpdateProLookFromMediaAsset,
    ).not.toHaveBeenCalled()

    expect(res.status).toBe(201)
    expect(body).toEqual({
      ok: true,
      media: createdMedia,
    })
  })

  it('creates media and delegates to the publication service when Looks is enabled', async () => {
    mocks.serviceFindMany.mockResolvedValue([
      { id: 'service_1' },
      { id: 'service_2' },
    ])

    const createdMedia = makeCreatedMedia({
      id: 'media_looks_1',
      isEligibleForLooks: true,
      services: [
        {
          serviceId: 'service_1',
          service: { id: 'service_1', name: 'Builder Gel' },
        },
        {
          serviceId: 'service_2',
          service: { id: 'service_2', name: 'Nail Art' },
        },
      ],
    })

    mocks.mediaAssetCreate.mockResolvedValue(createdMedia)

    const baseLookPublication = makeLookPublicationResult()

    const lookPublication = makeLookPublicationResult({
      target: {
        kind: 'LOOK_POST',
        id: 'look_looks_1',
        professionalId: 'pro_1',
        primaryMediaAssetId: 'media_looks_1',
      },
      result: {
        ...baseLookPublication.result,
        id: 'look_looks_1',
        primaryMediaAssetId: 'media_looks_1',
      },
    })

    mocks.createOrUpdateProLookFromMediaAsset.mockResolvedValue(
      lookPublication,
    )

    const req = makeJsonRequest({
      storageBucket: BUCKETS.mediaPublic,
      storagePath: 'pros/pro_1/media_looks_1.jpg',
      publicUrl: 'https://cdn.example.com/media_looks_1.jpg',
      caption: 'Fresh set',
      mediaType: 'image',
      isEligibleForLooks: true,
      isFeaturedInPortfolio: true,
      publishToLooks: true,
      primaryServiceId: 'service_2',
      serviceIds: ['service_1', 'service_2'],
      lookVisibility: LookPostVisibility.FOLLOWERS_ONLY,
      priceStartingAt: '85.00',
    })

    const res = await POST(req)
    const body = await readJson(res)

    expect(mocks.createOrUpdateProLookFromMediaAsset).toHaveBeenCalledWith(
      mocks.tx,
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
      media: createdMedia,
      lookPublication,
    })
  })

  it('returns 400 when publishToLooks is true but isEligibleForLooks is false', async () => {
  const res = await POST(
    makeJsonRequest({
      storageBucket: BUCKETS.mediaPrivate,
      storagePath: 'pros/pro_1/media_1.jpg',
      serviceIds: ['service_1'],
      isEligibleForLooks: false,
      publishToLooks: true,
    }),
  )
  const body = await readJson(res)

  expect(res.status).toBe(400)
  expect(body).toEqual({
    ok: false,
    error: 'publishToLooks requires isEligibleForLooks to be true.',
  })

  expect(mocks.prisma.$transaction).not.toHaveBeenCalled()
  expect(
    mocks.createOrUpdateProLookFromMediaAsset,
  ).not.toHaveBeenCalled()
})

  it('returns 400 when Looks is enabled with multiple service tags but no primaryServiceId is provided', async () => {
    mocks.serviceFindMany.mockResolvedValue([
      { id: 'service_1' },
      { id: 'service_2' },
    ])

    const res = await POST(
      makeJsonRequest({
        storageBucket: BUCKETS.mediaPublic,
        storagePath: 'pros/pro_1/media_1.jpg',
        publicUrl: 'https://cdn.example.com/media_1.jpg',
        serviceIds: ['service_1', 'service_2'],
        isEligibleForLooks: true,
      }),
    )
    const body = await readJson(res)

    expect(res.status).toBe(400)
    expect(body).toEqual({
      ok: false,
      error:
        'primaryServiceId is required when publishing to Looks with multiple service tags.',
    })

    expect(mocks.prisma.$transaction).not.toHaveBeenCalled()
    expect(
      mocks.createOrUpdateProLookFromMediaAsset,
    ).not.toHaveBeenCalled()
  })
})