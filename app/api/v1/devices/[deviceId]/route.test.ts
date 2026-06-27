import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  jsonOk: vi.fn(),
  jsonFail: vi.fn(),
  revokeDeviceSession: vi.fn(),
  deactivateDeviceTokensByDeviceId: vi.fn(),
  safeError: vi.fn(),
}))

vi.mock('@/app/api/_utils/auth/requireUser', () => ({
  requireUser: mocks.requireUser,
}))

vi.mock('@/app/api/_utils/responses', () => ({
  jsonOk: mocks.jsonOk,
  jsonFail: mocks.jsonFail,
}))

vi.mock('@/lib/auth/deviceSessions', () => ({
  revokeDeviceSession: mocks.revokeDeviceSession,
}))

vi.mock('@/lib/notifications/devices/deviceTokens', () => ({
  deactivateDeviceTokensByDeviceId: mocks.deactivateDeviceTokensByDeviceId,
}))

vi.mock('@/lib/security/logging', () => ({
  safeError: mocks.safeError,
}))

import { DELETE } from './route'

function makeJsonResponse(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function makeRequest(): Request {
  return new Request('https://app.tovis.app/api/v1/devices/device_abc', {
    method: 'DELETE',
  })
}

function makeParams(deviceId: string) {
  return { params: Promise.resolve({ deviceId }) }
}

describe('/api/v1/devices/[deviceId] DELETE', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)

    mocks.requireUser.mockResolvedValue({ ok: true, user: { id: 'user_1' } })
    mocks.jsonOk.mockImplementation((data: Record<string, unknown>, status = 200) =>
      makeJsonResponse(status, { ok: true, ...(data ?? {}) }),
    )
    mocks.jsonFail.mockImplementation(
      (status: number, error: string, extra?: Record<string, unknown>) =>
        makeJsonResponse(status, { ok: false, error, ...(extra ?? {}) }),
    )
    mocks.revokeDeviceSession.mockResolvedValue(
      new Date('2026-06-27T12:00:00.000Z'),
    )
    mocks.deactivateDeviceTokensByDeviceId.mockResolvedValue(2)
  })

  it('revokes the device session and deactivates its push tokens, scoped to the owner', async () => {
    const res = await DELETE(makeRequest(), makeParams(' device_abc '))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.deviceId).toBe('device_abc')
    expect(body.revokedAt).toBe('2026-06-27T12:00:00.000Z')
    expect(body.pushTokensDeactivated).toBe(2)

    expect(mocks.revokeDeviceSession).toHaveBeenCalledWith({
      userId: 'user_1',
      deviceId: 'device_abc',
    })
    expect(mocks.deactivateDeviceTokensByDeviceId).toHaveBeenCalledWith({
      userId: 'user_1',
      deviceId: 'device_abc',
    })
  })

  it('400s on a blank deviceId', async () => {
    const res = await DELETE(makeRequest(), makeParams('   '))

    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('MISSING_DEVICE_ID')
    expect(mocks.revokeDeviceSession).not.toHaveBeenCalled()
  })

  it('401s when unauthenticated', async () => {
    mocks.requireUser.mockResolvedValue({
      ok: false,
      res: makeJsonResponse(401, { ok: false }),
    })

    const res = await DELETE(makeRequest(), makeParams('device_abc'))

    expect(res.status).toBe(401)
    expect(mocks.revokeDeviceSession).not.toHaveBeenCalled()
  })
})
