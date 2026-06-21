import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireClient: vi.fn(),
  jsonOk: vi.fn(),
  jsonFail: vi.fn(),
  loadNotificationPreferences: vi.fn(),
  saveNotificationPreferences: vi.fn(),
}))

vi.mock('@/app/api/_utils', () => ({
  requireClient: mocks.requireClient,
  jsonOk: mocks.jsonOk,
  jsonFail: mocks.jsonFail,
}))

vi.mock('@/lib/notifications/preferenceService', () => ({
  loadNotificationPreferences: mocks.loadNotificationPreferences,
  saveNotificationPreferences: mocks.saveNotificationPreferences,
}))

import { GET, PATCH } from './route'

function patchRequest(body: unknown): Request {
  return new Request('http://localhost/api/client/notification-preferences', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const validBody = {
  events: {
    BOOKING_CONFIRMED: { inAppEnabled: true, smsEnabled: false, emailEnabled: true },
  },
  quietHours: { enabled: true, startMinutes: 1320, endMinutes: 480 },
}

describe('client notification-preferences route', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mocks.requireClient.mockResolvedValue({
      ok: true,
      clientId: 'client_1',
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
      quietHours: { enabled: true, startMinutes: 1320, endMinutes: 480 },
    })
    mocks.saveNotificationPreferences.mockResolvedValue(undefined)
  })

  it('GET returns the auth response when not authenticated', async () => {
    const authRes = { ok: false, status: 401 }
    mocks.requireClient.mockResolvedValueOnce({ ok: false, res: authRes })

    const res = await GET()

    expect(res).toBe(authRes)
    expect(mocks.loadNotificationPreferences).not.toHaveBeenCalled()
  })

  it('GET loads preferences scoped to the authenticated client', async () => {
    await GET()

    expect(mocks.loadNotificationPreferences).toHaveBeenCalledWith({
      audience: 'client',
      ownerId: 'client_1',
    })
  })

  it('PATCH rejects an unauthenticated caller before writing', async () => {
    const authRes = { ok: false, status: 401 }
    mocks.requireClient.mockResolvedValueOnce({ ok: false, res: authRes })

    const res = await PATCH(patchRequest(validBody))

    expect(res).toBe(authRes)
    expect(mocks.saveNotificationPreferences).not.toHaveBeenCalled()
  })

  it('PATCH saves owner-scoped to the authenticated client (ignores any body id)', async () => {
    await PATCH(
      patchRequest({ ...validBody, ownerId: 'someone_else', clientId: 'attacker' }),
    )

    expect(mocks.saveNotificationPreferences).toHaveBeenCalledTimes(1)
    const arg = mocks.saveNotificationPreferences.mock.calls[0]?.[0]
    expect(arg).toMatchObject({ audience: 'client', ownerId: 'client_1' })
  })

  it('PATCH is idempotent: re-applying the same body produces the same save call', async () => {
    await PATCH(patchRequest(validBody))
    const first = mocks.saveNotificationPreferences.mock.calls[0]?.[0]

    vi.clearAllMocks()
    mocks.requireClient.mockResolvedValue({
      ok: true,
      clientId: 'client_1',
      user: { id: 'user_1' },
    })
    mocks.saveNotificationPreferences.mockResolvedValue(undefined)
    mocks.loadNotificationPreferences.mockResolvedValue({
      categories: [],
      events: {},
      quietHours: { enabled: true, startMinutes: 1320, endMinutes: 480 },
    })

    await PATCH(patchRequest(validBody))
    const second = mocks.saveNotificationPreferences.mock.calls[0]?.[0]

    expect(second).toEqual(first)
  })

  it('PATCH returns 400 on an unknown event key without saving', async () => {
    const res = await PATCH(
      patchRequest({
        events: { NOT_A_REAL_EVENT: { inAppEnabled: true, smsEnabled: true, emailEnabled: true } },
        quietHours: { enabled: false, startMinutes: 0, endMinutes: 0 },
      }),
    )

    expect(res).toMatchObject({ ok: false, status: 400 })
    expect(mocks.saveNotificationPreferences).not.toHaveBeenCalled()
  })

  it('PATCH returns 400 when an enabled quiet-hours window has equal start/end', async () => {
    const res = await PATCH(
      patchRequest({
        events: {},
        quietHours: { enabled: true, startMinutes: 600, endMinutes: 600 },
      }),
    )

    expect(res).toMatchObject({ ok: false, status: 400 })
    expect(mocks.saveNotificationPreferences).not.toHaveBeenCalled()
  })

  it('PATCH rejects an out-of-range quiet-hours minute', async () => {
    const res = await PATCH(
      patchRequest({
        events: {},
        quietHours: { enabled: true, startMinutes: 1320, endMinutes: 5000 },
      }),
    )

    expect(res).toMatchObject({ ok: false, status: 400 })
    expect(mocks.saveNotificationPreferences).not.toHaveBeenCalled()
  })
})
