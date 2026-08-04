// app/api/v1/pro/practice/route.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MediaType, UploadSurface } from '@prisma/client'

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

  const practiceShotCreate = vi.fn()
  const practiceShotFindMany = vi.fn()

  const tx = { practiceShot: { create: practiceShotCreate } }

  const prisma = {
    practiceShot: { findMany: practiceShotFindMany },
    $transaction: vi.fn(async (callback: (db: typeof tx) => Promise<unknown>) =>
      callback(tx),
    ),
  }

  const validateUploadSession = vi.fn()
  const consumeUploadSession = vi.fn()
  const resolveProTenantId = vi.fn()
  const renderMediaUrls = vi.fn()
  const renderMediaUrlsBatch = vi.fn()
  const isRuntimeFlagEnabled = vi.fn()

  return {
    jsonOk,
    jsonFail,
    requirePro,
    prisma,
    tx,
    practiceShotCreate,
    practiceShotFindMany,
    validateUploadSession,
    consumeUploadSession,
    resolveProTenantId,
    renderMediaUrls,
    renderMediaUrlsBatch,
    isRuntimeFlagEnabled,
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

vi.mock('@/lib/media/uploadSession', () => {
  class UploadSessionError extends Error {
    code: string
    httpStatus: number
    constructor(code: string, message: string) {
      super(message)
      this.name = 'UploadSessionError'
      this.code = code
      this.httpStatus = code === 'ALREADY_CONSUMED' ? 409 : 400
    }
  }
  return {
    validateUploadSession: mocks.validateUploadSession,
    consumeUploadSession: mocks.consumeUploadSession,
    UploadSessionError,
  }
})

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

vi.mock('@/lib/security/logging', () => ({
  safeError: vi.fn((error: unknown) => ({
    message: error instanceof Error ? error.message : String(error),
  })),
}))

import { GET, POST } from './route'
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
    focalX: null,
    focalY: null,
    attachedMediaId: null,
    attachedAt: null,
    createdAt: CREATED_AT,
    ...overrides,
  }
}

function postRequest(body: unknown): Request {
  return new Request('https://tovis.test/api/v1/pro/practice', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requirePro.mockResolvedValue({
    ok: true,
    professionalId: PRO_ID,
    userId: 'user_1',
  })
  mocks.isRuntimeFlagEnabled.mockResolvedValue(false)
  mocks.resolveProTenantId.mockResolvedValue('tenant_1')
  mocks.renderMediaUrls.mockResolvedValue({
    renderUrl: 'https://signed/one',
    renderThumbUrl: null,
  })
  mocks.renderMediaUrlsBatch.mockResolvedValue([
    { renderUrl: 'https://signed/one', renderThumbUrl: null },
  ])
})

describe('GET /api/v1/pro/practice', () => {
  it('returns the pro’s own shots, newest first, with signed render URLs', async () => {
    mocks.practiceShotFindMany.mockResolvedValue([shotRow()])

    const res = await GET()
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(mocks.practiceShotFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { professionalId: PRO_ID },
        orderBy: { createdAt: 'desc' },
      }),
    )
    expect(body.items).toEqual([
      {
        id: 'shot_1',
        mediaType: MediaType.IMAGE,
        caption: null,
        createdAt: CREATED_AT.toISOString(),
        focalX: null,
        focalY: null,
        attachedMediaId: null,
        attachedAt: null,
        renderUrl: 'https://signed/one',
      },
    ])
  })

  it('never leaks the storage pointer onto the wire', async () => {
    mocks.practiceShotFindMany.mockResolvedValue([shotRow()])

    const body = await (await GET()).json()

    expect(JSON.stringify(body)).not.toContain('practice_private')
    expect(body.items[0]).not.toHaveProperty('storagePath')
    expect(body.items[0]).not.toHaveProperty('storageBucket')
  })

  it('is 503 when the kill switch is on', async () => {
    mocks.isRuntimeFlagEnabled.mockResolvedValue(true)

    const res = await GET()
    const body = await res.json()

    expect(res.status).toBe(503)
    expect(body.code).toBe('PRO_PRACTICE_DISABLED')
    expect(mocks.practiceShotFindMany).not.toHaveBeenCalled()
  })

  it('passes an unauthenticated caller straight through to requirePro’s refusal', async () => {
    const refusal = Response.json({ ok: false, error: 'Unauthorized.' }, { status: 401 })
    mocks.requirePro.mockResolvedValue({ ok: false, res: refusal })

    const res = await GET()

    expect(res.status).toBe(401)
    expect(mocks.isRuntimeFlagEnabled).not.toHaveBeenCalled()
    expect(mocks.practiceShotFindMany).not.toHaveBeenCalled()
  })
})

describe('POST /api/v1/pro/practice', () => {
  it('creates a shot from the session’s pointer and consumes the session', async () => {
    mocks.validateUploadSession.mockResolvedValue({
      surface: UploadSurface.PRO_PRACTICE,
      professionalId: PRO_ID,
      storageBucket: BUCKETS.mediaPrivate,
      storagePath: `pro/${PRO_ID}/practice_private/2026-08/1_a.jpg`,
      contentType: 'image/jpeg',
    })
    mocks.practiceShotCreate.mockResolvedValue(shotRow())

    const res = await POST(
      postRequest({
        uploadSessionId: 'us_1',
        focalX: 0.4,
        focalY: 0.3,
        // Hostile: a caller trying to assert someone else's object.
        storageBucket: BUCKETS.mediaPublic,
        storagePath: 'pro/pro_other/practice_private/2026-08/stolen.jpg',
      }),
    )
    const body = await res.json()

    expect(res.status).toBe(201)
    expect(body.shot.id).toBe('shot_1')

    // The pointer comes from the SESSION, never the body.
    expect(mocks.practiceShotCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          professionalId: PRO_ID,
          proTenantId: 'tenant_1',
          storageBucket: BUCKETS.mediaPrivate,
          storagePath: `pro/${PRO_ID}/practice_private/2026-08/1_a.jpg`,
          focalX: 0.4,
          focalY: 0.3,
        }),
      }),
    )
    // No mediaAssetId — a practice shot deliberately isn't one.
    expect(mocks.consumeUploadSession).toHaveBeenCalledWith(
      mocks.tx,
      expect.objectContaining({ uploadSessionId: 'us_1' }),
    )
    expect(mocks.consumeUploadSession.mock.calls[0]?.[1]).not.toHaveProperty(
      'mediaAssetId',
    )
  })

  it('only accepts a PRO_PRACTICE upload session', async () => {
    mocks.validateUploadSession.mockResolvedValue({
      surface: UploadSurface.PRO_PRACTICE,
      professionalId: PRO_ID,
      storageBucket: BUCKETS.mediaPrivate,
      storagePath: `pro/${PRO_ID}/practice_private/2026-08/1_a.jpg`,
      contentType: 'image/jpeg',
    })
    mocks.practiceShotCreate.mockResolvedValue(shotRow())

    await POST(postRequest({ uploadSessionId: 'us_1' }))

    expect(mocks.validateUploadSession).toHaveBeenCalledWith(
      mocks.prisma,
      expect.objectContaining({
        surface: UploadSurface.PRO_PRACTICE,
        professionalId: PRO_ID,
      }),
    )
  })

  it('refuses a public-bucket session — a practice shot is never world-readable', async () => {
    mocks.validateUploadSession.mockResolvedValue({
      surface: UploadSurface.PRO_PRACTICE,
      professionalId: PRO_ID,
      storageBucket: BUCKETS.mediaPublic,
      storagePath: 'pro/pro_1/practice_private/2026-08/1_a.jpg',
      contentType: 'image/jpeg',
    })

    const res = await POST(postRequest({ uploadSessionId: 'us_1' }))

    expect(res.status).toBe(400)
    expect(mocks.practiceShotCreate).not.toHaveBeenCalled()
  })

  it('400s without an uploadSessionId', async () => {
    const res = await POST(postRequest({}))

    expect(res.status).toBe(400)
    expect(mocks.validateUploadSession).not.toHaveBeenCalled()
  })

  it('rejects an over-long caption before touching the session', async () => {
    const res = await POST(
      postRequest({ uploadSessionId: 'us_1', caption: 'x'.repeat(301) }),
    )

    expect(res.status).toBe(400)
    expect(mocks.validateUploadSession).not.toHaveBeenCalled()
  })

  it('surfaces an upload-session refusal with its own status', async () => {
    const { UploadSessionError } = await import('@/lib/media/uploadSession')
    mocks.validateUploadSession.mockRejectedValue(
      new UploadSessionError('ALREADY_CONSUMED', 'This upload was already attached.'),
    )

    const res = await POST(postRequest({ uploadSessionId: 'us_1' }))

    expect(res.status).toBe(409)
    expect(mocks.practiceShotCreate).not.toHaveBeenCalled()
  })

  it('is 503 when the kill switch is on', async () => {
    mocks.isRuntimeFlagEnabled.mockResolvedValue(true)

    const res = await POST(postRequest({ uploadSessionId: 'us_1' }))

    expect(res.status).toBe(503)
    expect(mocks.validateUploadSession).not.toHaveBeenCalled()
  })
})
