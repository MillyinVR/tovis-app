// app/api/v1/pro/media/route.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  LookPostVisibility,
  MediaPhase,
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
  const mediaAssetFindMany = vi.fn()
  const professionalProfileFindUnique = vi.fn()

  const mediaAssetFindUniqueTx = vi.fn()

  const tx = {
    mediaAsset: {
      create: mediaAssetCreate,
      // §19b: the route re-reads the reconciled portfolio flags after publishing
      // so the response echoes DB truth.
      findUnique: mediaAssetFindUniqueTx,
    },
    professionalProfile: {
      findUnique: professionalProfileFindUnique,
    },
  }

  const prisma = {
    service: {
      findMany: serviceFindMany,
    },
    mediaAsset: {
      findMany: mediaAssetFindMany,
    },
    // §18d — GET reads the pro's cover id to flag the cover tile.
    professionalProfile: {
      findUnique: professionalProfileFindUnique,
    },
    $transaction: vi.fn(
      async (callback: (db: typeof tx) => Promise<unknown>) => {
        return await callback(tx)
      },
    ),
  }

  const createOrUpdateProLookFromMediaAsset = vi.fn()

  const validateUploadSession = vi.fn()
  const consumeUploadSession = vi.fn()

  const renderMediaUrlsBatch = vi.fn()

  return {
    jsonOk,
    jsonFail,
    requirePro,
    prisma,
    tx,
    serviceFindMany,
    mediaAssetCreate,
    mediaAssetFindMany,
    professionalProfileFindUnique,
    mediaAssetFindUniqueTx,
    createOrUpdateProLookFromMediaAsset,
    validateUploadSession,
    consumeUploadSession,
    renderMediaUrlsBatch,
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

vi.mock('@/lib/media/uploadSession', () => {
  class UploadSessionError extends Error {
    code: string
    httpStatus: number
    constructor(code: string, message: string) {
      super(message)
      this.name = 'UploadSessionError'
      this.code = code
      this.httpStatus = code === 'FORBIDDEN' ? 403 : 400
    }
  }
  return {
    validateUploadSession: mocks.validateUploadSession,
    consumeUploadSession: mocks.consumeUploadSession,
    UploadSessionError,
  }
})

vi.mock('@/lib/media/renderUrls', () => ({
  renderMediaUrlsBatch: mocks.renderMediaUrlsBatch,
}))

vi.mock('@/lib/security/logging', () => ({
  safeError: vi.fn((error: unknown) => ({
    name: error instanceof Error ? error.name : 'NonErrorThrown',
    message: error instanceof Error ? error.message : String(error),
  })),
}))

import { GET, POST } from './route'
import { BUCKETS } from '@/lib/storageBuckets'
import { safeError } from '@/lib/security/logging'

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
  primaryServiceId: string
  caption: string | null
  mediaType: MediaType
  visibility: MediaVisibility
  isFeaturedInPortfolio: boolean
  isEligibleForLooks: boolean
  url: string | null
  thumbUrl: string | null
  createdAt: Date
  storageBucket: string
  storagePath: string
  thumbBucket: string | null
  thumbPath: string | null
  services: CreatedMediaServiceTestDto[]
}

const CREATED_AT = new Date('2026-04-21T00:00:00.000Z')

// The picked `media` DTO the route now emits from a created row: storage
// pointers dropped, createdAt serialized, service tags slimmed to id + name.
function expectedMediaDTO(created: CreatedMediaTestDto) {
  return {
    id: created.id,
    professionalId: created.professionalId,
    primaryServiceId: created.primaryServiceId,
    mediaType: created.mediaType,
    visibility: created.visibility,
    caption: created.caption,
    isFeaturedInPortfolio: created.isFeaturedInPortfolio,
    isEligibleForLooks: created.isEligibleForLooks,
    url: created.url,
    thumbUrl: created.thumbUrl,
    createdAt: created.createdAt.toISOString(),
    services: created.services.map((tag) => ({
      serviceId: tag.serviceId,
      name: tag.service.name,
    })),
  }
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
  return new Request('http://localhost/api/v1/pro/media', {
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
    primaryServiceId: 'service_1',
    caption: 'Fresh set',
    mediaType: MediaType.IMAGE,
    visibility: MediaVisibility.PUBLIC,
    isFeaturedInPortfolio: false,
    isEligibleForLooks: false,
    url: 'https://cdn.example.com/media_1.jpg',
    thumbUrl: null,
    createdAt: CREATED_AT,
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

describe('app/api/v1/pro/media/route.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mocks.requirePro.mockResolvedValue(makeProAuth())

    mocks.serviceFindMany.mockResolvedValue([{ id: 'service_1' }])

    mocks.mediaAssetCreate.mockResolvedValue(makeCreatedMedia())

    mocks.professionalProfileFindUnique.mockResolvedValue({
      homeTenantId: 'tenant_root',
    })

    mocks.createOrUpdateProLookFromMediaAsset.mockResolvedValue(
      makeLookPublicationResult(),
    )

    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://supabase.example'

    mocks.validateUploadSession.mockResolvedValue({
      id: 'us_1',
      surface: 'PRO_PORTFOLIO',
      status: 'PENDING',
      professionalId: 'pro_1',
      clientId: null,
      bookingId: null,
      phase: null,
      storageBucket: BUCKETS.mediaPublic,
      storagePath: 'pros/pro_1/media_1.jpg',
      contentType: 'image/jpeg',
      maxBytes: 30 * 1024 * 1024,
      checksumSha256: null,
      expiresAt: new Date(Date.now() + 60_000),
      consumedAt: null,
      mediaAssetId: null,
    })
    mocks.consumeUploadSession.mockResolvedValue(undefined)

    // Default finalFlags re-read → undefined so the response echoes the created
    // row; individual tests that assert the mirror override this.
    mocks.mediaAssetFindUniqueTx.mockResolvedValue(undefined)
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

  it('returns 400 when uploadSessionId is missing', async () => {
    const res = await POST(
      makeJsonRequest({
        serviceIds: ['service_1'],
      }),
    )
    const body = await readJson(res)

    expect(res.status).toBe(400)
    expect(body).toEqual({
      ok: false,
      error: 'Missing uploadSessionId.',
    })

    expect(mocks.validateUploadSession).not.toHaveBeenCalled()
    expect(mocks.serviceFindMany).not.toHaveBeenCalled()
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled()
  })

  it('§19b: featuring to portfolio publishes a Look even when the Looks checkbox is off', async () => {
    mocks.serviceFindMany.mockResolvedValue([{ id: 'service_1' }])

    // Unified public atom: a featured upload is stored Looks-eligible and its
    // Look is published (grid + feed are one surface).
    const createdMedia = makeCreatedMedia({
      isFeaturedInPortfolio: true,
      isEligibleForLooks: true,
    })

    mocks.mediaAssetCreate.mockResolvedValue(createdMedia)

    const req = makeJsonRequest({
      uploadSessionId: 'us_1',
      caption: 'Portfolio upload',
      mediaType: 'image',
      isFeaturedInPortfolio: true,
      isEligibleForLooks: false,
      serviceIds: ['service_1'],
    })

    const res = await POST(req)
    const body = await readJson(res)

    expect(mocks.mediaAssetCreate).toHaveBeenCalledWith({
      data: {
        professionalId: 'pro_1',
        proTenantId: 'tenant_root',
        primaryServiceId: 'service_1',
        url: 'https://supabase.example/storage/v1/object/public/media-public/pros/pro_1/media_1.jpg',
        thumbUrl: null,
        focalX: null,
        focalY: null,
        caption: 'Portfolio upload',
        mediaType: MediaType.IMAGE,
        visibility: MediaVisibility.PUBLIC,
        isFeaturedInPortfolio: true,
        // §19b: featured ⇒ Looks-eligible so the publish below can back a Look.
        isEligibleForLooks: true,
        storageBucket: BUCKETS.mediaPublic,
        storagePath: 'pros/pro_1/media_1.jpg',
        thumbBucket: null,
        thumbPath: null,
        bookingId: null,
        reviewId: null,
        uploadedByUserId: null,
        uploadedByRole: null,
        phase: MediaPhase.OTHER,
        reviewLocked: false,
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

    // Featured (publishToLooks defaults off) → the Look is published anyway.
    expect(mocks.createOrUpdateProLookFromMediaAsset).toHaveBeenCalledWith(
      mocks.tx,
      {
        professionalId: 'pro_1',
        request: {
          mediaAssetId: 'media_1',
          primaryServiceId: 'service_1',
          caption: 'Portfolio upload',
          priceStartingAt: null,
          publish: true,
        },
      },
    )

    expect(mocks.consumeUploadSession).toHaveBeenCalledWith(expect.anything(), {
      uploadSessionId: 'us_1',
      mediaAssetId: 'media_1',
      now: expect.any(Date),
    })

    expect(res.status).toBe(201)
    expect(body).toEqual({
      ok: true,
      media: expectedMediaDTO(createdMedia),
      lookPublication: makeLookPublicationResult(),
    })
  })

  it('creates a private PRO_CLIENT asset in the private bucket when no public surface is selected', async () => {
    mocks.serviceFindMany.mockResolvedValue([{ id: 'service_1' }])

    const createdMedia = makeCreatedMedia({
      visibility: MediaVisibility.PRO_CLIENT,
      isFeaturedInPortfolio: false,
      isEligibleForLooks: false,
      storageBucket: BUCKETS.mediaPrivate,
    })
    mocks.mediaAssetCreate.mockResolvedValue(createdMedia)

    // A PORTFOLIO_PRIVATE upload arrives on the PRO_PORTFOLIO surface but in the
    // private bucket; with both public flags off, visibility must resolve to
    // PRO_CLIENT and no Look may be published.
    mocks.validateUploadSession.mockResolvedValue({
      id: 'us_1',
      surface: 'PRO_PORTFOLIO',
      status: 'PENDING',
      professionalId: 'pro_1',
      clientId: null,
      bookingId: null,
      phase: null,
      storageBucket: BUCKETS.mediaPrivate,
      storagePath: 'pro/pro_1/portfolio_private/2026-06/media_1.jpg',
      contentType: 'image/jpeg',
      maxBytes: 30 * 1024 * 1024,
      checksumSha256: null,
      expiresAt: new Date(Date.now() + 60_000),
      consumedAt: null,
      mediaAssetId: null,
    })

    const req = makeJsonRequest({
      uploadSessionId: 'us_1',
      caption: 'Private upload',
      mediaType: 'image',
      isFeaturedInPortfolio: false,
      isEligibleForLooks: false,
      serviceIds: ['service_1'],
    })

    const res = await POST(req)
    const body = await readJson(res)

    expect(mocks.mediaAssetCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          visibility: MediaVisibility.PRO_CLIENT,
          isFeaturedInPortfolio: false,
          isEligibleForLooks: false,
          storageBucket: BUCKETS.mediaPrivate,
          url: null,
        }),
      }),
    )

    expect(mocks.createOrUpdateProLookFromMediaAsset).not.toHaveBeenCalled()

    expect(res.status).toBe(201)
    expect(body).toEqual({
      ok: true,
      media: expectedMediaDTO(createdMedia),
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
      uploadSessionId: 'us_1',
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
      media: expectedMediaDTO(createdMedia),
      lookPublication,
    })
  })

  it('returns 400 when publishToLooks is true but isEligibleForLooks is false', async () => {
    const res = await POST(
      makeJsonRequest({
        uploadSessionId: 'us_1',
        serviceIds: ['service_1'],
        isFeaturedInPortfolio: true,
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
    expect(mocks.createOrUpdateProLookFromMediaAsset).not.toHaveBeenCalled()
  })

  it('returns 400 when Looks is enabled with multiple service tags but no primaryServiceId is provided', async () => {
    mocks.serviceFindMany.mockResolvedValue([
      { id: 'service_1' },
      { id: 'service_2' },
    ])

    const res = await POST(
      makeJsonRequest({
        uploadSessionId: 'us_1',
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
  it('persists a normalized focal point so the Looks crop centers on the subject', async () => {
    mocks.serviceFindMany.mockResolvedValue([{ id: 'service_1' }])
    mocks.mediaAssetCreate.mockResolvedValue(makeCreatedMedia())

    const res = await POST(
      makeJsonRequest({
        uploadSessionId: 'us_1',
        serviceIds: ['service_1'],
        isFeaturedInPortfolio: true,
        focalX: 0.42,
        focalY: 0.18,
      }),
    )

    expect(res.status).toBe(201)
    expect(mocks.mediaAssetCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ focalX: 0.42, focalY: 0.18 }),
      }),
    )
  })

  it.each([
    ['an out-of-range coordinate', { focalX: 1.4, focalY: 0.5 }],
    ['a non-numeric coordinate', { focalX: '0.4', focalY: '0.5' }],
    ['a half-supplied pair', { focalX: 0.4 }],
  ])(
    'degrades %s to a centered crop instead of rejecting the post',
    async (_label, focal) => {
      mocks.serviceFindMany.mockResolvedValue([{ id: 'service_1' }])
      mocks.mediaAssetCreate.mockResolvedValue(makeCreatedMedia())

      const res = await POST(
        makeJsonRequest({
          uploadSessionId: 'us_1',
          serviceIds: ['service_1'],
          isFeaturedInPortfolio: true,
          ...focal,
        }),
      )

      // A focal point is a crop hint, never load-bearing — a bad one must not
      // cost the pro their upload (the bytes are already in the bucket).
      expect(res.status).toBe(201)
      expect(mocks.mediaAssetCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ focalX: null, focalY: null }),
        }),
      )
    },
  )

  it('returns 500 and logs a safe error when media creation throws', async () => {
    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined)

    const thrown = new Error(
      'storage failed for https://example.com/private.jpg?token=secret',
    )

    mocks.mediaAssetCreate.mockRejectedValueOnce(thrown)

    const res = await POST(
      makeJsonRequest({
        uploadSessionId: 'us_1',
        serviceIds: ['service_1'],
        isFeaturedInPortfolio: true,
      }),
    )

    const body = await readJson(res)

    expect(res.status).toBe(500)
    expect(body).toEqual({
      ok: false,
      error: 'Internal server error',
    })

    expect(safeError).toHaveBeenCalledWith(thrown)
    expect(consoleErrorSpy).toHaveBeenCalledWith('POST /api/v1/pro/media error', {
      error: {
        name: 'Error',
        message: 'storage failed for https://example.com/private.jpg?token=secret',
      },
    })

    consoleErrorSpy.mockRestore()
  })
})

// A MediaAsset row shaped exactly as the GET select returns it (storage pointers
// present for renderMediaUrlsBatch; service tags as { serviceId, service: name }).
function makeManagedMediaRow(
  overrides?: Partial<{
    id: string
    mediaType: MediaType
    visibility: MediaVisibility
    caption: string | null
    createdAt: Date
    reviewId: string | null
    isEligibleForLooks: boolean
    isFeaturedInPortfolio: boolean
    beforeAssetId: string | null
    storageBucket: string | null
    storagePath: string | null
    thumbBucket: string | null
    thumbPath: string | null
    url: string | null
    thumbUrl: string | null
    services: { serviceId: string; service: { name: string } }[]
  }>,
) {
  return {
    id: 'media_1',
    mediaType: MediaType.IMAGE,
    visibility: MediaVisibility.PUBLIC,
    caption: 'Fresh set',
    createdAt: CREATED_AT,
    reviewId: null,
    isEligibleForLooks: false,
    isFeaturedInPortfolio: true,
    beforeAssetId: null,
    storageBucket: BUCKETS.mediaPublic,
    storagePath: 'pros/pro_1/media_1.jpg',
    thumbBucket: null,
    thumbPath: null,
    url: 'https://cdn.example.com/media_1.jpg',
    thumbUrl: null,
    services: [{ serviceId: 'service_1', service: { name: 'Gel X' } }],
    ...overrides,
  }
}

describe('GET /api/v1/pro/media', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requirePro.mockResolvedValue(makeProAuth())
    mocks.mediaAssetFindMany.mockResolvedValue([makeManagedMediaRow()])
    // §18d — no cover set by default (branded fallback).
    mocks.professionalProfileFindUnique.mockResolvedValue({
      coverMediaAssetId: null,
    })
    mocks.serviceFindMany.mockResolvedValue([
      { id: 'service_1', name: 'Gel X' },
      { id: 'service_2', name: 'Nail Art' },
    ])
    mocks.renderMediaUrlsBatch.mockResolvedValue([
      {
        renderUrl: 'https://signed.example/media_1.jpg',
        renderThumbUrl: 'https://signed.example/media_1_thumb.jpg',
      },
    ])
  })

  it('passes through failed pro auth responses unchanged', async () => {
    const authRes = Response.json(
      { ok: false, error: 'Unauthorized' },
      { status: 401 },
    )
    mocks.requirePro.mockResolvedValue({ ok: false as const, res: authRes })

    const res = await GET()

    expect(res).toBe(authRes)
    expect(mocks.mediaAssetFindMany).not.toHaveBeenCalled()
    expect(mocks.serviceFindMany).not.toHaveBeenCalled()
  })

  it('lists the owning pro’s media with resolved URLs, tags, and service options', async () => {
    const res = await GET()
    const body = await readJson(res)

    // Owner-scoped, most-recent-first, capped.
    expect(mocks.mediaAssetFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { professionalId: 'pro_1' },
        orderBy: { createdAt: 'desc' },
        take: 60,
      }),
    )
    // Taggable options = the active Service taxonomy the PATCH validates against.
    expect(mocks.serviceFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { isActive: true },
        orderBy: { name: 'asc' },
      }),
    )

    expect(res.status).toBe(200)
    expect(body).toEqual({
      ok: true,
      items: [
        {
          id: 'media_1',
          mediaType: MediaType.IMAGE,
          visibility: MediaVisibility.PUBLIC,
          caption: 'Fresh set',
          createdAt: CREATED_AT.toISOString(),
          reviewId: null,
          isEligibleForLooks: false,
          isFeaturedInPortfolio: true,
          isCoverMedia: false,
          beforeAssetId: null,
          services: [{ serviceId: 'service_1', name: 'Gel X' }],
          url: 'https://cdn.example.com/media_1.jpg',
          thumbUrl: null,
          renderUrl: 'https://signed.example/media_1.jpg',
          renderThumbUrl: 'https://signed.example/media_1_thumb.jpg',
        },
      ],
      serviceOptions: [
        { serviceId: 'service_1', name: 'Gel X' },
        { serviceId: 'service_2', name: 'Nail Art' },
      ],
    })
  })

  it('flags the media that is the pro’s current cover banner (§18d)', async () => {
    mocks.mediaAssetFindMany.mockResolvedValue([
      makeManagedMediaRow({ id: 'media_cover' }),
      makeManagedMediaRow({ id: 'media_other' }),
    ])
    mocks.professionalProfileFindUnique.mockResolvedValue({
      coverMediaAssetId: 'media_cover',
    })
    mocks.renderMediaUrlsBatch.mockResolvedValue([
      { renderUrl: 'https://signed.example/a.jpg', renderThumbUrl: null },
      { renderUrl: 'https://signed.example/b.jpg', renderThumbUrl: null },
    ])

    const res = await GET()
    const body = (await readJson(res)) as {
      items: { id: string; isCoverMedia: boolean }[]
    }

    expect(res.status).toBe(200)
    expect(body.items.map((i) => [i.id, i.isCoverMedia])).toEqual([
      ['media_cover', true],
      ['media_other', false],
    ])
  })

  it('carries the before/after pairing pointer and null render URLs when unresolvable', async () => {
    mocks.mediaAssetFindMany.mockResolvedValue([
      makeManagedMediaRow({
        id: 'media_after',
        beforeAssetId: 'media_before',
        storageBucket: BUCKETS.mediaPrivate,
        url: null,
        thumbUrl: null,
      }),
    ])
    mocks.renderMediaUrlsBatch.mockResolvedValue([
      { renderUrl: null, renderThumbUrl: null },
    ])

    const res = await GET()
    const body = (await readJson(res)) as {
      items: { beforeAssetId: string | null; renderUrl: string | null }[]
    }

    expect(res.status).toBe(200)
    const [first] = body.items
    expect(first).toBeDefined()
    expect(first?.beforeAssetId).toBe('media_before')
    expect(first?.renderUrl).toBeNull()
  })

  it('returns 500 and logs a safe error when the query throws', async () => {
    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined)
    const thrown = new Error('db down')
    mocks.mediaAssetFindMany.mockRejectedValueOnce(thrown)

    const res = await GET()
    const body = await readJson(res)

    expect(res.status).toBe(500)
    expect(body).toEqual({ ok: false, error: 'Failed to load media.' })
    expect(safeError).toHaveBeenCalledWith(thrown)

    consoleErrorSpy.mockRestore()
  })
})