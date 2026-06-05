// tests/chaos/supabase-storage-outage.test.ts

import { describe, expect, it, vi, beforeEach } from 'vitest'
import { MediaPhase, MediaType } from '@prisma/client'

const mocks = vi.hoisted(() => ({
  jsonOk: vi.fn(),
  jsonFail: vi.fn(),
  requirePro: vi.fn(),

  beginRouteIdempotency: vi.fn(),
  completeRouteIdempotency: vi.fn(),
  failStartedRouteIdempotency: vi.fn(),
  isRouteIdempotencyHandled: vi.fn(),

  enforceRateLimit: vi.fn(),
  rateLimitExceededResponse: vi.fn(),

  uploadProBookingMedia: vi.fn(),

  getSupabaseAdmin: vi.fn(),
  createSignedUrl: vi.fn(),

  captureBookingException: vi.fn(),
}))

vi.mock('@/app/api/_utils', () => ({
  jsonOk: mocks.jsonOk,
  jsonFail: mocks.jsonFail,
  pickString: (value: unknown) =>
    typeof value === 'string' && value.trim() ? value.trim() : null,
  requirePro: mocks.requirePro,
}))

vi.mock('@/app/api/_utils/idempotency', () => ({
  beginRouteIdempotency: mocks.beginRouteIdempotency,
  completeRouteIdempotency: mocks.completeRouteIdempotency,
  failStartedRouteIdempotency: mocks.failStartedRouteIdempotency,
  isRouteIdempotencyHandled: mocks.isRouteIdempotencyHandled,
}))

vi.mock('@/lib/rateLimit/enforce', () => ({
  enforceRateLimit: mocks.enforceRateLimit,
}))

vi.mock('@/lib/rateLimit/identity', () => ({
  proRateLimitKey: vi.fn(() => 'pro:media:write:pro_1:user_1'),
}))

vi.mock('@/lib/rateLimit/response', () => ({
  rateLimitExceededResponse: mocks.rateLimitExceededResponse,
}))

vi.mock('@/lib/booking/writeBoundary', () => ({
  uploadProBookingMedia: mocks.uploadProBookingMedia,
}))

vi.mock('@/lib/supabaseAdmin', () => ({
  getSupabaseAdmin: mocks.getSupabaseAdmin,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {},
}))

vi.mock('@/lib/observability/bookingEvents', () => ({
  captureBookingException: mocks.captureBookingException,
}))

vi.mock('@/lib/security/logging', () => ({
  safeError: vi.fn((error: unknown) => ({
    name: error instanceof Error ? error.name : 'NonErrorThrown',
    message: error instanceof Error ? error.message : String(error),
  })),
}))

import { POST } from '@/app/api/pro/bookings/[id]/media/route'

function makeJsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function makeRequest(body?: Record<string, unknown>): Request {
  return new Request('http://localhost/api/pro/bookings/booking_1/media', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'idempotency-key': 'idem_media_1',
      'x-request-id': 'request_1',
    },
    body: JSON.stringify(
      body ?? {
        storageBucket: 'media-private',
        storagePath: 'bookings/booking_1/after/photo.jpg',
        thumbBucket: 'media-private',
        thumbPath: 'bookings/booking_1/after/thumb.jpg',
        phase: MediaPhase.AFTER,
        mediaType: MediaType.IMAGE,
        caption: 'After photo',
      },
    ),
  })
}

describe('chaos: Supabase storage outage', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mocks.jsonOk.mockImplementation((body: unknown, status = 200) =>
      makeJsonResponse(body, status),
    )

    mocks.jsonFail.mockImplementation(
      (status: number, message: string, extra?: Record<string, unknown>) =>
        makeJsonResponse({ ok: false, error: message, ...(extra ?? {}) }, status),
    )

    mocks.requirePro.mockResolvedValue({
      ok: true,
      professionalId: 'pro_1',
      user: {
        id: 'user_1',
      },
    })

    mocks.enforceRateLimit.mockResolvedValue({
      allowed: true,
    })

    mocks.beginRouteIdempotency.mockResolvedValue({
      idempotencyRecordId: 'idem_record_1',
    })

    mocks.isRouteIdempotencyHandled.mockReturnValue(false)

    mocks.failStartedRouteIdempotency.mockResolvedValue(undefined)
    mocks.completeRouteIdempotency.mockResolvedValue(undefined)

    mocks.getSupabaseAdmin.mockReturnValue({
      storage: {
        from: vi.fn(() => ({
          createSignedUrl: mocks.createSignedUrl,
        })),
      },
    })
  })

  it('fails safely when Supabase cannot create a signed URL for uploaded media verification', async () => {
    mocks.createSignedUrl.mockResolvedValue({
      data: null,
      error: new Error('Supabase storage unavailable'),
    })

    const response = await POST(makeRequest(), {
      params: { id: 'booking_1' },
    })

    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: 'Uploaded file not found in storage.',
    })

    expect(response.status).toBe(400)

    expect(mocks.createSignedUrl).toHaveBeenCalledWith(
      'bookings/booking_1/after/photo.jpg',
      600,
    )

    expect(mocks.failStartedRouteIdempotency).toHaveBeenCalledWith({
      idempotencyRecordId: 'idem_record_1',
      operation: 'POST /api/pro/bookings/[id]/media',
    })

    expect(mocks.uploadProBookingMedia).not.toHaveBeenCalled()
    expect(mocks.completeRouteIdempotency).not.toHaveBeenCalled()
    expect(mocks.captureBookingException).not.toHaveBeenCalled()
  })

  it('fails safely when Supabase returns a signed URL but object probing cannot confirm the file exists', async () => {
    mocks.createSignedUrl.mockResolvedValue({
      data: {
        signedUrl: 'https://storage.example.test/signed/private-photo',
      },
      error: null,
    })

    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response(null, {
          status: 503,
        }),
      )

    const response = await POST(makeRequest(), {
      params: Promise.resolve({ id: 'booking_1' }),
    })

    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: 'Uploaded file not found in storage.',
    })

    expect(response.status).toBe(400)

    expect(fetchSpy).toHaveBeenCalledWith(
      'https://storage.example.test/signed/private-photo',
      { method: 'HEAD' },
    )

    expect(fetchSpy).toHaveBeenCalledWith(
      'https://storage.example.test/signed/private-photo',
      { method: 'GET' },
    )

    expect(mocks.failStartedRouteIdempotency).toHaveBeenCalledWith({
      idempotencyRecordId: 'idem_record_1',
      operation: 'POST /api/pro/bookings/[id]/media',
    })

    expect(mocks.uploadProBookingMedia).not.toHaveBeenCalled()
    expect(mocks.completeRouteIdempotency).not.toHaveBeenCalled()

    fetchSpy.mockRestore()
  })
})