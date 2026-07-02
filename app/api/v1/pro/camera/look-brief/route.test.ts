// app/api/v1/pro/camera/look-brief/route.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requirePro: vi.fn(),
  enforceRateLimit: vi.fn(),
  rateLimitIdentity: vi.fn(),
  enhanceReferenceLook: vi.fn(),
}))

vi.mock('@/app/api/_utils/auth/requirePro', () => ({
  requirePro: mocks.requirePro,
}))

vi.mock('@/app/api/_utils/rateLimit', () => ({
  enforceRateLimit: mocks.enforceRateLimit,
  rateLimitIdentity: mocks.rateLimitIdentity,
}))

vi.mock('@/lib/pro/cameraVision', async () => {
  const actual = await vi.importActual<typeof import('@/lib/pro/cameraVision')>(
    '@/lib/pro/cameraVision',
  )
  return { ...actual, enhanceReferenceLook: mocks.enhanceReferenceLook }
})

import { CameraVisionError } from '@/lib/pro/cameraVision'

import { POST } from './route'

function request(body: unknown): Request {
  return new Request('http://localhost/api/v1/pro/camera/look-brief', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const VALID_BODY = {
  image: { base64: 'aGVsbG8=', mediaType: 'image/jpeg' },
  serviceName: 'Balayage',
  measuredSummary: 'fill 0.4',
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requirePro.mockResolvedValue({ ok: true, userId: 'user-1' })
  mocks.rateLimitIdentity.mockResolvedValue({ kind: 'user', id: 'user-1' })
  mocks.enforceRateLimit.mockResolvedValue(null)
})

describe('POST /api/v1/pro/camera/look-brief', () => {
  it('returns the auth failure response untouched', async () => {
    const res = new Response('nope', { status: 401 })
    mocks.requirePro.mockResolvedValue({ ok: false, res })

    expect(await POST(request(VALID_BODY))).toBe(res)
    expect(mocks.enhanceReferenceLook).not.toHaveBeenCalled()
  })

  it('returns the rate-limit response and skips the vision call', async () => {
    const limited = new Response('slow down', { status: 429 })
    mocks.enforceRateLimit.mockResolvedValue(limited)

    expect(await POST(request(VALID_BODY))).toBe(limited)
    expect(mocks.enforceRateLimit).toHaveBeenCalledWith({
      bucket: 'pro:camera:look-brief',
      identity: { kind: 'user', id: 'user-1' },
    })
    expect(mocks.enhanceReferenceLook).not.toHaveBeenCalled()
  })

  it('rejects a missing image with 400', async () => {
    const res = await POST(request({ serviceName: 'Balayage' }))

    expect(res.status).toBe(400)
    expect(mocks.enhanceReferenceLook).not.toHaveBeenCalled()
  })

  it('returns the brief on success', async () => {
    const brief = {
      summary: 'Soft glam',
      poseRules: [],
      directionLines: ['Chin down a touch'],
    }
    mocks.enhanceReferenceLook.mockResolvedValue(brief)

    const res = await POST(request(VALID_BODY))

    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ brief })
    expect(mocks.enhanceReferenceLook).toHaveBeenCalledWith({
      image: { base64: 'aGVsbG8=', mediaType: 'image/jpeg' },
      serviceName: 'Balayage',
      measuredSummary: 'fill 0.4',
    })
  })

  it('maps vision unavailability to 502', async () => {
    mocks.enhanceReferenceLook.mockRejectedValue(
      new CameraVisionError('unavailable', 'overloaded'),
    )

    const res = await POST(request(VALID_BODY))

    expect(res.status).toBe(502)
  })

  it('maps a refused/bad-output analysis to 422', async () => {
    mocks.enhanceReferenceLook.mockRejectedValue(
      new CameraVisionError('refused', 'declined'),
    )

    const res = await POST(request(VALID_BODY))

    expect(res.status).toBe(422)
  })

  it('maps unexpected errors to 500', async () => {
    mocks.enhanceReferenceLook.mockRejectedValue(new Error('boom'))

    const res = await POST(request(VALID_BODY))

    expect(res.status).toBe(500)
  })
})
