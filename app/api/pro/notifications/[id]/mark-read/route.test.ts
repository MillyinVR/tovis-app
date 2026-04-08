import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requirePro: vi.fn(),
  pickString: vi.fn((value: unknown) => {
    if (typeof value !== 'string') return null
    const trimmed = value.trim()
    return trimmed.length > 0 ? trimmed : null
  }),
  jsonFail: vi.fn((status: number, error: string) => ({
    status,
    body: { ok: false, error },
  })),
  jsonOk: vi.fn((body: unknown, status: number) => ({
    status,
    body,
  })),
  markProNotificationRead: vi.fn(),
}))

vi.mock('@/app/api/_utils', () => ({
  requirePro: mocks.requirePro,
  pickString: mocks.pickString,
  jsonFail: mocks.jsonFail,
  jsonOk: mocks.jsonOk,
}))

vi.mock('@/lib/notifications/proNotificationQueries', () => ({
  markProNotificationRead: mocks.markProNotificationRead,
}))

import { POST } from '@/app/api/pro/notifications/[id]/mark-read/route'

describe('POST /api/pro/notifications/[id]/mark-read', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns auth response when requirePro fails', async () => {
    const authRes = { status: 401, body: { ok: false, error: 'Unauthorized' } }

    mocks.requirePro.mockResolvedValueOnce({
      ok: false,
      res: authRes,
    })

    const result = await POST(new Request('http://localhost'), {
      params: { id: 'notif_123' },
    })

    expect(result).toBe(authRes)
    expect(mocks.markProNotificationRead).not.toHaveBeenCalled()
  })

  it('returns 400 when notification id is missing', async () => {
    mocks.requirePro.mockResolvedValueOnce({
      ok: true,
      professionalId: 'pro_123',
    })

    const result = await POST(new Request('http://localhost'), {
      params: { id: '   ' },
    })

    expect(mocks.pickString).toHaveBeenCalledWith('   ')
    expect(mocks.jsonFail).toHaveBeenCalledWith(400, 'Missing notification id.')
    expect(result).toEqual({
      status: 400,
      body: { ok: false, error: 'Missing notification id.' },
    })
    expect(mocks.markProNotificationRead).not.toHaveBeenCalled()
  })

  it('returns 404 when notification is not found', async () => {
    mocks.requirePro.mockResolvedValueOnce({
      ok: true,
      professionalId: 'pro_123',
    })

    mocks.markProNotificationRead.mockResolvedValueOnce(false)

    const result = await POST(new Request('http://localhost'), {
      params: Promise.resolve({ id: 'notif_missing' }),
    })

    expect(mocks.markProNotificationRead).toHaveBeenCalledWith({
      professionalId: 'pro_123',
      notificationId: 'notif_missing',
    })
    expect(mocks.jsonFail).toHaveBeenCalledWith(404, 'Notification not found.')
    expect(result).toEqual({
      status: 404,
      body: { ok: false, error: 'Notification not found.' },
    })
  })

  it('returns 200 when notification is marked read', async () => {
    mocks.requirePro.mockResolvedValueOnce({
      ok: true,
      professionalId: 'pro_123',
    })

    mocks.markProNotificationRead.mockResolvedValueOnce(true)

    const result = await POST(new Request('http://localhost'), {
      params: { id: 'notif_123' },
    })

    expect(mocks.markProNotificationRead).toHaveBeenCalledWith({
      professionalId: 'pro_123',
      notificationId: 'notif_123',
    })
    expect(mocks.jsonOk).toHaveBeenCalledWith({ ok: true }, 200)
    expect(result).toEqual({
      status: 200,
      body: { ok: true },
    })
  })
})