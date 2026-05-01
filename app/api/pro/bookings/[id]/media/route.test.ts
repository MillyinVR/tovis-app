import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MediaPhase, MediaType } from '@prisma/client'
import { bookingError } from '@/lib/booking/errors'
import { BUCKETS } from '@/lib/storageBuckets'

const IDEMPOTENCY_ROUTE = 'POST /api/pro/bookings/[id]/media'

const createdAtIso = '2026-04-13T18:30:00.000Z'
const createdAt = new Date(createdAtIso)

const mediaItemFromUpload = {
  id: 'media_1',
  bookingId: 'booking_1',
  mediaType: MediaType.IMAGE,
  visibility: 'PRIVATE',
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
  storageBucket: BUCKETS.mediaPrivate,
  storagePath: 'bookings/booking_1/before/main.jpg',
  thumbBucket: BUCKETS.mediaPrivate,
  thumbPath: 'bookings/booking_1/before/thumb.jpg',
  caption: '  Before photo  ',
  phase: 'BEFORE',
  mediaType: 'IMAGE',
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

  beginIdempotency: vi.fn(),
  completeIdempotency: vi.fn(),
  failIdempotency: vi.fn(),

  captureBookingException: vi.fn(),
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

vi.mock('@/lib/idempotency', () => ({
  beginIdempotency: mocks.beginIdempotency,
  completeIdempotency: mocks.completeIdempotency,
  failIdempotency: mocks.failIdempotency,
  IDEMPOTENCY_ROUTES: {
    BOOKING_MEDIA_CREATE: 'POST /api/pro/bookings/[id]/media',
  },
}))

vi.mock('@/lib/observability/bookingEvents', () => ({
  captureBookingException: mocks.captureBookingException,
}))

import { GET, POST } from './route'

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

function makeGetRequest(path = 'http://localhost/api/pro/bookings/booking_1/media') {
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

    mocks.beginIdempotency.mockImplementation(
      async (args: { key: string | null }) => {
        const key = args.key?.trim()

        if (!key) {
          return { kind: 'missing_key' }
        }

        return {
          kind: 'started',
          idempotencyRecordId: 'idem_record_1',
          requestHash: 'hash_1',
        }
      },
    )

    mocks.completeIdempotency.mockResolvedValue(undefined)
    mocks.failIdempotency.mockResolvedValue(undefined)

    mocks.uploadProBookingMedia.mockResolvedValue({
      created: mediaItemFromUpload,
      advancedTo: 'BEFORE_PHOTOS',
    })
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
    expect(mocks.beginIdempotency).not.toHaveBeenCalled()
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

    expect(mocks.beginIdempotency).not.toHaveBeenCalled()
    expect(mocks.uploadProBookingMedia).not.toHaveBeenCalled()
  })

  it('POST validates required storage fields before idempotency', async () => {
    const result = await POST(
      makePostRequest({
        body: {
          ...validBody,
          storagePath: '',
        },
      }),
      makeCtx(),
    )

    expect(result.status).toBe(400)
    await expect(result.json()).resolves.toEqual({
      ok: false,
      error: 'Missing storageBucket/storagePath.',
    })

    expect(mocks.beginIdempotency).not.toHaveBeenCalled()
    expect(mocks.uploadProBookingMedia).not.toHaveBeenCalled()
  })

  it('POST validates thumb bucket and path pairing before idempotency', async () => {
    const result = await POST(
      makePostRequest({
        body: {
          ...validBody,
          thumbBucket: BUCKETS.mediaPrivate,
          thumbPath: '',
        },
      }),
      makeCtx(),
    )

    expect(result.status).toBe(400)
    await expect(result.json()).resolves.toEqual({
      ok: false,
      error: 'thumbBucket and thumbPath must be provided together.',
    })

    expect(mocks.beginIdempotency).not.toHaveBeenCalled()
    expect(mocks.uploadProBookingMedia).not.toHaveBeenCalled()
  })

  it('POST validates phase and mediaType before idempotency', async () => {
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

    expect(mocks.beginIdempotency).not.toHaveBeenCalled()
    expect(mocks.uploadProBookingMedia).not.toHaveBeenCalled()
  })

  it('POST rejects storage paths outside the booking prefix before idempotency', async () => {
    const result = await POST(
      makePostRequest({
        body: {
          ...validBody,
          storagePath: 'bookings/other_booking/before/main.jpg',
        },
      }),
      makeCtx(),
    )

    expect(result.status).toBe(400)
    await expect(result.json()).resolves.toEqual({
      ok: false,
      error: 'storagePath must be under bookings/<bookingId>/.',
    })

    expect(mocks.beginIdempotency).not.toHaveBeenCalled()
    expect(mocks.uploadProBookingMedia).not.toHaveBeenCalled()
  })

  it('POST returns missing idempotency key for valid media request without idempotency header', async () => {
    const result = await POST(makePostRequest(), makeCtx())

    expect(result.status).toBe(400)
    await expect(result.json()).resolves.toEqual({
      ok: false,
      error: 'Missing idempotency key.',
      code: 'IDEMPOTENCY_KEY_REQUIRED',
    })

    expect(mocks.beginIdempotency).toHaveBeenCalledWith({
      actor: {
        actorUserId: 'user_1',
        actorRole: 'PRO',
      },
      route: IDEMPOTENCY_ROUTE,
      key: null,
      requestBody: {
        professionalId: 'pro_1',
        actorUserId: 'user_1',
        bookingId: 'booking_1',
        storageBucket: BUCKETS.mediaPrivate,
        storagePath: 'bookings/booking_1/before/main.jpg',
        thumbBucket: BUCKETS.mediaPrivate,
        thumbPath: 'bookings/booking_1/before/thumb.jpg',
        caption: 'Before photo',
        phase: MediaPhase.BEFORE,
        mediaType: MediaType.IMAGE,
      },
    })

    expect(globalThis.fetch).not.toHaveBeenCalled()
    expect(mocks.uploadProBookingMedia).not.toHaveBeenCalled()
  })

  it('POST returns in-progress when idempotency ledger has an active matching request', async () => {
    mocks.beginIdempotency.mockResolvedValueOnce({
      kind: 'in_progress',
    })

    const result = await POST(makeIdempotentPostRequest(), makeCtx())

    expect(result.status).toBe(409)
    await expect(result.json()).resolves.toEqual({
      ok: false,
      error: 'A matching media upload request is already in progress.',
      code: 'IDEMPOTENCY_REQUEST_IN_PROGRESS',
    })

    expect(globalThis.fetch).not.toHaveBeenCalled()
    expect(mocks.uploadProBookingMedia).not.toHaveBeenCalled()
  })

  it('POST returns conflict when idempotency key was reused with a different body', async () => {
    mocks.beginIdempotency.mockResolvedValueOnce({
      kind: 'conflict',
    })

    const result = await POST(makeIdempotentPostRequest(), makeCtx())

    expect(result.status).toBe(409)
    await expect(result.json()).resolves.toEqual({
      ok: false,
      error:
        'This idempotency key was already used with a different request body.',
      code: 'IDEMPOTENCY_KEY_CONFLICT',
    })

    expect(globalThis.fetch).not.toHaveBeenCalled()
    expect(mocks.uploadProBookingMedia).not.toHaveBeenCalled()
  })

  it('POST replays completed idempotency response without storage check or media write', async () => {
    mocks.beginIdempotency.mockResolvedValueOnce({
      kind: 'replay',
      responseStatus: 200,
      responseBody: expectedPostResponseBody,
    })

    const result = await POST(makeIdempotentPostRequest(), makeCtx())

    expect(result.status).toBe(200)
    await expect(result.json()).resolves.toEqual({
      ok: true,
      ...expectedPostResponseBody,
    })

    expect(globalThis.fetch).not.toHaveBeenCalled()
    expect(mocks.uploadProBookingMedia).not.toHaveBeenCalled()
    expect(mocks.completeIdempotency).not.toHaveBeenCalled()
  })

  it('POST marks idempotency failed when main uploaded file is missing', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      new Response(null, { status: 404 }),
    )

    const result = await POST(
      makeIdempotentPostRequest({
        key: 'idem_missing_main_1',
      }),
      makeCtx(),
    )

    expect(result.status).toBe(400)
    await expect(result.json()).resolves.toEqual({
      ok: false,
      error: 'Uploaded file not found in storage.',
    })

    expect(mocks.failIdempotency).toHaveBeenCalledWith({
      idempotencyRecordId: 'idem_record_1',
    })
    expect(mocks.uploadProBookingMedia).not.toHaveBeenCalled()
    expect(mocks.completeIdempotency).not.toHaveBeenCalled()
  })

  it('POST marks idempotency failed when uploaded thumb is missing', async () => {
    vi.mocked(globalThis.fetch)
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 404 }))

    const result = await POST(
      makeIdempotentPostRequest({
        key: 'idem_missing_thumb_1',
      }),
      makeCtx(),
    )

    expect(result.status).toBe(400)
    await expect(result.json()).resolves.toEqual({
      ok: false,
      error: 'Uploaded thumb not found in storage.',
    })

    expect(mocks.failIdempotency).toHaveBeenCalledWith({
      idempotencyRecordId: 'idem_record_1',
    })
    expect(mocks.uploadProBookingMedia).not.toHaveBeenCalled()
    expect(mocks.completeIdempotency).not.toHaveBeenCalled()
  })

  it('POST uploads media, renders urls, completes idempotency, and returns item', async () => {
    const result = await POST(
      makeIdempotentPostRequest({
        key: 'idem_media_success_1',
      }),
      makeCtx(),
    )

    expect(mocks.beginIdempotency).toHaveBeenCalledWith({
      actor: {
        actorUserId: 'user_1',
        actorRole: 'PRO',
      },
      route: IDEMPOTENCY_ROUTE,
      key: 'idem_media_success_1',
      requestBody: {
        professionalId: 'pro_1',
        actorUserId: 'user_1',
        bookingId: 'booking_1',
        storageBucket: BUCKETS.mediaPrivate,
        storagePath: 'bookings/booking_1/before/main.jpg',
        thumbBucket: BUCKETS.mediaPrivate,
        thumbPath: 'bookings/booking_1/before/thumb.jpg',
        caption: 'Before photo',
        phase: MediaPhase.BEFORE,
        mediaType: MediaType.IMAGE,
      },
    })

    expect(mocks.createSignedUrl).toHaveBeenCalledTimes(2)
    expect(globalThis.fetch).toHaveBeenCalledTimes(2)

    expect(mocks.uploadProBookingMedia).toHaveBeenCalledWith({
      bookingId: 'booking_1',
      professionalId: 'pro_1',
      uploadedByUserId: 'user_1',
      storageBucket: BUCKETS.mediaPrivate,
      storagePath: 'bookings/booking_1/before/main.jpg',
      thumbBucket: BUCKETS.mediaPrivate,
      thumbPath: 'bookings/booking_1/before/thumb.jpg',
      caption: 'Before photo',
      phase: MediaPhase.BEFORE,
      mediaType: MediaType.IMAGE,
    })

    expect(mocks.renderMediaUrls).toHaveBeenLastCalledWith({
      storageBucket: BUCKETS.mediaPrivate,
      storagePath: 'bookings/booking_1/before/main.jpg',
      thumbBucket: BUCKETS.mediaPrivate,
      thumbPath: 'bookings/booking_1/before/thumb.jpg',
      url: null,
      thumbUrl: null,
    })

    expect(mocks.completeIdempotency).toHaveBeenCalledWith({
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

    expect(mocks.failIdempotency).toHaveBeenCalledWith({
      idempotencyRecordId: 'idem_record_1',
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

  it('POST returns internal error, captures exception, and marks idempotency failed for unexpected errors', async () => {
    mocks.uploadProBookingMedia.mockRejectedValueOnce(new Error('boom'))

    const result = await POST(
      makeIdempotentPostRequest({
        key: 'idem_media_boom_1',
      }),
      makeCtx(),
    )

    expect(mocks.failIdempotency).toHaveBeenCalledWith({
      idempotencyRecordId: 'idem_record_1',
    })

    expect(mocks.captureBookingException).toHaveBeenCalledWith({
      error: expect.any(Error),
      route: 'POST /api/pro/bookings/[id]/media',
    })

    expect(result.status).toBe(500)
    await expect(result.json()).resolves.toEqual({
      ok: false,
      error: 'Internal server error',
    })
  })
})