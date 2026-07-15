// app/api/v1/pro/camera/usage/route.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requirePro: vi.fn(),
  getProCameraUsage: vi.fn(),
}))

vi.mock('@/app/api/_utils/auth/requirePro', () => ({
  requirePro: mocks.requirePro,
}))

vi.mock('@/lib/pro/cameraQuota', () => ({
  getProCameraUsage: mocks.getProCameraUsage,
}))

import { GET } from './route'

const USAGE = {
  used: 4,
  baseQuota: 6,
  bonus: 2,
  quota: 8,
  remaining: 4,
  enforced: false,
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requirePro.mockResolvedValue({
    ok: true,
    professionalId: 'pro-1',
    userId: 'user-1',
  })
  mocks.getProCameraUsage.mockResolvedValue(USAGE)
})

describe('GET /api/v1/pro/camera/usage', () => {
  it('returns the auth failure response untouched', async () => {
    const res = new Response('nope', { status: 401 })
    mocks.requirePro.mockResolvedValue({ ok: false, res })

    expect(await GET()).toBe(res)
    expect(mocks.getProCameraUsage).not.toHaveBeenCalled()
  })

  it("returns the caller's usage scoped to their professionalId", async () => {
    const res = await GET()
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, usage: USAGE })
    expect(mocks.getProCameraUsage).toHaveBeenCalledWith({
      professionalId: 'pro-1',
    })
  })

  it('returns 500 when the usage read throws', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mocks.getProCameraUsage.mockRejectedValue(new Error('redis exploded'))

    const res = await GET()
    expect(res.status).toBe(500)
    expect(await res.json()).toMatchObject({
      ok: false,
      error: 'Failed to load camera usage.',
    })

    spy.mockRestore()
  })
})
