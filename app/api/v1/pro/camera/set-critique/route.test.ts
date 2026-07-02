// app/api/v1/pro/camera/set-critique/route.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requirePro: vi.fn(),
  enforceRateLimit: vi.fn(),
  rateLimitIdentity: vi.fn(),
  critiqueSessionSet: vi.fn(),
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
  return { ...actual, critiqueSessionSet: mocks.critiqueSessionSet }
})

import { CameraVisionError } from '@/lib/pro/cameraVision'

import { POST } from './route'

function request(body: unknown): Request {
  return new Request('http://localhost/api/v1/pro/camera/set-critique', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function photo(id: string, phase = 'AFTER') {
  return { id, phase, image: { base64: 'aGVsbG8=', mediaType: 'image/jpeg' } }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requirePro.mockResolvedValue({ ok: true, userId: 'user-1' })
  mocks.rateLimitIdentity.mockResolvedValue({ kind: 'user', id: 'user-1' })
  mocks.enforceRateLimit.mockResolvedValue(null)
})

describe('POST /api/v1/pro/camera/set-critique', () => {
  it('returns the auth failure response untouched', async () => {
    const res = new Response('nope', { status: 401 })
    mocks.requirePro.mockResolvedValue({ ok: false, res })

    expect(await POST(request({ photos: [photo('a')] }))).toBe(res)
    expect(mocks.critiqueSessionSet).not.toHaveBeenCalled()
  })

  it('returns the rate-limit response and skips the vision call', async () => {
    const limited = new Response('slow down', { status: 429 })
    mocks.enforceRateLimit.mockResolvedValue(limited)

    expect(await POST(request({ photos: [photo('a')] }))).toBe(limited)
    expect(mocks.enforceRateLimit).toHaveBeenCalledWith({
      bucket: 'pro:camera:set-critique',
      identity: { kind: 'user', id: 'user-1' },
    })
    expect(mocks.critiqueSessionSet).not.toHaveBeenCalled()
  })

  it.each([
    ['no photos', { photos: [] }],
    ['too many photos', { photos: Array.from({ length: 11 }, (_, i) => photo(`p${i}`)) }],
    ['duplicate ids', { photos: [photo('a'), photo('a')] }],
    ['bad phase', { photos: [photo('a', 'DURING')] }],
    [
      'bad image',
      { photos: [{ id: 'a', phase: 'AFTER', image: { base64: '!', mediaType: 'image/jpeg' } }] },
    ],
  ])('rejects %s with 400', async (_label, body) => {
    const res = await POST(request(body))

    expect(res.status).toBe(400)
    expect(mocks.critiqueSessionSet).not.toHaveBeenCalled()
  })

  it('returns the critique on success', async () => {
    const critique = {
      overall: 'Publish the glance.',
      strengths: ['Even light'],
      photos: [
        { id: 'a', verdict: 'portfolio', note: 'Hero', retakeTip: null },
      ],
    }
    mocks.critiqueSessionSet.mockResolvedValue(critique)

    const res = await POST(
      request({
        photos: [photo('a', 'BEFORE'), photo('b')],
        serviceName: 'Gel set',
      }),
    )

    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ critique })
    expect(mocks.critiqueSessionSet).toHaveBeenCalledWith({
      photos: [
        {
          id: 'a',
          phase: 'BEFORE',
          image: { base64: 'aGVsbG8=', mediaType: 'image/jpeg' },
        },
        {
          id: 'b',
          phase: 'AFTER',
          image: { base64: 'aGVsbG8=', mediaType: 'image/jpeg' },
        },
      ],
      serviceName: 'Gel set',
    })
  })

  it('maps vision unavailability to 502', async () => {
    mocks.critiqueSessionSet.mockRejectedValue(
      new CameraVisionError('unavailable', 'overloaded'),
    )

    const res = await POST(request({ photos: [photo('a')] }))

    expect(res.status).toBe(502)
  })

  it('maps a bad-output analysis to 422', async () => {
    mocks.critiqueSessionSet.mockRejectedValue(
      new CameraVisionError('bad_output', 'no notes'),
    )

    const res = await POST(request({ photos: [photo('a')] }))

    expect(res.status).toBe(422)
  })

  it('maps unexpected errors to 500', async () => {
    mocks.critiqueSessionSet.mockRejectedValue(new Error('boom'))

    const res = await POST(request({ photos: [photo('a')] }))

    expect(res.status).toBe(500)
  })
})
