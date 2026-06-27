// app/api/v1/pro/uploads/route.test.ts

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requirePro: vi.fn(),
  jsonFail: vi.fn(),
  jsonOk: vi.fn(),
  requireProBooking: vi.fn(),
  getSupabaseAdmin: vi.fn(),
  createSignedUploadUrl: vi.fn(),
  storageFrom: vi.fn(),
  resolveProTenantId: vi.fn(),
  createUploadSession: vi.fn(),
  uploadSurfaceForKind: vi.fn(),
}))

vi.mock('@/app/api/_utils', () => ({
  requirePro: mocks.requirePro,
  jsonFail: mocks.jsonFail,
  jsonOk: mocks.jsonOk,
}))

vi.mock('@/lib/prisma', () => ({ prisma: {} }))

vi.mock('@/app/api/_utils/auth/requireProBooking', () => ({
  requireProBooking: mocks.requireProBooking,
}))

vi.mock('@/lib/supabaseAdmin', () => ({
  getSupabaseAdmin: mocks.getSupabaseAdmin,
}))

vi.mock('@/lib/tenant/bookingAttribution', () => ({
  resolveProTenantId: mocks.resolveProTenantId,
}))

vi.mock('@/lib/media/uploadSession', () => ({
  createUploadSession: mocks.createUploadSession,
  uploadSurfaceForKind: mocks.uploadSurfaceForKind,
}))

import { POST } from './route'

function makeJsonResponse(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function makeRequest(body: Record<string, unknown>): Request {
  return new Request('http://localhost/api/v1/pro/uploads', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })
}

const PRO_ID = 'pro_1'

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co')

  mocks.requirePro.mockResolvedValue({
    ok: true,
    professionalId: PRO_ID,
    proId: PRO_ID,
    user: { id: 'user_1' },
  })
  mocks.jsonFail.mockImplementation(
    (status: number, error: string, extra?: Record<string, unknown>) =>
      makeJsonResponse(status, { ok: false, error, ...(extra ?? {}) }),
  )
  mocks.jsonOk.mockImplementation((payload: unknown, status = 200) =>
    makeJsonResponse(status, {
      ok: true,
      ...(typeof payload === 'object' && payload !== null ? payload : {}),
    }),
  )

  mocks.requireProBooking.mockResolvedValue({
    ok: true,
    booking: { id: 'booking_1' },
  })
  mocks.createSignedUploadUrl.mockResolvedValue({
    data: { token: 'signed-token', signedUrl: 'https://example/signed' },
    error: null,
  })
  mocks.storageFrom.mockReturnValue({
    createSignedUploadUrl: mocks.createSignedUploadUrl,
  })
  mocks.getSupabaseAdmin.mockReturnValue({
    storage: { from: mocks.storageFrom },
  })
  mocks.uploadSurfaceForKind.mockReturnValue(null)
  mocks.resolveProTenantId.mockResolvedValue('tenant_1')
  mocks.createUploadSession.mockResolvedValue({ id: 'session_1' })
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('POST /api/v1/pro/uploads', () => {
  it('returns the auth response when requirePro fails', async () => {
    const authRes = makeJsonResponse(401, { ok: false, error: 'Unauthorized' })
    mocks.requirePro.mockResolvedValueOnce({ ok: false, res: authRes })

    const res = await POST(
      makeRequest({ kind: 'PORTFOLIO_PUBLIC', contentType: 'image/png' }),
    )

    expect(res).toBe(authRes)
    expect(mocks.createSignedUploadUrl).not.toHaveBeenCalled()
  })

  it('fails with 500 when the Supabase URL env is missing', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '')

    const res = await POST(
      makeRequest({ kind: 'PORTFOLIO_PUBLIC', contentType: 'image/png' }),
    )

    expect(res.status).toBe(500)
  })

  it('rejects an invalid upload kind', async () => {
    const res = await POST(
      makeRequest({ kind: 'NONSENSE', contentType: 'image/png' }),
    )

    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual({ ok: false, error: 'Invalid kind' })
  })

  it('rejects a missing content type', async () => {
    const res = await POST(makeRequest({ kind: 'PORTFOLIO_PUBLIC' }))

    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual({
      ok: false,
      error: 'Missing contentType',
    })
  })

  it('rejects a non image/video content type', async () => {
    const res = await POST(
      makeRequest({ kind: 'PORTFOLIO_PUBLIC', contentType: 'application/pdf' }),
    )

    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual({
      ok: false,
      error: 'Only image/video uploads allowed',
    })
  })

  it('requires a bookingId for CONSULT_PRIVATE uploads', async () => {
    const res = await POST(
      makeRequest({
        kind: 'CONSULT_PRIVATE',
        contentType: 'image/png',
        phase: 'BEFORE',
      }),
    )

    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual({
      ok: false,
      error: 'Missing bookingId',
    })
    expect(mocks.requireProBooking).not.toHaveBeenCalled()
  })

  it('requires a phase for CONSULT_PRIVATE uploads', async () => {
    const res = await POST(
      makeRequest({
        kind: 'CONSULT_PRIVATE',
        contentType: 'image/png',
        bookingId: 'booking_1',
      }),
    )

    expect(res.status).toBe(400)
    expect(mocks.requireProBooking).not.toHaveBeenCalled()
  })

  it('enforces booking ownership BEFORE issuing a signed token (404 on a foreign booking)', async () => {
    mocks.requireProBooking.mockResolvedValueOnce({
      ok: false,
      res: makeJsonResponse(404, { ok: false, error: 'Booking not found.' }),
    })

    const res = await POST(
      makeRequest({
        kind: 'CONSULT_PRIVATE',
        contentType: 'image/png',
        bookingId: 'booking_foreign',
        phase: 'BEFORE',
      }),
    )

    expect(mocks.requireProBooking).toHaveBeenCalledWith(
      'booking_foreign',
      PRO_ID,
      { id: true },
    )
    expect(res.status).toBe(404)
    // critical: no signed upload URL is minted for a booking the pro does not own
    expect(mocks.createSignedUploadUrl).not.toHaveBeenCalled()
  })

  it('issues a signed token for an owned CONSULT_PRIVATE booking using the private bucket', async () => {
    const res = await POST(
      makeRequest({
        kind: 'CONSULT_PRIVATE',
        contentType: 'image/png',
        bookingId: 'booking_1',
        phase: 'BEFORE',
      }),
    )

    expect(mocks.requireProBooking).toHaveBeenCalledWith('booking_1', PRO_ID, {
      id: true,
    })
    expect(mocks.storageFrom).toHaveBeenCalledWith('media-private')
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json).toMatchObject({
      ok: true,
      kind: 'CONSULT_PRIVATE',
      bucket: 'media-private',
      token: 'signed-token',
      isPublic: false,
    })
  })

  it('does not require booking ownership for a non-booking public upload', async () => {
    const res = await POST(
      makeRequest({ kind: 'PORTFOLIO_PUBLIC', contentType: 'image/png' }),
    )

    expect(mocks.requireProBooking).not.toHaveBeenCalled()
    expect(mocks.storageFrom).toHaveBeenCalledWith('media-public')
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({
      ok: true,
      bucket: 'media-public',
      isPublic: true,
    })
  })

  it('binds an upload session when the kind maps to a surface', async () => {
    mocks.uploadSurfaceForKind.mockReturnValueOnce('PORTFOLIO')

    const res = await POST(
      makeRequest({ kind: 'PORTFOLIO_PUBLIC', contentType: 'image/png' }),
    )

    expect(mocks.createUploadSession).toHaveBeenCalledTimes(1)
    await expect(res.json()).resolves.toMatchObject({
      ok: true,
      uploadSessionId: 'session_1',
    })
  })

  it('returns 500 when Supabase fails to create the signed URL', async () => {
    mocks.createSignedUploadUrl.mockResolvedValueOnce({
      data: null,
      error: { message: 'boom', name: 'StorageError', statusCode: 500 },
    })

    const res = await POST(
      makeRequest({ kind: 'PORTFOLIO_PUBLIC', contentType: 'image/png' }),
    )

    expect(res.status).toBe(500)
  })
})
