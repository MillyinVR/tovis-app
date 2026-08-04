// app/api/v1/pro/practice/[id]/attach/route.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MediaPhase, MediaType, MediaVisibility } from '@prisma/client'

const mocks = vi.hoisted(() => {
  const jsonOk = vi.fn(
    (data?: Record<string, unknown>, init?: number | ResponseInit) => {
      const status = typeof init === 'number' ? init : init?.status
      return Response.json({ ok: true, ...(data ?? {}) }, { status: status ?? 200 })
    },
  )

  const jsonFail = vi.fn(
    (status: number, error: string, extra?: Record<string, unknown>) =>
      Response.json({ ok: false, error, ...(extra ?? {}) }, { status }),
  )

  const requirePro = vi.fn()

  const practiceShotFindUnique = vi.fn()
  const practiceShotUpdate = vi.fn()
  const bookingFindUnique = vi.fn()
  const serviceFindMany = vi.fn()
  const mediaAssetCreate = vi.fn()
  const mediaAssetFindUnique = vi.fn()
  const practiceShotUpdateTx = vi.fn()

  const tx = {
    mediaAsset: { create: mediaAssetCreate, findUnique: mediaAssetFindUnique },
    practiceShot: { update: practiceShotUpdateTx },
  }

  const prisma = {
    practiceShot: { findUnique: practiceShotFindUnique, update: practiceShotUpdate },
    booking: { findUnique: bookingFindUnique },
    service: { findMany: serviceFindMany },
    $transaction: vi.fn(async (callback: (db: typeof tx) => Promise<unknown>) =>
      callback(tx),
    ),
  }

  const copyStorageObject = vi.fn()
  const uploadProBookingMedia = vi.fn()
  const createOrUpdateProLookFromMediaAsset = vi.fn()
  const renderMediaUrls = vi.fn()
  const renderMediaUrlsBatch = vi.fn()
  const isRuntimeFlagEnabled = vi.fn()
  const resolveProTenantId = vi.fn()
  const storageRemove = vi.fn()

  return {
    jsonOk,
    jsonFail,
    requirePro,
    prisma,
    tx,
    practiceShotFindUnique,
    practiceShotUpdate,
    practiceShotUpdateTx,
    bookingFindUnique,
    serviceFindMany,
    mediaAssetCreate,
    mediaAssetFindUnique,
    copyStorageObject,
    uploadProBookingMedia,
    createOrUpdateProLookFromMediaAsset,
    renderMediaUrls,
    renderMediaUrlsBatch,
    isRuntimeFlagEnabled,
    resolveProTenantId,
    storageRemove,
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

vi.mock('@/lib/prisma', () => ({ prisma: mocks.prisma }))

vi.mock('@/lib/media/copyToPublicBucket', () => {
  class StorageCopyError extends Error {}
  return { copyStorageObject: mocks.copyStorageObject, StorageCopyError }
})

vi.mock('@/lib/booking/writeBoundary', () => ({
  uploadProBookingMedia: mocks.uploadProBookingMedia,
}))

vi.mock('@/lib/booking/errors', () => ({
  isBookingError: () => false,
}))

vi.mock('@/app/api/_utils/bookingResponses', () => ({
  bookingErrorJsonFail: vi.fn(() => Response.json({ ok: false }, { status: 409 })),
}))

vi.mock('@/lib/looks/publication/service', () => ({
  createOrUpdateProLookFromMediaAsset: mocks.createOrUpdateProLookFromMediaAsset,
}))

vi.mock('@/lib/media/renderUrls', () => ({
  renderMediaUrls: mocks.renderMediaUrls,
  renderMediaUrlsBatch: mocks.renderMediaUrlsBatch,
}))

vi.mock('@/lib/runtimeFlags', () => ({
  isRuntimeFlagEnabled: mocks.isRuntimeFlagEnabled,
}))

vi.mock('@/lib/tenant/bookingAttribution', () => ({
  resolveProTenantId: mocks.resolveProTenantId,
}))

vi.mock('@/lib/supabaseAdmin', () => ({
  getSupabaseAdmin: () => ({
    storage: { from: () => ({ remove: mocks.storageRemove }) },
  }),
}))

vi.mock('@/lib/security/logging', () => ({
  safeError: vi.fn((error: unknown) => ({
    message: error instanceof Error ? error.message : String(error),
  })),
}))

import { NextRequest } from 'next/server'

import { POST } from './route'
import type { RouteContext } from '@/app/api/_utils/routeContext'
import { BUCKETS } from '@/lib/storageBuckets'

const PRO_ID = 'pro_1'
const CREATED_AT = new Date('2026-08-04T12:00:00.000Z')

function shotRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'shot_1',
    professionalId: PRO_ID,
    storageBucket: BUCKETS.mediaPrivate,
    storagePath: `pro/${PRO_ID}/practice_private/2026-08/1_a.jpg`,
    contentType: 'image/jpeg',
    mediaType: MediaType.IMAGE,
    caption: null,
    focalX: 0.5,
    focalY: 0.4,
    attachedMediaId: null,
    attachedAt: null,
    createdAt: CREATED_AT,
    ...overrides,
  }
}

function attachRequest(body: unknown): NextRequest {
  return new NextRequest('https://tovis.test/api/v1/pro/practice/shot_1/attach', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

const CTX: RouteContext = { params: Promise.resolve({ id: 'shot_1' }) }

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requirePro.mockResolvedValue({
    ok: true,
    professionalId: PRO_ID,
    userId: 'user_1',
  })
  mocks.isRuntimeFlagEnabled.mockResolvedValue(false)
  mocks.resolveProTenantId.mockResolvedValue('tenant_1')
  mocks.practiceShotFindUnique.mockResolvedValue(shotRow())
  mocks.renderMediaUrls.mockResolvedValue({
    renderUrl: 'https://signed/one',
    renderThumbUrl: null,
  })
})

describe('POST /api/v1/pro/practice/[id]/attach — BOOKING', () => {
  beforeEach(() => {
    mocks.bookingFindUnique.mockResolvedValue({
      id: 'bk_1',
      professionalId: PRO_ID,
    })
    mocks.copyStorageObject.mockResolvedValue({
      storageBucket: BUCKETS.mediaPrivate,
      storagePath: 'bookings/bk_1/other/2026/08/04/1_a.jpg',
      contentType: 'image/jpeg',
    })
    mocks.uploadProBookingMedia.mockResolvedValue({
      created: {
        id: 'media_1',
        mediaType: MediaType.IMAGE,
        visibility: MediaVisibility.PRO_CLIENT,
        phase: MediaPhase.OTHER,
        caption: null,
        createdAt: CREATED_AT,
        reviewId: null,
        isEligibleForLooks: false,
        isFeaturedInPortfolio: false,
        storageBucket: BUCKETS.mediaPrivate,
        storagePath: 'bookings/bk_1/other/2026/08/04/1_a.jpg',
        thumbBucket: null,
        thumbPath: null,
        url: null,
        thumbUrl: null,
      },
      advancedTo: null,
      meta: {},
    })
    mocks.practiceShotUpdate.mockResolvedValue(
      shotRow({ attachedMediaId: 'media_1', attachedAt: CREATED_AT }),
    )
  })

  it('copies the bytes into the booking namespace and records phase OTHER', async () => {
    const res = await POST(attachRequest({ target: 'BOOKING', bookingId: 'bk_1' }), CTX)
    const body = await res.json()

    expect(res.status).toBe(201)
    expect(body.target).toBe('BOOKING')

    // The bytes are COPIED, not shared — the practice object stays put.
    expect(mocks.copyStorageObject).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceBucket: BUCKETS.mediaPrivate,
        sourcePath: `pro/${PRO_ID}/practice_private/2026-08/1_a.jpg`,
        destBucket: BUCKETS.mediaPrivate,
      }),
    )
    const destPath = mocks.copyStorageObject.mock.calls[0]?.[0].buildDestPath('jpg')
    expect(destPath).toMatch(/^bookings\/bk_1\/other\/\d{4}\/\d{2}\/\d{2}\//)

    // …and the write goes through the booking boundary at the COPIED pointer.
    expect(mocks.uploadProBookingMedia).toHaveBeenCalledWith(
      expect.objectContaining({
        bookingId: 'bk_1',
        professionalId: PRO_ID,
        phase: MediaPhase.OTHER,
        storagePath: 'bookings/bk_1/other/2026/08/04/1_a.jpg',
        focalX: 0.5,
        focalY: 0.4,
      }),
    )
    expect(body.shot.attachedMediaId).toBe('media_1')
  })

  it('never attaches to another pro’s booking, and copies nothing when it refuses', async () => {
    mocks.bookingFindUnique.mockResolvedValue({
      id: 'bk_1',
      professionalId: 'pro_other',
    })

    const res = await POST(attachRequest({ target: 'BOOKING', bookingId: 'bk_1' }), CTX)

    expect(res.status).toBe(404)
    expect(mocks.copyStorageObject).not.toHaveBeenCalled()
    expect(mocks.uploadProBookingMedia).not.toHaveBeenCalled()
  })

  it('cleans up the copied object when the booking write then fails', async () => {
    mocks.uploadProBookingMedia.mockRejectedValue(new Error('boundary refused'))

    const res = await POST(attachRequest({ target: 'BOOKING', bookingId: 'bk_1' }), CTX)

    expect(res.status).toBe(500)
    expect(mocks.storageRemove).toHaveBeenCalledWith([
      'bookings/bk_1/other/2026/08/04/1_a.jpg',
    ])
    expect(mocks.practiceShotUpdate).not.toHaveBeenCalled()
  })

  it('400s without a bookingId', async () => {
    const res = await POST(attachRequest({ target: 'BOOKING' }), CTX)

    expect(res.status).toBe(400)
    expect(mocks.copyStorageObject).not.toHaveBeenCalled()
  })
})

describe('POST /api/v1/pro/practice/[id]/attach — LOOK', () => {
  beforeEach(() => {
    mocks.serviceFindMany.mockResolvedValue([{ id: 'svc_1' }])
    mocks.copyStorageObject.mockResolvedValue({
      storageBucket: BUCKETS.mediaPublic,
      storagePath: `pro/${PRO_ID}/practice_look_public/2026-08/1_a.jpg`,
      contentType: 'image/jpeg',
    })
    mocks.mediaAssetCreate.mockResolvedValue({
      id: 'media_2',
      professionalId: PRO_ID,
      primaryServiceId: 'svc_1',
      mediaType: MediaType.IMAGE,
      visibility: MediaVisibility.PUBLIC,
      caption: null,
      isFeaturedInPortfolio: true,
      isEligibleForLooks: true,
      url: 'https://public/one.jpg',
      thumbUrl: null,
      createdAt: CREATED_AT,
      services: [{ serviceId: 'svc_1', service: { id: 'svc_1', name: 'Balayage' } }],
    })
    mocks.mediaAssetFindUnique.mockResolvedValue({
      isFeaturedInPortfolio: true,
      isEligibleForLooks: true,
      visibility: MediaVisibility.PUBLIC,
    })
    mocks.createOrUpdateProLookFromMediaAsset.mockResolvedValue({ target: null })
    mocks.practiceShotUpdateTx.mockResolvedValue(
      shotRow({ attachedMediaId: 'media_2', attachedAt: CREATED_AT }),
    )
  })

  it('copies into the public bucket and publishes a look', async () => {
    const res = await POST(
      attachRequest({ target: 'LOOK', serviceIds: ['svc_1'], publish: true }),
      CTX,
    )
    const body = await res.json()

    expect(res.status).toBe(201)
    expect(body.target).toBe('LOOK')
    expect(mocks.copyStorageObject).toHaveBeenCalledWith(
      expect.objectContaining({ destBucket: BUCKETS.mediaPublic }),
    )
    expect(mocks.createOrUpdateProLookFromMediaAsset).toHaveBeenCalledWith(
      mocks.tx,
      expect.objectContaining({
        professionalId: PRO_ID,
        request: expect.objectContaining({
          mediaAssetId: 'media_2',
          primaryServiceId: 'svc_1',
          publish: true,
        }),
      }),
    )
    expect(body.media.id).toBe('media_2')
    expect(body.shot.attachedMediaId).toBe('media_2')
  })

  it('leaves the look a DRAFT when publish is omitted — nothing goes public by default', async () => {
    await POST(attachRequest({ target: 'LOOK', serviceIds: ['svc_1'] }), CTX)

    expect(mocks.createOrUpdateProLookFromMediaAsset).toHaveBeenCalledWith(
      mocks.tx,
      expect.objectContaining({
        request: expect.objectContaining({ publish: false }),
      }),
    )
    expect(mocks.mediaAssetCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ isFeaturedInPortfolio: false }),
      }),
    )
  })

  it('requires at least one service tag — a look must route to "book this"', async () => {
    const res = await POST(attachRequest({ target: 'LOOK', serviceIds: [] }), CTX)

    expect(res.status).toBe(400)
    expect(mocks.copyStorageObject).not.toHaveBeenCalled()
  })

  it('rejects a primaryServiceId that isn’t in serviceIds', async () => {
    const res = await POST(
      attachRequest({
        target: 'LOOK',
        serviceIds: ['svc_1'],
        primaryServiceId: 'svc_9',
      }),
      CTX,
    )

    expect(res.status).toBe(400)
    expect(mocks.copyStorageObject).not.toHaveBeenCalled()
  })

  it('rejects an inactive/unknown service before copying', async () => {
    mocks.serviceFindMany.mockResolvedValue([])

    const res = await POST(
      attachRequest({ target: 'LOOK', serviceIds: ['svc_1'] }),
      CTX,
    )

    expect(res.status).toBe(400)
    expect(mocks.copyStorageObject).not.toHaveBeenCalled()
  })

  it('refuses to publish a video as a look', async () => {
    mocks.practiceShotFindUnique.mockResolvedValue(
      shotRow({ mediaType: MediaType.VIDEO }),
    )

    const res = await POST(
      attachRequest({ target: 'LOOK', serviceIds: ['svc_1'] }),
      CTX,
    )

    expect(res.status).toBe(400)
    expect(mocks.copyStorageObject).not.toHaveBeenCalled()
  })

  it('cleans up the public copy when the transaction fails', async () => {
    mocks.prisma.$transaction.mockRejectedValue(new Error('tx failed'))

    const res = await POST(
      attachRequest({ target: 'LOOK', serviceIds: ['svc_1'] }),
      CTX,
    )

    expect(res.status).toBe(500)
    expect(mocks.storageRemove).toHaveBeenCalledWith([
      `pro/${PRO_ID}/practice_look_public/2026-08/1_a.jpg`,
    ])
  })
})

describe('POST /api/v1/pro/practice/[id]/attach — guards', () => {
  it('404s another pro’s shot rather than admitting it exists', async () => {
    mocks.practiceShotFindUnique.mockResolvedValue(
      shotRow({ professionalId: 'pro_other' }),
    )

    const res = await POST(attachRequest({ target: 'BOOKING', bookingId: 'bk_1' }), CTX)

    expect(res.status).toBe(404)
  })

  it('409s a shot that was already attached', async () => {
    mocks.practiceShotFindUnique.mockResolvedValue(
      shotRow({ attachedMediaId: 'media_1', attachedAt: CREATED_AT }),
    )

    const res = await POST(attachRequest({ target: 'BOOKING', bookingId: 'bk_1' }), CTX)
    const body = await res.json()

    expect(res.status).toBe(409)
    expect(body.code).toBe('PRACTICE_ALREADY_ATTACHED')
    expect(mocks.copyStorageObject).not.toHaveBeenCalled()
  })

  it('400s an unknown target', async () => {
    const res = await POST(attachRequest({ target: 'PORTFOLIO' }), CTX)

    expect(res.status).toBe(400)
  })

  it('is 503 when the kill switch is on', async () => {
    mocks.isRuntimeFlagEnabled.mockResolvedValue(true)

    const res = await POST(attachRequest({ target: 'BOOKING', bookingId: 'bk_1' }), CTX)

    expect(res.status).toBe(503)
    expect(mocks.practiceShotFindUnique).not.toHaveBeenCalled()
  })
})
