import { beforeEach, describe, expect, it, vi } from 'vitest'

const requirePro = vi.fn()
const pickString = vi.fn((value: unknown) => {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
})
const jsonFail = vi.fn((status: number, error: string) => ({
  status,
  body: { ok: false, error },
}))
const jsonOk = vi.fn((body: unknown, status: number) => ({
  status,
  body,
}))

const markProNotificationRead = vi.fn()

vi.mock('@/app/api/_utils', () => ({
  requirePro,
  pickString,
  jsonFail,
  jsonOk,
}))

vi.mock('@/lib/notifications/proNotificationQueries', () => ({
  markProNotificationRead,
}))

import { POST } from '@/app/api/pro/notifications/[id]/mark-read/route'

describe('POST /api/pro/notifications/[id]/mark-read', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns auth response when requirePro fails', async () => {
    const authRes = { status: 401, body: { ok: false, error: 'Unauthorized' } }

    requirePro.mockResolvedValueOnce({
      ok: false,
      res: authRes,
    })

    const result = await POST(new Request('http://localhost'), {
      params: { id: 'notif_123' },
    })

    expect(result).toBe(authRes)
    expect(markProNotificationRead).not.toHaveBeenCalled()
  })

  it('returns 400 when notification id is missing', async () => {
    requirePro.mockResolvedValueOnce({
      ok: true,
      professionalId: 'pro_123',
    })

    const result = await POST(new Request('http://localhost'), {
      params: { id: '   ' },
    })

    expect(pickString).toHaveBeenCalledWith('   ')
    expect(jsonFail).toHaveBeenCalledWith(400, 'Missing notification id.')
    expect(result).toEqual({
      status: 400,
      body: { ok: false, error: 'Missing notification id.' },
    })
    expect(markProNotificationRead).not.toHaveBeenCalled()
  })

  it('returns 404 when notification is not found', async () => {
    requirePro.mockResolvedValueOnce({
      ok: true,
      professionalId: 'pro_123',
    })

    markProNotificationRead.mockResolvedValueOnce(false)

    const result = await POST(new Request('http://localhost'), {
      params: Promise.resolve({ id: 'notif_missing' }),
    })

    expect(markProNotificationRead).toHaveBeenCalledWith({
      professionalId: 'pro_123',
      notificationId: 'notif_missing',
    })
    expect(jsonFail).toHaveBeenCalledWith(404, 'Notification not found.')
    expect(result).toEqual({
      status: 404,
      body: { ok: false, error: 'Notification not found.' },
    })
  })

  it('returns 200 when notification is marked read', async () => {
    requirePro.mockResolvedValueOnce({
      ok: true,
      professionalId: 'pro_123',
    })

    markProNotificationRead.mockResolvedValueOnce(true)

    const result = await POST(new Request('http://localhost'), {
      params: { id: 'notif_123' },
    })

    expect(markProNotificationRead).toHaveBeenCalledWith({
      professionalId: 'pro_123',
      notificationId: 'notif_123',
    })
    expect(jsonOk).toHaveBeenCalledWith({ ok: true }, 200)
    expect(result).toEqual({
      status: 200,
      body: { ok: true },
    })
  })
})