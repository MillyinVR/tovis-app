import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requirePro: vi.fn(),
  jsonOk: vi.fn(),
  jsonFail: vi.fn(),
  loadNotificationPreferences: vi.fn(),
  saveNotificationPreferences: vi.fn(),
}))

vi.mock('@/app/api/_utils', () => ({
  requirePro: mocks.requirePro,
  jsonOk: mocks.jsonOk,
  jsonFail: mocks.jsonFail,
}))

vi.mock('@/lib/notifications/preferenceService', () => ({
  loadNotificationPreferences: mocks.loadNotificationPreferences,
  saveNotificationPreferences: mocks.saveNotificationPreferences,
}))

import { GET, PATCH } from './route'

function patchRequest(body: unknown): Request {
  return new Request('http://localhost/api/v1/pro/notification-preferences', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const validBody = {
  events: {
    BOOKING_REQUEST_CREATED: { inAppEnabled: true, smsEnabled: true, emailEnabled: false },
  },
  quietHours: { enabled: false, startMinutes: 0, endMinutes: 0 },
}

describe('pro notification-preferences route', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mocks.requirePro.mockResolvedValue({
      ok: true,
      professionalId: 'pro_1',
      proId: 'pro_1',
      userId: 'user_1',
      user: { id: 'user_1' },
    })
    mocks.jsonOk.mockImplementation((data: unknown, status = 200) => ({
      ok: true,
      status,
      data,
    }))
    mocks.jsonFail.mockImplementation((status: number, error: string) => ({
      ok: false,
      status,
      error,
    }))
    mocks.loadNotificationPreferences.mockResolvedValue({
      categories: [],
      events: {},
      quietHours: { enabled: false, startMinutes: 1320, endMinutes: 480 },
    })
    mocks.saveNotificationPreferences.mockResolvedValue(undefined)
  })

  it('GET returns the auth response when not a pro', async () => {
    const authRes = { ok: false, status: 403 }
    mocks.requirePro.mockResolvedValueOnce({ ok: false, res: authRes })

    const res = await GET()

    expect(res).toBe(authRes)
    expect(mocks.loadNotificationPreferences).not.toHaveBeenCalled()
  })

  it('GET loads preferences scoped to the authenticated pro', async () => {
    await GET()

    expect(mocks.loadNotificationPreferences).toHaveBeenCalledWith({
      audience: 'pro',
      ownerId: 'pro_1',
    })
  })

  it('PATCH saves owner-scoped to the authenticated pro', async () => {
    await PATCH(patchRequest({ ...validBody, professionalId: 'attacker' }))

    expect(mocks.saveNotificationPreferences).toHaveBeenCalledTimes(1)
    const arg = mocks.saveNotificationPreferences.mock.calls[0]?.[0]
    expect(arg).toMatchObject({ audience: 'pro', ownerId: 'pro_1' })
  })

  it('PATCH rejects a client-only event key for a pro audience', async () => {
    // AFTERCARE_READY is a client event; it is not pro-manageable.
    const res = await PATCH(
      patchRequest({
        events: { AFTERCARE_READY: { inAppEnabled: true, smsEnabled: true, emailEnabled: true } },
        quietHours: { enabled: false, startMinutes: 0, endMinutes: 0 },
      }),
    )

    expect(res).toMatchObject({ ok: false, status: 400 })
    expect(mocks.saveNotificationPreferences).not.toHaveBeenCalled()
  })
})
