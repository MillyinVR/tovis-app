import { beforeEach, describe, expect, it, vi } from 'vitest'

const requirePro = vi.fn()
const jsonOk = vi.fn((body: unknown, status: number) => ({
  status,
  body,
}))

const markAllProNotificationsRead = vi.fn()

vi.mock('@/app/api/_utils', () => ({
  requirePro,
  jsonOk,
}))

vi.mock('@/lib/notifications/proNotificationQueries', () => ({
  markAllProNotificationsRead,
}))

import { POST } from '@/app/api/pro/notifications/mark-read/route'

describe('POST /api/pro/notifications/mark-read', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns auth response when requirePro fails', async () => {
    const authRes = { status: 401, body: { ok: false, error: 'Unauthorized' } }

    requirePro.mockResolvedValueOnce({
      ok: false,
      res: authRes,
    })

    const result = await POST()

    expect(result).toBe(authRes)
    expect(markAllProNotificationsRead).not.toHaveBeenCalled()
  })

  it('marks all unread notifications as read and returns count', async () => {
    requirePro.mockResolvedValueOnce({
      ok: true,
      professionalId: 'pro_123',
    })

    markAllProNotificationsRead.mockResolvedValueOnce({
      count: 7,
    })

    const result = await POST()

    expect(markAllProNotificationsRead).toHaveBeenCalledWith({
      professionalId: 'pro_123',
    })

    expect(jsonOk).toHaveBeenCalledWith(
      {
        ok: true,
        count: 7,
      },
      200,
    )

    expect(result).toEqual({
      status: 200,
      body: {
        ok: true,
        count: 7,
      },
    })
  })

  it('returns ok with count 0 when there is nothing unread', async () => {
    requirePro.mockResolvedValueOnce({
      ok: true,
      professionalId: 'pro_123',
    })

    markAllProNotificationsRead.mockResolvedValueOnce({
      count: 0,
    })

    const result = await POST()

    expect(markAllProNotificationsRead).toHaveBeenCalledWith({
      professionalId: 'pro_123',
    })

    expect(jsonOk).toHaveBeenCalledWith(
      {
        ok: true,
        count: 0,
      },
      200,
    )

    expect(result).toEqual({
      status: 200,
      body: {
        ok: true,
        count: 0,
      },
    })
  })
})