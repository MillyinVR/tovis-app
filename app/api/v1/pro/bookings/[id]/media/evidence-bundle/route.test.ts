import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requirePro: vi.fn(),
  jsonFail: vi.fn(),
  pickString: vi.fn(),
  gatherEvidenceBundleData: vi.fn(),
  buildEvidenceBundlePdf: vi.fn(),
  getBrandForTenantContext: vi.fn(),
  resolveTenantContextForRequest: vi.fn(),
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
  pickString: mocks.pickString,
}))

vi.mock('@/lib/media/evidenceBundleData', () => ({
  gatherEvidenceBundleData: mocks.gatherEvidenceBundleData,
}))

vi.mock('@/lib/media/evidenceBundlePdf', () => ({
  buildEvidenceBundlePdf: mocks.buildEvidenceBundlePdf,
}))

vi.mock('@/lib/brand/forTenant', () => ({
  getBrandForTenantContext: mocks.getBrandForTenantContext,
}))

vi.mock('@/lib/tenant/requestContext', () => ({
  resolveTenantContextForRequest: mocks.resolveTenantContextForRequest,
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

import { GET } from './route'

function makeCtx(id = 'booking_1') {
  return { params: Promise.resolve({ id }) }
}

function makeRequest(): Request {
  return new Request(
    'http://localhost/api/v1/pro/bookings/booking_1/media/evidence-bundle',
    { method: 'GET' },
  )
}

describe('GET /api/v1/pro/bookings/[id]/media/evidence-bundle', () => {
  beforeEach(() => {
    mocks.requirePro.mockResolvedValue({
      ok: true,
      professionalId: 'pro_1',
      user: { id: 'user_1' },
    })
    mocks.pickString.mockImplementation((v: unknown) =>
      typeof v === 'string' && v.trim() ? v.trim() : null,
    )
    mocks.jsonFail.mockImplementation(
      (status: number, error: string) =>
        new Response(JSON.stringify({ ok: false, error }), { status }),
    )
    mocks.proRateLimitKey.mockReturnValue('user:user_1|pro:pro_1|ip:unknown-ip')
    mocks.enforceRateLimit.mockResolvedValue({ allowed: true })
    mocks.resolveTenantContextForRequest.mockResolvedValue({ tenantId: 't1' })
    mocks.getBrandForTenantContext.mockReturnValue({ displayName: 'Tovis' })
    mocks.gatherEvidenceBundleData.mockResolvedValue({
      ok: true,
      data: { bookingId: 'booking_1' },
    })
    mocks.buildEvidenceBundlePdf.mockResolvedValue({
      filename: 'evidence-bundle-booking_1.pdf',
      bytes: new Uint8Array([1, 2, 3]),
    })
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('returns the auth response when requirePro fails', async () => {
    const authResponse = new Response(null, { status: 401 })
    mocks.requirePro.mockResolvedValue({ ok: false, res: authResponse })

    const result = await GET(makeRequest(), makeCtx())

    expect(result).toBe(authResponse)
    expect(mocks.gatherEvidenceBundleData).not.toHaveBeenCalled()
  })

  it('returns 400 when the booking id is missing', async () => {
    await GET(makeRequest(), makeCtx(''))
    expect(mocks.jsonFail).toHaveBeenCalledWith(400, 'Missing booking id.')
  })

  it('returns the rate-limit response before gathering data', async () => {
    const limited = { allowed: false, retryAfterSeconds: 30 }
    mocks.enforceRateLimit.mockResolvedValue(limited)
    mocks.rateLimitExceededResponse.mockReturnValue(new Response(null, { status: 429 }))

    const result = await GET(makeRequest(), makeCtx())

    expect(result.status).toBe(429)
    expect(mocks.gatherEvidenceBundleData).not.toHaveBeenCalled()
  })

  it('propagates a gather failure as a JSON error, never builds a PDF', async () => {
    mocks.gatherEvidenceBundleData.mockResolvedValue({
      ok: false,
      status: 404,
      error: 'Booking not found.',
    })

    await GET(makeRequest(), makeCtx())

    expect(mocks.jsonFail).toHaveBeenCalledWith(404, 'Booking not found.')
    expect(mocks.buildEvidenceBundlePdf).not.toHaveBeenCalled()
  })

  it('streams the PDF with the right headers on success', async () => {
    const result = await GET(makeRequest(), makeCtx())

    expect(mocks.buildEvidenceBundlePdf).toHaveBeenCalledWith(
      { bookingId: 'booking_1' },
      'Tovis',
    )
    expect(result.status).toBe(200)
    expect(result.headers.get('Content-Type')).toBe('application/pdf')
    expect(result.headers.get('Content-Disposition')).toBe(
      'attachment; filename="evidence-bundle-booking_1.pdf"',
    )
    expect(result.headers.get('Cache-Control')).toBe('no-store')
    await expect(result.arrayBuffer()).resolves.toEqual(
      new Uint8Array([1, 2, 3]).buffer,
    )
  })

  it('returns 500 and reports the exception when the PDF builder throws', async () => {
    mocks.buildEvidenceBundlePdf.mockRejectedValue(new Error('boom'))

    await GET(makeRequest(), makeCtx())

    expect(mocks.jsonFail).toHaveBeenCalledWith(500, 'Internal server error')
    expect(mocks.captureBookingException).toHaveBeenCalledWith(
      expect.objectContaining({
        route: 'GET /api/v1/pro/bookings/[id]/media/evidence-bundle',
      }),
    )
  })
})
