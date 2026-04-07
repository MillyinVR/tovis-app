import { beforeEach, describe, expect, it, vi } from 'vitest'

const requirePro = vi.fn()
const jsonOk = vi.fn((body: unknown, status: number) => ({
  status,
  body,
}))

const getProNotificationSummary = vi.fn()

vi.mock('@/app/api/_utils/auth/requirePro', () => ({
  requirePro,
}))

vi.mock('@/app/api/_utils', () => ({
  jsonOk,
}))

vi.mock('@/lib/notifications/proNotificationQueries', () => ({
  getProNotificationSummary,
}))

import { GET } from '@/app/api/pro/notifications/summary/route'

describe('GET /api/pro/notifications/summary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns auth response when requirePro fails', async () => {
    const authRes = {
      status: 401,
      body: { ok: false, error: 'Unauthorized' },
    }

    requirePro.mockResolvedValueOnce({
      ok: false,
      res: authRes,
    })

    const result = await GET()

    expect(result).toBe(authRes)
    expect(getProNotificationSummary).not.toHaveBeenCalled()
  })

  it('returns unread summary for the authenticated pro', async () => {
    requirePro.mockResolvedValueOnce({
      ok: true,
      professionalId: 'pro_123',
    })

    getProNotificationSummary.mockResolvedValueOnce({
      hasUnread: true,
      count: 5,
    })

    const result = await GET()

    expect(getProNotificationSummary).toHaveBeenCalledWith({
      professionalId: 'pro_123',
    })

    expect(jsonOk).toHaveBeenCalledWith(
      {
        hasUnread: true,
        count: 5,
      },
      200,
    )

    expect(result).toEqual({
      status: 200,
      body: {
        hasUnread: true,
        count: 5,
      },
    })
  })

  it('returns zero summary when there are no unread notifications', async () => {
    requirePro.mockResolvedValueOnce({
      ok: true,
      professionalId: 'pro_123',
    })

    getProNotificationSummary.mockResolvedValueOnce({
      hasUnread: false,
      count: 0,
    })

    const result = await GET()

    expect(getProNotificationSummary).toHaveBeenCalledWith({
      professionalId: 'pro_123',
    })

    expect(jsonOk).toHaveBeenCalledWith(
      {
        hasUnread: false,
        count: 0,
      },
      200,
    )

    expect(result).toEqual({
      status: 200,
      body: {
        hasUnread: false,
        count: 0,
      },
    })
  })
})