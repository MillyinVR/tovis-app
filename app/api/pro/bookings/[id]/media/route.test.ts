import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MediaPhase, MediaType, Role } from '@prisma/client'

import { bookingError } from '@/lib/booking/errors'
import { BUCKETS } from '@/lib/storageBuckets'

const IDEMPOTENCY_ROUTE = 'POST /api/pro/bookings/[id]/media'

const createdAtIso = '2026-04-13T18:30:00.000Z'
const createdAt = new Date(createdAtIso)

const mediaItemFromUpload = {
  id: 'media_1',
  bookingId: 'booking_1',
  mediaType: MediaType.IMAGE,
  visibility: 'PRO_CLIENT',
  phase: MediaPhase.BEFORE,
  caption: 'Before photo',
  createdAt,
  reviewId: null,
  isEligibleForLooks: false,
  isFeaturedInPortfolio: false,
  storageBucket: BUCKETS.mediaPrivate,
  storagePath: 'bookings/booking_1/before/main.jpg',
  thumbBucket: BUCKETS.mediaPrivate,
  thumbPath: 'bookings/booking_1/before/thumb.jpg',
  url: null,
  thumbUrl: null,
}

const renderedUrls = {
  renderUrl: 'https://signed.example/main.jpg',
  renderThumbUrl: 'https://signed.example/thumb.jpg',
}

const expectedPostResponseBody = {
  item: {
    ...mediaItemFromUpload,
    createdAt: createdAtIso,
    renderUrl: renderedUrls.renderUrl,
    renderThumbUrl: renderedUrls.renderThumbUrl,
    url: renderedUrls.renderUrl,
    thumbUrl: renderedUrls.renderThumbUrl,
  },
  advancedTo: 'BEFORE_PHOTOS',
}

const validBody = {
  uploadSessionId: 'us_1',
  caption: '  Before photo  ',
  phase: 'BEFORE',
  mediaType: 'IMAGE',
}

// What validateUploadSession returns by default — the authoritative pointer the
// route uses instead of any client-supplied bucket/path.
const validSession = {
  id: 'us_1',
  surface: 'PRO_BOOKING_MEDIA',
  status: 'PENDING',
  tenantId: 'tenant_1',
  professionalId: 'pro_1',
  clientId: null,
  bookingId: 'booking_1',
  phase: MediaPhase.BEFORE,
  storageBucket: BUCKETS.mediaPrivate,
  storagePath: 'bookings/booking_1/before/main.jpg',
  contentType: 'image/jpeg',
  maxBytes: 30 * 1024 * 1024,
  checksumSha256: null,
  expiresAt: new Date('2026-04-13T19:00:00.000Z'),
  consumedAt: null,
  mediaAssetId: null,
}

const mocks = vi.hoisted(() => ({
  requirePro: vi.fn(),
  jsonFail: vi.fn(),
  jsonOk: vi.fn(),
  pickString: vi.fn(),

  bookingFindUnique: vi.fn(),
  mediaAssetFindMany: vi.fn(),

  renderMediaUrls: vi.fn(),

  getSupabaseAdmin: vi.fn(),
  createSignedUrl: vi.fn(),

  uploadProBookingMedia: vi.fn(),

  validateUploadSession: vi.fn(),
  consumeUploadSession: vi.fn(),

  beginRouteIdempotency: vi.fn(),
  completeRouteIdempotency: vi.fn(),
  failStartedRouteIdempotency: vi.fn(),
  isRouteIdempotencyHandled: vi.fn(),

  enforceRateLimit: vi.fn(),
  proRateLimitKey: vi.fn(),
  rateLimitExceededResponse: vi.fn(),

  captureBookingException: vi.fn(),

  safeError: vi.fn((error: unknown) => ({
    name: error instanceof Error ? error.name : 'NonErrorThrown',
    message: error instanceof Error ? error.message : String(error),
  })),
}))

vi.mock('@/app/api/_utils', () => ({
  requirePro: mocks.requirePro,
  jsonFail: mocks.jsonFail,
  jsonOk: mocks.jsonOk,
  pickString: mocks.pickString,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    booking: {
      findUnique: mocks.bookingFindUnique,
    },
    mediaAsset: {
      findMany: mocks.mediaAssetFindMany,
    },
  },
}))

vi.mock('@/lib/media/renderUrls', () => ({
  renderMediaUrls: mocks.renderMediaUrls,
}))

vi.mock('@/lib/supabaseAdmin', () => ({
  getSupabaseAdmin: mocks.getSupabaseAdmin,
}))

vi.mock('@/lib/booking/writeBoundary', () => ({
  uploadProBookingMedia: mocks.uploadProBookingMedia,
}))

vi.mock('@/lib/media/uploadSession', () => {
  class UploadSessionError extends Error {
    code: string
    httpStatus: number
    constructor(code: string, message: string) {
      super(message)
      this.name = 'UploadSessionError'
      this.code = code
      const map: Record<string, number> = {
        NOT_FOUND: 404,
        FORBIDDEN: 403,
        EXPIRED: 410,
        ALREADY_CONSUMED: 409,
        SURFACE_MISMATCH: 400,
        CONTEXT_MISMATCH: 400,
        CONSUME_CONFLICT: 409,
      }
      this.httpStatus = map[code] ?? 400
    }
  }

  return {
    validateUploadSession: mocks.validateUploadSession,
    consumeUploadSession: mocks.consumeUploadSession,
    UploadSessionError,
  }
})

vi.mock('@/app/api/_utils/idempotency', () => ({
  beginRouteIdempotency: mocks.beginRouteIdempotency,
  completeRouteIdempotency: mocks.completeRouteIdempotency,
  failStartedRouteIdempotency: mocks.failStartedRouteIdempotency,
  isRouteIdempotencyHandled: mocks.isRouteIdempotencyHandled,
}))

vi.mock('@/lib/idempotency', () => ({
  IDEMPOTENCY_ROUTES: {
    BOOKING_MEDIA_CREATE: 'POST /api/pro/bookings/[id]/media',
  },
}))

vi.mock('@/lib/rateLimit/enforce', () => ({
  enforceRateLimit: mocks.enforceRateLimit,
}))

vi.mock('@/lib/rateLimit/identity', () => ({
  proRateLimitKey: mocks.proRateLimitKey,
}))

vi.mock('@/lib/rateLimit/response', () => ({
  rateLimitExceededResponse: mocks.rateLimitExceededResponse,
}))

vi.mock('@/lib/observability/bookingEvents', () => ({
  captureBookingException: mocks.captureBookingException,
}))

vi.mock('@/lib/security/logging', () => ({
  safeError: mocks.safeError,
}))

import { GET, POST } from './route'
import { UploadSessionError } from '@/lib/media/uploadSession'

function expectIdempotencyStarted(key = 'idem_media_create_1'): void {
  mocks.beginRouteIdempotency.mockResolvedValue({
    kind: 'started',
    idempotencyRecordId: 'idem_record_1',
    idempotencyKey: key,
    requestHash: 'hash_1',
  })

  mocks.isRouteIdempotencyHandled.mockReturnValue(false)
}

function makeJsonResponse(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'content-type': 'application/json',
    },
  })
}

function makeCtx(id = 'booking_1') {
  return {
    params: Promise.resolve({ id }),
  }
}

function makeGetRequest(
  path = 'http://localhost/api/pro/bookings/booking_1/media',
): Request {
  return new Request(path, {
    method: 'GET',
  })
}

function makePostRequest(args?: {
  body?: unknown
  headers?: Record<string, string>
}): Request {
  return new Request('http://localhost/api/pro/bookings/booking_1/media', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(args?.headers ?? {}),
    },
    body: JSON.stringify(args?.body ?? validBody),
  })
}

function makeIdempotentPostRequest(args?: {
  body?: unknown
  key?: string
  headers?: Record<string, string>
}): Request {
  return makePostRequest({
    body: args?.body ?? validBody,
    headers: {
      'idempotency-key': args?.key ?? 'idem_media_create_1',
      ...(args?.headers ?? {}),
    },
  })
}

describe('app/api/pro/bookings/[id]/media/route.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 200 })),
    )

    mocks.requirePro.mockResolvedValue({
      ok: true,
      professionalId: 'pro_1',
      proId: 'pro_1',
      user: {
        id: 'user_1',
      },
    })

    mocks.jsonFail.mockImplementation(
      (status: number, error: string, extra?: Record<string, unknown>) =>
        makeJsonResponse(status, {
          ok: false,
          error,
          ...(extra ?? {}),
        }),
    )

    mocks.jsonOk.mockImplementation(
      (data: Record<string, unknown>, status = 200) =>
        makeJsonResponse(status, {
          ok: true,
          ...(data ?? {}),
        }),
    )

    mocks.pickString.mockImplementation((value: unknown) => {
      if (typeof value !== 'string') return null

      const trimmed = value.trim()
      return trimmed.length > 0 ? trimmed : null
    })

    mocks.bookingFindUnique.mockResolvedValue({
      id: 'booking_1',
      professionalId: 'pro_1',
    })

    mocks.mediaAssetFindMany.mockResolvedValue([
      {
        ...mediaItemFromUpload,
        createdAt,
      },
    ])

    mocks.renderMediaUrls.mockResolvedValue(renderedUrls)

    mocks.getSupabaseAdmin.mockReturnValue({
      storage: {
        from: vi.fn(() => ({
          createSignedUrl: mocks.createSignedUrl,
        })),
      },
    })

    mocks.createSignedUrl.mockResolvedValue({
      data: {
        signedUrl: 'https://signed.example/object',
      },
      error: null,
    })

    mocks.proRateLimitKey.mockReturnValue(
      'user:user_1|pro:pro_1|ip:unknown-ip',
    )

    mocks.enforceRateLimit.mockResolvedValue({
      allowed: true,
      bucket: 'pro:media:write',
      key: 'user:user_1|pro:pro_1|ip:unknown-ip',
      limit: 30,
      remaining: 29,
      resetAt: new Date('2026-04-13T18:31:00.000Z'),
      retryAfterSeconds: 60,
      source: 'redis',
    })

    expectIdempotencyStarted()

    mocks.completeRouteIdempotency.mockResolvedValue(undefined)
    mocks.failStartedRouteIdempotency.mockResolvedValue(undefined)

    mocks.uploadProBookingMedia.mockResolvedValue({
      created: mediaItemFromUpload,
      advancedTo: 'BEFORE_PHOTOS',
    })

    mocks.validateUploadSession.mockResolvedValue(validSession)
    mocks.consumeUploadSession.mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('GET returns auth response when requirePro fails', async () => {
    const authRes = makeJsonResponse(401, {
      ok: false,
      error: 'Unauthorized',
    })

    mocks.requirePro.mockResolvedValueOnce({
      ok: false,
      res: authRes,
    })

    const result = await GET(makeGetRequest(), makeCtx())

    expect(result).toBe(authRes)
    expect(mocks.bookingFindUnique).not.toHaveBeenCalled()
    expect(mocks.enforceRateLimit).not.toHaveBeenCalled()
  })

  it('GET returns BOOKING_ID_REQUIRED when booking id is missing', async () => {
    const result = await GET(makeGetRequest(), makeCtx(''))

    expect(result.status).toBe(400)
    await expect(result.json()).resolves.toEqual(
      expect.objectContaining({
        ok: false,
        code: 'BOOKING_ID_REQUIRED',
      }),
    )

    expect(mocks.mediaAssetFindMany).not.toHaveBeenCalled()
    expect(mocks.enforceRateLimit).not.toHaveBeenCalled()
  })

  it('GET returns 404 when booking is not found', async () => {
    mocks.bookingFindUnique.mockResolvedValueOnce(null)

    const result = await GET(makeGetRequest(), makeCtx())

    expect(result.status).toBe(404)
    await expect(result.json()).resolves.toEqual({
      ok: false,
      error: 'Booking not found.',
    })

    expect(mocks.mediaAssetFindMany).not.toHaveBeenCalled()
    expect(mocks.renderMediaUrls).not.toHaveBeenCalled()
    expect(mocks.enforceRateLimit).not.toHaveBeenCalled()
  })

  it('GET returns forbidden when booking belongs to another professional', async () => {
    mocks.bookingFindUnique.mockResolvedValueOnce({
      id: 'booking_1',
      professionalId: 'other_pro',
    })

    const result = await GET(makeGetRequest(), makeCtx())

    expect(result.status).toBe(403)
    await expect(result.json()).resolves.toEqual({
      ok: false,
      error: 'Forbidden.',
    })

    expect(mocks.mediaAssetFindMany).not.toHaveBeenCalled()
    expect(mocks.renderMediaUrls).not.toHaveBeenCalled()
    expect(mocks.enforceRateLimit).not.toHaveBeenCalled()
  })

  it('GET rejects invalid phase query param', async () => {
    const result = await GET(
      makeGetRequest(
        'http://localhost/api/pro/bookings/booking_1/media?phase=BANANA',
      ),
      makeCtx(),
    )

    expect(result.status).toBe(400)
    await expect(result.json()).resolves.toEqual({
      ok: false,
      error: 'Invalid phase query param.',
    })

    expect(mocks.mediaAssetFindMany).not.toHaveBeenCalled()
    expect(mocks.enforceRateLimit).not.toHaveBeenCalled()
  })

  it('GET returns media items with rendered urls', async () => {
    const result = await GET(
      makeGetRequest(
        'http://localhost/api/pro/bookings/booking_1/media?phase=BEFORE',
      ),
      makeCtx(),
    )

    expect(mocks.bookingFindUnique).toHaveBeenCalledWith({
      where: { id: 'booking_1' },
      select: { id: true, professionalId: true },
    })

    expect(mocks.mediaAssetFindMany).toHaveBeenCalledWith({
      where: {
        bookingId: 'booking_1',
        phase: MediaPhase.BEFORE,
      },
      select: expect.any(Object),
      orderBy: { createdAt: 'desc' },
    })

    expect(mocks.renderMediaUrls).toHaveBeenCalledWith({
      storageBucket: BUCKETS.mediaPrivate,
      storagePath: 'bookings/booking_1/before/main.jpg',
      thumbBucket: BUCKETS.mediaPrivate,
      thumbPath: 'bookings/booking_1/before/thumb.jpg',
      url: null,
      thumbUrl: null,
    })

    expect(mocks.enforceRateLimit).not.toHaveBeenCalled()

    expect(result.status).toBe(200)
    await expect(result.json()).resolves.toEqual({
      ok: true,
      items: [
        {
          ...mediaItemFromUpload,
          createdAt: createdAtIso,
          renderUrl: renderedUrls.renderUrl,
          renderThumbUrl: renderedUrls.renderThumbUrl,
          url: renderedUrls.renderUrl,
          thumbUrl: renderedUrls.renderThumbUrl,
        },
      ],
    })
  })

  it('GET returns internal error, logs safely, and captures exception for unexpected errors', async () => {
    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined)

    const thrown = new Error(
      'db blew up for https://signed.example/file.jpg?token=secret',
    )

    mocks.bookingFindUnique.mockRejectedValueOnce(thrown)

    const result = await GET(makeGetRequest(), makeCtx())

    expect(mocks.safeError).toHaveBeenCalledWith(thrown)

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'GET /api/pro/bookings/[id]/media error',
      {
        error: {
          name: 'Error',
          message:
            'db blew up for https://signed.example/file.jpg?token=secret',
        },
      },
    )

    expect(mocks.captureBookingException).toHaveBeenCalledWith({
      error: thrown,
      route: 'GET /api/pro/bookings/[id]/media',
    })

    expect(result.status).toBe(500)
    await expect(result.json()).resolves.toEqual({
      ok: false,
      error: 'Internal server error',
    })

    consoleErrorSpy.mockRestore()
  })

  it('POST returns auth response when requirePro fails', async () => {
    const authRes = makeJsonResponse(401, {
      ok: false,
      error: 'Unauthorized',
    })

    mocks.requirePro.mockResolvedValueOnce({
      ok: false,
      res: authRes,
    })

    const result = await POST(makePostRequest(), makeCtx())

    expect(result).toBe(authRes)
    expect(mocks.enforceRateLimit).not.toHaveBeenCalled()
    expect(mocks.beginRouteIdempotency).not.toHaveBeenCalled()
    expect(mocks.uploadProBookingMedia).not.toHaveBeenCalled()
  })

  it('POST returns FORBIDDEN when actor user id is missing', async () => {
    mocks.requirePro.mockResolvedValueOnce({
      ok: true,
      professionalId: 'pro_1',
      user: {
        id: '   ',
      },
    })

    const result = await POST(makePostRequest(), makeCtx())

    expect(result.status).toBe(403)
    await expect(result.json()).resolves.toEqual(
      expect.objectContaining({
        ok: false,
        code: 'FORBIDDEN',
      }),
    )

    expect(mocks.enforceRateLimit).not.toHaveBeenCalled()
    expect(mocks.beginRouteIdempotency).not.toHaveBeenCalled()
    expect(mocks.uploadProBookingMedia).not.toHaveBeenCalled()
  })

  it('POST returns BOOKING_ID_REQUIRED when booking id is missing', async () => {
    const result = await POST(makePostRequest(), makeCtx(''))

    expect(result.status).toBe(400)
    await expect(result.json()).resolves.toEqual(
      expect.objectContaining({
        ok: false,
        code: 'BOOKING_ID_REQUIRED',
      }),
    )

    expect(mocks.enforceRateLimit).not.toHaveBeenCalled()
    expect(mocks.beginRouteIdempotency).not.toHaveBeenCalled()
    expect(mocks.uploadProBookingMedia).not.toHaveBeenCalled()
  })

  it('POST returns rate-limit response before parsing body or starting idempotency', async () => {
    const blockedDecision = {
      allowed: false,
      bucket: 'pro:media:write',
      key: 'user:user_1|pro:pro_1|ip:unknown-ip',
      limit: 30,
      remaining: 0,
      resetAt: new Date('2026-04-13T18:31:00.000Z'),
      retryAfterSeconds: 60,
      source: 'redis',
      reason: 'rate_limited',
    } as const

    const limitedResponse = makeJsonResponse(429, {
      ok: false,
      error: 'Too many requests. Please try again later.',
      code: 'RATE_LIMITED',
    })

    mocks.enforceRateLimit.mockResolvedValueOnce(blockedDecision)
    mocks.rateLimitExceededResponse.mockReturnValueOnce(limitedResponse)

    const result = await POST(makeIdempotentPostRequest(), makeCtx())

    expect(result).toBe(limitedResponse)

    expect(mocks.proRateLimitKey).toHaveBeenCalledWith({
      professionalId: 'pro_1',
      userId: 'user_1',
      request: expect.any(Request),
    })

    expect(mocks.enforceRateLimit).toHaveBeenCalledWith({
      bucket: 'pro:media:write',
      key: 'user:user_1|pro:pro_1|ip:unknown-ip',
    })

    expect(mocks.rateLimitExceededResponse).toHaveBeenCalledWith(
      blockedDecision,
    )

    expect(mocks.beginRouteIdempotency).not.toHaveBeenCalled()
    expect(mocks.uploadProBookingMedia).not.toHaveBeenCalled()
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('POST returns 400 when uploadSessionId is missing, before idempotency', async () => {
    const result = await POST(
      makePostRequest({
        body: {
          caption: 'Before photo',
          phase: 'BEFORE',
          mediaType: 'IMAGE',
        },
      }),
      makeCtx(),
    )

    expect(mocks.enforceRateLimit).toHaveBeenCalledWith({
      bucket: 'pro:media:write',
      key: 'user:user_1|pro:pro_1|ip:unknown-ip',
    })

    expect(result.status).toBe(400)
    await expect(result.json()).resolves.toEqual({
      ok: false,
      error: 'Missing uploadSessionId.',
    })

    expect(mocks.beginRouteIdempotency).not.toHaveBeenCalled()
    expect(mocks.validateUploadSession).not.toHaveBeenCalled()
    expect(mocks.uploadProBookingMedia).not.toHaveBeenCalled()
  })

  it('POST validates phase and mediaType before idempotency or session lookup', async () => {
    const badPhase = await POST(
      makePostRequest({
        body: {
          ...validBody,
          phase: 'NOPE',
        },
      }),
      makeCtx(),
    )

    expect(badPhase.status).toBe(400)
    await expect(badPhase.json()).resolves.toEqual({
      ok: false,
      error: 'Invalid phase.',
    })

    const badType = await POST(
      makePostRequest({
        body: {
          ...validBody,
          mediaType: 'PDF',
        },
      }),
      makeCtx(),
    )

    expect(badType.status).toBe(400)
    await expect(badType.json()).resolves.toEqual({
      ok: false,
      error: 'Invalid mediaType.',
    })

    expect(mocks.beginRouteIdempotency).not.toHaveBeenCalled()
    expect(mocks.validateUploadSession).not.toHaveBeenCalled()
    expect(mocks.uploadProBookingMedia).not.toHaveBeenCalled()
  })

  it('POST maps upload-session validation errors and marks idempotency failed', async () => {
    mocks.validateUploadSession.mockRejectedValueOnce(
      new UploadSessionError('FORBIDDEN', 'Upload session belongs to another professional.'),
    )

    const result = await POST(
      makeIdempotentPostRequest({ key: 'idem_media_forbidden_1' }),
      makeCtx(),
    )

    expect(result.status).toBe(403)
    await expect(result.json()).resolves.toEqual({
      ok: false,
      error: 'Upload session belongs to another professional.',
    })

    expect(mocks.failStartedRouteIdempotency).toHaveBeenCalledWith({
      idempotencyRecordId: 'idem_record_1',
      operation: 'POST /api/pro/bookings/[id]/media',
    })
    expect(mocks.createSignedUrl).not.toHaveBeenCalled()
    expect(mocks.uploadProBookingMedia).not.toHaveBeenCalled()
  })

  it('POST rejects a session whose pointer is not in the private session bucket', async () => {
    mocks.validateUploadSession.mockResolvedValueOnce({
      ...validSession,
      storageBucket: BUCKETS.mediaPublic,
    })

    const result = await POST(
      makeIdempotentPostRequest({ key: 'idem_media_badbucket_1' }),
      makeCtx(),
    )

    expect(result.status).toBe(400)
    await expect(result.json()).resolves.toEqual({
      ok: false,
      error: `Session media must upload to ${BUCKETS.mediaPrivate}.`,
    })

    expect(mocks.failStartedRouteIdempotency).toHaveBeenCalledWith({
      idempotencyRecordId: 'idem_record_1',
      operation: 'POST /api/pro/bookings/[id]/media',
    })
    expect(mocks.uploadProBookingMedia).not.toHaveBeenCalled()
  })

  it('POST returns missing idempotency key for valid media request without idempotency header', async () => {
    const handledResponse = makeJsonResponse(400, {
      ok: false,
      error: 'Missing idempotency key.',
      code: 'IDEMPOTENCY_KEY_REQUIRED',
    })

    mocks.beginRouteIdempotency.mockResolvedValueOnce({
      kind: 'handled',
      response: handledResponse,
    })

    mocks.isRouteIdempotencyHandled.mockReturnValueOnce(true)

    const result = await POST(makePostRequest(), makeCtx())

    expect(result).toBe(handledResponse)

    expect(mocks.beginRouteIdempotency).toHaveBeenCalledWith({
      request: expect.any(Request),
      actor: {
        actorUserId: 'user_1',
        actorRole: Role.PRO,
      },
      route: IDEMPOTENCY_ROUTE,
      requestLabel: 'media upload',
      requestBody: {
        professionalId: 'pro_1',
        actorUserId: 'user_1',
        bookingId: 'booking_1',
        uploadSessionId: 'us_1',
        caption: 'Before photo',
        phase: MediaPhase.BEFORE,
        mediaType: MediaType.IMAGE,
      },
      messages: {
        missingKey: 'Missing idempotency key.',
        inProgress: 'A matching media upload request is already in progress.',
        conflict:
          'This idempotency key was already used with a different request body.',
      },
    })

    expect(mocks.validateUploadSession).not.toHaveBeenCalled()
    expect(globalThis.fetch).not.toHaveBeenCalled()
    expect(mocks.uploadProBookingMedia).not.toHaveBeenCalled()
  })

  it('POST returns in-progress when idempotency ledger has an active matching request', async () => {
    const handledResponse = makeJsonResponse(409, {
      ok: false,
      error: 'A matching media upload request is already in progress.',
      code: 'IDEMPOTENCY_REQUEST_IN_PROGRESS',
    })

    mocks.beginRouteIdempotency.mockResolvedValueOnce({
      kind: 'handled',
      response: handledResponse,
    })

    mocks.isRouteIdempotencyHandled.mockReturnValueOnce(true)

    const result = await POST(makeIdempotentPostRequest(), makeCtx())

    expect(result).toBe(handledResponse)
    expect(globalThis.fetch).not.toHaveBeenCalled()
    expect(mocks.uploadProBookingMedia).not.toHaveBeenCalled()
  })

  it('POST returns conflict when idempotency key was reused with a different body', async () => {
    const handledResponse = makeJsonResponse(409, {
      ok: false,
      error:
        'This idempotency key was already used with a different request body.',
      code: 'IDEMPOTENCY_KEY_CONFLICT',
    })

    mocks.beginRouteIdempotency.mockResolvedValueOnce({
      kind: 'handled',
      response: handledResponse,
    })

    mocks.isRouteIdempotencyHandled.mockReturnValueOnce(true)

    const result = await POST(makeIdempotentPostRequest(), makeCtx())

    expect(result).toBe(handledResponse)
    expect(globalThis.fetch).not.toHaveBeenCalled()
    expect(mocks.uploadProBookingMedia).not.toHaveBeenCalled()
  })

  it('POST replays completed idempotency response without storage check or media write', async () => {
    const handledResponse = makeJsonResponse(200, {
      ok: true,
      ...expectedPostResponseBody,
    })

    mocks.beginRouteIdempotency.mockResolvedValueOnce({
      kind: 'handled',
      response: handledResponse,
    })

    mocks.isRouteIdempotencyHandled.mockReturnValueOnce(true)

    const result = await POST(makeIdempotentPostRequest(), makeCtx())

    expect(result).toBe(handledResponse)
    expect(globalThis.fetch).not.toHaveBeenCalled()
    expect(mocks.uploadProBookingMedia).not.toHaveBeenCalled()
    expect(mocks.completeRouteIdempotency).not.toHaveBeenCalled()
  })

  it('POST marks idempotency failed when main uploaded file is missing', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      new Response(null, { status: 404 }),
    )

    const result = await POST(
      makeIdempotentPostRequest({
        key: 'idem_media_success_1',
        headers: {
          'x-request-id': 'req_media_success_1',
        },
      }),
      makeCtx(),
    )

    expect(result.status).toBe(400)
    await expect(result.json()).resolves.toEqual({
      ok: false,
      error: 'Uploaded file not found in storage.',
    })

    expect(mocks.failStartedRouteIdempotency).toHaveBeenCalledWith({
      idempotencyRecordId: 'idem_record_1',
      operation: 'POST /api/pro/bookings/[id]/media',
    })
    expect(mocks.uploadProBookingMedia).not.toHaveBeenCalled()
    expect(mocks.completeRouteIdempotency).not.toHaveBeenCalled()
  })

  it('POST uploads media, renders urls, completes idempotency, and returns item', async () => {
    const result = await POST(
      makeIdempotentPostRequest({
        key: 'idem_media_success_1',
        headers: {
          'x-request-id': 'req_media_success_1',
        },
      }),
      makeCtx(),
    )

    expect(mocks.proRateLimitKey).toHaveBeenCalledWith({
      professionalId: 'pro_1',
      userId: 'user_1',
      request: expect.any(Request),
    })

    expect(mocks.enforceRateLimit).toHaveBeenCalledWith({
      bucket: 'pro:media:write',
      key: 'user:user_1|pro:pro_1|ip:unknown-ip',
    })

    expect(mocks.beginRouteIdempotency).toHaveBeenCalledWith({
      request: expect.any(Request),
      actor: {
        actorUserId: 'user_1',
        actorRole: Role.PRO,
      },
      route: IDEMPOTENCY_ROUTE,
      requestLabel: 'media upload',
      requestBody: {
        professionalId: 'pro_1',
        actorUserId: 'user_1',
        bookingId: 'booking_1',
        uploadSessionId: 'us_1',
        caption: 'Before photo',
        phase: MediaPhase.BEFORE,
        mediaType: MediaType.IMAGE,
      },
      messages: {
        missingKey: 'Missing idempotency key.',
        inProgress: 'A matching media upload request is already in progress.',
        conflict:
          'This idempotency key was already used with a different request body.',
      },
    })

    expect(mocks.validateUploadSession).toHaveBeenCalledWith(expect.anything(), {
      uploadSessionId: 'us_1',
      surface: 'PRO_BOOKING_MEDIA',
      professionalId: 'pro_1',
      bookingId: 'booking_1',
      phase: MediaPhase.BEFORE,
      now: expect.any(Date),
    })

    // Only the main object is checked — booking session media has no thumb.
    expect(mocks.createSignedUrl).toHaveBeenCalledTimes(1)
    expect(globalThis.fetch).toHaveBeenCalledTimes(1)

    expect(mocks.uploadProBookingMedia).toHaveBeenCalledWith({
      bookingId: 'booking_1',
      professionalId: 'pro_1',
      uploadedByUserId: 'user_1',
      storageBucket: BUCKETS.mediaPrivate,
      storagePath: 'bookings/booking_1/before/main.jpg',
      thumbBucket: null,
      thumbPath: null,
      caption: 'Before photo',
      phase: MediaPhase.BEFORE,
      mediaType: MediaType.IMAGE,
      requestId: 'req_media_success_1',
      idempotencyKey: 'idem_media_success_1',
    })

    expect(mocks.consumeUploadSession).toHaveBeenCalledWith(expect.anything(), {
      uploadSessionId: 'us_1',
      mediaAssetId: 'media_1',
      now: expect.any(Date),
    })

    expect(mocks.renderMediaUrls).toHaveBeenLastCalledWith({
      storageBucket: BUCKETS.mediaPrivate,
      storagePath: 'bookings/booking_1/before/main.jpg',
      thumbBucket: BUCKETS.mediaPrivate,
      thumbPath: 'bookings/booking_1/before/thumb.jpg',
      url: null,
      thumbUrl: null,
    })

    expect(mocks.completeRouteIdempotency).toHaveBeenCalledWith({
      idempotencyRecordId: 'idem_record_1',
      responseStatus: 200,
      responseBody: expectedPostResponseBody,
    })

    expect(result.status).toBe(200)
    await expect(result.json()).resolves.toEqual({
      ok: true,
      ...expectedPostResponseBody,
    })
  })

  it('POST maps booking errors and marks idempotency failed', async () => {
    mocks.uploadProBookingMedia.mockRejectedValueOnce(
      bookingError('BOOKING_NOT_FOUND', {
        message: 'Booking was not found for this professional.',
        userMessage: 'Booking not found.',
      }),
    )

    const result = await POST(
      makeIdempotentPostRequest({
        key: 'idem_media_not_found_1',
      }),
      makeCtx(),
    )

    expect(mocks.failStartedRouteIdempotency).toHaveBeenCalledWith({
      idempotencyRecordId: 'idem_record_1',
      operation: 'POST /api/pro/bookings/[id]/media',
    })

    expect(result.status).toBe(404)
    await expect(result.json()).resolves.toEqual(
      expect.objectContaining({
        ok: false,
        code: 'BOOKING_NOT_FOUND',
        error: 'Booking not found.',
      }),
    )
  })

  it('POST maps write-boundary forbidden ownership errors and marks idempotency failed', async () => {
    mocks.uploadProBookingMedia.mockRejectedValueOnce(
      bookingError('FORBIDDEN', {
        message: 'Professional cannot upload media for this booking.',
        userMessage: 'You are not allowed to upload media for this booking.',
      }),
    )

    const result = await POST(
      makeIdempotentPostRequest({
        key: 'idem_media_wrong_pro_1',
      }),
      makeCtx(),
    )

    expect(mocks.failStartedRouteIdempotency).toHaveBeenCalledWith({
      idempotencyRecordId: 'idem_record_1',
      operation: 'POST /api/pro/bookings/[id]/media',
    })

    expect(mocks.uploadProBookingMedia).toHaveBeenCalledWith(
      expect.objectContaining({
        bookingId: 'booking_1',
        professionalId: 'pro_1',
        uploadedByUserId: 'user_1',
      }),
    )

    expect(result.status).toBe(403)
    await expect(result.json()).resolves.toEqual(
      expect.objectContaining({
        ok: false,
        code: 'FORBIDDEN',
        error: 'You are not allowed to upload media for this booking.',
      }),
    )
  })

  it('POST returns internal error, logs safely, captures exception, and marks idempotency failed for unexpected errors', async () => {
    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined)

    const thrown = new Error(
      'boom for https://signed.example/file.jpg?token=secret',
    )

    mocks.uploadProBookingMedia.mockRejectedValueOnce(thrown)

    const result = await POST(
      makeIdempotentPostRequest({
        key: 'idem_media_boom_1',
      }),
      makeCtx(),
    )

    expect(mocks.failStartedRouteIdempotency).toHaveBeenCalledWith({
      idempotencyRecordId: 'idem_record_1',
      operation: 'POST /api/pro/bookings/[id]/media',
    })

    expect(mocks.safeError).toHaveBeenCalledWith(thrown)

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'POST /api/pro/bookings/[id]/media error',
      {
        error: {
          name: 'Error',
          message:
            'boom for https://signed.example/file.jpg?token=secret',
        },
      },
    )

    expect(mocks.captureBookingException).toHaveBeenCalledWith({
      error: thrown,
      route: 'POST /api/pro/bookings/[id]/media',
    })

    expect(result.status).toBe(500)
    await expect(result.json()).resolves.toEqual({
      ok: false,
      error: 'Internal server error',
    })

    consoleErrorSpy.mockRestore()
  })
})