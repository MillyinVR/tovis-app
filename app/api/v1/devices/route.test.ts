import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  jsonOk: vi.fn(),
  jsonFail: vi.fn(),
  registerDeviceToken: vi.fn(),
  deactivateDeviceToken: vi.fn(),
  listUserDevices: vi.fn(),
  listDeviceSessionRevocations: vi.fn(),
  serializeDeviceToken: vi.fn(),
  serializeUserDevice: vi.fn(),
  safeError: vi.fn(),
}))

vi.mock('@/app/api/_utils/auth/requireUser', () => ({
  requireUser: mocks.requireUser,
}))

vi.mock('@/app/api/_utils/responses', () => ({
  jsonOk: mocks.jsonOk,
  jsonFail: mocks.jsonFail,
}))

vi.mock('@/lib/notifications/devices/deviceTokens', () => ({
  registerDeviceToken: mocks.registerDeviceToken,
  deactivateDeviceToken: mocks.deactivateDeviceToken,
  listUserDevices: mocks.listUserDevices,
}))

vi.mock('@/lib/auth/deviceSessions', () => ({
  listDeviceSessionRevocations: mocks.listDeviceSessionRevocations,
}))

vi.mock('@/lib/dto/deviceToken', () => ({
  serializeDeviceToken: mocks.serializeDeviceToken,
}))

vi.mock('@/lib/dto/device', () => ({
  serializeUserDevice: mocks.serializeUserDevice,
}))

vi.mock('@/lib/security/logging', () => ({
  safeError: mocks.safeError,
}))

import { DELETE, GET, POST } from './route'

function makeJsonResponse(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function makeRequest(body: unknown): Request {
  return new Request('https://app.tovis.app/api/v1/devices', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('/api/v1/devices', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)

    mocks.requireUser.mockResolvedValue({ ok: true, user: { id: 'user_1' } })
    mocks.jsonOk.mockImplementation(
      (data: Record<string, unknown>, status = 200) =>
        makeJsonResponse(status, { ok: true, ...(data ?? {}) }),
    )
    mocks.jsonFail.mockImplementation(
      (status: number, error: string, extra?: Record<string, unknown>) =>
        makeJsonResponse(status, { ok: false, error, ...(extra ?? {}) }),
    )
    mocks.serializeDeviceToken.mockImplementation((row: { id: string }) => ({
      id: row.id,
      platform: 'IOS',
      deviceId: null,
      isActive: true,
      lastSeenAt: null,
      createdAt: '2026-06-27T00:00:00.000Z',
    }))
  })

  describe('POST', () => {
    it('returns the auth response when unauthenticated', async () => {
      const denied = makeJsonResponse(401, { ok: false })
      mocks.requireUser.mockResolvedValue({ ok: false, res: denied })

      const res = await POST(makeRequest({ platform: 'IOS', token: 't' }))

      expect(res.status).toBe(401)
      expect(mocks.registerDeviceToken).not.toHaveBeenCalled()
    })

    it('registers a token for the authed user and does NOT echo the raw token', async () => {
      mocks.registerDeviceToken.mockResolvedValue({ id: 'dt_1' })

      const res = await POST(
        makeRequest({ platform: 'ios', token: 'apns-abc', deviceId: 'dev-9' }),
      )
      const body = await res.json()

      expect(res.status).toBe(200)
      expect(mocks.registerDeviceToken).toHaveBeenCalledWith({
        userId: 'user_1',
        platform: 'IOS', // case-insensitive normalize
        token: 'apns-abc',
        deviceId: 'dev-9',
      })
      expect(body.device.id).toBe('dt_1')
      expect(JSON.stringify(body)).not.toContain('apns-abc')
    })

    it('400s on an invalid platform', async () => {
      const res = await POST(makeRequest({ platform: 'WINDOWS', token: 't' }))
      expect(res.status).toBe(400)
      expect((await res.json()).code).toBe('INVALID_PLATFORM')
      expect(mocks.registerDeviceToken).not.toHaveBeenCalled()
    })

    it('400s when the token is missing', async () => {
      const res = await POST(makeRequest({ platform: 'ANDROID' }))
      expect(res.status).toBe(400)
      expect((await res.json()).code).toBe('MISSING_TOKEN')
    })
  })

  describe('DELETE', () => {
    it('deactivates the token for the authed user (idempotent)', async () => {
      mocks.deactivateDeviceToken.mockResolvedValue(false)

      const res = await DELETE(makeRequest({ platform: 'ANDROID', token: 'fcm-xyz' }))
      const body = await res.json()

      expect(res.status).toBe(200)
      expect(body.removed).toBe(false)
      expect(mocks.deactivateDeviceToken).toHaveBeenCalledWith({
        userId: 'user_1',
        platform: 'ANDROID',
        token: 'fcm-xyz',
      })
    })

    it('400s on missing token', async () => {
      const res = await DELETE(makeRequest({ platform: 'IOS' }))
      expect(res.status).toBe(400)
      expect((await res.json()).code).toBe('MISSING_TOKEN')
    })
  })

  describe('GET (manage-devices list)', () => {
    it('lists the user devices joined with their revocation state', async () => {
      mocks.listUserDevices.mockResolvedValue([
        { deviceId: 'device_abc', platforms: ['IOS'], pushActive: true, lastSeenAt: null },
        { deviceId: 'device_xyz', platforms: ['ANDROID'], pushActive: false, lastSeenAt: null },
      ])
      mocks.listDeviceSessionRevocations.mockResolvedValue([
        { deviceId: 'device_xyz', revokedAt: new Date('2026-06-27T00:00:00.000Z') },
      ])
      mocks.serializeUserDevice.mockImplementation(
        (device: { deviceId: string }, revokedAt: Date | null) => ({
          deviceId: device.deviceId,
          revoked: revokedAt !== null,
        }),
      )

      const res = await GET()
      const body = await res.json()

      expect(res.status).toBe(200)
      expect(body.devices).toEqual([
        { deviceId: 'device_abc', revoked: false },
        { deviceId: 'device_xyz', revoked: true },
      ])
      // The revoked instant is matched per device by deviceId, not positionally.
      expect(mocks.serializeUserDevice).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ deviceId: 'device_abc' }),
        null,
      )
      expect(mocks.serializeUserDevice).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ deviceId: 'device_xyz' }),
        new Date('2026-06-27T00:00:00.000Z'),
      )
    })

    it('401s when unauthenticated', async () => {
      mocks.requireUser.mockResolvedValue({
        ok: false,
        res: makeJsonResponse(401, { ok: false }),
      })

      const res = await GET()
      expect(res.status).toBe(401)
      expect(mocks.listUserDevices).not.toHaveBeenCalled()
    })
  })
})
